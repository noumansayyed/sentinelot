# SentinelOT

Passive OT/IIoT visibility and threat detection. Runs on one laptop with Docker.

Sniffs a copy of industrial network traffic (SPAN/mirror port in production, or a
local Docker lab) and detects anomalous activity on **Modbus TCP, DNP3, S7comm,
and OPC UA**.

---

## Endpoints

| Service | URL | Credentials |
|---|---|---|
| Dashboard | http://localhost:3000 | Keycloak user (see below) |
| OpenPLC (simulated PLC) | http://localhost:8090/dashboard | `openplc` / `openplc` |
| Keycloak (auth) | http://localhost:8080 | admin password in `.env` |
| Ingestion API | http://localhost:8000 | — |

---

## 30-Second Start (fresh machine)

```bash
git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot
cd ~/sentinelot
cp .env.example .env

# Fill the four required secrets (compose refuses to start without them)
gen() { openssl rand -hex 24; }
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen)|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(gen)|" .env
sed -i "s|^KEYCLOAK_ADMIN_PASSWORD=.*|KEYCLOAK_ADMIN_PASSWORD=$(gen)|" .env
sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$(gen)|" .env
cat .env   # save these values somewhere safe

# Bring the whole stack up
bash setup/restart.sh
```

Then: open http://localhost:8090/dashboard → login `openplc`/`openplc` → if the PLC status is **Stopped**, click **Start PLC**.

That is the *only* manual step. Everything else is automated.

---

## Daily Operations

**Full start / restart** (safe to run any time, any number of times):

```bash
cd ~/sentinelot
bash setup/restart.sh
```

**Just bring the lab up** (leaves the core stack running):

```bash
cd ~/sentinelot
bash setup/lab-up.sh
```

**Stop everything cleanly:**

```bash
cd ~/sentinelot

docker stop plc-modbus modbus-sim-client s7-plc opcua-server \
             s7-client opcua-client dnp3-client hmi-device iiot-sensor \
             real-sensor zeek-bridge conn-bridge llm-triage dashboard-react \
             sentinelot-stream-processor-1 sentinelot-ingestion-api-1 \
             sentinelot-keycloak-1 sentinelot-redis-1 sentinelot-redpanda-1 \
             sentinelot-postgres-1 ollama 2>/dev/null || true
```

**Start everything back via lab-up.sh:**

```bash
cd ~/sentinelot
bash setup/lab-up.sh
```

---

## The 5-Second Health Check

Any time you suspect something is broken, these four lines tell you where:

```bash
# 1. Are all containers up?
docker ps --format '{{.Names}}\t{{.Status}}' | sort

# 2. Is the API happy?
curl -s http://localhost:8000/health/components | python3 -m json.tool

# 3. Are all 4 protocols flowing?
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
  "SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval '2 minutes' GROUP BY 1;"

# 4. Is the dashboard serving?
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000
```

Healthy = all containers `Up`, all 4 protocols non-zero, `200` from dashboard.

---

## Architecture

```text
                  ┌──────────────────────────────────────────────────┐
                  │ real-sensor (Zeek + Suricata + ICSNPP)           │
                  │   sniffs eth0 (lab) or SPAN port (production)    │
                  │   writes /logs/zeek/{conn,modbus,s7comm,...}     │
                  └────────────────────┬─────────────────────────────┘
                                       │
                   ┌───────────────────┴────────────────────┐
                   │                                        │
           conn-bridge (conn.log)               zeek-bridge (modbus.log)
           TCP connection events                Modbus PDU events
                   │                                        │
                   └───────────────────┬────────────────────┘
                                       │ POST /v1/ingest/events
                                       ▼
                          sentinelot-ingestion-api-1
                          (auth: X-Client-Cert-Fingerprint)
                                       │
                                       ▼
                              sentinelot-redpanda-1
                              (Kafka topic: protocol-events)
                                       │
                                       ▼
                        sentinelot-stream-processor-1
                        (detection rules + asset classifier)
                                       │
                                       ▼
                          sentinelot-postgres-1 (TimescaleDB)
                                       │
                                       ▼
                          dashboard-react (nginx :3000)
```

The `llm-triage` service polls alerts and writes plain-language playbooks via Ollama (`qwen2.5:1.5b`).

---

## What's in the Lab

Started by `setup/lab-up.sh`:

| Container | Role |
|---|---|
| `plc-modbus` | OpenPLC simulating a Modbus/S7/DNP3/OPC-UA PLC (stateful — program preserved across restarts) |
| `s7-plc` | Shares `plc-modbus` network namespace, runs S7comm on :102 |
| `opcua-server` | Shares `plc-modbus` network namespace, runs OPC-UA on :4840 |
| `modbus-sim-client` | Polls `plc-modbus` on :502 every 2s — the Modbus traffic source |
| `s7-client` | Polls `plc-modbus` on :102 |
| `dnp3-client` | Polls `plc-modbus` on :20000 |
| `opcua-client` | Polls `plc-modbus` on :4840 |
| `hmi-device` | Reads Modbus holding registers (HMI-like traffic) |
| `iiot-sensor` | Reads sensor data via Modbus |
| `real-sensor` | Zeek inspecting `plc-modbus`'s network namespace |
| `zeek-bridge` | Parses `modbus.log`, POSTs to API |
| `conn-bridge` | Parses `conn.log`, POSTs to API |
| `dashboard-react` | nginx serving the built frontend |

Every lab container runs with `--restart unless-stopped` and survives machine reboots.

### The one manual step

OpenPLC's runtime has a physical "start" button in its UI. After every `plc-modbus` start, open http://localhost:8090/dashboard, log in with `openplc`/`openplc`, and click **Start PLC** if the status shows "Stopped."

