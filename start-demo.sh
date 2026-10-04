#!/bin/bash
cd ~/sentinelot
P="docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot"
say(){ echo; echo "== $1"; }
waitfor(){ for i in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 3; done; echo "!! TIMEOUT waiting for $2"; }

say "0/6 stopping everything (clean start)"
docker stop rogue-device telemetry-api iiot-sensor hmi-device s7-client s7-plc dnp3-client opcua-client plc-relay opcua-server real-sensor plc-modbus conn-bridge zeek-bridge llm-triage ollama dashboard-react sentinelot-ingestion-api-1 sentinelot-stream-processor-1 sentinelot-keycloak-1 sentinelot-redis-1 sentinelot-redpanda-1 sentinelot-postgres-1 >/dev/null 2>&1

say "1/6 base services"
docker start sentinelot-postgres-1 sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 >/dev/null
waitfor '[ "$(docker inspect -f {{.State.Health.Status}} sentinelot-postgres-1)" = healthy ]' postgres
waitfor 'curl -sf localhost:8080/realms/sentinelot' keycloak

say "2/6 clean data wipe"
$P -c "TRUNCATE TABLE alerts, protocol_events, assets RESTART IDENTITY CASCADE;"

say "3/6 backend, AI and dashboard"
docker start ollama sentinelot-ingestion-api-1 sentinelot-stream-processor-1 >/dev/null; sleep 5
docker start llm-triage dashboard-react >/dev/null
waitfor 'curl -sf localhost:8000/healthz' api

say "4/6 PLC and sensor"
docker start plc-modbus >/dev/null; sleep 10
docker rm -f real-sensor opcua-server >/dev/null 2>&1
mkdir -p zeek-lab/real-sensor/logs/zeek zeek-lab/real-sensor/logs/suricata
docker run -d --name real-sensor --network container:plc-modbus --cap-add=NET_ADMIN --cap-add=NET_RAW -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null
docker logs --tail 80 plc-modbus 2>&1 | grep -q "port: 502" || { echo "PLC Modbus was off, enabling it"; docker run --rm --network container:plc-modbus sentinelot-telemetry-api python -c "import socket;s=socket.create_connection(('127.0.0.1',43628),5);s.sendall(b'start_modbus(502)\n');print(s.recv(200))"; sleep 3; }

say "5/6 factory devices"
docker start hmi-device iiot-sensor s7-plc s7-client dnp3-client opcua-client plc-relay >/dev/null
docker rm -f telemetry-api >/dev/null 2>&1
docker run -d --name telemetry-api --network sentinelot_default -p 8001:8001 sentinelot-telemetry-api >/dev/null
docker network connect --ip 172.28.240.221 sentinelot-net telemetry-api
sleep 30

say "6/6 bridges (last, so they see live traffic)"
docker start zeek-bridge conn-bridge >/dev/null; docker restart zeek-bridge conn-bridge >/dev/null
sleep 45

say "CHECK"
$P -c "select protocol, count(*) from protocol_events group by 1 order by 2 desc;"
curl -s localhost:8001/telemetry | head -c 100; echo
echo; echo "READY: open http://localhost:3000 and press Ctrl+Shift+R"
echo "ATTACK (live): docker start rogue-device"
