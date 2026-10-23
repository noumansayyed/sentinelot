"""Per-device classification + inbox. This is the scale foundation for plants with 200+ devices."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from uuid import UUID
from typing import Literal
import asyncpg, os

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

VALID_ROLES = ("plc","hmi","rtu","sensor","engineering_workstation","switch","unknown")
VALID_CRIT  = ("critical","high","medium","low","unclassified")


class ClassifyBody(BaseModel):
    actor:       str = Field(..., min_length=2)
    role:        str | None = None
    criticality: str | None = None
    hidden:      bool | None = None
    reason:      str | None = None


class BulkClassifyBody(BaseModel):
    actor:       str = Field(..., min_length=2)
    asset_ids:   list[UUID] = Field(..., min_length=1)
    role:        str | None = None
    criticality: str | None = None
    hidden:      bool | None = None
    reason:      str | None = None


@router.post("/v1/assets/{asset_id}/classify")
async def classify_asset(asset_id: UUID, body: ClassifyBody, _: dict = Depends(lambda: None)):
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(400, f"invalid role; must be one of {VALID_ROLES}")
    if body.criticality and body.criticality not in VALID_CRIT:
        raise HTTPException(400, f"invalid criticality; must be one of {VALID_CRIT}")
    if body.hidden is None and body.role is None and body.criticality is None:
        raise HTTPException(400, "at least one of role/criticality/hidden required")

    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                cur = await conn.fetchrow(
                    "SELECT id, site_id, device_role, criticality, hidden FROM assets WHERE id = $1 FOR UPDATE",
                    asset_id)
                if not cur:
                    raise HTTPException(404, "asset not found")

                sets, params = [], []
                if body.role is not None:
                    params.append(body.role)
                    sets.append(f"role_manual = ${len(params)}")
                    params.append(body.role)
                    sets.append(f"device_role = ${len(params)}")
                if body.criticality is not None:
                    params.append(body.criticality)
                    sets.append(f"criticality = ${len(params)}")
                if body.hidden is not None:
                    params.append(body.hidden)
                    sets.append(f"hidden = ${len(params)}")
                    if body.hidden:
                        params.append(body.reason or "operator marked as infrastructure")
                        sets.append(f"hidden_reason = ${len(params)}")
                    else:
                        sets.append("hidden_reason = NULL")

                params.append(asset_id)
                await conn.execute(
                    f"UPDATE assets SET {', '.join(sets)} WHERE id = ${len(params)}", *params)

                # audit
                action = "hide" if body.hidden else ("unhide" if body.hidden is False else "classify")
                await conn.execute("""
                    INSERT INTO asset_classifications
                      (asset_id, site_id, actor, action, old_role, new_role,
                       old_hidden, new_hidden, reason)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """, asset_id, cur["site_id"], body.actor, action,
                     cur["device_role"], body.role or cur["device_role"],
                     cur["hidden"], body.hidden if body.hidden is not None else cur["hidden"],
                     body.reason)

                return {"asset_id": str(asset_id), "updated": True}
    finally:
        await pool.close()


@router.post("/v1/assets/bulk-classify")
async def bulk_classify(body: BulkClassifyBody, _: dict = Depends(lambda: None)):
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(400, f"invalid role; must be one of {VALID_ROLES}")
    if body.criticality and body.criticality not in VALID_CRIT:
        raise HTTPException(400, f"invalid criticality; must be one of {VALID_CRIT}")
    if body.hidden is None and body.role is None and body.criticality is None:
        raise HTTPException(400, "at least one of role/criticality/hidden required")

    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    try:
        updated = 0
        async with pool.acquire() as conn:
            async with conn.transaction():
                for aid in body.asset_ids:
                    cur = await conn.fetchrow(
                        "SELECT id, site_id, device_role, hidden FROM assets WHERE id = $1 FOR UPDATE",
                        aid)
                    if not cur:
                        continue
                    sets, params = [], []
                    if body.role is not None:
                        params.append(body.role); sets.append(f"role_manual = ${len(params)}")
                        params.append(body.role); sets.append(f"device_role = ${len(params)}")
                    if body.criticality is not None:
                        params.append(body.criticality); sets.append(f"criticality = ${len(params)}")
                    if body.hidden is not None:
                        params.append(body.hidden); sets.append(f"hidden = ${len(params)}")
                        if body.hidden:
                            params.append(body.reason or "operator bulk-marked"); sets.append(f"hidden_reason = ${len(params)}")
                        else:
                            sets.append("hidden_reason = NULL")
                    params.append(aid)
                    await conn.execute(
                        f"UPDATE assets SET {', '.join(sets)} WHERE id = ${len(params)}", *params)

                    action = "hide" if body.hidden else ("unhide" if body.hidden is False else "classify")
                    await conn.execute("""
                        INSERT INTO asset_classifications
                          (asset_id, site_id, actor, action, old_role, new_role,
                           old_hidden, new_hidden, reason)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    """, aid, cur["site_id"], body.actor, action,
                         cur["device_role"], body.role or cur["device_role"],
                         cur["hidden"], body.hidden if body.hidden is not None else cur["hidden"],
                         body.reason)
                    updated += 1
        return {"updated": updated, "requested": len(body.asset_ids)}
    finally:
        await pool.close()


@router.get("/v1/sites/{site_id}/assets/inbox")
async def asset_inbox(site_id: UUID, _: dict = Depends(lambda: None)):
    """Devices needing operator attention: unclassified, or no traffic in 24h but not hidden."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("""
            SELECT id, ip_address::text AS ip, mac_address::text AS mac,
                   device_role, criticality, protocols, first_seen, last_seen,
                   CASE
                     WHEN device_role = 'unknown' AND criticality = 'unclassified' THEN 'unclassified'
                     WHEN last_seen < now() - interval '24 hours' THEN 'stale'
                     ELSE 'attention'
                   END AS reason
            FROM assets
            WHERE site_id = $1
              AND hidden = false
              AND (
                (device_role = 'unknown' AND criticality = 'unclassified')
                OR (last_seen < now() - interval '24 hours')
              )
            ORDER BY last_seen DESC
        """, site_id)
        return {"inbox": [
            {
                "asset_id": str(r["id"]),
                "ip": r["ip"],
                "mac": r["mac"],
                "device_role": r["device_role"],
                "criticality": r["criticality"],
                "protocols": list(r["protocols"] or []),
                "first_seen": r["first_seen"].isoformat() if r["first_seen"] else None,
                "last_seen": r["last_seen"].isoformat() if r["last_seen"] else None,
                "reason": r["reason"],
            } for r in rows
        ]}
    finally:
        await pool.close()

@router.delete("/v1/assets/{asset_id}")
async def delete_asset(asset_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                # 1. Delete dependent protocol_events
                await conn.execute("DELETE FROM protocol_events WHERE src_asset_id = $1 OR dst_asset_id = $1", asset_id)
                # 2. Delete dependent alerts
                await conn.execute("DELETE FROM alerts WHERE asset_id = $1", asset_id)
                # 3. Delete the asset itself
                await conn.execute("DELETE FROM assets WHERE id = $1", asset_id)
        return {"status": "deleted"}
    finally:
        await pool.close()
