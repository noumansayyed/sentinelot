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

async def _offhrs_ok(pool, event: dict) -> bool:
    # Protocol gate: only alert on protocols enabled in settings.
    enabled = await _get_setting(pool, "detection.enabled_protocols", ["modbus_tcp", "s7comm", "dnp3", "opcua"])
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
    if now - _offhrs_seen.get(k, 0) < 900:
        return False
    _offhrs_seen[k] = now
    return True

async def is_off_hours(pool, ts: datetime) -> bool:
    from datetime import timedelta as _td
    start_str = await _get_setting(pool, "detection.off_hours_start", "22:00")
    end_str   = await _get_setting(pool, "detection.off_hours_end",   "06:00")
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


async def _get_setting(pool, key, default=None):
    """Read a setting from DB (cached 10s so we don't hit DB on every event)."""
    import time as _time
    now = _time.time()
    if now - _settings_cache["at"] > _SETTINGS_TTL:
        try:
            rows = await pool.fetch("SELECT key, value FROM settings WHERE tenant_id = $1", _TENANT)
            _settings_cache["map"] = {r["key"]: r["value"] for r in rows}
            _settings_cache["at"] = now
        except Exception:
            pass
    return _settings_cache["map"].get(key, default)


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
) -> tuple[bool, float, float]:
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

    min_samples = await _get_setting(pool, "detection.baseline_min_samples", BASELINE_MIN_SAMPLES)
    zscore_thr  = await _get_setting(pool, "detection.zscore_threshold",    ZSCORE_THRESHOLD)
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


async def process_event(pool: asyncpg.Pool, site_id: UUID, tenant_id: UUID, event: dict) -> None:
    src_asset_id, is_new = await upsert_asset(pool, site_id, event["src_ip"], event["protocol"])
    dst_asset_id, _ = await upsert_asset(pool, site_id, event["dst_ip"], event["protocol"], touch_last_seen=False)

    ts = datetime.fromisoformat(event["timestamp"])
    function_code = event.get("function_code")
    is_write = is_write_command(function_code)

    # Must check history BEFORE inserting this event, so "prior" truly
    # means "before now", not including the row we're about to write.
    first_ever_write = False
    if is_write and not is_new:
        first_ever_write = not await has_prior_write(pool, site_id, src_asset_id)
    elif is_write and is_new:
        # a brand-new device whose very first observed action is a write
        first_ever_write = True

    baseline_anomaly, gap_seconds, zscore = await update_baseline_and_check(pool, src_asset_id, ts)

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

    # Fetch zscore threshold locally for the alert payload (used in the
    # behavioral-anomaly branch below). Cheap — cached 2s by _get_setting.
    zscore_thr = await _get_setting(pool, "detection.zscore_threshold", ZSCORE_THRESHOLD)
    try:
        zscore_thr = float(zscore_thr)
    except (TypeError, ValueError):
        zscore_thr = ZSCORE_THRESHOLD

    if await is_off_hours(pool, ts) and await _offhrs_ok(pool, event):
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, "high",
            f"Industrial protocol activity ({event['protocol']}) from {event.get('src_ip') or 'unknown'} observed outside normal hours "
            f"at {ts.isoformat()}",
        )

    if first_ever_write:
        _oh = await is_off_hours(pool, ts)
        off_hours_note = " -- and outside normal working hours" if _oh else ""
        severity = "critical" if _oh else "high"
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, severity,
            f"Unauthorized write command detected: {event['src_ip']} sent {function_code} "
            f"to {event['dst_ip']} -- this device has only been observed reading until now"
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
                await process_event(pool, site_id, tenant_row["tenant_id"], event)
                consumer.commit(msg)
            except Exception:
                logger.exception("failed to process message, skipping")
                consumer.commit(msg)
    finally:
        consumer.close()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(run())
