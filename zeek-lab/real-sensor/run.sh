#!/bin/bash
set -e

echo "Starting Suricata on eth0..."
suricata -i eth0 -l /logs/suricata &
SURICATA_PID=$!
sleep 3

echo "Starting Zeek on eth0..."
cd /logs/zeek
zeek -i eth0 -C &
ZEEK_PID=$!

wait $SURICATA_PID $ZEEK_PID
