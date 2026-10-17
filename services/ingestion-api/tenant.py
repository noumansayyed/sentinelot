"""Tenant-level endpoints for multi-site visibility."""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from datetime import datetime, timezone
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]


@router.get("/v1/tenants/{tenant_id}/overview")
async def tenant_overview(tenant_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    try:
        rows = await pool.fetch("""
            SELECT s.id, s.name,
                   count(DISTINCT a.id) AS devices,
                   count(DISTINCT a.id) FILTER (
                     WHERE a.last_seen > now() - interval '60 seconds'
                   ) AS devices_active,
                   (SELECT count(*) FROM alerts al
                    WHERE al.site_id = s.id
                      AND al.status IN ('open','acknowledged','escalated')) AS alerts_open,
                   (SELECT count(*) FROM alerts al
                    WHERE al.site_id = s.id
                      AND al.status IN ('open','acknowledged','escalated')
                      AND al.severity IN ('critical','high')) AS alerts_critical_high
            FROM sites s
            LEFT JOIN assets a ON a.site_id = s.id
            WHERE s.tenant_id = $1
            GROUP BY s.id, s.name
            ORDER BY s.name
        """, tenant_id)

        total_devices = sum(r["devices"] for r in rows)
        total_active = sum(r["devices_active"] for r in rows)
        total_open = sum(r["alerts_open"] for r in rows)
        total_critical_high = sum(r["alerts_critical_high"] for r in rows)

        return {
            "tenant_id": str(tenant_id),
            "summary": {
                "sites": len(rows),
                "devices": total_devices,
                "devices_active": total_active,
                "alerts_open": total_open,
                "alerts_critical_high": total_critical_high,
            },
            "sites": [
                {
                    "id": str(r["id"]),
                    "name": r["name"],
                    "devices": r["devices"],
                    "devices_active": r["devices_active"],
                    "alerts_open": r["alerts_open"],
                    "alerts_critical_high": r["alerts_critical_high"],
                }
                for r in rows
            ],
        }
    finally:
        await pool.close()


@router.get("/v1/tenants/{tenant_id}/alerts")
async def tenant_alerts(tenant_id: UUID, status: str | None = None, limit: int = 100, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    try:
        params = [tenant_id]
        where = ["a.tenant_id = $1"]
        if status:
            params.append(status)
            where.append(f"a.status = ${len(params)}")

        q = f"""
            SELECT a.id, a.time, a.severity, a.status, a.description,
                   a.recurrence_count, a.first_occurrence_at, a.last_occurrence_at,
                   s.name AS site_name, s.id AS site_id,
                   ast.ip_address::text AS device_ip,
                   COALESCE(ast.role_manual, ast.device_role, 'unknown') AS device_role
            FROM alerts a
            LEFT JOIN sites s ON s.id = a.site_id
            LEFT JOIN assets ast ON ast.id = a.asset_id
            WHERE {' AND '.join(where)}
            ORDER BY a.time DESC
            LIMIT {int(limit)}
        """
        rows = await pool.fetch(q, *params)
        return {
            "alerts": [
                {
                    "id": str(r["id"]),
                    "time": r["time"].isoformat(),
                    "severity": r["severity"],
                    "status": r["status"],
                    "description": r["description"],
                    "recurrence_count": r["recurrence_count"],
                    "first_occurrence_at": r["first_occurrence_at"].isoformat() if r["first_occurrence_at"] else None,
                    "last_occurrence_at": r["last_occurrence_at"].isoformat() if r["last_occurrence_at"] else None,
                    "site_name": r["site_name"],
                    "site_id": str(r["site_id"]) if r["site_id"] else None,
                    "device_ip": r["device_ip"],
                    "device_role": r["device_role"],
                }
                for r in rows
            ],
        }
    finally:
        await pool.close()
