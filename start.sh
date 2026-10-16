#!/bin/bash
cd ~/sentinelot
waitfor(){ for i in $(seq 1 60); do eval "$1" >/dev/null 2>&1 && return 0; sleep 3; done; echo "!! TIMEOUT: $2"; }
docker start sentinelot-postgres-1 sentinelot-redpanda-1 sentinelot-redis-1 sentinelot-keycloak-1 >/dev/null
waitfor '[ "$(docker inspect -f {{.State.Health.Status}} sentinelot-postgres-1)" = healthy ]' postgres
waitfor 'curl -sf localhost:8080/realms/sentinelot' keycloak
docker start ollama sentinelot-ingestion-api-1 >/dev/null; sleep 5
docker restart zeek-bridge conn-bridge 2>/dev/null || true
docker restart sentinelot-stream-processor-1 >/dev/null
docker start llm-triage dashboard-react >/dev/null
docker start plc-modbus >/dev/null; sleep 10
docker rm -f real-sensor opcua-server >/dev/null 2>&1
mkdir -p zeek-lab/real-sensor/logs/zeek zeek-lab/real-sensor/logs/suricata
docker run -d --name real-sensor --network container:plc-modbus --cap-add=NET_ADMIN --cap-add=NET_RAW -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor >/dev/null
docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server >/dev/null
docker logs --tail 80 plc-modbus 2>&1 | grep -q "port: 502" || { echo "PLC Modbus was off, enabling it"; docker run --rm --network container:plc-modbus sentinelot-telemetry-api python -c "import socket;s=socket.create_connection(('127.0.0.1',43628),5);s.sendall(b'start_modbus(502)\n');print(s.recv(200))"; sleep 3; }
docker start hmi-device iiot-sensor s7-plc s7-client dnp3-client opcua-client plc-relay >/dev/null
docker rm -f telemetry-api >/dev/null 2>&1
docker run -d --name telemetry-api --network sentinelot_default -p 8001:8001 sentinelot-telemetry-api >/dev/null
docker network connect --ip 172.28.240.221 sentinelot-net telemetry-api
sleep 30
docker restart zeek-bridge conn-bridge >/dev/null; sleep 30
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "select protocol, count(*) from protocol_events group by 1 order by 2 desc;"
echo "READY: open http://localhost:3000 and press Ctrl+Shift+R"
echo "ATTACK (live): docker start rogue-device"
