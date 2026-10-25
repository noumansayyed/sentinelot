#!/bin/bash
set -e

# IFACE defaults to eth0 (lab/Docker setup). For a real physical deployment,
# override with -e IFACE=<real NIC name> when the sensor is plugged into
# a switch's mirror/SPAN port -- e.g. IFACE=eth1 or IFACE=enp0s3,
# whatever `ip link` shows for the physical adapter.
IFACE="${IFACE:-eth0}"

echo "Starting Suricata on ${IFACE}..."
suricata -i "${IFACE}" -l /logs/suricata &
SURICATA_PID=$!
sleep 3

echo "Starting Zeek on ${IFACE}..."
cd /logs/zeek
zeek -i "${IFACE}" -C &
ZEEK_PID=$!

wait $SURICATA_PID $ZEEK_PID
