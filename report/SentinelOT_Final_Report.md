# SentinelOT — A Passive OT/IIoT Asset-Visibility & Threat-Detection Platform for SME Manufacturers
## Final Project Report — Semester 8

**Institution:** [Your College Name]  
**Department:** Computer Engineering  
**Academic Year:** 2025–26  

| Roll No | Name | Role |
|---------|------|------|
| 221859 | Nouman Riyaz Ahmed Sayyed | Project Lead · Passive Capture · Protocol Engineering |
| 221851 | Akash Yadav | Backend · Detection Pipeline · Live Demo |
| 221804 | Bilal Ansari | Dashboard · LLM Triage Assistant |
| 221807 | Musab Ansari | Documentation · Compliance · Evaluation |

**Guide:** Er. Pragati Pal  
**Co-Guide:** Er. Mehek Qureshi  
**HOD:** Er. Samana Jafri  
**Principal:** Dr. Shafi Pathan  

---

## Abstract

SentinelOT is a passive network-monitoring platform designed for small and mid-size Indian manufacturers who currently have no visibility into their operational technology (OT) networks. The system discovers PLCs, SCADA/HMI systems, RTUs, and IIoT sensors by inspecting mirrored network traffic — without transmitting a single packet onto the monitored network — and detects anomalous industrial-protocol activity in real time. A local large language model (LLM) translates each machine-generated alert into plain-language operator guidance. The entire stack runs on a single laptop using Docker Compose, requiring no dedicated hardware or paid cloud infrastructure, and can be connected to any real industrial network via a single switch mirror/SPAN port. The platform was validated against the CIC Modbus 2023 dataset (152,251 transactions) and demonstrated end-to-end detection across four ICS protocols: Modbus TCP, Siemens S7comm, DNP3, and OPC-UA.

---

## 1. Problem Statement

Indian small and mid-size manufacturers (SMEs) operate PLCs, SCADA systems, RTUs, and IIoT sensors that were designed for reliability, not security. These devices run legacy protocols — Modbus TCP, Siemens S7comm, DNP3, OPC-UA — that carry no authentication or encryption by default. A single rogue write command to a PLC register can halt a production line or cause physical damage.

Despite this risk, the large majority of Indian SME manufacturers have no OT security visibility today. Commercial OT security platforms (Claroty, Dragos, Nozomi Networks) cost hundreds of thousands of dollars annually and require dedicated hardware sensors, making them inaccessible to SMEs. Academic and open-source tools exist but are not packaged for practical deployment by non-expert plant operators.

SentinelOT addresses this gap by delivering enterprise-grade passive OT monitoring on commodity hardware, with a plain-language AI triage layer that makes alerts actionable for operators who are not cybersecurity professionals.

---

## 2. Objectives

### Semester 7 (Completed — ~85% of project)
- Passive capture pipeline using Zeek + Suricata with CISA ICSNPP parsers for Modbus TCP, DNP3, S7comm, and OPC-UA
- Lab testbed simulating PLC/SCADA/IIoT traffic using OpenPLC, software simulators, and real containerized devices
- Real-time ingestion and detection backend: FastAPI → Kafka/Redpanda → PostgreSQL/TimescaleDB
- Rule-based anomaly detection: new device, off-hours activity, unauthorized write, Welford z-score baseline
- React + TypeScript live dashboard with asset inventory, alert management, and Keycloak JWT authentication
- Local LLM triage assistant (Ollama qwen2.5:1.5b) explaining each alert in plain language

### Semester 8 (Completed — ~15% of project)
- CIC Modbus 2023 dataset validation (152,251 transactions)
- Live SPAN/mirror demo capability with documented runbook
- EtherNet/IP (44818/tcp) and BACnet (47808/udp) Suricata rules added
- Compliance report module
- Final project report and evaluation demonstration preparation

---

## 3. System Architecture

### 3.1 Overview

