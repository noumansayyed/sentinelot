#!/bin/bash
# SentinelOT full stack restart — clean stop, clean start.
set -e
cd "$HOME/sentinelot"

echo "=== Stopping full stack ==="
docker stop plc-modbus modbus-sim-client s7-plc opcua-server \
             s7-client opcua-client dnp3-client hmi-device iiot-sensor \
             real-sensor zeek-bridge conn-bridge dashboard-react llm-triage \
             ollama 2>/dev/null || true
docker compose down

echo ""
echo "=== Starting full stack ==="
bash setup/lab-up.sh
