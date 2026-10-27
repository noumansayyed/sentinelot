"""Per-alert playbook (read-only). Structured playbooks are generated
asynchronously by the llm-triage worker and cached in alert_playbooks.
This endpoint never calls Ollama synchronously -- the modal must open
instantly, and CPU inference on qwen2.5:1.5b takes minutes per prompt.
"""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
import asyncpg, os, json

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]


async def _get_alert_ctx(pool, alert_id):
    r = await pool.fetchrow("""
        SELECT a.id, a.time, a.severity, a.description, a.evidence,
               a.llm_explanation,
               ast.ip_address::text AS device_ip,
               COALESCE(ast.role_manual, ast.device_role, 'unknown') AS device_role,
               s.name AS site_name
        FROM alerts a
        LEFT JOIN assets ast ON ast.id = a.asset_id
        LEFT JOIN sites s ON s.id = a.site_id
        WHERE a.id = $1
    """, alert_id)
    if not r:
        raise HTTPException(404, "alert not found")
    return r


def _decode_actions(v):
    if v is None:
        return []
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v


@router.get("/v1/alerts/{alert_id}/playbook")
async def get_playbook(alert_id: UUID, refresh: bool = False, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        # Fast path 1: structured playbook exists -> return immediately.
        pb = await pool.fetchrow(
            "SELECT what, why, actions, escalate, model, generated_at "
            "FROM alert_playbooks WHERE alert_id = $1", alert_id)
        if pb and pb["why"]:
            return {
                "alert_id": str(alert_id),
                "cached": True,
                "model": pb["model"],
                "generated_at": pb["generated_at"].isoformat(),
                "what": pb["what"],
                "why": pb["why"],
                "actions": _decode_actions(pb["actions"]),
                "escalate": pb["escalate"],
                "status": "ready",
            }

        # Fast path 2: prose explanation exists but no structured playbook yet.
        ctx = await _get_alert_ctx(pool, alert_id)
        if ctx["llm_explanation"]:
            return {
                "alert_id": str(alert_id),
                "cached": True,
                "model": os.environ.get("LLM_MODEL", "qwen2.5:1.5b"),
                "generated_at": "now",
                "what": ctx["llm_explanation"].strip(),
                "why": "",
                "actions": [],
                "escalate": "",
                "status": "generating",
                "message": "A detailed playbook is being generated. Re-open this alert in about a minute for the full recommendation.",
            }

        # Fast path 3: nothing yet -- worker has not seen this alert.
        return {
            "alert_id": str(alert_id),
            "cached": True,
            "model": "pending",
            "generated_at": "now",
            "what": ctx["description"],
            "why": "",
            "actions": [],
            "escalate": "",
            "status": "generating",
            "message": "Playbook generation has not started yet. The background worker picks up new alerts within ~1 minute.",
        }
    finally:
        await pool.close()
