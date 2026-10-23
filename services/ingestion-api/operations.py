"""Production operations endpoints: site-scoped plant state + site listing."""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from datetime import datetime, timezone
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

RECENT_WINDOW_SEC = 10   # single source of truth: any device/protocol event within this window is "not offline"

# A device is:
#   ACTIVE  — has a successful exchange (READ_*, WRITE_*, CONNECT_SUCCESS) in RECENT_WINDOW
#   IDLE    — has any event (incl. CONNECT_FAILED) in RECENT_WINDOW, but no successful exchange
#   OFFLINE — has no events at all in RECENT_WINDOW


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

        # Successful exchanges per asset in RECENT_WINDOW (both src AND dst — a responder is also "active")
        successful_rows = await pool.fetch("""
            SELECT asset_id, count(*) AS n
            FROM (
                SELECT src_asset_id AS asset_id FROM protocol_events
                WHERE site_id = $1
                  AND function_code IN ('READ_HOLDING_REGISTERS','WRITE_SINGLE_REGISTER',
                                        'READ_COILS','WRITE_COIL','READ_INPUT_REGISTERS',
                                        'READ_DISCRETE_INPUTS','WRITE_MULTIPLE_REGISTERS',
                                        'WRITE_MULTIPLE_COILS','CONNECT_SUCCESS')
                  AND time > now() - ($2 * interval '1 second')
                UNION ALL
                SELECT dst_asset_id AS asset_id FROM protocol_events
                WHERE site_id = $1
                  AND function_code IN ('READ_HOLDING_REGISTERS','WRITE_SINGLE_REGISTER',
                                        'READ_COILS','WRITE_COIL','READ_INPUT_REGISTERS',
                                        'READ_DISCRETE_INPUTS','WRITE_MULTIPLE_REGISTERS',
                                        'WRITE_MULTIPLE_COILS','CONNECT_SUCCESS')
                  AND time > now() - ($2 * interval '1 second')
            ) sub WHERE asset_id IS NOT NULL GROUP BY asset_id
        """, site_id, RECENT_WINDOW_SEC)
        success_map = {str(r["asset_id"]): r["n"] for r in successful_rows if r["asset_id"]}

        # ANY event per asset (success or failure) in RECENT_WINDOW
        any_event_rows = await pool.fetch("""
            SELECT src_asset_id AS asset_id, count(*) AS n, max(time) AS last_any
            FROM protocol_events
            WHERE site_id = $1 AND time > now() - ($2 * interval '1 second')
              AND src_asset_id IS NOT NULL
            GROUP BY src_asset_id
        """, site_id, RECENT_WINDOW_SEC)
        event_map = {str(r["asset_id"]): (r["n"], r["last_any"]) for r in any_event_rows if r["asset_id"]}

        # Absolute last src event (for seconds_since_seen)
        last_src_rows = await pool.fetch("""
            SELECT src_asset_id AS asset_id, max(time) AS last_src
            FROM protocol_events
            WHERE site_id = $1 AND src_asset_id IS NOT NULL
            GROUP BY src_asset_id
        """, site_id)
        last_src_map = {str(r["asset_id"]): r["last_src"] for r in last_src_rows if r["asset_id"]}

        devices = []
        for r in asset_rows:
            asset_id_str = str(r["id"])
            success_n = success_map.get(asset_id_str, 0)
            any_n, last_any = event_map.get(asset_id_str, (0, None))
            last_src = last_src_map.get(asset_id_str, None)

            if success_n > 0:
                status = "active"
            elif any_n > 0:
                status = "idle"
            else:
                status = "offline"

            # Use absolute last src event for the "seconds ago" counter
            last_seen = last_src or r["last_seen"]
            age = (now - last_seen).total_seconds() if last_seen else None

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

        # Protocol health: same 3-state logic, aggregated per protocol
        proto_rows = await pool.fetch(
            """
            SELECT protocol,
                   count(*) AS events,
                   count(DISTINCT src_asset_id) AS devices,
                   max(time) AS last_event,
                   count(*) FILTER (WHERE function_code IN ('READ_HOLDING_REGISTERS','WRITE_SINGLE_REGISTER',
                                                             'READ_COILS','WRITE_COIL','READ_INPUT_REGISTERS',
                                                             'READ_DISCRETE_INPUTS','WRITE_MULTIPLE_REGISTERS',
                                                             'WRITE_MULTIPLE_COILS','CONNECT_SUCCESS')) AS successful,
                   count(DISTINCT src_asset_id) FILTER (WHERE function_code IN ('READ_HOLDING_REGISTERS','WRITE_SINGLE_REGISTER',
                                                             'READ_COILS','WRITE_COIL','READ_INPUT_REGISTERS',
                                                             'READ_DISCRETE_INPUTS','WRITE_MULTIPLE_REGISTERS',
                                                             'WRITE_MULTIPLE_COILS','CONNECT_SUCCESS')) AS successful_devices
            FROM protocol_events
            WHERE site_id = $1 AND time > now() - ($2 * interval '1 second')
            GROUP BY protocol
            """, site_id, RECENT_WINDOW_SEC,
        )

        protocols = []
        for p in proto_rows:
            last = p["last_event"]
            age = (now - last).total_seconds() if last else None
            if p["successful"] > 0:
                proto_status = "active"
            elif p["events"] > 0:
                proto_status = "idle"
            else:
                proto_status = "offline"
            protocols.append({
                "protocol": p["protocol"],
                "events_5min": p["events"],
                "completed_5min": p["successful"],
                "devices_seen": p["devices"],
                "successful_devices": p["successful_devices"],
                "last_event": last.isoformat() if last else None,
                "seconds_since_event": int(age) if age is not None else None,
                "status": proto_status,
            })

        # Ensure all 4 known protocols are present, even if no events
        KNOWN_PROTOCOLS = ["modbus_tcp", "s7comm", "dnp3", "opcua"]
        present = {p["protocol"] for p in protocols}
        for kp in KNOWN_PROTOCOLS:
            if kp not in present:
                protocols.append({
                    "protocol": kp,
                    "events_5min": 0,
                    "completed_5min": 0,
                    "devices_seen": 0,
                    "successful_devices": 0,
                    "last_event": None,
                    "seconds_since_event": None,
                    "status": "offline",
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


