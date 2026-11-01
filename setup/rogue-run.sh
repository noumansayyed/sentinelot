#!/bin/bash
set -e
cd "$(dirname "$0")/.."

if docker ps --format '{{.Names}}' | grep -q '^rogue-device$'; then
  echo "rogue-device already running. Stop first: bash setup/rogue-stop.sh"
  exit 1
fi
if ! docker image inspect rogue-device:latest >/dev/null 2>&1; then
  echo "image missing. Build first: bash setup/rogue-build.sh"
  exit 1
fi

echo "=== starting rogue-device on fixed IP 172.18.0.30 ==="
docker run -d \
  --name rogue-device \
  --network sentinelot_default \
  --ip 172.18.0.30 \
  --restart no \
  rogue-device:latest

echo ""
echo "Watch:  docker logs -f rogue-device"
echo "Stop:   bash setup/rogue-stop.sh"
