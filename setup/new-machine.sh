#!/bin/bash
set -e; cd ~/sentinelot; sudo chown -R $USER:$USER ~/sentinelot

echo "== build images"
docker build -t sentinelot-zeek-icsnpp -t sentinelot-zeek-lab zeek-lab || true
for p in hmi-device:sentinelot-hmi dnp3-client:sentinelot-dnp3-client iiot-sensor:sentinelot-iiot-sensor opcua-client:sentinelot-opcua-client opcua-server:sentinelot-opcua-server real-sensor:sentinelot-real-sensor s7-client:sentinelot-s7-client s7-plc:sentinelot-s7-plc; do
  d=zeek-lab/${p%%:*}; [ -f $d/Dockerfile ] && docker build -t ${p##*:} $d || echo "skip $d"; done
for p in services/telemetry-api:sentinelot-telemetry-api services/llm-triage:sentinelot-llm-triage services/compliance-report:sentinelot-compliance-report dashboard-react:sentinelot-dashboard-react zeek-bridge:sentinelot-zeek-bridge; do
  [ -f ${p%%:*}/Dockerfile ] && docker build -t ${p##*:} ${p%%:*} || echo "skip ${p%%:*}"; done

echo "== core services"
docker compose up -d --build
sleep 20

echo "== database fixes"
bash setup/fix-db.sh
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS role_manual TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Primary Tenant') ON CONFLICT DO NOTHING;
INSERT INTO sites (id, tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Plant-01') ON CONFLICT DO NOTHING;
INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status) VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'dev-sensor', 'dev-test-fingerprint-000', 'online') ON CONFLICT DO NOTHING;
"

echo "== import seed data"
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy assets(id,site_id,mac_address,ip_address,vendor_oui,device_role,protocols,criticality,first_seen,last_seen,baseline_mean_interval,baseline_m2,baseline_count,last_event_at) from stdin csv header" < setup/data/assets.csv || true
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy alerts(id,time,tenant_id,site_id,asset_id,rule_id,severity,description,status,evidence,llm_explanation,acknowledged_by,acknowledged_at) from stdin csv header" < setup/data/alerts.csv || true
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy protocol_events from stdin csv header" < setup/data/protocol_events.csv || true

echo "== lab containers"
bash setup/recreate-lab.sh || true

echo "== zeek-bridge (correct mount)"
docker rm -f zeek-bridge || true
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge

echo "== ollama + model"
docker run -d --name ollama --network sentinelot_default -p 11434:11434 --restart unless-stopped ollama/ollama || true
sleep 5
docker exec ollama ollama pull qwen2.5:1.5b || true

echo "== keycloak"
sleep 40
bash setup/keycloak-import.sh

echo "DONE. Open http://localhost:8090/dashboard, upload zeek-lab/openplc-program/simple_plc.st, compile, Start PLC. Then run ~/sentinelot/start.sh"#!/bin/bash
set -e; cd ~/sentinelot; sudo chown -R $USER:$USER ~/sentinelot

echo "== build images"
docker build -t sentinelot-zeek-icsnpp -t sentinelot-zeek-lab zeek-lab || true
for p in hmi-device:sentinelot-hmi dnp3-client:sentinelot-dnp3-client iiot-sensor:sentinelot-iiot-sensor opcua-client:sentinelot-opcua-client opcua-server:sentinelot-opcua-server real-sensor:sentinelot-real-sensor s7-client:sentinelot-s7-client s7-plc:sentinelot-s7-plc; do
  d=zeek-lab/${p%%:*}; [ -f $d/Dockerfile ] && docker build -t ${p##*:} $d || echo "skip $d"; done
for p in services/telemetry-api:sentinelot-telemetry-api services/llm-triage:sentinelot-llm-triage services/compliance-report:sentinelot-compliance-report dashboard-react:sentinelot-dashboard-react zeek-bridge:sentinelot-zeek-bridge; do
  [ -f ${p%%:*}/Dockerfile ] && docker build -t ${p##*:} ${p%%:*} || echo "skip ${p%%:*}"; done

echo "== core services"
docker compose up -d --build
sleep 20

echo "== database fixes"
bash setup/fix-db.sh
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS role_manual TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Primary Tenant') ON CONFLICT DO NOTHING;
INSERT INTO sites (id, tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Plant-01') ON CONFLICT DO NOTHING;
INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status) VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'dev-sensor', 'dev-test-fingerprint-000', 'online') ON CONFLICT DO NOTHING;
"

echo "== import seed data"
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy assets(id,site_id,mac_address,ip_address,vendor_oui,device_role,protocols,criticality,first_seen,last_seen,baseline_mean_interval,baseline_m2,baseline_count,last_event_at) from stdin csv header" < setup/data/assets.csv || true
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy alerts(id,time,tenant_id,site_id,asset_id,rule_id,severity,description,status,evidence,llm_explanation,acknowledged_by,acknowledged_at) from stdin csv header" < setup/data/alerts.csv || true
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy protocol_events from stdin csv header" < setup/data/protocol_events.csv || true

echo "== lab containers"
bash setup/recreate-lab.sh || true

echo "== zeek-bridge (correct mount)"
docker rm -f zeek-bridge || true
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge

echo "== ollama + model"
docker run -d --name ollama --network sentinelot_default -p 11434:11434 --restart unless-stopped ollama/ollama || true
sleep 5
docker exec ollama ollama pull qwen2.5:1.5b || true

echo "== keycloak"
sleep 40
bash setup/keycloak-import.sh

echo "DONE. Open http://localhost:8090/dashboard, upload zeek-lab/openplc-program/simple_plc.st, compile, Start PLC. Then run ~/sentinelot/start.sh"