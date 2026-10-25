# SentinelOT — Project Status

Passive OT/IIoT network monitoring platform for small and mid-size manufacturers.
Runs entirely on one laptop via Docker Compose. No cloud, no dedicated hardware.

## Working

| Feature | Status |
|---|---|
| Passive capture (Zeek + Suricata + ICSNPP) on eth1 | ✅ Live |
| Multi-protocol detection: Modbus TCP, S7comm, DNP3, OPC-UA | ✅ All 4 live |
| Asset discovery (auto, passive) | ✅ |
| Real-time alerts: new device, off-hours, unauthorized write, behavioral anomaly | ✅ |
| LLM plain-language explanations (qwen2.5:1.5b, local via Ollama) | ✅ |
| LLM playbook per alert | ✅ |
| Dashboard — live operations view, all 4 protocol health cards | ✅ |
| Alerts queue with acknowledge / resolve / escalate | ✅ |
| Audit log | ✅ |
| Keycloak authentication | ✅ |
| Compliance report generation | ✅ |
| Multi-tenant schema (tenant → site → sensor → assets) | ✅ |

## Recently Fixed

| Fix | Notes |
|---|---|
| zeek-bridge rotation-safe tailing | Bridge now detects file rotation / container restart by inode+mtime; Modbus events forward reliably after real-sensor restarts |
| schema.sql missing columns | `assets.hidden`, `assets.hidden_reason`, `assets.role_manual`, `alerts.escalated_at` now declared in schema (previously only in live DB, breaking fresh setups) |
| start.sh reorder | Backend services gate on postgres health before stream-processor starts; zeek log perms fixed |
| ICSNPP package version pins | `icsnpp-s7comm` and `icsnpp-dnp3` pinned to compatible release (Zeek 9 analyzer registration) |
| Cleanup: demo/attack fixtures removed | Rogue-device container, demo runbooks, trigger script, all demo framing removed. Seeds renamed to `Primary Tenant` / `Plant-01` |

## Known Runtime Behavior (not bugs)

| Behavior | Recovery |
|---|---|
| stream-processor may hold stale Kafka consumer-group offsets after a container restart, causing newer protocol events to be skipped | `docker exec sentinelot-redpanda-1 rpk group seek sentinelot-stream-processor --to latest --topics protocol-events` then restart the container |

## Pending

| Item | Priority |
|---|---|
| Auto role classification (PLC/HMI/RTU) inferred from protocol pattern | Low — manual classification works |
| SPAN/mirror port deployment on real network | Pending — needs managed switch |
| Ollama container auto-start in `recreate-lab.sh` | Medium |
| Periodic export of live data to `setup/data/` CSVs | Medium |
| Validation against public ICS datasets (BATADAL, SWaT, CIC Modbus 2023) | Semester 8 |

## How to Run

1. `bash ~/sentinelot/start.sh`
2. Answer `y` to start backend, `a` to start all lab devices
3. Open http://localhost:3000
4. Log in as `operator / operator123`
5. Operations tab shows live devices and per-protocol health
6. Alerts tab — click any alert for the LLM-generated playbook

## Architecture (one line per stage)
Zeek + Suricata (real-sensor, on eth1) → bridges (zeek-bridge, conn-bridge)
→ ingestion-api (FastAPI, port 8000) → Kafka/Redpanda topic protocol-events
→ stream-processor (asyncpg) → TimescaleDB → operations API → React dashboard (port 3000)
LLM triage worker polls alerts table → qwen2.5:1.5b via Ollama → writes llm_explanation back


## Credentials (lab defaults)

- Dashboard: `operator / operator123`
- OpenPLC: `openplc / openplc`
- DB user: `sentinelot` (password in `.env`)
- Keycloak admin: `admin` (password in `.env`)
