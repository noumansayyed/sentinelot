"""Sensor ↔ Site subscription management.
One sensor can feed many sites; each site gets its own copy of every event."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from uuid import UUID
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]


class SubscribeBody(BaseModel):
    sensor_id: UUID
    actor: str = "operator"


@router.get("/v1/sites/{site_id}/sensors")
async def list_sensors_for_site(site_id: UUID):
    """List every sensor currently subscribed to this site, with sensor metadata."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            """
            SELECT
                s.id,
                s.label,
                s.status,
                s.mtls_cert_fingerprint,
                sub.subscribed_at,
                sub.subscribed_by
              FROM sensor_site_subscriptions sub
              JOIN sensors s ON s.id = sub.sensor_id
             WHERE sub.site_id = $1
             ORDER BY s.label
            """,
            site_id,
        )
        return {
            "sensors": [
                {
                    "id":                     str(r["id"]),
                    "label":                  r["label"],
                    "status":                 r["status"],
                    "mtls_cert_fingerprint":  r["mtls_cert_fingerprint"],
                    "subscribed_at":          r["subscribed_at"].isoformat() if r["subscribed_at"] else None,
                    "subscribed_by":          r["subscribed_by"],
                }
                for r in rows
            ]
        }
    finally:
        await pool.close()


@router.get("/v1/sites/{site_id}/sensors/available")
async def list_available_sensors(site_id: UUID):
    """List sensors NOT yet subscribed to this site (for the enroll dropdown)."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            """
            SELECT id, label, status, mtls_cert_fingerprint
              FROM sensors s
             WHERE NOT EXISTS (
                 SELECT 1 FROM sensor_site_subscriptions sub
                  WHERE sub.sensor_id = s.id AND sub.site_id = $1
             )
             ORDER BY label
            """,
            site_id,
        )
        return {
            "sensors": [
                {
                    "id": str(r["id"]),
                    "label": r["label"],
                    "status": r["status"],
                    "mtls_cert_fingerprint": r["mtls_cert_fingerprint"],
                }
                for r in rows
            ]
        }
    finally:
        await pool.close()


@router.post("/v1/sites/{site_id}/sensors")
async def subscribe_sensor(site_id: UUID, body: SubscribeBody):
    """Enroll a sensor into a site. From this moment, its events fan out to this site."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        site_ok = await pool.fetchval("SELECT 1 FROM sites WHERE id = $1", site_id)
        if not site_ok:
            raise HTTPException(404, "site not found")
        sensor_ok = await pool.fetchval("SELECT 1 FROM sensors WHERE id = $1", body.sensor_id)
        if not sensor_ok:
            raise HTTPException(404, "sensor not found")

        await pool.execute(
            """INSERT INTO sensor_site_subscriptions (sensor_id, site_id, subscribed_by)
               VALUES ($1, $2, $3)
               ON CONFLICT (sensor_id, site_id) DO NOTHING""",
            body.sensor_id, site_id, body.actor,
        )
        return {"ok": True, "site_id": str(site_id), "sensor_id": str(body.sensor_id)}
    finally:
        await pool.close()


@router.delete("/v1/sites/{site_id}/sensors/{sensor_id}")
async def unsubscribe_sensor(site_id: UUID, sensor_id: UUID):
    """Remove a sensor from a site. Existing events/assets/alerts stay; new ones stop flowing."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        result = await pool.execute(
            "DELETE FROM sensor_site_subscriptions WHERE site_id = $1 AND sensor_id = $2",
            site_id, sensor_id,
        )
        deleted = 0 if result == "DELETE 0" else int(result.split()[1])
        if deleted == 0:
            raise HTTPException(404, "subscription not found")
        return {"ok": True, "deleted": deleted}
    finally:
        await pool.close()
