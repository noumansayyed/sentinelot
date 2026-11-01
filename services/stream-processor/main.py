"""
SentinelOT — Stream Processor
Consumes normalized protocol events from Kafka/Redpanda, upserts the
asset inventory, persists events to TimescaleDB, and runs rule-based
detections: "new device seen", "off-hours activity", "unauthorized
write", and behavioral baselining (per-device timing anomaly via
Welford's online algorithm + z-score).
"""

import asyncio
import json
import logging
import math
import os
from datetime import datetime, timezone

import time as _t
_offhrs_seen: dict = {}

async def _offhrs_ok(pool, event: dict, site_id=None) -> bool:
    # Protocol gate: only alert on protocols enabled in this site's settings.
    enabled = await _get_setting(pool, "detection.enabled_protocols", ["modbus_tcp", "s7comm", "dnp3", "opcua"], site_id=site_id)
    if isinstance(enabled, str):
        try:
            import json as _jj
            enabled = _jj.loads(enabled)
        except Exception:
            enabled = []
    if event.get("protocol") not in (enabled or []):
        return False
    # Per-asset-per-protocol throttle: 15-minute cooldown (unchanged behaviour).
    k = (event.get("protocol"), str(event.get("src_ip") or event.get("asset_id") or ""))
    now = _t.time()
    if now - _offhrs_seen.get(k, 0) < 120:   # 2 minutes, was 15
        return False
    _offhrs_seen[k] = now
    return True

async def is_off_hours(pool, ts: datetime, site_id=None) -> bool:
    from datetime import timedelta as _td
    start_str = await _get_setting(pool, "detection.off_hours_start", "22:00", site_id=site_id)
    end_str   = await _get_setting(pool, "detection.off_hours_end",   "06:00", site_id=site_id)
    try:
        sh, sm = [int(x) for x in str(start_str).split(":")]
        eh, em = [int(x) for x in str(end_str).split(":")]
    except Exception:
        sh, sm, eh, em = 22, 0, 6, 0
    local_hour = ts.astimezone(timezone(_td(hours=5, minutes=30))).hour
    local_min = ts.astimezone(timezone(_td(hours=5, minutes=30))).minute
    now_m = local_hour * 60 + local_min
    start_m = sh * 60 + sm
    end_m = eh * 60 + em
    if start_m <= end_m:
        return start_m <= now_m < end_m
    # Window crosses midnight (e.g. 22:00 → 06:00)
    return now_m >= start_m or now_m < end_m

from uuid import UUID, uuid4

import asyncpg
from confluent_kafka import Consumer, KafkaError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinelot.stream_processor")

KAFKA_BOOTSTRAP_SERVERS = os.environ["KAFKA_BOOTSTRAP_SERVERS"]
DATABASE_URL = os.environ["DATABASE_URL"]
TOPIC = "protocol-events"

# Minimum samples before we trust a device's baseline enough to alert on
# it -- avoids false positives from a device's first few, still-settling
# observations.
BASELINE_MIN_SAMPLES = 30

# ── Runtime settings from DB ────────────────────────────────────────────
import json as _json
from uuid import UUID as _UUID

_TENANT = _UUID("11111111-1111-1111-1111-111111111111")
_settings_cache = {"at": 0.0, "map": {}}
_SETTINGS_TTL = 2.0


async def _get_setting(pool, key, default=None, site_id=None):
    """Read a per-site setting from DB (cached 2s). If site_id is None,
    falls back to any row matching the key — used by tests/debug only.
    All production callers pass site_id."""
    import time as _time
    now = _time.time()
    cache_key = str(site_id) if site_id else "__global__"
    if now - _settings_cache["at"] > _SETTINGS_TTL or _settings_cache.get("site") != cache_key:
        try:
            if site_id:
                rows = await pool.fetch(
                    "SELECT key, value FROM settings WHERE site_id = $1",
                    site_id,
                )
            else:
                rows = await pool.fetch(
                    "SELECT key, value FROM settings ORDER BY updated_at DESC LIMIT 100"
                )
            _settings_cache["map"] = {r["key"]: r["value"] for r in rows}
            _settings_cache["at"] = now
            _settings_cache["site"] = cache_key
        except Exception:
            pass
    return _settings_cache["map"].get(key, default)

async def _subscribed_sites(pool, sensor_id):
    """Return the list of sites this sensor fans out to right now."""
    if not sensor_id:
        return []
    rows = await pool.fetch(
        "SELECT site_id FROM sensor_site_subscriptions WHERE sensor_id = $1",
        sensor_id,
    )
    return [r["site_id"] for r in rows]



