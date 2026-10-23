#!/bin/bash
cd ~/sentinelot

waitfor(){ for i in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 3; done; echo "!! TIMEOUT: $2"; }

echo "=== SentinelOT startup ==="
echo ""

# ──────── Stage 1: PLC + Zeek + bridges + dashboard (always) ────────
echo "[1] Recreating plc-modbus (with -p 8090:8080) + real-sensor (Zeek on eth1)..."
docker rm -f plc-modbus real-sensor >/dev/null 2>&1
docker run -d --name plc-modbus \
  --network sentinelot_default \
  -p 8090:8080 \
  tuttas/openplc_v3 >/dev/null
sleep 5
docker network connect --ip 172.28.240.211 sentinelot-net plc-modbus 2>/dev/null || true
sleep 10

echo "    Webserver listening on 8080?"
docker exec plc-modbus cat /proc/net/tcp | awk '$2 == "00000000:1F90" {print "      ✓ 8080 listening"}' || echo "      ✗ 8080 NOT listening"

echo "    Can host reach the UI?"
curl -s -o /dev/null -w "      HTTP %{http_code}\n" http://localhost:8090/dashboard

mkdir -p zeek-lab/real-sensor/logs/zeek zeek-lab/real-sensor/logs/suricata
docker run -d --name real-sensor \
  --network container:plc-modbus \
  -e IFACE=eth1 \
  --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  sentinelot-real-sensor >/dev/null
sleep 5


echo "    Creating s7-plc (S7 server in plc-modbus namespace)..."
docker rm -f s7-plc >/dev/null 2>&1
docker run -d --name s7-plc --network container:plc-modbus sentinelot-s7-plc >/dev/null
sleep 3
docker exec plc-modbus cat /proc/net/tcp | awk '$2 == "00000000:0066" {print "      ✓ S7 listening on port 102"}' || echo "      ✗ S7 NOT listening on 102"

echo "    Starting bridges..."
docker start zeek-bridge conn-bridge >/dev/null 2>&1 || true
docker restart zeek-bridge conn-bridge >/dev/null

echo "    Starting dashboard..."
docker start dashboard-react >/dev/null 2>&1 || true

echo ""
echo "    ✓ PLC:        http://localhost:8090/dashboard  (click 'Start PLC')"
echo "    ✓ Dashboard:  http://localhost:3000"
echo "    ✓ Zeek + bridges running (capturing on eth1)"
echo ""

# ──────── Stage 2: backend stack? ────────
read -p "[2] Start backend (postgres, redpanda, redis, keycloak, ollama, ingestion-api, stream-processor)? [y/N]: " BACKEND
echo ""

if [[ "$BACKEND" =~ ^[yY] ]]; then
  echo "    Starting backend..."
  docker start sentinelot-postgres-1 sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 >/dev/null
  waitfor '[ "$(docker inspect -f {{.State.Health.Status}} sentinelot-postgres-1)" = healthy ]' postgres
  waitfor 'curl -sf localhost:8080/realms/sentinelot' keycloak

  docker start ollama sentinelot-ingestion-api-1 >/dev/null
  sleep 5
  docker restart sentinelot-stream-processor-1 >/dev/null

  # Rule #1: bridges cache DNS — must restart after ingestion-api
  docker restart zeek-bridge conn-bridge >/dev/null
  sleep 3

  # opcua-server (optional — needed only for OPC-UA demo)
  docker rm -f opcua-server >/dev/null 2>&1
  docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null

  echo "    Backend started"
else
  echo "    Backend skipped — bridges will retry until backend is up"
fi
echo ""

# ──────── Stage 3: lab devices menu ────────
echo "[3] Lab devices — pick what to start"
echo ""
echo "  1) hmi-device"
echo "  2) rogue-device"
echo "  3) s7-client"
echo "  4) dnp3-client"
echo "  5) opcua-client"
echo "  6) iiot-sensor"
echo "  7) s7-plc"
echo "  8) plc-relay"
echo "  9) llm-triage"
echo "  a) all of the above"
echo ""
read -p "Enter choice (single, comma-separated list, 'a' for all, or empty to skip): " CHOICE
echo ""

DEVICES=(hmi-device rogue-device s7-client dnp3-client opcua-client iiot-sensor s7-plc plc-relay llm-triage)
START_LIST=()

if [ "$CHOICE" = "a" ] || [ "$CHOICE" = "A" ]; then
  START_LIST=("${DEVICES[@]}")
elif [ -n "$CHOICE" ]; then
  IFS=',' read -ra PICKS <<< "$CHOICE"
  for pick in "${PICKS[@]}"; do
    pick_trimmed=$(echo "$pick" | tr -d ' ')
    if [[ "$pick_trimmed" =~ ^[1-9]$ ]]; then
      START_LIST+=("${DEVICES[$((pick_trimmed - 1))]}")
    fi
  done
fi

if [ ${#START_LIST[@]} -eq 0 ]; then
  echo "    No lab devices selected"
else
  echo "    Starting: ${START_LIST[*]}"
  for c in "${START_LIST[@]}"; do
    if docker start "$c" >/dev/null 2>&1; then
      echo "      + $c started"
    else
      echo "      ! $c FAILED (missing)"
    fi
  done
fi
echo ""

# ──────── Final: only if backend was started ────────
if [[ "$BACKEND" =~ ^[yY] ]]; then
  echo "[4] Waiting 10s for event pipeline to settle..."
  sleep 10
  echo ""
  echo "=== Final DB state (last 5 min) ==="
  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
    "select protocol, count(*) from protocol_events where time > now() - interval '5 minutes' group by 1 order by 2 desc;"
  echo ""
fi

echo "READY:"
echo "  Dashboard:  http://localhost:3000  (Ctrl+Shift+R)"
echo "  OpenPLC:    http://localhost:8090/dashboard  (click 'Start PLC' if needed)"
echo "  ATTACK:     docker start rogue-device"