SentinelOT follows a passive, layered architecture:
[OT Network / SPAN Port]
|
| mirrored traffic only — no injection
↓
[real-sensor container]
├── Zeek + ICSNPP parsers → JSON logs → /logs/zeek/
└── Suricata IDS → alerts → /logs/suricata/
|
↓
[zeek-bridge + suricata-bridge]
Tail logs, POST events to ingestion API
|
↓
[FastAPI ingestion-api :8000]
Normalize, authenticate (Keycloak JWT), publish to Kafka
|
↓
[Kafka / Redpanda]
Decoupled event bus — stream-processor consumes
|
↓
[stream-processor]
├── Rule engine: new_device, off_hours, unauthorized_write
├── Welford online algorithm: z-score baseline per (src,dst,protocol)
└── Writes alerts + assets → TimescaleDB
|
↓
[TimescaleDB / PostgreSQL]
Tables: alerts, assets, protocol_events, audit_log,
compliance_reports, detection_rules, tenants, sites
|
├──→ [llm-triage] Ollama qwen2.5:1.5b — plain-language explanation
└──→ [React Dashboard :3000] Live + History tabs, ack/resolve, PLCChart

### 3.2 Lab Network

All containers run on Docker macvlan network `sentinelot-net` at `172.28.240.0/20`. Real devices:

| Container | IP | Role | Protocols |
|-----------|-----|------|-----------|
| plc-modbus / OpenPLC | .211 | Primary PLC | Modbus TCP, S7comm, OPC-UA |
| hmi-device | .212 | HMI simulator | Modbus TCP |
| rogue-device | .213 | Attacker simulator | Modbus TCP (unauthorized writes) |
| iiot-sensor | .217 | IIoT gateway | Modbus TCP |
| dnp3-client | .218 | DNP3 client | DNP3 |
| opcua-client | .220 | OPC-UA client | OPC-UA |
| real-sensor | container:plc-modbus netns | Capture engine | — |

### 3.3 Passive Capture Design

The `real-sensor` container shares the network namespace of `plc-modbus` in lab mode, giving Zeek and Suricata visibility into all traffic on that interface. For live SPAN demo, the same container is relaunched with `--network host` and `IFACE` set to the physical NIC receiving mirrored traffic. No code change is required. The sensor cannot transmit onto the monitored network because it holds no IP address on that segment in SPAN mode.

---

## 4. Methodology

### 4.1 Passive Protocol Parsing

Zeek is extended with CISA's open-source ICSNPP plugins:

| Plugin | Protocol | Parsed fields |
|--------|----------|---------------|
| icsnpp-modbus | Modbus TCP (502) | function code, unit ID, register address, value, read/write |
| icsnpp-s7comm | Siemens S7 (102) | PDU type, function, item count, DB number |
| icsnpp-dnp3 | DNP3 (20000) | application control, function, object group/variation |
| icsnpp-opcua-binary | OPC-UA (4840) | service type, node ID, session |

All logs are written as JSON to `/logs/zeek/`. The `zeek-bridge` service tails these files and forwards normalized events to the ingestion API.

### 4.2 Suricata IDS Rules

Nine custom rules cover all six protocols listed in the SoP:

| SID | Protocol | Detection |
|-----|----------|-----------|
| 1000001 | Modbus TCP | Write Single Register (FC 0x06) |
| 1000002–3 | EtherNet/IP | TCP connection + CIP Write |
| 1000004 | EtherNet/IP | UDP discovery |
| 1000005–6 | BACnet | Traffic + WriteProperty |
| 1000007 | DNP3 | TCP connection |
| 1000008 | S7comm | TCP connection to port 102 |
| 1000009 | OPC-UA | Session established |

### 4.3 Detection Rules

The stream-processor implements four detection rules:

**New Device:** Any source IP appearing for the first time in the `assets` table triggers a HIGH alert. This covers passive device discovery without active scanning.

**Off-Hours Activity:** Industrial protocol activity outside configured production hours (configurable per site) triggers a MEDIUM/HIGH alert. Default window: 06:00–22:00 IST.

**Unauthorized Write:** A Modbus write (FC 01/05/06/15/16) or S7comm write from a source that has never previously written to that destination triggers a CRITICAL alert.

**Welford Z-Score Baseline:** An online implementation of Welford's algorithm maintains a running mean and variance of transaction rates per (source, destination, protocol) tuple. A z-score exceeding 3.0 triggers a MEDIUM behavioral anomaly alert. This requires no labeled training data and adapts continuously to the network baseline.

### 4.4 LLM Triage Layer

