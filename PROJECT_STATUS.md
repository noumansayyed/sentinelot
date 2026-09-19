# SentinelOT — What's Built, and Where to See It

## 1. Passive capture (Zeek + Suricata + ICSNPP)
**What:** Parses real Modbus, S7comm, DNP3, OPC-UA traffic.
**See it live:**

    tail -f ~/sentinelot/zeek-lab/real-sensor/logs/zeek/modbus.log
    tail -f ~/sentinelot/zeek-lab/real-sensor/logs/suricata/eve.json

Watch new lines appear every few seconds while devices run.

## 2. Real network devices (6 distinct IPs)
PLC (Modbus+S7+DNP3+OPC-UA), HMI, rogue laptop, IIoT sensor, DNP3 client, OPC-UA client.
See: `docker ps`

## 3. Detection rules + your own baselining algorithm
Code: `~/sentinelot/services/stream-processor/main.py`

    docker exec -it sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "SELECT time, severity, description FROM alerts ORDER BY time DESC LIMIT 10;"

## 4. LLM plain-language explanations (local, free, Qwen2.5 via Ollama)
Code: `~/sentinelot/services/llm-triage/main.py`
See: same query above, `llm_explanation` column.

## 5. Authenticated dashboard
File: `~/sentinelot/dashboard/index.html`
Now requires real Keycloak login.

## 6. Compliance report
File: `~/sentinelot/reports/compliance_report.html`

---

# How Anyone Can Independently Verify This Is Real

## Test 1: Watch raw capture happen, live
    tail -f ~/sentinelot/zeek-lab/real-sensor/logs/zeek/modbus.log
New lines appear every ~3 seconds on their own.

## Test 2: Compare against Wireshark
Capture on the same network interface at the same time. Packets match exactly.

## Test 3: Kill a device, watch honest failure
    docker stop hmi-device
Wait 30s, check dashboard for a genuine behavioral-anomaly alert on resume.

## Test 4: Query the database directly
    docker exec -it sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "SELECT * FROM protocol_events ORDER BY time DESC LIMIT 5;"

## Test 5: Clone and rebuild from scratch
    git clone https://github.com/noumansayyed/sentinelot.git
Every Dockerfile builds independently on any machine.

## Test 6: Confirm authentication is genuinely enforced
    curl -o /dev/null -s -w "%{http_code}\n" http://localhost:8000/v1/sites/22222222-2222-2222-2222-222222222222/alerts
Returns 401 without a valid token.
