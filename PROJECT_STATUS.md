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
| Rogue device demo | ✅ |
| Off-hours detection demo | ✅ |

## Known Issues / To Do

| Item | Priority |
|---|---|
| Auto role classification (PLC/HMI/RTU) from protocol | Low — manual classification works |
| SPAN/mirror port live demo on real network | Pending — needs managed switch |
| Save ollama container in recreate-lab.sh | Medium |
| Export updated data to setup/data/ CSVs | Medium |
| Semester 8: validation against public ICS datasets | Pending |

## How to Demo

1. `~/sentinelot/start.sh` → backend `y` → devices `a`
2. Open http://localhost:3000
3. Show live devices going ACTIVE on Operations tab
4. Show Alerts tab — click any alert for LLM playbook
5. Run attack: `docker start rogue-device`
6. Show rogue device appearing as UNKNOWN + Unauthorized Write alert
7. Acknowledge alert, download Audit CSV
