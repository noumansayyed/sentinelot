"""Real per-protocol activity: derived from protocol_events, not assets.protocols."""
from fastapi import APIRouter, Depends
from uuid import UUID
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

PROTO_MAP = {
    "modbus_tcp": "modbus",
    "s7comm":     "s7",
    "dnp3":       "dnp3",
    "opcua":      "opc",
}

@router.get("/v1/sites/{site_id}/protocols/activity")
async def protocol_activity(site_id: UUID, window_sec: int = 300, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("""
            SELECT protocol, src_asset_id, max(time) AS last_seen,
                   count(*) AS events
            FROM protocol_events
            WHERE site_id = $1 AND time > now() - ($2 || ' seconds')::interval
            GROUP BY protocol, src_asset_id
        """, site_id, str(window_sec))

        by_proto: dict = {}
        for r in rows:
            key = PROTO_MAP.get(r["protocol"], r["protocol"])
            by_proto.setdefault(key, []).append({
                "asset_id": str(r["src_asset_id"]) if r["src_asset_id"] else None,
                "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
                "events": r["events"],
            })
        return {"window_sec": window_sec, "by_protocol": by_proto}
    finally:
        await pool.close()
