"""Per-alert LLM playbook generator + cache."""
from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
import asyncpg, os, json
import httpx

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:1.5b")

PROMPT_TEMPLATE = """You are an OT security analyst advising a plant operator. Return ONLY valid JSON, no other text.

Alert:
- Severity: {severity}
- Description: {description}
- Device: {device_ip} (role: {device_role})
- Site: {site_name}
- Evidence: {evidence}

Return JSON:
{{
  "what":   "One sentence: what happened.",
  "why":    "Two sentences: why this matters in an OT plant.",
  "actions": [
    {{"step": "Short action", "detail": "One sentence how."}},
    ... 3 to 6 steps ...
  ],
  "escalate": "One sentence: when to escalate and to whom."
}}"""

async def _get_alert_ctx(pool, alert_id):
    r = await pool.fetchrow("""
        SELECT a.id, a.time, a.severity, a.description, a.evidence,
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

async def _call_ollama(prompt: str) -> str:
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
                  "options": {"temperature": 0.2}},
        )
        r.raise_for_status()
        return r.json()["response"]

def _parse_json(raw: str) -> dict:
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON")
    return json.loads(raw[start:end+1])

@router.get("/v1/alerts/{alert_id}/playbook")
async def get_playbook(alert_id: UUID, refresh: bool = False, _: dict = Depends(lambda: None)):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        if not refresh:
            cached = await pool.fetchrow(
                "SELECT what, why, actions, escalate, model, generated_at FROM alert_playbooks WHERE alert_id = $1",
                alert_id)
            if cached:
                return {
                    "alert_id": str(alert_id), "cached": True,
                    "model": cached["model"],
                    "generated_at": cached["generated_at"].isoformat(),
                    "what": cached["what"], "why": cached["why"],
                    "actions": cached["actions"], "escalate": cached["escalate"],
                }

        ctx = await _get_alert_ctx(pool, alert_id)
        prompt = PROMPT_TEMPLATE.format(
            severity=ctx["severity"], description=ctx["description"],
            device_ip=ctx["device_ip"] or "unknown",
            device_role=ctx["device_role"], site_name=ctx["site_name"] or "unknown",
            evidence=json.dumps(ctx["evidence"] or {}, default=str)[:1000],
        )
        raw = await _call_ollama(prompt)
        try:
            parsed = _parse_json(raw)
        except Exception:
            raise HTTPException(502, f"LLM returned non-JSON: {raw[:200]}")

        what = parsed.get("what",""); why = parsed.get("why","")
        actions = parsed.get("actions", []); escalate = parsed.get("escalate","")

        await pool.execute("""
            INSERT INTO alert_playbooks (alert_id, alert_time, what, why, actions, escalate, model)
            VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
            ON CONFLICT (alert_id) DO UPDATE
              SET what=$3, why=$4, actions=$5::jsonb, escalate=$6, model=$7, generated_at=now()
        """, alert_id, ctx["time"], what, why, json.dumps(actions), escalate, OLLAMA_MODEL)

        return {"alert_id": str(alert_id), "cached": False, "model": OLLAMA_MODEL,
                "generated_at": "now", "what": what, "why": why,
                "actions": actions, "escalate": escalate}
    finally:
        await pool.close()
