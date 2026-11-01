#!/bin/bash
# SentinelOT lab up — docker start in dependency order.
# Only real-sensor is recreated (fresh inodes for Zeek logs).
# Bridges are restarted AFTER real-sensor so they attach to new files.
set -e

cd "$HOME/sentinelot"

# 1. Data layer first — postgres needs to be ready before everything else
docker start sentinelot-postgres-1
sleep 5
docker logs sentinelot-postgres-1 --tail 3

docker start sentinelot-redis-1
docker start sentinelot-redpanda-1
docker start sentinelot-keycloak-1
sleep 3

# 2. Backend services — need postgres + kafka + keycloak
docker start sentinelot-ingestion-api-1
docker start sentinelot-stream-processor-1
sleep 3

# 3. LLM backend
docker start ollama
sleep 3
docker start llm-triage

# 4. Dashboard
docker start dashboard-react

# 5. PLC — starts S7/OPCUA/DNP3/Modbus servers
docker start plc-modbus
sleep 10
# In browser: http://localhost:8090/dashboard → login openplc/openplc
# If status shows "Stopped", click "Start PLC"
# This is the one manual step — OpenPLC runtime must be started via browser

# 6. Lab netns helpers + sensor
docker start s7-plc
docker start opcua-server

# Instead of docker start real-sensor, recreate it (works reliably)
docker rm -f real-sensor 2>/dev/null || true
docker run -d --name real-sensor --network container:plc-modbus \
  -e IFACE=eth0 --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs" \
  sentinelot-real-sensor
sleep 25

# 7. Clients
docker start s7-client opcua-client dnp3-client modbus-sim-client hmi-device iiot-sensor
sleep 5

# 8. Bridges — RECREATE with current SITE_ID (docker restart reuses old site_id env)
SITE_ID=$(grep "^SITE_ID=" "$HOME/sentinelot/.env" | cut -d= -f2)
if [ -z "$SITE_ID" ]; then
  SITE_ID=$(docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -tAc \
    "SELECT id FROM sites WHERE archived_at IS NULL ORDER BY created_at LIMIT 1")
fi
echo "  site_id=$SITE_ID"

docker rm -f conn-bridge zeek-bridge 2>/dev/null || true
docker run -d --name conn-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro" \
  -v "$HOME/sentinelot/zeek-bridge:/app:ro" \
  -e SITE_ID="$SITE_ID" \
  --restart unless-stopped --init \
  sentinelot-zeek-bridge python -u /app/conn_bridge.py
docker run -d --name zeek-bridge --network sentinelot_default \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro" \
  -v "$HOME/sentinelot/zeek-bridge:/app:ro" \
  -e SITE_ID="$SITE_ID" \
  --restart unless-stopped --init \
  sentinelot-zeek-bridge python -u /app/bridge.py
sleep 20
