"""
SentinelOT — LLM Triage Service
Polls for alerts without an explanation yet, asks a local Ollama model
(Qwen2.5, open-weight, running on-prem -- no API cost, no third-party
data dependency) to translate the raw technical description into a
plain-language explanation + recommended action for a non-expert plant
operator, and stores it back on the alert row.
"""
import time
import requests
import psycopg2
import psycopg2.extras
import os

DATABASE_URL = os.environ["DATABASE_URL"]
OLLAMA_URL = "http://ollama:11434/api/generate"
MODEL = "qwen2.5:1.5b"
POLL_INTERVAL_S = 5

PROMPT_TEMPLATE = """You are an OT security assistant explaining a technical alert to a non-expert factory plant operator, in 2-3 short sentences.
Explain plainly what happened, why it matters, and one clear recommended action. Do not use jargon.

Alert: {description}

Plain-language explanation:"""


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def fetch_unexplained_alerts(conn):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT id, time, description FROM alerts WHERE llm_explanation IS NULL ORDER BY time ASC LIMIT 5"
        )
        return cur.fetchall()


def explain(description: str) -> str:
    resp = requests.post(
        OLLAMA_URL,
        json={"model": MODEL, "prompt": PROMPT_TEMPLATE.format(description=description), "stream": False},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()


def save_explanation(conn, alert_id, time_val, explanation: str):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE alerts SET llm_explanation = %s WHERE id = %s AND time = %s",
            (explanation, alert_id, time_val),
        )
    conn.commit()


def main():
    print(f"LLM triage service starting, model={MODEL}, polling every {POLL_INTERVAL_S}s ...")
    conn = get_conn()
    while True:
        try:
            alerts = fetch_unexplained_alerts(conn)
            for alert in alerts:
                print(f"explaining alert {alert['id']}: {alert['description'][:60]}...")
                explanation = explain(alert["description"])
                save_explanation(conn, alert["id"], alert["time"], explanation)
                print(f"  -> {explanation[:100]}...")
        except Exception as exc:
            print("error:", exc)
            conn.rollback()
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
