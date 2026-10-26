"""
SentinelOT - LLM Triage Service
Polls for alerts without a playbook, asks local Ollama (qwen2.5:1.5b) for a
structured playbook (what / why / actions / escalate) in JSON, writes both
to alerts.llm_explanation (prose) and alert_playbooks (structured).

CPU inference on 1.5B is slow (~2-4 min per alert), so this worker runs
fully async with per-alert connection retries. If a generation fails, the
alert is retried on the next poll without holding a stale DB connection.
"""
import time, json, requests, psycopg2, psycopg2.extras, os

DATABASE_URL = os.environ["DATABASE_URL"]
OLLAMA_URL = "http://ollama:11434/api/generate"
MODEL = "qwen2.5:1.5b"
POLL_INTERVAL_S = 10

# Compact prompt -- fewer input tokens = faster time-to-first-token.
# NOTE: the JSON example below MUST use doubled braces {{ }} -- Python's
# str.format() treats single { } as placeholders and would raise KeyError.
PROMPT_TEMPLATE = """Return ONLY a JSON object (no prose, no markdown). You are an OT security analyst writing a short playbook for a plant operator.

Alert: severity={severity}; description={description}; device={device_ip} ({device_role}); site={site_name}

JSON schema:
{{"what": "1 sentence", "why": "2 sentences on OT risk", "actions": [{{"step":"3-5 words","detail":"1 sentence"}}, {{"step":"3-5 words","detail":"1 sentence"}}, {{"step":"3-5 words","detail":"1 sentence"}}], "escalate": "1 sentence on when/who to escalate"}}"""


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def fetch_pending_alerts(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT a.id, a.time, a.severity, a.description, a.evidence,
                   ast.ip_address::text AS device_ip,
                   COALESCE(ast.role_manual, ast.device_role, 'unknown') AS device_role,
                   s.name AS site_name
            FROM alerts a
            LEFT JOIN assets ast ON ast.id = a.asset_id
            LEFT JOIN sites s ON s.id = a.site_id
            LEFT JOIN alert_playbooks pb ON pb.alert_id = a.id
            WHERE pb.alert_id IS NULL
            ORDER BY a.time ASC
            LIMIT 1
        """)
        return cur.fetchall()


def parse_json(raw):
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON in LLM output: " + raw[:200])
    return json.loads(raw[start:end+1])


def generate_playbook(alert):
    prompt = PROMPT_TEMPLATE.format(
        severity=alert["severity"],
        description=alert["description"],
        device_ip=alert["device_ip"] or "unknown",
        device_role=alert["device_role"],
        site_name=alert["site_name"] or "unknown",
    )
    resp = requests.post(
        OLLAMA_URL,
        json={
            "model": MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_predict": 400,   # cap output -> bounded generation time
                "num_ctx": 2048,      # smaller context -> faster prefill
            },
        },
        timeout=(10, 600),   # 10s connect, 600s read
    )
    resp.raise_for_status()
    raw = resp.json().get("response", "")
    print("    [raw model output, " + str(len(raw)) + " chars]: " + raw[:500], flush=True)
    return parse_json(raw)


def save_playbook(alert, pb):
    """Open a fresh connection for the write (previous conn may have gone idle)."""
    what = pb.get("what", "")
    why = pb.get("why", "")
    actions = pb.get("actions", [])
    escalate = pb.get("escalate", "")
    prose = (what + " " + why).strip() or what

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE alerts SET llm_explanation = %s WHERE id = %s AND time = %s",
                (prose, alert["id"], alert["time"]),
            )
            cur.execute("""
                INSERT INTO alert_playbooks
                  (alert_id, alert_time, what, why, actions, escalate, model)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
                ON CONFLICT (alert_id) DO UPDATE
                  SET what = EXCLUDED.what,
                      why = EXCLUDED.why,
                      actions = EXCLUDED.actions,
                      escalate = EXCLUDED.escalate,
                      model = EXCLUDED.model,
                      generated_at = now()
            """, (alert["id"], alert["time"], what, why,
                  json.dumps(actions), escalate, MODEL))
        conn.commit()
    finally:
        conn.close()


def main():
    print("LLM triage starting (STRUCTURED v2), model=" + MODEL, flush=True)
    while True:
        try:
            conn = get_conn()
            try:
                alerts = fetch_pending_alerts(conn)
            finally:
                conn.close()

            if alerts:
                print("processing " + str(len(alerts)) + " alert(s)", flush=True)
            for alert in alerts:
                aid = str(alert["id"])
                print("generating for " + aid + " - " + alert["description"][:60] + "...", flush=True)
                try:
                    pb = generate_playbook(alert)
                    save_playbook(alert, pb)
                    print("  OK saved (" + str(len(pb.get("actions", []))) + " actions)", flush=True)
                except Exception as exc:
                    import traceback
                    print("  FAILED " + aid + ": " + str(exc)[:200], flush=True)
                    print("  TRACEBACK:", traceback.format_exc()[:1500], flush=True)
        except Exception as exc:
            print("poll error: " + str(exc)[:200], flush=True)
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
