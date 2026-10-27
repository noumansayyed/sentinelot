#!/bin/bash
set -e
ok()   { echo "[OK]  $1"; }
warn() { echo "[WARN] $1"; }

# ── LLM Triage (needs env var, not in compose) ──────────────────────────────
docker rm -f llm-triage 2>/dev/null || true
docker run -d --name llm-triage \
  -e DATABASE_URL="postgresql://sentinelot:f0cacbf8c8eb4ca99738c69f@sentinelot-postgres-1:5432/sentinelot" \
  --network sentinelot_default \
  sentinelot-llm-triage && ok "llm-triage" || warn "llm-triage"

# ── Dashboard (fixed build baked in) ────────────────────────────────────────
docker rm -f dashboard-react 2>/dev/null || true
docker run -d --name dashboard-react \
  --network sentinelot_default \
  -p 3000:80 \
  sentinelot-dashboard-react && ok "dashboard-react" || warn "dashboard-react"

# ── Everything else (already have correct config, just start) ────────────────
for c in plc-modbus hmi-device iiot-sensor s7-client dnp3-client opcua-client \
          rogue-device real-sensor zeek-bridge conn-bridge \
          sentinelot-postgres-1 ollama sentinelot-ingestion-api-1 \
          sentinelot-redpanda-1 sentinelot-stream-processor-1; do
  docker start "$c" >/dev/null 2>&1 && ok "$c" || warn "$c (not found or failed)"
done

echo ""
echo "Dashboard → http://localhost:3000"
echo "Login     → operator / operator123"