Each alert is passed to a locally-running Ollama instance (qwen2.5:1.5b, ~1GB RAM) with a structured prompt containing: protocol, source IP, destination IP, operation type, time, detection rule, and anomaly score. The model returns a plain-language explanation and recommended operator action. The LLM is a triage and explanation layer only — it does not issue commands to PLCs or modify detection logic. All detection remains grounded in structured sensor events and rule evaluation.

### 4.5 Data Retention and Security

- All data is stored locally in PostgreSQL/TimescaleDB. No OT traffic or alert data is transmitted to external services.
- The LLM (Ollama) runs entirely on-device. No prompts or alert data leave the laptop.
- Keycloak provides JWT-based authentication for all API endpoints. The dashboard requires a valid operator token.
- Audit log table records all alert acknowledgements and resolutions with operator ID and timestamp.
- Under India's Digital Personal Data Protection Act 2023 (DPDPA), OT network metadata (IP addresses, timestamps, protocol events) may constitute personal data if linkable to identifiable individuals. SentinelOT mitigates this by: (a) storing only network-layer metadata, not application payload content; (b) keeping all data on-premises; (c) providing configurable data retention periods via TimescaleDB's built-in data retention policies (`add_retention_policy`). For production deployment, operators should configure retention to the minimum period required for incident investigation (recommended: 90 days) and document the lawful basis for processing under DPDPA Section 4.

---

## 5. Validation Results

### 5.1 CIC Modbus 2023 Dataset

The CIC Modbus 2023 dataset contains labeled Modbus TCP traffic including normal operations and seven attack categories. SentinelOT's detection pipeline was run against 152,251 transactions.

Full results are documented in `validation/RESULTS.md`. Key findings:
- Unauthorized write detection (FC 0x06 Suricata rule + stream-processor write rule): detected all labeled write-attack transactions
- New device alerts: fired on all previously-unseen source IPs in the attack traffic
- Off-hours detection: fired on transactions outside the configured production window
- Welford z-score: flagged statistical anomalies in attack burst patterns

### 5.2 Live Lab Demonstration

End-to-end pipeline verified with 6 containerized devices generating real Modbus TCP, S7comm, DNP3, and OPC-UA traffic:
- Zeek parses all four protocols with ICSNPP field-level extraction
- Alerts appear on dashboard within 3–5 seconds of triggering event
- LLM triage explanation generated within 8–15 seconds per alert
- Rogue device (.213) triggers unauthorized write CRITICAL alert reliably
- Demo attack script (`validation/trigger_demo_attack.sh`) reproducibly triggers all four detection rules

---

## 6. Live SPAN Demo Method

For demonstration on any real network, the sensor connects via a single RJ45 cable to a switch mirror/SPAN port. The switch administrator configures the port to receive a copy of production VLAN traffic. No change is required to any PLC, SCADA, HMI, RTU, or IIoT sensor. The sensor holds no IP address on the production segment and cannot transmit onto it.

**SPAN mode command:**
```bash
docker rm -f real-sensor
docker run -d --name real-sensor \
  --network host \
  --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
  -e IFACE=eth0 \
  sentinelot-real-sensor
```

Full runbook: `validation/runbooks/span_demo.md`

**Protocols detected on real traffic:**

| Protocol | Port | Parser |
|----------|------|--------|
| Modbus TCP | 502/tcp | ICSNPP field-level |
| Siemens S7comm | 102/tcp | ICSNPP field-level |
| DNP3 | 20000/tcp+udp | ICSNPP field-level |
| OPC-UA | 4840/tcp | ICSNPP field-level |
| EtherNet/IP | 44818/tcp | Suricata + Zeek conn |
| BACnet | 47808/udp | Suricata + Zeek conn |

---

## 7. Related Work

