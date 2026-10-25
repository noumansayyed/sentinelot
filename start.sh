#!/bin/bash
cd ~/sentinelot

waitfor(){ for i in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 3; done; echo "!! TIMEOUT: $2"; }

echo "=== SentinelOT startup ==="

# Fix permissions
sudo chown -R $USER:$USER ~/sentinelot/zeek-lab/real-sensor/logs 2>/dev/null || true
mkdir -p zeek-lab/real-sensor/logs/zeek zeek-lab/real-sensor/logs/suricata

# Core backend
docker start sentinelot-postgres-1 sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 ollama >/dev/null 2>&1 || true
waitfor '[ "$(docker inspect -f {{.State.Health.Status}} sentinelot-postgres-1 2>/dev/null)" = healthy ]' postgres
docker start sentinelot-ingestion-api-1 sentinelot-stream-processor-1 >/dev/null 2>&1 || true

# PLC - never recreate if running (preserves program)
if ! docker ps --format '{{.Names}}' | grep -q '^plc-modbus$'; then
  docker rm -f plc-modbus >/dev/null 2>&1
  docker run -d --name plc-modbus --network sentinelot_default -p 8090:8080 tuttas/openplc_v3 >/dev/null
  sleep 15
  docker network connect --ip 172.28.240.211 sentinelot-net plc-modbus 2>/dev/null || true
  sleep 5
  # Auto-upload and start program
  curl -s -c /tmp/plc_cookie -d "username=openplc&password=openplc" http://localhost:8090/login -L >/dev/null
  curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie -F "file=@$HOME/sentinelot/zeek-lab/openplc-program/simple_plc.st" http://localhost:8090/upload-program >/dev/null || true
  sleep 3
  curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie http://localhost:8090/start-plc -X POST >/dev/null || true
  echo "  PLC started + program loaded"
else
  echo "  PLC already running"
fi

# Sensor - always on eth1 inside plc-modbus namespace
if ! docker ps --format '{{.Names}}' | grep -q '^real-sensor$'; then
  docker rm -f real-sensor >/dev/null 2>&1
  docker run -d --name real-sensor --network container:plc-modbus \
    -e IFACE=eth1 --cap-add=NET_ADMIN --cap-add=NET_RAW \
    -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
fi

# S7 and OPC-UA servers in plc-modbus namespace
if ! docker ps --format '{{.Names}}' | grep -q '^s7-plc$'; then
  docker rm -f s7-plc >/dev/null 2>&1
  docker run -d --name s7-plc --network container:plc-modbus sentinelot-s7-plc >/dev/null
fi
if ! docker ps --format '{{.Names}}' | grep -q '^opcua-server$'; then
  docker rm -f opcua-server >/dev/null 2>&1
  docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null
fi

# zeek-bridge - always with correct mount
docker rm -f zeek-bridge >/dev/null 2>&1
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge >/dev/null

# conn-bridge and dashboard
docker start conn-bridge dashboard-react >/dev/null 2>&1 || true

# Lab devices
for c in hmi-device rogue-device s7-client dnp3-client opcua-client iiot-sensor plc-relay llm-triage; do
  docker start $c >/dev/null 2>&1 && echo "  + $c" || echo "  ! $c missing"
done

sleep 10
echo ""
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
  "select protocol, count(*) from protocol_events where time > now() - interval '2 minutes' group by 1 order by 2 desc;" 2>/dev/null || true

echo ""
echo "READY:"
echo "  Dashboard: http://localhost:3000"
echo "  OpenPLC:   http://localhost:8090/dashboard"
echo "  ATTACK:    docker start rogue-device"