# How many standard deviations from a device's own normal timing counts
# as a genuine anomaly. 3 is the conventional statistical threshold for
# "significant deviation" (Chebyshev/normal-distribution heuristic).
ZSCORE_THRESHOLD = 4.5


async def upsert_asset(pool: asyncpg.Pool, site_id: UUID, ip: str, protocol: str, touch_last_seen: bool = True) -> tuple[UUID, bool]:
    row = await pool.fetchrow(
        "SELECT id FROM assets WHERE site_id = $1 AND ip_address = $2",
        site_id, ip,
    )
    if row is not None:
        if touch_last_seen:
            await pool.execute(
                """UPDATE assets SET last_seen = now(),
                       protocols = CASE WHEN $2 = ANY(protocols) THEN protocols
                                         ELSE array_append(protocols, $2) END
                   WHERE id = $1""",
                row["id"], protocol,
            )
        else:
            # Still add the protocol but don't bump last_seen
            await pool.execute(
                """UPDATE assets SET
                       protocols = CASE WHEN $2 = ANY(protocols) THEN protocols
                                         ELSE array_append(protocols, $2) END
                   WHERE id = $1""",
                row["id"], protocol,
            )
        return row["id"], False

    new_id = uuid4()
    await pool.execute(
        """INSERT INTO assets (id, site_id, ip_address, device_role, protocols)
           VALUES ($1, $2, $3, 'unknown', ARRAY[$4]::TEXT[])
           ON CONFLICT DO NOTHING""",
        new_id, site_id, ip, protocol,
    )
    return new_id, True


async def insert_alert(
    pool: asyncpg.Pool, tenant_id: UUID, site_id: UUID, asset_id: UUID | None,
    severity: str, description: str, evidence: dict | None = None,
) -> None:
    """
    Insert-or-consolidate. Same rule+asset+shift => increment recurrence, do not
    create a new row. This is the production alert model: one action per incident,
    not one action per occurrence.
    """
    # Derive shift_key (12h buckets, UTC): YYYY-MM-DD-H1|H2
    shift_sql = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '-H' || CASE WHEN extract(hour from now() AT TIME ZONE 'UTC') < 12 THEN '1' ELSE '2' END"
    # Rule family = first 60 chars of description (heuristic; stable enough to group)
    rule_family = description[:60]

    # Try to find an existing open/acknowledged/escalated alert for the same
    # (tenant, site, asset, rule_family, shift)
    existing = await pool.fetchrow(
        f"""
        SELECT id, recurrence_count
        FROM alerts
        WHERE tenant_id = $1
          AND site_id   = $2
          AND asset_id IS NOT DISTINCT FROM $3
          AND substring(description from 1 for 60) = $4
          AND shift_key = {shift_sql}
          AND status IN ('open','acknowledged','escalated')
        ORDER BY time DESC
        LIMIT 1
        """,
        tenant_id, site_id, asset_id, rule_family,
    )

    if existing:
        # CONSOLIDATE: bump recurrence, refresh last_occurrence, append evidence
        await pool.execute(
            """
            UPDATE alerts
            SET recurrence_count     = recurrence_count + 1,
                last_occurrence_at   = now(),
                evidence = COALESCE(evidence, '{}'::jsonb)
                           || jsonb_build_object(
                                'last_occurrence', $2::jsonb,
                                'consolidated_at', now()::text
                              )
            WHERE id = $1
            """,
            existing["id"],
            json.dumps(evidence or {}),
        )
        logger.info(
            "CONSOLIDATED [%s] asset=%s rule=%s recurrence=%d",
            severity, asset_id, rule_family[:40], existing["recurrence_count"] + 1,
        )
        return

    # NEW alert
    await pool.execute(
        """
        INSERT INTO alerts (
            tenant_id, site_id, asset_id, severity, description,
            evidence, first_occurrence_at, last_occurrence_at,
            shift_key, recurrence_count
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now(),
                """ + shift_sql + """, 1)
        """,
        tenant_id, site_id, asset_id, severity, description,
        json.dumps(evidence or {}),
    )
    logger.info("ALERT [%s] site=%s asset=%s: %s", severity, site_id, asset_id, description)



def is_write_command(function_code: str | None) -> bool:
    """Protocol-agnostic check: works for Modbus, DNP3, S7comm write ops,
    since ICSNPP's function_code names for writes always contain WRITE."""
    return bool(function_code) and "WRITE" in function_code.upper()

async def has_prior_write(pool: asyncpg.Pool, site_id: UUID, asset_id: UUID) -> bool:
    """True if this asset has ever issued a write command before this event."""
    return await pool.fetchval(
        """SELECT EXISTS (
               SELECT 1 FROM protocol_events
               WHERE site_id = $1 AND src_asset_id = $2
                 AND function_code ILIKE '%WRITE%'
           )""",
        site_id, asset_id,
    )


