"""Production operations endpoints: site-scoped plant state + site listing."""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from datetime import datetime, timezone
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

ACTIVE_THRESHOLD_SEC = 60      # seen in last 60s = active
IDLE_THRESHOLD_SEC   = 300     # seen in 1–5 min = idle
# beyond 300s = offline


@router.get("/v1/sites/{site_id}/operations")
async def operations(site_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    try:
        # Site header
        site = await pool.fetchrow(
            "SELECT id, name, tenant_id FROM sites WHERE id = $1", site_id,
        )
        if not site:
            raise HTTPException(404, "site not found")

        # Devices: all assets for the site
        asset_rows = await pool.fetch(
            """
            SELECT id, ip_address::text AS ip, mac_address::text AS mac,
                   vendor_oui, device_role, protocols, criticality,
                   first_seen, last_seen, last_event_at
            FROM assets
            WHERE site_id = $1
            ORDER BY last_seen DESC NULLS LAST
            """, site_id,
        )

        now = datetime.now(timezone.utc)

        # Real completions per asset (last 60s) — for honest "active" status
        completions = await pool.fetch("""
            SELECT src_asset_id AS asset_id, count(*) AS n, max(time) AS last_completed
            FROM protocol_events
            WHERE site_id = $1
              AND function_code IS NOT NULL
              AND time > now() - interval '30 seconds'
            GROUP BY src_asset_id
        """, site_id)
        completed_map = {str(r["asset_id"]): (r["n"], r["last_completed"]) for r in completions if r["asset_id"]}

        devices = []
        for r in asset_rows:
            last_seen = r["last_seen"]
            age = (now - last_seen).total_seconds() if last_seen else None
            comp = completed_map.get(str(r["id"]))
            if comp and comp[0] > 0:
                status = "active"          # completed a real transaction in last 60s
            elif age is None:
                status = "offline"
            elif age < ACTIVE_THRESHOLD_SEC:
                status = "idle"            # saw traffic but no completion
            elif age < IDLE_THRESHOLD_SEC:
                status = "idle"
            else:
                status = "offline"

            devices.append({
                "asset_id": str(r["id"]),
                "ip": r["ip"],
                "mac": r["mac"],
                "vendor_oui": r["vendor_oui"],
                "role": r["device_role"],
                "protocols": list(r["protocols"] or []),
                "criticality": r["criticality"],
                "first_seen": r["first_seen"].isoformat() if r["first_seen"] else None,
                "last_seen": last_seen.isoformat() if last_seen else None,
                "status": status,
                "seconds_since_seen": int(age) if age is not None else None,
            })

        # Protocol health: real events in last 5 min, per protocol
        proto_rows = await pool.fetch(
            """
            SELECT protocol,
                   count(*) AS events,
                   count(DISTINCT src_asset_id) AS devices,
                   max(time) AS last_event,
                   count(*) FILTER (WHERE function_code IS NOT NULL) AS completed
            FROM protocol_events
            WHERE site_id = $1 AND time > now() - interval '30 seconds'
            GROUP BY protocol
            """, site_id,
        )

        protocols = []
        for p in proto_rows:
            last = p["last_event"]
            age = (now - last).total_seconds() if last else None
            protocols.append({
                "protocol": p["protocol"],
                "events_5min": p["events"],
                "completed_5min": p["completed"],
                "devices_seen": p["devices"],
                "last_event": last.isoformat() if last else None,
                "seconds_since_event": int(age) if age is not None else None,
                "status": "active" if age is not None and age < 60 else ("idle" if age is not None and age < 300 else "offline"),
            })

        # Alert summary — count only, no detail (Operations tab doesn't show alerts)
        alert_counts = await pool.fetchrow(
            """
            SELECT
              count(*) FILTER (WHERE status IN ('open','acknowledged','escalated')) AS open_queue,
              count(*) FILTER (WHERE status IN ('open','acknowledged','escalated') AND severity IN ('critical','high')) AS critical_high_open,
              count(*) FILTER (WHERE status IN ('open','acknowledged','escalated') AND severity = 'critical') AS critical_open
            FROM alerts
            WHERE site_id = $1
            """, site_id,
        )

        return {
            "site": {"id": str(site["id"]), "name": site["name"], "tenant_id": str(site["tenant_id"])},
            "devices": devices,
            "device_summary": {
                "total": len(devices),
                "active": sum(1 for d in devices if d["status"] == "active"),
                "idle": sum(1 for d in devices if d["status"] == "idle"),
                "offline": sum(1 for d in devices if d["status"] == "offline"),
                "unknown": sum(1 for d in devices if d["criticality"] == "unclassified"),
            },
            "protocols": protocols,
            "alert_summary": {
                "open_queue": alert_counts["open_queue"],
                "critical_high_open": alert_counts["critical_high_open"],
                "critical_open": alert_counts["critical_open"],
            },
        }
    finally:
        await pool.close()