| Paper | Year | Methodology | Finding | Limitation Addressed by SentinelOT |
|-------|------|-------------|---------|--------------------------------------|
| Scrutinizing Security in ICS: Architectural Vulnerabilities and Communication Network Perspective | 2024 | Survey of ICS architecture, SCADA, PLC, HMI, RTU security | Real-time monitoring and automated asset management are under-utilized | SentinelOT provides continuous passive asset discovery and real-time alerting |
| On the Cost of Asset Discovery Techniques for ICS | 2025 | ARP, ICMP, TCP, SNMP scanning on PLC testbeds | Active TCP scanning can affect PLC cycle times | SentinelOT is fully passive — zero packets transmitted to PLCs |
| Network-Based Real-Time Detection of Data Manipulation Attacks in ICS | 2025 | Protocol-aware IDS on EtherNet/IP and SWaT | Real-time detection with high accuracy | SentinelOT covers four protocols; validated on public dataset |
| Intrusion Detection for ICS by ML using Privileged Information | 2021 | Supervised ML with physical-process data | Network-only ML had limited accuracy | SentinelOT uses rule-based + Welford baseline requiring no labeled training data |

---

## 8. Expected Outcomes vs Achieved

| Expected Outcome | Status |
|-----------------|--------|
| Auto-discovered asset inventory of PLCs, SCADA/HMI, RTUs, IIoT sensors | ✅ Achieved — passive discovery from Zeek conn logs |
| Real-time detection pipeline flagging anomalous ICS protocol activity | ✅ Achieved — 4 rules + Welford, <5s latency |
| Interactive dashboard on personal laptop | ✅ Achieved — React :3000, no cloud required |
| AI/LLM alert explanation for non-expert operators | ✅ Achieved — Ollama qwen2.5:1.5b, on-device |
| Compliance report module | ✅ Achieved — HTML report at /reports/ |
| CIC Modbus 2023 validation | ✅ Achieved — 152,251 transactions |
| Live SPAN demo on real network | ✅ Ready — runbook written, one command switch |
| EtherNet/IP + BACnet coverage | ✅ Achieved — Suricata rules 1000002–1000006 |

---

## 9. Tools and Technologies

| Category | Tool / Technology |
|----------|------------------|
| Passive capture | Zeek 6.x + CISA ICSNPP (Modbus, S7comm, DNP3, OPC-UA) |
| IDS | Suricata 7.x with 9 custom ICS rules |
| Ingestion API | Python 3.12, FastAPI, pymodbus |
| Message bus | Redpanda (Kafka-compatible) |
| Database | PostgreSQL 16 + TimescaleDB |
| Auth | Keycloak 24 (realm: sentinelot, JWT) |
| LLM | Ollama qwen2.5:1.5b (on-device, no API key) |
| Dashboard | React 18, TypeScript, Tailwind CSS, Recharts |
| Lab PLC | OpenPLC Runtime (Modbus + S7 + OPC-UA) |
| Containerization | Docker Desktop, Docker Compose |
| Validation dataset | CIC Modbus 2023 (University of New Brunswick) |

---

## 10. Conclusion

SentinelOT demonstrates that enterprise-grade passive OT security monitoring is achievable on a single laptop without dedicated hardware or paid cloud services. The platform covers the full detection pipeline from raw packet capture through protocol-aware parsing, rule-based and statistical anomaly detection, AI-assisted triage, and operator-facing dashboard — all running locally in Docker containers. The live SPAN demo capability confirms the system is immediately deployable at any site with a managed switch, with zero risk to production operations. The platform directly addresses the OT security visibility gap faced by Indian SME manufacturers and is extensible to additional protocols and detection rules as the threat landscape evolves.

---

## References

1. Yılmaz, E. N., & Gönen, S. (2024). Scrutinizing Security in Industrial Control Systems: An Architectural Vulnerabilities and Communication Network Perspective. *Computers & Security*.
2. Müller, S., et al. (2025). On the Cost of Asset Discovery Techniques for Industrial Control Systems. *IEEE S&P Workshop on ICS Security*.
3. Agrawal, A., et al. (2025). Network-Based Real-Time Detection of Data Manipulation Attacks in Industrial Control Systems. *NDSS*.
4. Goh, J., et al. (2021). Intrusion Detection for Industrial Control Systems by Machine Learning using Privileged Information. *IEEE TIFS*.
5. CISA. (2023). ICSNPP — ICS Network Protocol Parsers. https://github.com/cisagov/icsnpp
6. University of New Brunswick. (2023). CIC Modbus Dataset 2023. https://www.unb.ca/cic/datasets/modbus-2023.html
7. Zeek Project. (2024). Zeek Network Security Monitor. https://zeek.org
8. Suricata. (2024). Suricata IDS/IPS. https://suricata.io
