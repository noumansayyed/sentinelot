#!/bin/bash
# Run from ~/sentinelot after: .env created, network created (see README)
set -e; cd ~/sentinelot
echo "== build images"
docker build -t sentinelot-zeek-icsnpp -t sentinelot-zeek-lab zeek-lab || true
for p in hmi-device:sentinelot-hmi rogue-device:sentinelot-rogue dnp3-client:sentinelot-dnp3-client iiot-sensor:sentinelot-iiot-sensor opcua-client:sentinelot-opcua-client opcua-server:sentinelot-opcua-server real-sensor:sentinelot-real-sensor s7-client:sentinelot-s7-client s7-plc:sentinelot-s7-plc; do
  d=zeek-lab/${p%%:*}; [ -f $d/Dockerfile ] && docker build -t ${p##*:} $d || echo "skip $d"; done
for p in services/telemetry-api:sentinelot-telemetry-api services/llm-triage:sentinelot-llm-triage services/compliance-report:sentinelot-compliance-report dashboard-react:sentinelot-dashboard-react zeek-bridge:sentinelot-zeek-bridge; do
  [ -f ${p%%:*}/Dockerfile ] && docker build -t ${p##*:} ${p%%:*} || echo "skip ${p%%:*}"; done
echo "== core services"; docker compose up -d --build
echo "== lab containers"; bash setup/recreate-lab.sh
sleep 10; echo "== AI model"; docker exec ollama ollama pull qwen2.5:1.5b || true
echo "== login (Keycloak)"; sleep 40
PW=$(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2-)
TOK=$(curl -s -d client_id=admin-cli -d username=admin --data-urlencode "password=$PW" -d grant_type=password http://localhost:8080/realms/master/protocol/openid-connect/token | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @setup/keycloak-realm.json http://localhost:8080/admin/realms
curl -s -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"username":"operator","enabled":true,"credentials":[{"type":"password","value":"operator123","temporary":false}]}' http://localhost:8080/admin/realms/sentinelot/users
echo "DONE. Now upload the PLC program in OpenPLC (README step 6), then run ~/sentinelot/start.sh"
