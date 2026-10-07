#!/bin/bash
cd ~/sentinelot
for i in $(seq 1 40); do curl -sf localhost:8080/realms/master >/dev/null && break; sleep 5; done
PW=$(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2-)
TOK=$(curl -s -d client_id=admin-cli -d username=admin --data-urlencode "password=$PW" -d grant_type=password http://localhost:8080/realms/master/protocol/openid-connect/token | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -o /dev/null -w "realm import: %{http_code}\n" -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d @setup/keycloak-realm.json http://localhost:8080/admin/realms
curl -s -o /dev/null -w "user create: %{http_code}\n" -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{"username":"operator","enabled":true,"credentials":[{"type":"password","value":"operator123","temporary":false}]}' http://localhost:8080/admin/realms/sentinelot/users
