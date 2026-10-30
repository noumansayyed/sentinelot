"""
SentinelOT — Ingestion API database access layer.
"""

import os
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import asyncpg

DATABASE_URL = os.environ["DATABASE_URL"]

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        import asyncio, logging
        _log = logging.getLogger("sentinelot.db")
        for _attempt in range(30):
            try:
                _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
                _log.info("postgres pool ready")
                break
            except Exception as _e:
                _log.warning("postgres not ready (attempt %d/30): %s", _attempt + 1, _e)
                await asyncio.sleep(3)
        if _pool is None:
            raise RuntimeError("Could not connect to Postgres after 30 attempts")
    return _pool


@dataclass
class Sensor:
    id: UUID
    site_id: UUID
    status: str
    last_heartbeat_at: Optional[str]
    software_version: Optional[str]


async def get_sensor_by_fingerprint(fingerprint: str) -> Optional[Sensor]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT id, site_id, status, last_heartbeat_at, software_version
           FROM sensors WHERE mtls_cert_fingerprint = $1""",
        fingerprint,
    )
    if row is None:
        return None
    return Sensor(**row)


async def get_sensor_by_id(sensor_id: UUID) -> Optional[Sensor]:
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT id, site_id, status, last_heartbeat_at, software_version
           FROM sensors WHERE id = $1""",
        sensor_id,
    )
    if row is None:
        return None
    return Sensor(**row)


async def touch_sensor_heartbeat(sensor_id: UUID) -> None:
    pool = await get_pool()
    await pool.execute(
        """UPDATE sensors SET status = 'online', last_heartbeat_at = now()
           WHERE id = $1""",
        sensor_id,
    )


async def register_sensor(site_id: UUID, label: str, mtls_cert_fingerprint: str):
    pool = await get_pool()
    row = await pool.fetchrow(
        """INSERT INTO sensors (site_id, label, mtls_cert_fingerprint, status)
           VALUES ($1, $2, $3, 'provisioned')
           RETURNING id""",
        site_id, label, mtls_cert_fingerprint,
    )
    return row["id"]


async def site_exists(site_id: UUID) -> bool:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT 1 FROM sites WHERE id = $1", site_id)
    return row is not None


async def list_assets_for_site(site_id: UUID) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT id, ip_address, mac_address, device_role, protocols,
                  criticality, first_seen, last_seen
           FROM assets WHERE site_id = $1 ORDER BY last_seen DESC""",
        site_id,
    )
    return [dict(r) for r in rows]


async def list_alerts_for_site(site_id: UUID) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT id, time, severity, description, status, llm_explanation
           FROM alerts WHERE site_id = $1 ORDER BY time DESC LIMIT 200""",
        site_id,
    )
    return [dict(r) for r in rows]


async def get_asset_id_by_ip(site_id: UUID, ip_address: str) -> Optional[UUID]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT id FROM assets WHERE site_id = $1 AND ip_address = $2",
        site_id, ip_address,
    )
    return row["id"] if row else None


async def get_tenant_id_for_site(site_id: UUID) -> Optional[UUID]:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT tenant_id FROM sites WHERE id = $1", site_id)
    return row["tenant_id"] if row else None


async def insert_signature_alert(
    tenant_id: UUID, site_id: UUID, asset_id: UUID, severity: str, description: str
) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO alerts (tenant_id, site_id, asset_id, severity, description)
           VALUES ($1, $2, $3, $4, $5)""",
        tenant_id, site_id, asset_id, severity, description,
    )


async def update_alert_status(alert_id: str, new_status: str, acknowledged_by: str = "operator",
                               conn=None) -> bool:
    """Update alert status. If `conn` is provided, runs in the caller's transaction
    (so an audit row can be committed atomically alongside). Otherwise uses the pool."""
    sql = """UPDATE alerts
               SET status = $1,
                   acknowledged_by = CASE WHEN $1 != 'open' THEN $3 ELSE acknowledged_by END,
                   acknowledged_at = CASE WHEN $1 != 'open' THEN NOW() ELSE acknowledged_at END
               WHERE id = $2"""
    if conn is not None:
        result = await conn.execute(sql, new_status, alert_id, acknowledged_by)
    else:
        pool = await get_pool()
        result = await pool.execute(sql, new_status, alert_id, acknowledged_by)
    return result != "UPDATE 0"


# ---------------------------------------------------------------------------
# Audit trail — canonical writer and reader for the audit_log table.
# ---------------------------------------------------------------------------
import json as _json


async def write_audit(
    conn=None,
    *,
    tenant_id,
    site_id=None,
    actor=None,
    user_id=None,
    action,
    target=None,
    target_type=None,
    target_id=None,
    detail=None,
    details=None,
):
    """Insert one audit row. If `conn` is given, joins its transaction."""
    sql = """
        INSERT INTO audit_log
          (tenant_id, site_id, user_id, actor, action, target, target_type,
           target_id, detail, details)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    """
    args = (
        tenant_id, site_id, user_id, actor, action, target, target_type,
        target_id, detail,
        _json.dumps(details) if details is not None else None,
    )
    if conn is not None:
        await conn.execute(sql, *args)
    else:
        pool = await get_pool()
        await pool.execute(sql, *args)


async def list_audit(
    limit: int = 200,
    actor: Optional[str] = None,
    action: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    q: Optional[str] = None,
):
    """Return audit entries, newest first, with optional filters."""
    where, params = [], []
    def add(clause, value):
        params.append(value)
        where.append(clause.format(n=len(params)))

    if actor:       add("actor = ${n}", actor)
    if action:      add("action = ${n}", action)
    if target_type: add("target_type = ${n}", target_type)
    if target_id:   add("target_id::text = ${n}", target_id)
    if since:       add("time >= ${n}::timestamptz", since)
    if until:       add("time <= ${n}::timestamptz", until)
    if q:
        add("(target ILIKE ${n} OR actor ILIKE ${n} OR action ILIKE ${n} OR detail ILIKE ${n})", f"%{q}%")
        # the same placeholder used four times → rebuild the clause with same index
        where[-1] = f"(target ILIKE ${len(params)} OR actor ILIKE ${len(params)} OR action ILIKE ${len(params)} OR detail ILIKE ${len(params)})"

    params.append(max(1, min(limit, 1000)))
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            f"""
            SELECT id, time, tenant_id, site_id, user_id, actor, action,
                   target, target_type, target_id, detail, details
              FROM audit_log
              {where_sql}
             ORDER BY id DESC
             LIMIT ${len(params)}
            """,
            *params,
        )
    return [dict(r) for r in rows]
