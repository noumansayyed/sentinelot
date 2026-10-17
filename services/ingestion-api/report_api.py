from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
import asyncpg, os
from datetime import datetime, timezone

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

@router.get("/v1/sites/{site_id}/report-data")
async def get_report_data(site_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        # 1. Site
        site = await pool.fetchrow("SELECT name FROM sites WHERE id = $1", site_id)
        if not site:
            raise HTTPException(404, "site not found")

        # 2. Assets
        assets = await pool.fetch("""
            SELECT ip_address::text AS ip, mac_address::text AS mac, 
                   COALESCE(role_manual, device_role) AS role, 
                   protocols, criticality, first_seen, last_seen
            FROM assets WHERE site_id = $1 ORDER BY ip_address
        """, site_id)

        # 3. Alerts (last 30 days)
        alerts = await pool.fetch("""
            SELECT time, severity, status, description 
            FROM alerts WHERE site_id = $1 AND time > now() - interval '30 days' 
            ORDER BY time DESC LIMIT 50
        """, site_id)

        # 4. Protocol Events (last 7 days)
        events = await pool.fetch("""
            SELECT protocol, count(*) AS cnt 
            FROM protocol_events WHERE site_id = $1 AND time > now() - interval '7 days' 
            GROUP BY protocol ORDER BY protocol
        """, site_id)

        return {
            "site_name": site["name"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "assets": [dict(a) for a in assets],
            "alerts": [dict(a) for a in alerts],
            "events": [dict(e) for e in events],
        }
    finally:
        await pool.close()
