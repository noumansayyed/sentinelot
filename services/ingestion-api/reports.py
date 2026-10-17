from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
import asyncpg, os, subprocess

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

@router.post("/v1/sites/{site_id}/reports/generate")
async def trigger_report(site_id: UUID, _: dict = Depends(lambda: None)):
    # Since the ingestion-api container doesn't have psycopg2 or the report script,
    # we execute the docker command on the host using the host's docker socket.
    # (This assumes /var/run/docker.sock is mounted to the ingestion-api).
    # If it isn't, we run it via a shell that connects back to the host.
    try:
        # We use the host's docker CLI by execing into the /var/run/docker.sock
        # For this to work, you must mount /var/run/docker.sock into the ingestion-api container.
        # I will provide the docker-compose update below.
        
        cmd = [
            "docker", "run", "--rm",
            "--network", "sentinelot_default",
            "-v", "/home/user/sentinelot/reports:/reports",
            "-e", f"DATABASE_URL={DATABASE_URL}",
            "-e", "TRIGGERED_BY=manual",
            "sentinelot-compliance-report",
            "python", "generate_report.py", str(site_id)
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise Exception(f"Stdout: {result.stdout} Stderr: {result.stderr}")
            
        return {"status": "generated"}
    except Exception as e:
        raise HTTPException(500, f"Generator failed: {e}")

@router.get("/v1/sites/{site_id}/reports")
async def list_reports(site_id: UUID, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch("SELECT id, created_at, triggered_by, file_path FROM report_archive WHERE site_id = $1 ORDER BY created_at DESC", site_id)
        return {"reports": [
            {"id": str(r["id"]), "created_at": r["created_at"].isoformat(), "triggered_by": r["triggered_by"], "file_path": r["file_path"].split("/")[-1]} for r in rows
        ]}
    finally:
        await pool.close()
