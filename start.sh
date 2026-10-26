#!/bin/bash
cd ~/sentinelot

RESET='\033[0m'; GREEN='\033[1;32m'; BLUE='\033[1;34m'; YELLOW='\033[1;33m'; CYAN='\033[1;36m'
step() { echo -e "\n${BLUE}▶ $1${RESET}"; }
ok()   { echo -e "  ${GREEN}✓ $1${RESET}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${RESET}"; }
waitfor() { for i in $(seq 1 ${3:-60}); do eval "$2" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

echo -e "${CYAN}=== SentinelOT startup ===${RESET}"

step "1/9 Postgres"
docker start sentinelot-postgres-1 >/dev/null 2>&1
waitfor "postgres" '[ "$(docker inspect -f "{{.State.Health.Status}}" sentinelot-postgres-1 2>/dev/null)" = "healthy" ]' 60 && ok "postgres healthy" || warn "postgres not healthy"

step "2/9 Kafka + Redis + Keycloak"
docker start sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 >/dev/null 2>&1
sleep 5
ok "kafka/redis/keycloak started"

step "3/9 Ollama (LLM server)"
docker start ollama >/dev/null 2>&1
sleep 3
ok "ollama started"

step "4/9 ingestion-api + stream-processor"
docker start sentinelot-ingestion-api-1 sentinelot-stream-processor-1 >/dev/null 2>&1
sleep 5
ok "backend services started"

step "5/9 Dashboard"
docker start dashboard-react >/dev/null 2>&1
ok "dashboard on http://localhost:3000"

step "6/9 OpenPLC"
if docker ps --format '{{.Names}}' | grep -q '^plc-modbus$'; then
  ok "plc-modbus already running"
else
  docker rm -f plc-modbus >/dev/null 2>&1
  docker run -d --name plc-modbus --network sentinelot_default -p 8090:8080 tuttas/openplc_v3 >/dev/null
  sleep 15
  docker network connect --ip 172.28.240.211 sentinelot-net plc-modbus 2>/dev/null || true
  ok "plc-modbus started (http://localhost:8090)"
fi

step "7/9 PLC program"
curl -s -c /tmp/plc_cookie -d "username=openplc&password=openplc" http://localhost:8090/login -L >/dev/null
curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie -F "file=@$HOME/sentinelot/zeek-lab/openplc-program/simple_plc.st" http://localhost:8090/upload-program >/dev/null || true
sleep 3
curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie http://localhost:8090/start-plc -X POST >/dev/null || true
ok "PLC program uploaded + started"

step "8/9 Lab devices"
for c in hmi-device s7-client dnp3-client opcua-client iiot-sensor plc-relay s7-plc opcua-server llm-triage; do
  docker start $c >/dev/null 2>&1 && ok "$c" || warn "$c missing"
done

step "9/9 Zeek sensor + bridges"
if ! docker ps --format '{{.Names}}' | grep -q '^real-sensor$'; then
  docker rm -f real-sensor >/dev/null 2>&1
  docker run -d --name real-sensor --network container:plc-modbus \
    -e IFACE=eth1 --cap-add=NET_ADMIN --cap-add=NET_RAW \
    -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
  sleep 5
fi
docker rm -f zeek-bridge >/dev/null 2>&1
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge >/dev/null
docker start conn-bridge >/dev/null 2>&1
ok "real-sensor + zeek-bridge + conn-bridge running"

echo ""
echo -e "${CYAN}============ READY ============${RESET}"
echo "  Dashboard: http://localhost:3000  (operator / operator123)"
echo "  OpenPLC:   http://localhost:8090  (openplc / openplc)"
echo ""
echo "  Watch protocol events flow:"
echo "    docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \\"
echo "      \"SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval '1 minute' GROUP BY 1;\""
echo ""
