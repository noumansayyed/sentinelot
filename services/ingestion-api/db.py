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
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
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
