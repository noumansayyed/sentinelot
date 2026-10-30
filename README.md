SentinelOT

Passive OT/IIoT asset-visibility and threat-detection platform. Runs on a single laptop with Docker. The sensor passively inspects a copy of industrial network traffic (via SPAN/mirror port in production, or a local Docker lab for development) and detects anomalous activity on Modbus TCP, DNP3, S7comm, and OPC UA.

Dashboard: http://localhost:3000
OpenPLC (simulated PLC): http://localhost:8090/dashboard
Keycloak (auth): http://localhost:8080
Ingestion API: http://localhost:8000
Architecture (the pipeline, one line per hop)
text
┌───────────────────────────────────────────────────────┐
│ real-sensor (Zeek + Suricata + ICSNPP)                 │
│ sniffs eth0 (bridge) or a physical NIC (SPAN)          │
│ writes /logs/zeek/{conn,modbus,s7comm,dnp3,opcua}       │
└──────────────────────┬────────────────────────────────┘
                       │
          ┌────────────┴────────────────┐
          │                             │
 conn-bridge (conn.log)       zeek-bridge (modbus.log)
 parses TCP connections       parses Modbus PDUs
          │                             │
          └────────────┬────────────────┘
                       │ POST /v1/ingest/events
                       ▼
          sentinelot-ingestion-api-1
          (auth via X-Client-Cert-Fingerprint)
                       │
                       │ Kafka topic: protocol-events
                       ▼
          sentinelot-redpanda-1
                       │
                       │ consume
                       ▼
          sentinelot-stream-processor-1
          (rule-based detection + anomaly baseline)
                       │
                       │ INSERT
                       ▼
          sentinelot-postgres-1 (TimescaleDB)
                       │
                       ▼
          dashboard-react (http://localhost:3000)


llm-triage polls alerts and writes plain-language playbooks via ollama (qwen2.5:1.5b).

First-time setup (new machine, from zero)
1. Prerequisites
bash
# Install Git, curl, and Docker + Compose plugin (Ubuntu 22.04/24.04)
sudo apt update && sudo apt install -y git curl openssl

# Docker: see https://docs.docker.com/engine/install/ubuntu/

# Then: sudo usermod -aG docker "$USER"  (log out / back in)

2. Clone and configure secrets
bash
git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot
cd ~/sentinelot

cp .env.example .env

# Fill the four secrets — this step is required (compose refuses to start without them)
gen() { openssl rand -hex 24; }

sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(gen)|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(gen)|" .env
sed -i "s|^KEYCLOAK_ADMIN_PASSWORD=.*|KEYCLOAK_ADMIN_PASSWORD=$(gen)|" .env
sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$(gen)|" .env

cat .env   # save these values somewhere safe

3. Build and start the core stack
bash
cd ~/sentinelot
docker compose up -d --build


Wait ~60 seconds, then confirm:

bash
docker compose ps

# Expect: postgres (healthy), redis, redpanda, keycloak,
# ingestion-api, stream-processor all Up

4. One-time database seed
bash
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "
INSERT INTO tenants (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Primary Tenant')
ON CONFLICT DO NOTHING;

INSERT INTO sites (id, tenant_id, name)
VALUES ('22222222-2222-2222-2222-222222222222',
'11111111-1111-1111-1111-111111111111', 'Plant-01')
ON CONFLICT DO NOTHING;

INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status)
VALUES ('33333333-3333-3333-3333-333333333333',
'22222222-2222-2222-2222-222222222222',
'dev-sensor', 'dev-test-fingerprint-000', 'online')
ON CONFLICT DO NOTHING;
"

5. Kafka topic + Keycloak realm (one-time)

Kafka topic

bash
docker exec sentinelot-redpanda-1 rpk topic create protocol-events --brokers redpanda:9092 || true

docker exec sentinelot-redpanda-1 rpk topic list --brokers redpanda:9092


Keycloak realm

bash
KCPW=$(grep ^KEYCLOAK_ADMIN_PASSWORD ~/sentinelot/.env | cut -d= -f2)

docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user admin --password "$KCPW"

docker cp ~/sentinelot/setup/keycloak-realm.json sentinelot-keycloak-1:/tmp/realm.json

docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh create realms -f /tmp/realm.json || true

docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh create users -r sentinelot \
  -s username=admin -s email=admin@sentinelot.local -s enabled=true -s emailVerified=true || true

docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh set-password -r sentinelot \
  --username admin --new-password admin

docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh update realms/sentinelot -s sslRequired=none

6. Dashboard, Ollama, LLM triage

Dashboard

bash
docker build -t sentinelot-dashboard-react ~/sentinelot/dashboard-react

docker run -d --name dashboard-react --network sentinelot_default \
  -p 3000:80 \
  -v ~/sentinelot/dashboard-react/dist:/usr/share/nginx/html:ro \
  sentinelot-dashboard-react


Ollama + model

bash
docker run -d --name ollama --network sentinelot_default -p 11434:11434 \
  -v ollama-models:/root/.ollama ollama/ollama

sleep 5

docker exec ollama ollama pull qwen2.5:1.5b


LLM triage

bash
docker build -t sentinelot-llm-triage ~/sentinelot/services/llm-triage

PG_PW=$(grep ^POSTGRES_PASSWORD ~/sentinelot/.env | cut -d= -f2)

docker run -d --name llm-triage --network sentinelot_default \
  -e DATABASE_URL="postgresql://sentinelot:${PG_PW}@sentinelot-postgres-1:5432/sentinelot" \
  -e OLLAMA_URL="http://ollama:11434" \
  -e OLLAMA_MODEL="qwen2.5:1.5b" \
  sentinelot-llm-triage

7. Build the lab images (one-time, ~5 minutes)
bash
cd ~/sentinelot

for d in zeek-lab/*/; do
  name="sentinelot-$(basename "$d")"
  [ -f "$d/Dockerfile" ] && docker build -t "$name" "$d" 2>&1 | tail -2
done

docker build -t sentinelot-zeek-bridge zeek-bridge

docker build -t sentinelot-dashboard-react dashboard-react

8. Start the lab (one command)
bash
bash setup/lab-up.sh


That script creates plc-modbus, modbus-sim + modbus-sim-client, s7-plc, opcua-server, real-sensor, zeek-bridge, conn-bridge, llm-triage — all on sentinelot_default, no macvlan, and inserts the sensor row if missing.

Start the stack (after setup, container-by-container)

Every command below is docker start. No up. No recreation. Container names are exactly what docker ps -a shows.

Step 1 — Postgres first
bash
docker start sentinelot-postgres-1
sleep 5
docker logs sentinelot-postgres-1 --tail 6

# Expect: "database system is ready to accept connections"

Step 2 — Kafka, Redis, Keycloak
bash
docker start sentinelot-redpanda-1
docker start sentinelot-redis-1
docker start sentinelot-keycloak-1

Step 3 — Backend services
bash
docker start sentinelot-ingestion-api-1
docker start sentinelot-stream-processor-1

Step 4 — Ollama + LLM triage
bash
docker start ollama
sleep 3
docker start llm-triage

Step 5 — Dashboard
bash
docker start dashboard-react

Step 6 — PLC
bash
docker start plc-modbus
sleep 8

Step 7 — Lab containers sharing PLC's netns
bash
docker start s7-plc
docker start opcua-server
docker start real-sensor

sleep 15   # give Zeek time to open its logs

Step 8 — Industrial clients
bash
docker start s7-client
docker start opcua-client
docker start dnp3-client
docker start hmi-device
docker start iiot-sensor

Step 9 — Modbus simulator + its client
bash
docker start modbus-sim
docker start modbus-sim-client

Step 10 — Bridges (last, so log files exist first)
bash
docker start conn-bridge
docker start zeek-bridge

Step 11 — Verify
bash
docker ps --format 'table {{.Names}}\t{{.Status}}' | sort


You should see: sentinelot-postgres-1 (healthy), sentinelot-redis-1, sentinelot-redpanda-1, sentinelot-keycloak-1, sentinelot-ingestion-api-1, sentinelot-stream-processor-1, dashboard-react, ollama, llm-triage, plc-modbus, s7-plc, opcua-server, real-sensor, s7-client, opcua-client, dnp3-client, hmi-device, iiot-sensor, modbus-sim, modbus-sim-client, zeek-bridge, conn-bridge.

Then:

bash
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
  "SELECT protocol, count(*) FROM protocol_events WHERE time > now() - interval '2 minutes' GROUP BY 1 ORDER BY 2 DESC;"


Expect non-zero counts for s7comm, opcua, and possibly dnp3 / modbus_tcp.

Step 12 — Start the PLC program (in the browser)

The PLC runtime must be started manually in the browser — this is the only step that can't be automated because the current OpenPLC build exposes no start endpoint:

Open http://localhost:8090/dashboard
Log in: openplc / openplc
Click Start PLC

The runtime log should show Issued start_modbus() command to start on port: 502.

Stop (container-by-container, reverse order)
bash
# 1. Bridges first (so they finish flushing)
docker stop conn-bridge
docker stop zeek-bridge

# 2. Clients and simulators
docker stop modbus-sim-client
docker stop modbus-sim
docker stop s7-client
docker stop opcua-client
docker stop dnp3-client
docker stop hmi-device
docker stop iiot-sensor

# 3. Sensor (writes to logs)
docker stop real-sensor
docker stop s7-plc
docker stop opcua-server

# 4. PLC
docker stop plc-modbus

# 5. Dashboard + LLM
docker stop dashboard-react
docker stop llm-triage
docker stop ollama

# 6. Backend
docker stop sentinelot-stream-processor-1
docker stop sentinelot-ingestion-api-1

# 7. Data layer (last)
docker stop sentinelot-keycloak-1
docker stop sentinelot-redis-1
docker stop sentinelot-redpanda-1
docker stop sentinelot-postgres-1


Data persists in named volumes (sentinelot_pgdata, sentinelot_redpandadata, ollama-models). Stopping is safe; starting again resumes where you left off.

SPAN / mirror-port deployment (production)

For a live demo on a real network — campus lab, partner facility, or industrial plant — the sensor connects to one port on a managed switch, configured as a SPAN/mirror destination. That port receives a copy of all traffic on the production VLAN, without being inserted into the data path.

The sensor itself does not change. Only its run command:

bash
# On the production host:
docker run -d --name real-sensor \
  --network host \
  --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -e IFACE=<physical-NIC-receiving-the-mirror> \
  -v /var/lib/sentinelot/logs:/logs \
  sentinelot-real-sensor

# Find the NIC name on the host:
ip -br link

# Then set IFACE= to whatever port the SPAN traffic lands on
# (e.g. enp3s0, eth1).


run.sh inside the sensor reads IFACE and passes it to both Suricata and Zeek. If the mirror is delivered on a VLAN-tagged trunk, Suricata and Zeek need vlan filters — add -e IFACE=enp3s0 and inside the container the run script can be extended with -e BPF_FILTER='vlan' when needed.

Do not use macvlan for the sensor in production. macvlan deliberately hides peer traffic from the host, which is the opposite of what a SPAN port needs. Use --network host so Zeek sees the real NIC, or --network macvlan only if you've explicitly verified the switch forwards mirrors across the macvlan parent interface.

What a SPAN port gives you that the Docker lab does not
Actual switch-mirrored traffic from real PLCs, HMIs, RTUs, IIoT sensors.
Protocol coverage: 502/tcp (Modbus), 20000/tcp+udp (DNP3), 102/tcp (S7comm), 4840/tcp (OPC UA), 44818/tcp (EtherNet/IP), 47808/udp (BACnet).
Real device-to-device connections.

What stays the same: everything downstream of real-sensor — conn-bridge, ingestion-api, Kafka, stream-processor, postgres, dashboard-react. The software is SPAN-compatible because conn-bridge reads conn.log (TCP metadata) which Zeek generates on any interface, and zeek-bridge reads modbus.log (protocol PDUs) which ICSNPP generates on any interface. The lab and production differ only in what interface real-sensor sniffs.

Reconciling with the SoP: the current lab (sentinelot_default bridge) is functionally equivalent to a SPAN port — all lab devices exchange traffic on one segment, and real-sensor sniffs that segment. The macvlan that was previously used violated this equivalence (Zeek couldn't see peer traffic). It has been removed.

Troubleshooting (the three real pitfalls)
1. protocol_events is always empty despite Zeek writing conn.log

Two causes, both fixed by the current setup:

conn.log was in JSON, not TSV.

local.zeek had redef LogAscii::use_json = T;. The bridges in this repo parse TSV. Check with:

bash
head -3 /logs/zeek/conn.log

# Should start with `#separator \x09`.
# If it starts with `{`, edit local.zeek:
docker exec -u root real-sensor sed -i 's/use_json = T/use_json = F/' /usr/local/zeek/share/zeek/site/local.zeek

docker restart real-sensor


conn-bridge was running bridge.py, not conn_bridge.py.

The sentinelot-zeek-bridge image's CMD is bridge.py. Start conn-bridge with:

bash
docker run -d --name conn-bridge --network sentinelot_default \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs:ro \
  -v ~/sentinelot/zeek-bridge/conn_bridge.py:/app/conn_bridge.py:ro \
  sentinelot-zeek-bridge python -u /app/conn_bridge.py

2. conn-bridge gets 401 on every POST

sensors table has no row matching the X-Client-Cert-Fingerprint header (dev-test-fingerprint-000). Fix:

bash
docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c \
  "INSERT INTO sensors (id, site_id, label, mtls_cert_fingerprint, status)
   VALUES ('33333333-3333-3333-3333-333333333333',
           '22222222-2222-2222-2222-222222222222',
           'dev-sensor',
           'dev-test-fingerprint-000',
           'online')
   ON CONFLICT (id) DO NOTHING;"

3. Dashboard shows Keycloak 401 / CORS errors

Realm exists but sslRequired is external and the browser is talking plain HTTP on localhost. Fix:

bash
docker exec sentinelot-keycloak-1 /opt/keycloak/bin/kcadm.sh update realms/sentinelot -s sslRequired=none

# Then hard-refresh http://localhost:3000 in a private window
# Login: admin / admin

4. modbus.log stays empty

Zeek's Modbus parser must be loaded before the first Modbus packet arrives. Ensure modbus-sim is running before restarting real-sensor:

bash
docker start modbus-sim
docker restart real-sensor


Then confirm:

bash
ls -la ~/sentinelot/zeek-lab/real-sensor/logs/zeek/modbus.log

# Should be > 0 bytes after 30 seconds of modbus-sim-client polling

Ports reference
Port	Protocol	Container
3000	HTTP	dashboard-react
8080	HTTP (Keycloak)	sentinelot-keycloak-1
8000	HTTP (API)	sentinelot-ingestion-api-1
8090	HTTP (OpenPLC)	plc-modbus
11434	HTTP (Ollama)	ollama
5432	PostgreSQL	sentinelot-postgres-1
6379	Redis	sentinelot-redis-1
9092	Kafka	sentinelot-redpanda-1
102/tcp	S7comm	plc-modbus
502/tcp	Modbus TCP	modbus-sim (sim), plc-modbus (OpenPLC built-in)
4840/tcp	OPC UA	plc-modbus (built-in)
20000/tcp+udp	DNP3	plc-modbus (built-in)
44818/tcp	EtherNet/IP	not simulated (SoP lists it for real deployment)
47808/udp	BACnet	not simulated (SoP lists it for real deployment)
