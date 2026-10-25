# SentinelOT
Passive OT/IIoT asset-visibility and threat-detection platform. Runs on one laptop with Docker.

- Dashboard: http://localhost:3000
- OpenPLC:   http://localhost:8090/dashboard

## Daily Start (existing setup)

```bash
~/sentinelot/start.sh
```

When prompted:
- Backend already running? → `n`
- Lab devices → `a` (all)

If backend was stopped: → `y` to restart it.

After start, go to http://localhost:8090/dashboard, log in (openplc / openplc), click **Start PLC** if stopped.

## First-Time Setup (new machine)

```bash
# 1. Install dependencies
sudo apt update && sudo apt install -y git curl openssl python3

# 2. Install Docker
sudo apt install -y docker.io
sudo systemctl enable docker --now
sudo usermod -aG docker $USER
newgrp docker

# 3. Install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.5/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. Clone repo
git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot
cd ~/sentinelot

# 5. Create env file
bash setup/make-env.sh

# 6. Create lab network (check your interface with: ip -br a)
bash setup/network.txt

# 7. Build everything (30-60 min, do not Ctrl+C)
bash setup/new-machine.sh

# 8. Seed database
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "
INSERT INTO tenants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Primary Tenant') ON CONFLICT DO NOTHING;
INSERT INTO sites (id, tenant_id, name) VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Plant-01') ON CONFLICT DO NOTHING;
INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status) VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'dev-sensor', 'dev-test-fingerprint-000', 'online') ON CONFLICT DO NOTHING;
"

# 9. Import seed data
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy assets(id,site_id,mac_address,ip_address,vendor_oui,device_role,protocols,criticality,first_seen,last_seen,baseline_mean_interval,baseline_m2,baseline_count,last_event_at) from stdin csv header" < setup/data/assets.csv
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy alerts(id,time,tenant_id,site_id,asset_id,rule_id,severity,description,status,evidence,llm_explanation,acknowledged_by,acknowledged_at) from stdin csv header" < setup/data/alerts.csv
docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy protocol_events from stdin csv header" < setup/data/protocol_events.csv

# 10. Fix DB columns
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS hidden_reason TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS role_manual TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;
"

# 11. Setup Keycloak login
bash setup/keycloak-import.sh

# 12. Pull LLM model (986MB)
docker run -d --name ollama --network sentinelot_default -p 11434:11434 --restart unless-stopped ollama/ollama
sleep 5
docker exec ollama ollama pull qwen2.5:1.5b

# 13. Start zeek-bridge with correct mount
docker rm -f zeek-bridge
docker run -d --name zeek-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  --restart unless-stopped sentinelot-zeek-bridge

# 14. Run start.sh
~/sentinelot/start.sh
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard empty / Failed to fetch | `bash setup/keycloak-import.sh` |
| Modbus shows 0 devices | `docker restart zeek-bridge` |
| Permission denied on logs | `sudo chown -R $USER:$USER ~/sentinelot/zeek-lab/real-sensor/logs` |
| LLM not explaining alerts | `docker restart llm-triage` |
| PLC page not loading | `docker restart plc-modbus` then re-upload program |

## Architecture
Lab devices (hmi, s7, dnp3, opcua, iiot)
↓ traffic on sentinelot-net (172.28.240.x)
real-sensor (Zeek + Suricata on eth1)
↓ modbus.log / conn.log
zeek-bridge / conn-bridge
↓ HTTP POST /v1/ingest/events
ingestion-api (FastAPI :8000)
↓ Kafka/Redpanda
stream-processor → PostgreSQL/TimescaleDB
↓
dashboard-react (:3000) + llm-triage (Ollama qwen2.5:1.5b)


## Test Device Simulation

```bash
# (rogue device removed)
```
Device 172.28.240.213 appears as UNKNOWN with Unauthorized Write alert.
EOF

# Rewrite PROJECT_STATUS
cat > PROJECT_STATUS.md << 'EOF'
# SentinelOT — Project Status

## What is Working

| Feature | Status |
|---|---|
| Passive capture (Zeek + Suricata + ICSNPP) | ✅ Live on eth1 |
| Multi-protocol detection: Modbus, S7, DNP3, OPC-UA | ✅ |
| Asset discovery (auto, passive) | ✅ |
| Real-time alerts (new device, off-hours, unauthorized write, anomaly) | ✅ |
| LLM plain-language explanations (qwen2.5:1.5b, local) | ✅ |
| LLM playbook per alert | ✅ |
| Dashboard with live operations view | ✅ |
| Alerts with acknowledge/resolve/escalate | ✅ |
| Audit log | ✅ |
| Keycloak authentication | ✅ |
| Compliance report generation | ✅ |

| Off-hours detection | ✅ |

## Known Issues / To Do

| Item | Priority |
|---|---|
| Auto role classification (PLC/HMI/RTU) from protocol | Low — manual classification works |
| SPAN/mirror port on real network | Pending — needs managed switch |
| Save ollama container in recreate-lab.sh | Medium |
| Export updated data to setup/data/ CSVs | Medium |
| Semester 8: validation against public ICS datasets | Pending |

## How to run

1. `~/sentinelot/start.sh` → backend `y` → devices `a`
2. Open http://localhost:3000
3. Show live devices going ACTIVE on Operations tab
4. Show Alerts tab — click any alert for LLM playbook


7. Acknowledge alert, download Audit CSV