from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
import asyncpg, os, secrets

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]
from db import write_audit

class CreateSiteRequest(BaseModel):
    name: str
    actor: str = "operator"

class EnrollmentRequest(BaseModel):
    actor: str = "operator"

@router.get("/v1/tenants/{tenant_id}/sites")
async def list_sites(tenant_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("SELECT id, name FROM sites WHERE tenant_id = $1 ORDER BY name", tenant_id)
        return {"sites": [{"id": str(r["id"]), "name": r["name"]} for r in rows]}
    finally:
        await pool.close()

@router.get("/v1/sites")
async def list_all_sites(_: dict = Depends(lambda: None)):
    """List all sites with aggregate counts. Frontend uses this for the
    site picker, onboarding gate, and the Sites management tab."""
    DEMO_TENANT = "11111111-1111-1111-1111-111111111111"
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            """
            SELECT
                s.id,
                s.name,
                s.created_at,
                (SELECT max(time)  FROM protocol_events WHERE site_id = s.id) AS last_event_at,
                (SELECT count(*)   FROM protocol_events WHERE site_id = s.id) AS event_count,
                (SELECT count(*)   FROM assets          WHERE site_id = s.id) AS asset_count,
                (SELECT count(*)   FROM alerts          WHERE site_id = s.id AND status = 'open') AS alert_count
            FROM sites s
            WHERE s.tenant_id = $1
            ORDER BY s.name
            """,
            DEMO_TENANT,
        )
        return {
            "sites": [
                {
                    "id":             str(r["id"]),
                    "name":           r["name"],
                    "created_at":     r["created_at"].isoformat() if r["created_at"] else None,
                    "last_event_at":  r["last_event_at"].isoformat() if r["last_event_at"] else None,
                    "event_count":    int(r["event_count"] or 0),
                    "asset_count":    int(r["asset_count"] or 0),
                    "alert_count":    int(r["alert_count"] or 0),
                }
                for r in rows
            ]
        }
    finally:
        await pool.close()


@router.delete("/v1/sites/{site_id}")
async def delete_site(site_id: UUID, actor: str = "operator", _: dict = Depends(lambda: None)):
    """Delete a site — ONLY if it has no events, no assets, no alerts.
    Refuses with 409 if data exists; user must purge first via Settings."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        row = await pool.fetchrow(
            """SELECT
                 (SELECT count(*) FROM protocol_events WHERE site_id = $1) AS ev,
                 (SELECT count(*) FROM assets          WHERE site_id = $1) AS as_,
                 (SELECT count(*) FROM alerts          WHERE site_id = $1) AS al,
                 tenant_id
               FROM sites WHERE id = $1""",
            site_id,
        )
        if row is None:
            raise HTTPException(404, "site not found")

        ev, as_, al = int(row["ev"]), int(row["as_"]), int(row["al"])
        if ev or as_ or al:
            raise HTTPException(
                409,
                f"site has data ({ev} events, {as_} assets, {al} alerts). "
                f"Purge first via Settings → Retention → Purge old events.",
            )

        # Guarded cleanup — same order as manual deletion
        await pool.execute("DELETE FROM compliance_reports WHERE site_id = $1", site_id)
        await pool.execute("DELETE FROM report_archive     WHERE site_id = $1", site_id)
        await pool.execute("DELETE FROM asset_classifications WHERE site_id = $1", site_id)
        await pool.execute("DELETE FROM enrollment_tokens  WHERE site_id = $1", site_id)
        await pool.execute("DELETE FROM sensors            WHERE site_id = $1", site_id)
        await pool.execute("DELETE FROM sites WHERE id = $1", site_id)

        await write_audit(
            tenant_id=row["tenant_id"],
            site_id=site_id,
            actor=actor,
            action="site.delete",
            target=str(site_id),
            target_type="site",
            target_id=site_id,
            detail=None,
            details={},
        )
        return {"ok": True, "id": str(site_id)}
    finally:
        await pool.close()


@router.post("/v1/tenants/{tenant_id}/sites")
async def create_site(tenant_id: UUID, req: CreateSiteRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        site_id = await pool.fetchval(
            "INSERT INTO sites (tenant_id, name) VALUES ($1, $2) RETURNING id",
            tenant_id, req.name
        )
        await write_audit(
            tenant_id=tenant_id,
            site_id=site_id,
            actor=req.actor,
            action="site.create",
            target=str(site_id),
            target_type="site",
            target_id=site_id,
            detail=None,
            details={"name": req.name},
        )
        return {"id": str(site_id), "name": req.name}
    finally:
        await pool.close()

@router.post("/v1/sites/{site_id}/enrollment-token")
async def get_token(site_id: UUID, req: EnrollmentRequest, _: dict = Depends(lambda: None)):
    """Generate an enrollment token for a new sensor.
    Token is returned ONCE in plaintext; only the SHA-256 hash is stored."""
    import hashlib as _hl
    from datetime import datetime as _dt, timezone as _tz, timedelta as _td

    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        # Verify site exists and get its tenant_id
        tenant_id = await pool.fetchval(
            "SELECT tenant_id FROM sites WHERE id = $1", site_id
        )
        if tenant_id is None:
            raise HTTPException(404, "site not found")

        # Generate opaque token, store only its hash
        token_plain = secrets.token_urlsafe(32)
        token_hash = _hl.sha256(token_plain.encode()).hexdigest()
        expires = _dt.now(_tz.utc) + _td(days=7)

        await pool.execute(
            """INSERT INTO enrollment_tokens
               (tenant_id, site_id, token_hash, label, created_by, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            tenant_id, site_id, token_hash,
            f"auto-{_dt.now(_tz.utc).strftime('%Y%m%d')}",
            req.actor, expires,
        )

        await write_audit(
            tenant_id=tenant_id,
            site_id=site_id,
            actor=req.actor,
            action="site.enrollment_token.create",
            target=str(site_id),
            target_type="site",
            target_id=site_id,
            detail=None,
            details={"token_prefix": token_plain[:8], "expires_at": expires.isoformat()},
        )

        return {
            "token": token_plain,
            "site_id": str(site_id),
            "expires_at": expires.isoformat(),
            "note": "Save this token — it cannot be retrieved again.",
        }
    finally:
        await pool.close()

class UpdateSiteRequest(BaseModel):
    name: str
    actor: str = "operator"

@router.patch("/v1/sites/{site_id}")
async def update_site(site_id: UUID, req: UpdateSiteRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        _old_name = await pool.fetchval("SELECT name FROM sites WHERE id = $1", site_id)
        if _old_name is None:
            raise HTTPException(404, "site not found")
        await pool.execute(
            "UPDATE sites SET name = $1 WHERE id = $2",
            req.name, site_id
        )
        _tid = await pool.fetchval("SELECT tenant_id FROM sites WHERE id = $1", site_id)
        await write_audit(
            tenant_id=_tid,
            site_id=site_id,
            actor=req.actor,
            action="site.update",
            target=str(site_id),
            target_type="site",
            target_id=site_id,
            detail=None,
            details={"old_name": _old_name, "new_name": req.name},
        )
        return {"status": "updated", "name": req.name}
    finally:
        await pool.close()