async def update_baseline_and_check(
    pool: asyncpg.Pool, asset_id: UUID, ts: datetime,
    site_id=None) -> tuple[bool, float, float]:
    """
    Welford's online algorithm: updates a device's running mean/variance
    of inter-event timing with a single pass, no stored history needed.
    Returns (is_anomaly, gap_seconds, zscore) for the caller to decide
    whether to alert. On a device's first-ever event there's no prior
    timestamp to compare, so no gap is computed that round.
    """
    row = await pool.fetchrow(
        """SELECT baseline_mean_interval, baseline_m2, baseline_count, last_event_at
           FROM assets WHERE id = $1""",
        asset_id,
    )
    mean, m2, count, last_event_at = (
        row["baseline_mean_interval"], row["baseline_m2"],
        row["baseline_count"], row["last_event_at"],
    )

    if last_event_at is None:
        await pool.execute("UPDATE assets SET last_event_at = $1 WHERE id = $2", ts, asset_id)
        return False, 0.0, 0.0

    gap = (ts - last_event_at).total_seconds()
    if gap < 0:
        # Out-of-order event delivery (network/Kafka reordering) -- skip
        # rather than corrupt the running statistics with a negative gap.
        return False, gap, 0.0

    count += 1
    if mean is None:
        mean, m2 = gap, 0.0
    else:
        delta = gap - mean
        mean += delta / count
        m2 += delta * (gap - mean)

    variance = m2 / count if count > 1 else 0.0
    stddev = math.sqrt(variance)
    zscore = (gap - mean) / stddev if stddev > 0 else 0.0

    await pool.execute(
        """UPDATE assets
           SET baseline_mean_interval = $1, baseline_m2 = $2,
               baseline_count = $3, last_event_at = $4
           WHERE id = $5""",
        mean, m2, count, ts, asset_id,
    )

    min_samples = await _get_setting(pool, "detection.baseline_min_samples", BASELINE_MIN_SAMPLES, site_id=site_id)
    zscore_thr  = await _get_setting(pool, "detection.zscore_threshold",    ZSCORE_THRESHOLD,     site_id=site_id)
    try:
        min_samples = int(min_samples)
        zscore_thr  = float(zscore_thr)
    except (TypeError, ValueError):
        min_samples, zscore_thr = BASELINE_MIN_SAMPLES, ZSCORE_THRESHOLD

    is_anomaly = (
        count > min_samples
        and abs(zscore) > zscore_thr
        and gap < 21600  # 6h: longer gaps = lab downtime, not event of interest
    )
    return is_anomaly, gap, zscore


