"""
SentinelOT — Stream Processor
Consumes normalized protocol events from Kafka/Redpanda, upserts the
asset inventory, persists events to TimescaleDB, and runs rule-based
detections: "new device seen", "off-hours activity", and "unauthorized
write" (a device writing for the first time -- more severe if off-hours).
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from uuid import UUID, uuid4

import asyncpg
from confluent_kafka import Consumer, KafkaError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sentinelot.stream_processor")

KAFKA_BOOTSTRAP_SERVERS = os.environ["KAFKA_BOOTSTRAP_SERVERS"]
DATABASE_URL = os.environ["DATABASE_URL"]
TOPIC = "protocol-events"


async def upsert_asset(pool: asyncpg.Pool, site_id: UUID, ip: str) -> tuple[UUID, bool]:
    row = await pool.fetchrow(
        "SELECT id FROM assets WHERE site_id = $1 AND ip_address = $2",
        site_id, ip,
    )
    if row is not None:
        await pool.execute(
            "UPDATE assets SET last_seen = now() WHERE id = $1", row["id"]
        )
        return row["id"], False

    new_id = uuid4()
    await pool.execute(
        """INSERT INTO assets (id, site_id, ip_address, device_role, protocols)
           VALUES ($1, $2, $3, 'unknown', ARRAY[]::TEXT[])
           ON CONFLICT DO NOTHING""",
        new_id, site_id, ip,
    )
    return new_id, True


async def insert_alert(
    pool: asyncpg.Pool, tenant_id: UUID, site_id: UUID, asset_id: UUID,
    severity: str, description: str,
) -> None:
    await pool.execute(
        """INSERT INTO alerts (tenant_id, site_id, asset_id, severity, description)
           VALUES ($1, $2, $3, $4, $5)""",
        tenant_id, site_id, asset_id, severity, description,
    )
    logger.info("ALERT [%s] site=%s asset=%s: %s", severity, site_id, asset_id, description)


def is_off_hours(ts: datetime) -> bool:
    local_hour = ts.astimezone(timezone.utc).hour
    return local_hour < 6 or local_hour >= 22


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


async def process_event(pool: asyncpg.Pool, site_id: UUID, tenant_id: UUID, event: dict) -> None:
    src_asset_id, is_new = await upsert_asset(pool, site_id, event["src_ip"])
    dst_asset_id, _ = await upsert_asset(pool, site_id, event["dst_ip"])

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

    await pool.execute(
        """INSERT INTO protocol_events
               (time, sensor_id, site_id, src_asset_id, dst_asset_id,
                protocol, function_code, payload_summary, zeek_uid)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
        ts,
        UUID(event.get("sensor_id")) if event.get("sensor_id") else None,
        site_id, src_asset_id, dst_asset_id,
        event["protocol"], function_code,
        json.dumps(event.get("payload_summary", {})), event["zeek_uid"],
    )

    if is_new:
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, "medium",
            f"New device seen on network: {event['src_ip']} ({event['protocol']})",
        )

    if is_off_hours(ts) and event["protocol"] in ("modbus_tcp", "dnp3", "s7comm"):
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, "high",
            f"Industrial protocol activity ({event['protocol']}) observed outside normal hours "
            f"at {ts.isoformat()}",
        )

    if first_ever_write:
        off_hours_note = " -- and outside normal working hours" if is_off_hours(ts) else ""
        severity = "critical" if is_off_hours(ts) else "high"
        await insert_alert(
            pool, tenant_id, site_id, src_asset_id, severity,
            f"Unauthorized write command detected: {event['src_ip']} sent {function_code} "
            f"to {event['dst_ip']} -- this device has only been observed reading until now"
            f"{off_hours_note}.",
        )


async def run() -> None:
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)

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