This is a design choice of OpenPLC, not something the automation can fix. Everything else — the bridges, the clients, the sensor, the dashboards — is fully automatic.

---

## Data Flow (developers)

1. `real-sensor` (Zeek) captures packets and writes log files to `~/sentinelot/zeek-lab/real-sensor/logs/zeek/`.
2. `conn-bridge` and `zeek-bridge` tail those files. Each batch is 50 events POSTed to `/v1/ingest/events`. If the API is slow, the bridge backs off and retries — it never drops events.
3. `sentinelot-ingestion-api-1` validates the sensor's cert fingerprint and pushes to Kafka topic `protocol-events`.
4. `sentinelot-stream-processor-1` consumes Kafka, resolves `src_ip`/`dst_ip` to asset UUIDs (upserting new assets on the fly), inserts into `protocol_events`, runs detection rules, and classifies assets by observed protocol pattern.
5. `sentinelot-postgres-1` (TimescaleDB) stores events as a hypertable on `time`.
6. `dashboard-react` reads from `sentinelot-ingestion-api-1`.

### Key tables

| Table | Written by | What |
|---|---|---|
| `assets` | stream-processor | One row per distinct IP/MAC. Fields: `ip_address`, `mac_address`, `device_role`, `protocols`, `first_seen`, `last_seen` |
| `protocol_events` | stream-processor | One row per protocol event. Fields: `time`, `sensor_id`, `site_id`, `src_asset_id`, `dst_asset_id`, `protocol`, `function_code`, `payload_summary`, `zeek_uid` |
| `alerts` | stream-processor | Detection-rule output |
| `alerts_status_log` | ingestion-api | Alert state transitions |
| `audit_log` | triggers + endpoints | Every INSERT/UPDATE/DELETE on `assets`/`alerts`/`sites`/`compliance_reports` |

### Configuration

`.env` (4 required keys):

```env
POSTGRES_PASSWORD=...
REDIS_PASSWORD=...
KEYCLOAK_ADMIN_PASSWORD=...
MINIO_ROOT_PASSWORD=...
```

Optional: `MINIO_ROOT_USER`. See `.env.example`.

---

## Repo Layout

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Core stack: postgres, redis, redpanda, keycloak, ingestion-api, stream-processor |
| `setup/lab-up.sh` | Idempotent full-lab bring-up (core stack + lab). Safe to re-run |
| `setup/restart.sh` | Full stop (`docker compose down` + stop lab) then start via `lab-up.sh` |
| `setup/verify.sh` | One-command health check |
| `setup/audit_triggers.sql` | DB triggers that auto-log every mutation to `audit_log` |
| `services/ingestion-api/` | FastAPI ingestion + REST API |
| `services/stream-processor/` | Kafka consumer, detection rules, asset upsert |
| `dashboard-react/` | React frontend, served as static files by nginx |
| `zeek-bridge/` | `bridge.py` (modbus.log), `conn_bridge.py` (conn.log) |
| `zeek-lab/real-sensor/` | Zeek + Suricata Dockerfile |
| `zeek-lab/{s7-plc,opcua-server,...}/` | One dir per lab device |
| `schema.sql` | Postgres schema (loaded on first DB start) |

---

## Troubleshooting

**"Modbus TCP: 0 devices active"**

1. `docker logs zeek-bridge --tail 20` — should show `forwarded batch of N`.
2. `tail -5 ~/sentinelot/zeek-lab/real-sensor/logs/zeek/modbus.log` — should be non-empty and recent.
3. `docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "SELECT max(time) FROM protocol_events WHERE protocol='modbus_tcp';"` — should be within the last minute.
4. If bridge is stuck, `docker restart zeek-bridge`. If it stays stuck, check `/logs/zeek/modbus.log` mtime vs. `now`.

**"Dashboard shows 401 / Session expired"**

- Keycloak token expired. Reload the page — the frontend re-authenticates.
- If it persists, `docker logs sentinelot-keycloak-1 --tail 20`.

**"Container in restart loop"**

- `docker logs <container> --tail 50` — read the actual error.
- If it's a bridge: `docker restart <container>`. `--init` + inode detection means this should self-heal.

**"Modbus still 0 after clicking Start PLC"**

- `docker logs modbus-sim-client --tail 10` — verify it's polling `.9:502` and getting data back.
- If it says `Connection refused`, OpenPLC's runtime isn't started. Click **Start PLC** in the OpenPLC UI again.

**"Too many devices on the dashboard"**

- Ghosts from prior restarts. One-time cleanup:

  ```bash
  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
    "DELETE FROM assets WHERE id NOT IN (
       SELECT DISTINCT src_asset_id FROM protocol_events WHERE time > now() - interval '1 hour'
       UNION SELECT DISTINCT dst_asset_id FROM protocol_events WHERE time > now() - interval '1 hour'
     ) AND device_role = 'unknown';"
  ```

**"WSL / Docker Desktop mount error on bridge start"**

- `docker rm -f conn-bridge zeek-bridge && bash setup/lab-up.sh`
- Bridges mount folders now (not single files), so this should be rare.

---

## What It Detects

Rules currently shipped in `stream-processor`:

- **Industrial protocol activity** — any Modbus/S7/DNP3/OPC-UA traffic from a previously unseen asset
- **New device on network** — first-seen IP/MAC
- **Out-of-hours activity** — protocol events between configured off-hours windows
- **Signature alerts** — Suricata matches (via `/v1/ingest/signature-alerts`)

Additional detections (rogue-device testing, port-scan, C2 beaconing, write-anomaly) are being added incrementally. See `services/stream-processor/` for the current rule set.

---

## License

Internal / private.
