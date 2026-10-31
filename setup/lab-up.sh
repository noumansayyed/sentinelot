#!/bin/bash
# SentinelOT lab-up — idempotent, restart-safe.
# Every container: --restart unless-stopped. Every mount: folder-level where
# possible (WSL2 file-mount cache is unreliable). Bridges self-heal on inode
# rotation. Safe to run any number of times, in any order.
set -e

PG_PW=$(grep ^POSTGRES_PASSWORD "$HOME/sentinelot/.env" | cut -d= -f2)

# ── Pre-flight: remove any leftover lab containers ──────────────────────────
docker rm -f plc-modbus modbus-sim-client s7-plc opcua-server \
             s7-client opcua-client dnp3-client hmi-device iiot-sensor \
             real-sensor zeek-bridge conn-bridge llm-triage \
             dashboard-react >/dev/null 2>&1 || true

echo "=== 1. plc-modbus (OpenPLC, bridge network) ==="
docker run -d --name plc-modbus --network sentinelot_default \
  --restart unless-stopped \
  -p 8090:8080 tuttas/openplc_v3
sleep 12

echo "=== 2. modbus-sim-client (polls OpenPLC on 502) ==="
docker run -d --name modbus-sim-client --network sentinelot_default \
  --restart unless-stopped \
  -e PYTHONUNBUFFERED=1 \
  -e PLC_HOST=plc-modbus \
  -e PLC_PORT=502 \
  --entrypoint python sentinelot-modbus-sim -u /app/client_traffic.py
sleep 2

echo "=== 3. s7-plc, opcua-server (share plc-modbus netns) ==="
docker run -d --name s7-plc      --network container:plc-modbus --restart unless-stopped sentinelot-s7-plc
docker run -d --name opcua-server --network container:plc-modbus --restart unless-stopped sentinelot-opcua-server

echo "=== 4. industrial clients: s7, opcua, dnp3, hmi, iiot ==="
for c in s7-client opcua-client dnp3-client hmi-device iiot-sensor; do
  if docker image inspect "sentinelot-$c" >/dev/null 2>&1; then
    docker run -d --name "$c" --network sentinelot_default \
      --restart unless-stopped \
      -e PLC_HOST=plc-modbus "sentinelot-$c"
    echo "  started: $c"
  elif docker image inspect "sentinelot-${c%%-*}" >/dev/null 2>&1; then
    docker run -d --name "$c" --network sentinelot_default \
      --restart unless-stopped \
      -e PLC_HOST=plc-modbus "sentinelot-${c%%-*}"
    echo "  started: $c (from sentinelot-${c%%-*})"
  else
    echo "  SKIP: no image for $c"
  fi
done

echo "=== 5. real-sensor (Zeek, sniffs eth0 of plc-modbus netns) ==="
mkdir -p "$HOME/sentinelot/zeek-lab/real-sensor/logs/zeek" \
         "$HOME/sentinelot/zeek-lab/real-sensor/logs/suricata"

REAL_SENSOR_MOUNTS=(-v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs")
if [ -f "$HOME/sentinelot/zeek-lab/real-sensor/logs/local.zeek.patched" ]; then
  REAL_SENSOR_MOUNTS+=(-v "$HOME/sentinelot/zeek-lab/real-sensor/logs/local.zeek.patched:/usr/local/zeek/share/zeek/site/local.zeek:ro")
fi

docker run -d --name real-sensor --network container:plc-modbus \
  --restart unless-stopped \
  -e IFACE=eth0 --cap-add=NET_ADMIN --cap-add=NET_RAW \
  "${REAL_SENSOR_MOUNTS[@]}" \
  sentinelot-real-sensor
sleep 25

echo "=== 6. bridges (folder mounts, self-healing, --init) ==="
docker run -d --name zeek-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro" \
  -v "$HOME/sentinelot/zeek-bridge:/app:ro" \
  --restart unless-stopped \
  --init \
  sentinelot-zeek-bridge python -u /app/bridge.py
docker run -d --name conn-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro" \
  -v "$HOME/sentinelot/zeek-bridge:/app:ro" \
  --restart unless-stopped \
  --init \
  sentinelot-zeek-bridge python -u /app/conn_bridge.py
sleep 10

echo "=== 7. llm-triage ==="
docker run -d --name llm-triage --network sentinelot_default \
  --restart unless-stopped \
  -e "DATABASE_URL=postgresql://sentinelot:${PG_PW}@sentinelot-postgres-1:5432/sentinelot" \
  -e OLLAMA_URL="http://ollama:11434" \
  -e OLLAMA_MODEL="qwen2.5:1.5b" \
  sentinelot-llm-triage

echo "=== 8. dashboard-react (nginx) ==="
docker run -d --name dashboard-react --network sentinelot_default \
  --restart unless-stopped \
  -p 3000:80 \
  -v "$HOME/sentinelot/dashboard-react/dist:/usr/share/nginx/html:ro" \
  nginx:alpine

echo "=== 9. ensure sensor record exists ==="
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
  "INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status) VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'dev-sensor', 'dev-test-fingerprint-000', 'online') ON CONFLICT (id) DO NOTHING;" >/dev/null

echo ""
echo "=== Lab up. Verify: ==="
echo "  curl -s http://localhost:8000/health/components | python3 -m json.tool"
echo "  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \"SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval '2 minutes' GROUP BY 1;\""
