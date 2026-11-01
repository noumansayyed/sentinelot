#!/bin/bash
set -e
cd "$(dirname "$0")/.."
echo "=== building rogue-device image ==="
docker build -t rogue-device:latest zeek-lab/rogue-device/
echo ""
echo "image built."
echo "  Start: bash setup/rogue-run.sh"
echo "  Stop:  bash setup/rogue-stop.sh"
