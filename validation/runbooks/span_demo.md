# SentinelOT — Live SPAN/Mirror Demo Runbook

## What the evaluator sees
- Laptop plugged into switch mirror port via RJ45
- Real PLC/SCADA/HMI traffic captured passively
- Zeek parses Modbus/S7/DNP3/OPC-UA in real time
- Alerts appear on dashboard within seconds
- Zero change to any PLC or production device

## Pre-demo checklist
- [ ] All containers healthy: docker ps --format table
- [ ] Dashboard loads at http://localhost:3000
- [ ] telemetry-api healthy: curl -s http://localhost:8001/healthz
- [ ] Know your laptop NIC: ip link show
- [ ] Ask site network admin to configure mirror port BEFORE you arrive

## Switch admin instructions (print and hand over)
Configure one port as SPAN/mirror destination.
Mirror source: production VLAN or uplink carrying PLC/SCADA traffic
Mirror destination: port our laptop is plugged into
Direction: bidirectional (TX+RX)
No change needed to any PLC, HMI, RTU, or sensor.
Laptop only receives — cannot transmit onto your network.

## Step 1 — Identify SPAN NIC
    ip link show
    export SPAN_IFACE=eth0   # change to whichever NIC connects to switch mirror port

## Step 2 — Switch real-sensor to SPAN mode
    docker rm -f real-sensor
    docker run -d --name real-sensor \
      --network host \
      --cap-add=NET_ADMIN --cap-add=NET_RAW \
      -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
      -e IFACE=${SPAN_IFACE} \
      sentinelot-real-sensor

## Step 3 — Verify capture
    sleep 10
    docker exec real-sensor cat /logs/zeek/conn.log | tail -5
    docker exec real-sensor cat /logs/suricata/stats.log | grep capture | tail -3

## Step 4 — Watch dashboard
    http://localhost:3000
    Devices appear in ~30s if mirror port has OT traffic
    Alerts fire automatically on new devices / off-hours / writes

## Step 5 — Demo attack trigger
    bash ~/sentinelot/validation/trigger_demo_attack.sh

## Step 6 — Restore lab mode after demo
    docker rm -f real-sensor
    docker run -d --name real-sensor \
      --network container:plc-modbus \
      --cap-add=NET_ADMIN --cap-add=NET_RAW \
      -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
      sentinelot-real-sensor

## Protocols covered
| Protocol    | Port          | Parser  |
|-------------|---------------|---------|
| Modbus TCP  | 502/tcp       | ICSNPP  |
| Siemens S7  | 102/tcp       | ICSNPP  |
| DNP3        | 20000/tcp+udp | ICSNPP  |
| OPC-UA      | 4840/tcp      | ICSNPP  |
| EtherNet/IP | 44818/tcp     | Zeek conn |
| BACnet      | 47808/udp     | Zeek conn |

## Troubleshooting
- No packets: confirm mirror direction is bidirectional not RX-only
- Wrong iface: tcpdump -i eth0 -c 10 -- if no output try eth1
- Zeek not parsing: docker logs real-sensor
- Dashboard not updating: docker ps | grep bridge
