#!/bin/bash
# SentinelOT lab-up — flat bridge network, no macvlan.
# All devices on sentinelot_default; sensor sees all industrial traffic on eth0.
# Per SoP: 502/tcp (Modbus), 20000/tcp+udp (DNP3), 102/tcp (S7comm), 4840/tcp (OPC UA).
set -e

# Read DB password from .env, never hardcode
PG_PW=$(grep ^POSTGRES_PASSWORD "$HOME/sentinelot/.env" | cut -d= -f2)

echo "=== 1. plc-modbus (OpenPLC, bridge network) ==="
docker rm -f plc-modbus >/dev/null 2>&1 || true
docker run -d --name plc-modbus --network sentinelot_default \
  -p 8090:8080 tuttas/openplc_v3
sleep 12

echo "=== 2. modbus-sim (real Modbus TCP simulator on 502) ==="
# modbus-sim (fake PLC) NOT needed — plc-modbus (OpenPLC) serves Modbus on port 502
# docker rm -f modbus-sim >/dev/null 2>&1 || true
# docker run -d --name modbus-sim --network sentinelot_default \
#   --entrypoint python sentinelot-modbus-sim plc_server.py
docker rm -f modbus-sim-client >/dev/null 2>&1 || true
docker run -d --name modbus-sim-client --network sentinelot_default \
  -e PYTHONUNBUFFERED=1 \
  -e PLC_HOST=plc-modbus \
  -e PLC_PORT=502 \
  --entrypoint python sentinelot-modbus-sim -u /app/client_traffic.py
sleep 2

echo "=== 3. s7-plc, opcua-server (share plc-modbus netns for OpenPLC's built-in protocol servers) ==="
docker rm -f s7-plc opcua-server >/dev/null 2>&1 || true
docker run -d --name s7-plc      --network container:plc-modbus sentinelot-s7-plc
docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server

echo "=== 4. industrial clients: s7, opcua, dnp3 ==="
for c in s7-client opcua-client dnp3-client hmi-device iiot-sensor; do
  docker rm -f "$c" >/dev/null 2>&1 || true
  if docker image inspect "sentinelot-$c" >/dev/null 2>&1; then
    docker run -d --name "$c" --network sentinelot_default \
      -e PLC_HOST=plc-modbus "sentinelot-$c"
    echo "  started: $c"
  elif docker image inspect "sentinelot-${c%%-*}" >/dev/null 2>&1; then
    docker run -d --name "$c" --network sentinelot_default \
      -e PLC_HOST=plc-modbus "sentinelot-${c%%-*}"
    echo "  started: $c (from sentinelot-${c%%-*})"
  else
    echo "  SKIP: no image for $c"
  fi
done

echo "=== 5. real-sensor (Zeek + Suricata, sniffs eth0 of plc-modbus netns) ==="
docker rm -f real-sensor >/dev/null 2>&1 || true
mkdir -p "$HOME/sentinelot/zeek-lab/real-sensor/logs/zeek" \
         "$HOME/sentinelot/zeek-lab/real-sensor/logs/suricata"
docker run -d --name real-sensor --network container:plc-modbus \
  -e IFACE=eth0 --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs" \
  sentinelot-real-sensor
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs/local.zeek.patched:/usr/local/zeek/share/zeek/site/local.zeek:ro" \

sleep 15

echo "=== 6. bridges (mount source files — edits picked up on restart, no rebuild) ==="
# Give real-sensor 25s to create conn.log and modbus.log before bridges open them
sleep 25

docker rm -f zeek-bridge conn-bridge >/dev/null 2>&1 || true
docker run -d --name zeek-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs" \
  -v "$HOME/sentinelot/zeek-bridge/bridge.py:/app/bridge.py:ro" \
  --restart unless-stopped \
  sentinelot-zeek-bridge python -u /app/bridge.py
docker run -d --name conn-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro" \
  -v "$HOME/sentinelot/zeek-bridge/conn_bridge.py:/app/conn_bridge.py:ro" \
  --restart unless-stopped \
  sentinelot-zeek-bridge python -u /app/conn_bridge.py

echo "=== 7. llm-triage (DB URL from .env, not hardcoded) ==="
docker rm -f llm-triage >/dev/null 2>&1 || true
docker run -d --name llm-triage --network sentinelot_default \
  -e "DATABASE_URL=postgresql://sentinelot:${PG_PW}@sentinelot-postgres-1:5432/sentinelot" \
  -e OLLAMA_URL="http://ollama:11434" \
  -e OLLAMA_MODEL="qwen2.5:1.5b" \
  sentinelot-llm-triage

docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status) VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'dev-sensor', 'dev-test-fingerprint-000', 'online') ON CONFLICT (id) DO NOTHING;"

echo ""
echo "=== Lab up. Verify in 30s: ==="
echo "  docker logs conn-bridge --tail 15"
echo "  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c 'SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval \"2 minutes\" GROUP BY 1;'"
