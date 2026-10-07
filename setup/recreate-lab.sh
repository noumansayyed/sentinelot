#!/bin/bash
# generated from the running lab containers (env values of secrets are not included)
docker rm -f telemetry-api >/dev/null 2>&1; docker run -d --name telemetry-api --network sentinelot_default -p 8001:8001 sentinelot-telemetry-api; docker network connect --ip 172.28.240.221 sentinelot-net telemetry-api
docker rm -f dashboard-react >/dev/null 2>&1; docker run -d --name dashboard-react --network bridge -p 3000:80 -v $HOME/sentinelot/reports:/usr/share/nginx/html/reports sentinelot-dashboard-react
docker rm -f conn-bridge >/dev/null 2>&1; docker run -d --name conn-bridge --network sentinelot_default -v $HOME/sentinelot/zeek-lab/real-sensor/logs:/logs:ro -v $HOME/sentinelot/zeek-bridge/conn_bridge.py:/app/conn_bridge.py:ro sentinelot-zeek-bridge python -u /app/conn_bridge.py
docker rm -f zeek-bridge >/dev/null 2>&1; docker run -d --name zeek-bridge --network sentinelot_default -v $HOME/sentinelot/zeek-lab/real-sensor/logs:$HOME/sentinelot/zeek-lab/real-sensor/logs sentinelot-zeek-bridge
docker rm -f opcua-client >/dev/null 2>&1; docker run -d --name opcua-client --network sentinelot-net --ip 172.28.240.220 sentinelot-opcua-client
docker rm -f dnp3-client >/dev/null 2>&1; docker run -d --name dnp3-client --network sentinelot-net --ip 172.28.240.218 sentinelot-dnp3-client
docker rm -f llm-triage >/dev/null 2>&1; docker run -d --name llm-triage --network sentinelot_default -e DATABASE_URL=postgresql://sentinelot:change_me_dev_only@sentinelot-postgres-1:5432/sentinelot sentinelot-llm-triage
docker rm -f ollama >/dev/null 2>&1; docker run -d --name ollama --network bridge -p 11434:11434 ollama/ollama; docker network connect sentinelot_default ollama
docker rm -f iiot-sensor >/dev/null 2>&1; docker run -d --name iiot-sensor --network sentinelot-net --ip 172.28.240.217 sentinelot-iiot-sensor
docker rm -f s7-client >/dev/null 2>&1; docker run -d --name s7-client --network sentinelot-net --ip 172.28.240.214 sentinelot-s7-client
docker rm -f rogue-device >/dev/null 2>&1; docker run -d --name rogue-device --network sentinelot-net --ip 172.28.240.213 sentinelot-rogue
docker rm -f hmi-device >/dev/null 2>&1; docker run -d --name hmi-device --network sentinelot-net --ip 172.28.240.212 sentinelot-hmi
docker rm -f plc-relay >/dev/null 2>&1; docker run -d --name plc-relay --network bridge -p 8090:8090 alpine sh -c 'apk add --no-cache socat >/dev/null 2>&1 && socat TCP-LISTEN:8090,fork,reuseaddr,bind=0.0.0.0 TCP:172.28.240.211:8080'; docker network connect --ip 172.28.240.2 sentinelot-net plc-relay
docker rm -f plc-modbus >/dev/null 2>&1; docker run -d --name plc-modbus --network sentinelot-net --ip 172.28.240.211 tuttas/openplc_v3
sleep 8
sleep 5
docker rm -f opcua-server >/dev/null 2>&1; docker run -d --name opcua-server --network container:plc-modbus sentinelot-opcua-server
docker rm -f real-sensor >/dev/null 2>&1; docker run -d --name real-sensor --network container:plc-modbus --cap-add CAP_NET_ADMIN --cap-add CAP_NET_RAW -v $HOME/sentinelot/zeek-lab/real-sensor/logs:/logs sentinelot-real-sensor
docker rm -f s7-plc >/dev/null 2>&1; docker run -d --name s7-plc --network container:plc-modbus sentinelot-s7-plc
