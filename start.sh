#!/bin/bash
# SentinelOT startup — idempotent, netns-safe. Only creates what is missing.
cd ~/sentinelot
RESET='\033[0m'; GREEN='\033[1;32m'; BLUE='\033[1;34m'; YELLOW='\033[1;33m'; CYAN='\033[1;36m'; RED='\033[1;31m'
step(){ echo -e "\n${BLUE}▶ $1${RESET}"; }
ok(){   echo -e "  ${GREEN}✓ $1${RESET}"; }
warn(){ echo -e "  ${YELLOW}⚠ $1${RESET}"; }
fail(){ echo -e "  ${RED}✗ $1${RESET}"; }
running(){ docker ps --format '{{.Names}}' | grep -qx "$1"; }
exists(){  docker ps -a --format '{{.Names}}' | grep -qx "$1"; }

echo -e "${CYAN}=== SentinelOT startup ===${RESET}"

step "1/9 Postgres"
running sentinelot-postgres-1 || docker start sentinelot-postgres-1 >/dev/null 2>&1
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' sentinelot-postgres-1 2>/dev/null)" = "healthy" ] && break
  sleep 1
done
ok "postgres healthy"

step "2/9 Kafka + Redis + Keycloak"
for c in sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1; do running $c || docker start $c >/dev/null 2>&1; done
ok "kafka/redis/keycloak started"

step "3/9 Ollama"
running ollama || docker start ollama >/dev/null 2>&1
ok "ollama started"

step "4/9 ingestion-api + stream-processor"
for c in sentinelot-ingestion-api-1 sentinelot-stream-processor-1; do running $c || docker start $c >/dev/null 2>&1; done
ok "backend services started"

step "5/9 Dashboard"
# NEVER rm dashboard-react. It has the bundle bind-mounted. Just start it.
running dashboard-react || docker start dashboard-react >/dev/null 2>&1
running dashboard-react && ok "dashboard-react" || fail "dashboard-react missing — recreate once with bind mount (see B3)"

step "6/9 OpenPLC"
PLC_RECREATED=0
if running plc-modbus; then
  ok "plc-modbus already running (netns host untouched)"
elif exists plc-modbus; then
  docker start plc-modbus >/dev/null 2>&1
  ok "plc-modbus started"
else
  docker run -d --name plc-modbus --network sentinelot_default -p 8090:8080 tuttas/openplc_v3 >/dev/null
  sleep 15
  docker network connect --ip 172.28.240.211 sentinelot-net plc-modbus 2>/dev/null || true
  PLC_RECREATED=1
  ok "plc-modbus created (netns-mates will be recreated)"
fi

step "7/9 PLC program"
curl -s -c /tmp/plc_cookie -d "username=openplc&password=openplc" http://localhost:8090/login -L >/dev/null 2>&1
curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie -F "file=@$HOME/sentinelot/zeek-lab/openplc-program/simple_plc.st" http://localhost:8090/upload-program >/dev/null 2>&1 || true
sleep 2
curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie http://localhost:8090/start-plc -X POST >/dev/null 2>&1 || true
ok "PLC program uploaded + started"

step "8/9 Lab devices"
for c in hmi-device s7-client dnp3-client opcua-client iiot-sensor plc-relay rogue-device; do
  running $c || docker start $c >/dev/null 2>&1
  running $c && ok "$c" || warn "$c missing"
done

# Netns-mates: recreate ONLY if plc-modbus was created, or they are missing
if [ "$PLC_RECREATED" = "1" ] || ! running s7-plc; then
  docker rm -f s7-plc >/dev/null 2>&1 || true
  docker run -d --name s7-plc --network container:plc-modbus sentinelot-s7-plc >/dev/null 2>&1
  ok "s7-plc recreated against plc-modbus"
else
  ok "s7-plc already running"
fi
if [ "$PLC_RECREATED" = "1" ] || ! running opcua-server; then
  docker rm -f opcua-server >/dev/null 2>&1 || true
  docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null 2>&1
  ok "opcua-server recreated against plc-modbus"
else
  ok "opcua-server already running"
fi

step "9/9 Zeek + bridges + LLM"
# real-sensor also shares plc-modbus netns
if [ "$PLC_RECREATED" = "1" ] || ! running real-sensor; then
  docker rm -f real-sensor >/dev/null 2>&1 || true
  docker run -d --name real-sensor --network container:plc-modbus \
    -e IFACE=eth1 --cap-add=NET_ADMIN --cap-add=NET_RAW \
    -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
  ok "real-sensor recreated against plc-modbus"
else
  ok "real-sensor already running"
fi

# Wait for modbus.log to be non-empty BEFORE starting zeek-bridge (fixes dead-inode tail bug)
echo -n "  waiting for modbus.log... "
for i in $(seq 1 60); do
  if docker exec real-sensor sh -c '[ -s /logs/zeek/modbus.log ]' 2>/dev/null; then echo ready; break; fi
  sleep 1
done
docker exec real-sensor sh -c '[ -s /logs/zeek/modbus.log ]' 2>/dev/null && ok "Zeek writing modbus.log" || warn "modbus.log not growing"

# Recreate zeek-bridge AFTER modbus.log exists
docker rm -f zeek-bridge >/dev/null 2>&1 || true
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge >/dev/null
ok "zeek-bridge started (post-modbus.log)"

running conn-bridge || docker start conn-bridge >/dev/null 2>&1
running conn-bridge && ok "conn-bridge" || warn "conn-bridge missing"

# NEVER rm llm-triage. It has main.py bind-mounted.
running llm-triage || docker start llm-triage >/dev/null 2>&1
running llm-triage && ok "llm-triage" || fail "llm-triage missing — recreate once with bind mount (see B2)"

echo ""
echo -e "${CYAN}============ READY ============${RESET}"
echo "  Dashboard: http://localhost:3000  (operator / operator123)"
echo "  OpenPLC:   http://localhost:8090  (openplc / openplc)"
echo ""
echo "  Verify in 30s:"
echo "    docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \\"
echo "      \"SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval '1 minute' GROUP BY 1;\""
