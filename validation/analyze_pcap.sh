#!/bin/bash
# SentinelOT — offline validation against public ICS datasets.
# Feeds a PCAP file through the exact same Zeek+ICSNPP+Suricata sensor
# image used in live capture, to prove parser correctness against
# independently-labeled, third-party research traffic.
set -e
PCAP_FILE="$1"
if [ -z "$PCAP_FILE" ]; then
  echo "Usage: ./analyze_pcap.sh /path/to/file.pcap"
  exit 1
fi
mkdir -p ~/sentinelot/validation/output
docker run --rm \
  -v "$PCAP_FILE:/input.pcap:ro" \
  -v ~/sentinelot/validation/output:/logs \
  --entrypoint zeek \
  sentinelot-real-sensor \
  -C -r /input.pcap
echo "Done. Logs in ~/sentinelot/validation/output/"
ls ~/sentinelot/validation/output/
