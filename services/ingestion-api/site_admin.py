"""Site creation, editing, archiving, and enrollment-token management."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from uuid import UUID
from datetime import datetime, timezone, timedelta
import asyncpg, os, hashlib, secrets

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]


class SiteCreate(BaseModel):
    name:          str = Field(..., min_length=2, max_length=80)
    location:      str | None = None
    timezone:      str = "Asia/Kolkata"
    network_cidr:  str | None = None
    contact_name:  str | None = None
    contact_email: str | None = None
    actor:         str = Field(..., min_length=2)


class SitePatch(BaseModel):
    name:          str | None = None
    location:      str | None = None
    timezone:      str | None = None
    network_cidr:  str | None = None
    contact_name:  str | None = None
    contact_email: str | None = None
    actor:         str = Field(..., min_length=2)


class ArchiveBody(BaseModel):
    actor:  str = Field(..., min_length=2)
    reason: str = Field(..., min_length=3)


class TokenBody(BaseModel):
    actor:        str = Field(..., min_length=2)
    label:        str | None = None
    ttl_hours:    int = 72


@router.post("/v1/tenants/{tenant_id}/sites", status_code=201)
async def create_site(tenant_id: UUID, body: SiteCreate, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        # tenant exists?
        t = await pool.fetchval("SELECT id FROM tenants WHERE id = $1", tenant_id)
        if not t:
            raise HTTPException(404, "tenant not found")

        # duplicate name in tenant?
        dup = await pool.fetchval(
            "SELECT 1 FROM sites WHERE tenant_id = $1 AND name = $2 AND archived_at IS NULL",
            tenant_id, body.name)
        if dup:
            raise HTTPException(409, f"site '{body.name}' already exists in this tenant")

        row = await pool.fetchrow("""
            INSERT INTO sites (tenant_id, name, location, timezone, network_cidr,
                              contact_name, contact_email)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id, name, location, timezone, network_cidr,
                      contact_name, contact_email
        """, tenant_id, body.name, body.location, body.timezone,
             body.network_cidr, body.contact_name, body.contact_email)

        # audit
        await pool.execute("""
            INSERT INTO audit_log (tenant_id, site_id, actor, action, target, detail)
            VALUES ($1, $2, $3, 'site_create', $4, $5)
        """, tenant_id, row["id"], body.actor, body.name,
             f"created site {body.name}")

        return {
            "id": str(row["id"]),
            "name": row["name"],
            "location": row["location"],
            "timezone": row["timezone"],
            "network_cidr": row["network_cidr"],
            "contact_name": row["contact_name"],
            "contact_email": row["contact_email"],
        }
    finally:
        await pool.close()


@router.patch("/v1/sites/{site_id}")
async def patch_site(site_id: UUID, body: SitePatch, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        current = await pool.fetchrow(
            "SELECT tenant_id FROM sites WHERE id = $1 AND archived_at IS NULL", site_id)
        if not current:
            raise HTTPException(404, "site not found or archived")

        # build update set
        fields, params = [], []
        for k, v in body.dict(exclude={"actor"}, exclude_unset=True).items():
            if v is not None:
                params.append(v)
                fields.append(f"{k} = ${len(params)}")
        if not fields:
            return {"changed": 0}
        params.append(site_id)
        await pool.execute(
            f"UPDATE sites SET {', '.join(fields)} WHERE id = ${len(params)}", *params)

        await pool.execute("""
            INSERT INTO audit_log (tenant_id, site_id, actor, action, target, detail)
            VALUES ($1, $2, $3, 'site_patch', $4, $5)
        """, current["tenant_id"], site_id, body.actor, str(site_id),
             f"updated fields: {list(body.dict(exclude={'actor'}, exclude_unset=True).keys())}")

        return {"changed": len(fields)}
    finally:
        await pool.close()


@router.post("/v1/sites/{site_id}/archive")
async def archive_site(site_id: UUID, body: ArchiveBody, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                cur = await conn.fetchrow(
                    "SELECT tenant_id, name, archived_at FROM sites WHERE id = $1 FOR UPDATE",
                    site_id)
                if not cur:
                    raise HTTPException(404, "site not found")
                if cur["archived_at"]:
                    raise HTTPException(409, "site already archived")

                n_dev = await conn.fetchval(
                    "SELECT count(*) FROM assets WHERE site_id = $1", site_id)
                if n_dev > 0:
                    raise HTTPException(409,
                        f"cannot archive: site has {n_dev} devices. Remove or reassign them first.")

                await conn.execute("""
                    UPDATE sites
                    SET archived_at = now(), archived_by = $1, archived_reason = $2
                    WHERE id = $3
                """, body.actor, body.reason, site_id)

                await conn.execute("""
                    INSERT INTO audit_log (tenant_id, site_id, actor, action, target, detail)
                    VALUES ($1, $2, $3, 'site_archive', $4, $5)
                """, cur["tenant_id"], site_id, body.actor, cur["name"],
                     f"archived: {body.reason}")

                return {"archived": True, "site_id": str(site_id)}
    finally:
        await pool.close()


@router.post("/v1/sites/{site_id}/enrollment-token", status_code=201)
async def create_enrollment_token(site_id: UUID, body: TokenBody, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                s = await conn.fetchrow(
                    "SELECT tenant_id, name, archived_at FROM sites WHERE id = $1 FOR UPDATE",
                    site_id)
                if not s or s["archived_at"]:
                    raise HTTPException(404, "site not found or archived")

                # generate raw token (shown once) + store hash
                raw = secrets.token_urlsafe(32)
                token_hash = hashlib.sha256(raw.encode()).hexdigest()
                expires_at = datetime.now(timezone.utc) + timedelta(hours=body.ttl_hours)

                row = await conn.fetchrow("""
                    INSERT INTO enrollment_tokens
                      (tenant_id, site_id, token_hash, label, created_by, expires_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    RETURNING id, expires_at
                """, s["tenant_id"], site_id, token_hash, body.label, body.actor, expires_at)

                await conn.execute("""
                    INSERT INTO audit_log (tenant_id, site_id, actor, action, target, detail)
                    VALUES ($1, $2, $3, 'enrollment_token_create', $4, $5)
                """, s["tenant_id"], site_id, body.actor, s["name"],
                     f"token issued (label={body.label or 'n/a'}, ttl={body.ttl_hours}h)")

                return {
                    "id": str(row["id"]),
                    "site_id": str(site_id),
                    "site_name": s["name"],
                    "token": raw,                       # shown ONCE
                    "expires_at": row["expires_at"].isoformat(),
                    "label": body.label,
                    "install_hint":
                        f"On the {s['name']} sensor host, run:\n"
                        f"  curl -s https://sentinelot.local/install.sh | sudo bash -s -- \\\n"
                        f"      --site-id={site_id} \\\n"
                        f"      --token={raw}",
                }
    finally:
        await pool.close()


@router.get("/v1/sites/{site_id}/enrollment-tokens")
async def list_enrollment_tokens(site_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("""
            SELECT id, label, created_by, created_at, expires_at,
                   used_at, revoked_at
            FROM enrollment_tokens
            WHERE site_id = $1
            ORDER BY created_at DESC
        """, site_id)
        return {"tokens": [
            {
                "id": str(r["id"]),
                "label": r["label"],
                "created_by": r["created_by"],
                "created_at": r["created_at"].isoformat(),
                "expires_at": r["expires_at"].isoformat(),
                "used_at": r["used_at"].isoformat() if r["used_at"] else None,
                "revoked_at": r["revoked_at"].isoformat() if r["revoked_at"] else None,
                "status": (
                    "used" if r["used_at"] else
                    "revoked" if r["revoked_at"] else
                    "expired" if r["expires_at"] < datetime.now(timezone.utc) else
                    "active"
                ),
            } for r in rows
        ]}
    finally:
        await pool.close()


@router.get("/v1/tenants/{tenant_id}/sites")
async def list_sites_admin(tenant_id: UUID, include_archived: bool = False, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        where = "tenant_id = $1"
        if not include_archived:
            where += " AND archived_at IS NULL"
        rows = await pool.fetch(f"""
            SELECT s.id, s.name, s.location, s.timezone, s.network_cidr,
                   s.contact_name, s.contact_email, s.archived_at,
                   count(DISTINCT a.id) AS device_count
            FROM sites s
            LEFT JOIN assets a ON a.site_id = s.id
            WHERE s.{where}
            GROUP BY s.id, s.name, s.location, s.timezone, s.network_cidr,
                     s.contact_name, s.contact_email, s.archived_at
            ORDER BY s.name
        """, tenant_id)
        return {"sites": [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "location": r["location"],
                "timezone": r["timezone"],
                "network_cidr": r["network_cidr"],
                "contact_name": r["contact_name"],
                "contact_email": r["contact_email"],
                "device_count": r["device_count"],
                "archived": r["archived_at"] is not None,
            } for r in rows
        ]}
    finally:
        await pool.close()
