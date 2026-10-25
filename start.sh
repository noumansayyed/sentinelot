#!/bin/bash
cd ~/sentinelot

waitfor(){ for i in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 3; done; echo "!! TIMEOUT: $2"; }

echo "=== SentinelOT startup ==="

# Stage 1: PLC
if ! docker ps --format '{{.Names}}' | grep -q '^plc-modbus$'; then
  docker rm -f plc-modbus >/dev/null 2>&1
  docker run -d --name plc-modbus --network sentinelot_default -p 8090:8080 tuttas/openplc_v3 >/dev/null
  sleep 15
  docker network connect --ip 172.28.240.211 sentinelot-net plc-modbus 2>/dev/null || true
  echo "  PLC started fresh - upload program at http://localhost:8090/dashboard"
else
  echo "  PLC already running - program preserved"
  # Auto-start PLC program if not running
  sleep 2
  PLC_STATUS=$(curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie -d "username=openplc&password=openplc" http://localhost:8090/login -L -s -o /dev/null -w "%{http_code}")
  curl -s -c /tmp/plc_cookie -b /tmp/plc_cookie http://localhost:8090/start-plc -X POST >/dev/null 2>&1 || true
fi

mkdir -p zeek-lab/real-sensor/logs/zeek zeek-lab/real-sensor/logs/suricata

if ! docker ps --format '{{.Names}}' | grep -q '^real-sensor$'; then
  docker rm -f real-sensor >/dev/null 2>&1
  docker run -d --name real-sensor --network container:plc-modbus \
    -e IFACE=eth1 --cap-add=NET_ADMIN --cap-add=NET_RAW \
    -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
fi

if ! docker ps --format '{{.Names}}' | grep -q '^s7-plc$'; then
  docker rm -f s7-plc >/dev/null 2>&1
  docker run -d --name s7-plc --network container:plc-modbus sentinelot-s7-plc >/dev/null
fi

docker start zeek-bridge conn-bridge dashboard-react >/dev/null 2>&1 || true
docker restart zeek-bridge conn-bridge >/dev/null

echo "  PLC:       http://localhost:8090/dashboard"
echo "  Dashboard: http://localhost:3000"

# Stage 2: backend
read -p "Start backend? [y/N]: " BACKEND
if [[ "$BACKEND" =~ ^[yY] ]]; then
  docker start sentinelot-postgres-1 sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 >/dev/null
  waitfor '[ "$(docker inspect -f {{.State.Health.Status}} sentinelot-postgres-1)" = healthy ]' postgres
  waitfor 'curl -sf localhost:8080/realms/sentinelot' keycloak
  docker start ollama sentinelot-ingestion-api-1 >/dev/null
  sleep 5
  docker restart sentinelot-stream-processor-1 >/dev/null
  docker restart zeek-bridge conn-bridge >/dev/null
  docker rm -f opcua-server >/dev/null 2>&1
  docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null
fi

# Stage 3: lab devices
echo "Lab devices: 1)hmi 2)rogue 3)s7-client 4)dnp3 5)opcua 6)iiot 7)s7-plc 8)plc-relay 9)llm-triage a)all"
read -p "Choice: " CHOICE
DEVICES=(hmi-device rogue-device s7-client dnp3-client opcua-client iiot-sensor s7-plc plc-relay llm-triage)
if [ "$CHOICE" = "a" ] || [ "$CHOICE" = "A" ]; then
  for c in "${DEVICES[@]}"; do docker start "$c" >/dev/null 2>&1 && echo "  + $c" || echo "  ! $c FAILED"; done
elif [ -n "$CHOICE" ]; then
  IFS=',' read -ra PICKS <<< "$CHOICE"
  for pick in "${PICKS[@]}"; do
    pick=$(echo "$pick" | tr -d ' ')
    [[ "$pick" =~ ^[1-9]$ ]] && { c="${DEVICES[$((pick-1))]}"; docker start "$c" >/dev/null 2>&1 && echo "  + $c" || echo "  ! $c FAILED"; }
  done
fi

if [[ "$BACKEND" =~ ^[yY] ]]; then
  sleep 10
  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
    "select protocol, count(*) from protocol_events where time > now() - interval '5 minutes' group by 1 order by 2 desc;"
fi

echo "READY: http://localhost:3000  |  http://localhost:8090/dashboard"
echo "ATTACK: docker start rogue-device"