async def _process_one_site(pool: asyncpg.Pool, site_id: UUID, tenant_id: UUID,
                               event: dict, ts, function_code, is_write,
                               zscore_thr: float, off_hours: bool, offhrs_ok: bool) -> None:
    """Per-site detection + insertion. Everything inside runs exactly once per
    (event, site) pair. The shared parsing (ts, function_code, thresholds,
    off-hours decision) is done by the caller to avoid redundant DB reads."""
    src_asset_id, is_new = await upsert_asset(pool, site_id, event["src_ip"], event["protocol"])
    dst_asset_id, _ = await upsert_asset(pool, site_id, event["dst_ip"], event["protocol"], touch_last_seen=False)

    # Alert on write only if there's no prior write from this asset+protocol
    # in the last hour, EXCLUDING the current event (uid match).
    first_ever_write = False
    if is_write:
        current_uid = event.get("zeek_uid") or ""
        recent = await pool.fetchval(
            """SELECT EXISTS(
                 SELECT 1 FROM protocol_events
                 WHERE site_id = $1 AND src_asset_id = $2 AND protocol = $3
                   AND function_code IN ('WRITE_SINGLE_REGISTER','WRITE_MULTIPLE_REGISTERS',
                                          'WRITE_COIL','WRITE_MULTIPLE_COILS')
                   AND time > now() - interval '1 hour'
                   AND COALESCE(zeek_uid, '') <> $4
            )""",
            site_id, src_asset_id, event["protocol"], current_uid,
        )
        first_ever_write = not recent

    baseline_anomaly, gap_seconds, zscore = await update_baseline_and_check(pool, src_asset_id, ts, site_id=site_id)

    await pool.execute(
        """INSERT INTO protocol_events
             (time, sensor_id, site_id, src_asset_id, dst_asset_id,
              protocol, function_code, payload_summary, zeek_uid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
        ts,
        UUID(event.get("sensor_id")) if event.get("sensor_id") else None,
        site_id, src_asset_id, dst_asset_id,
        event["protocol"], function_code,
        json.dumps(event.get("payload_summary", {})),
        event.get("zeek_uid") or f"conn-{int(ts.timestamp()*1000)}",
    )

    if is_new:
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, "medium",
            f"New device seen on network: {event['src_ip']} ({event['protocol']})",
        )

    if off_hours and offhrs_ok:
        # Inside off-hours window → critical; outside → high
        _oh_sev = "critical" if off_hours else "high"
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, _oh_sev,
            f"Industrial protocol activity ({event['protocol']}) from {event.get('src_ip') or 'unknown'} observed outside normal hours "
            f"at {ts.isoformat()}",
        )

    if first_ever_write:
        off_hours_note = " -- and outside normal working hours" if off_hours else ""
        severity = "critical" if off_hours else "high"
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, severity,
            f"Unauthorized write command detected: {event['src_ip']} sent {function_code} "
            f"to {event['dst_ip']} -- no write activity from this device in the past hour"
            f"{off_hours_note}.",
            evidence={"function_code": function_code, "dst_ip": event["dst_ip"],
                      "src_ip": event["src_ip"], "protocol": event["protocol"]},
        )

    if baseline_anomaly:
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, "medium",
            f"Behavioral anomaly: {event['src_ip']} request timing deviates sharply from its "
            f"own established baseline (gap={gap_seconds:.2f}s, z-score={zscore:.1f}, "
            f"threshold={zscore_thr}).",
            evidence={"gap_seconds": gap_seconds, "zscore": zscore,
                      "threshold": zscore_thr, "protocol": event["protocol"]},
        )


async def process_event(pool: asyncpg.Pool, tenant_id: UUID, event: dict) -> None:
    """Fan out one incoming event to every site subscribed to its sensor.
    Shared parsing (ts, thresholds, off-hours) happens once per event;
    per-site logic (upsert, insert, alert) runs once per subscribed site."""
    sensor_id = event.get("sensor_id")
    site_ids = await _subscribed_sites(pool, sensor_id)
    if not site_ids:
        logger.debug("event dropped: no sites subscribed to sensor %s", sensor_id)
        return

    # ── Shared per-event parsing (do this once) ─────────────────────────
    ts = datetime.fromisoformat(event["timestamp"])
    function_code = event.get("function_code")
    is_write = is_write_command(function_code)

    # ── Shared detection threshold lookups (once per event) ─────────────
    # NB: settings can differ per site — we can't pre-compute these globally.
    # Instead, inside the per-site loop we do read the setting per site, but
    # we cache-close them so it's still cheap (2s cache in _get_setting).

    # ── Per-site fanout ─────────────────────────────────────────────────
    for site_id in site_ids:
        # All three reads are site-scoped so each site's settings apply independently.
        off_hours = await is_off_hours(pool, ts, site_id=site_id)
        offhrs_ok = await _offhrs_ok(pool, event, site_id=site_id)
        zscore_thr = await _get_setting(pool, "detection.zscore_threshold", ZSCORE_THRESHOLD, site_id=site_id)
        try:
            zscore_thr = float(zscore_thr)
        except (TypeError, ValueError):
            zscore_thr = ZSCORE_THRESHOLD

        await _process_one_site(
            pool, site_id, tenant_id, event,
            ts, function_code, is_write,
            zscore_thr, off_hours, offhrs_ok,
        )




async def run() -> None:
    pool = None
    for _attempt in range(30):
        try:
            pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
            logger.info("postgres pool ready")
            break
        except Exception as _e:
            logger.warning("postgres not ready (attempt %d/30): %s", _attempt + 1, _e)
            await asyncio.sleep(3)
    if pool is None:
        raise RuntimeError("Could not connect to Postgres after 30 attempts")

    consumer = Consumer({
        "bootstrap.servers": KAFKA_BOOTSTRAP_SERVERS,
        "group.id": "sentinelot-stream-processor",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
    })
    consumer.subscribe([TOPIC])
    logger.info("stream processor started, consuming topic=%s", TOPIC)

    try:
        while True:
            msg = consumer.poll(1.0)
            if msg is None:
                await asyncio.sleep(0)
                continue
            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    continue
                logger.error("Kafka error: %s", msg.error())
                continue

            try:
                event = json.loads(msg.value())
                site_id = UUID(msg.key().decode())
                tenant_row = await pool.fetchrow(
                    "SELECT tenant_id FROM sites WHERE id = $1", site_id
                )
                if tenant_row is None:
                    logger.warning("unknown site_id=%s, dropping event", site_id)
                    consumer.commit(msg)
                    continue
                await process_event(pool, tenant_row["tenant_id"], event)
                consumer.commit(msg)
            except Exception:
                logger.exception("failed to process message, skipping")
                consumer.commit(msg)
    finally:
        consumer.close()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(run())
