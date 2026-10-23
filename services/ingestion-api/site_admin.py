from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from uuid import UUID
import asyncpg, os, secrets

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

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

@router.post("/v1/tenants/{tenant_id}/sites")
async def create_site(tenant_id: UUID, req: CreateSiteRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        site_id = await pool.fetchval(
            "INSERT INTO sites (tenant_id, name) VALUES ($1, $2) RETURNING id",
            tenant_id, req.name
        )
        return {"id": str(site_id), "name": req.name}
    finally:
        await pool.close()

@router.post("/v1/sites/{site_id}/enrollment-token")
async def get_token(site_id: UUID, req: EnrollmentRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        token = secrets.token_urlsafe(32)
        await pool.execute(
            "INSERT INTO sensor_enrollments (site_id, token) VALUES ($1, $2)",
            site_id, token
        )
        return {"token": token, "site_id": str(site_id)}
    finally:
        await pool.close()

class UpdateSiteRequest(BaseModel):
    name: str
    actor: str = "operator"

@router.patch("/v1/sites/{site_id}")
async def update_site(site_id: UUID, req: UpdateSiteRequest, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        await pool.execute(
            "UPDATE sites SET name = $1 WHERE id = $2",
            req.name, site_id
        )
        return {"status": "updated", "name": req.name}
    finally:
        await pool.close()
