from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
from datetime import datetime, timezone, timedelta
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

class ReportRequest(BaseModel):
    start_date: datetime
    end_date: datetime
    actor: str = "operator"

@router.post("/v1/sites/{site_id}/reports/generate")
async def generate_report(site_id: UUID, req: ReportRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        # 1. Save the report metadata
        # Get tenant_id from site
        tenant_id = await pool.fetchval("SELECT tenant_id FROM sites WHERE id = $1", site_id)
        if not tenant_id:
            raise HTTPException(404, "site not found")
        
        report_id = await pool.fetchval("""
            INSERT INTO compliance_reports 
                (tenant_id, site_id, report_type, period_start, period_end, s3_object_key, generated_by)
            VALUES ($1, $2, 'cert_in_aligned', $3::date, $4::date, 'generated/native-report', $5)
            RETURNING id
        """, tenant_id, site_id, req.start_date.date(), req.end_date.date(), req.actor)

        # 2. Fetch assets that were ACTIVE during the period
        # If the period is in the past, only show devices that had events.
        # If the period includes "now", show all current assets.
        now = datetime.now(timezone.utc)
        is_historical = req.end_date < now - timedelta(minutes=5)

        if is_historical:
            assets = await pool.fetch("""
                SELECT a.ip_address::text AS ip, a.mac_address::text AS mac,
                       COALESCE(a.role_manual, a.device_role) AS role,
                       a.protocols, a.criticality, a.first_seen, a.last_seen
                FROM assets a
                WHERE a.site_id = $1
                  AND a.id IN (
                    SELECT DISTINCT src_asset_id FROM protocol_events 
                    WHERE site_id = $1 AND time >= $2 AND time <= $3 AND src_asset_id IS NOT NULL
                    UNION
                    SELECT DISTINCT dst_asset_id FROM protocol_events 
                    WHERE site_id = $1 AND time >= $2 AND time <= $3 AND dst_asset_id IS NOT NULL
                  )
                ORDER BY a.ip_address
            """, site_id, req.start_date, req.end_date)
        else:
            assets = await pool.fetch("""
                SELECT ip_address::text AS ip, mac_address::text AS mac,
                       COALESCE(role_manual, device_role) AS role,
                       protocols, criticality, first_seen, last_seen
                FROM assets WHERE site_id = $1 ORDER BY ip_address
            """, site_id)

        # 3. Fetch alerts for the specific period
        alerts = await pool.fetch("""
            SELECT time, severity, status, description
            FROM alerts WHERE site_id = $1 AND time >= $2 AND time <= $3
            ORDER BY time DESC LIMIT 100
        """, site_id, req.start_date, req.end_date)

        # 4. Fetch protocol events summary for the period
        events = await pool.fetch("""
            SELECT protocol, count(*) AS cnt
            FROM protocol_events WHERE site_id = $1 AND time >= $2 AND time <= $3
            GROUP BY protocol ORDER BY protocol
        """, site_id, req.start_date, req.end_date)

        return {
            "report_id": str(report_id),
            "site_id": str(site_id),
            "period": {"start": req.start_date.isoformat(), "end": req.end_date.isoformat()},
            "assets": [dict(a) for a in assets],
            "alerts": [dict(a) for a in alerts],
            "events": [dict(e) for e in events],
        }
    finally:
        await pool.close()

@router.get("/v1/sites/{site_id}/reports")
async def list_reports(site_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("""
            SELECT id, generated_at, period_start, period_end, generated_by, report_type
            FROM compliance_reports WHERE site_id = $1 ORDER BY generated_at DESC
        """, site_id)
        return {"reports": [dict(r) for r in rows]}
    finally:
        await pool.close()
