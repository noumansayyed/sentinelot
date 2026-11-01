#!/bin/bash
# Switch real-sensor from lab mode to production (host) mode.
# After running this, open the dashboard, go to Settings → Capture,
# and pick the interface you want Zeek to sniff (Wi-Fi, Ethernet, USB tether).
set -e
cd "$HOME/sentinelot"

echo "=== Stopping lab-mode real-sensor ==="
docker rm -f real-sensor 2>/dev/null || true

echo "=== Creating host-mode real-sensor (interface = any initially) ==="
mkdir -p "$HOME/sentinelot/zeek-lab/real-sensor/logs/zeek" \
         "$HOME/sentinelot/zeek-lab/real-sensor/logs/suricata"

docker run -d --name real-sensor \
  --network host \
  --restart unless-stopped \
  -e IFACE=any \
  --cap-add=NET_ADMIN --cap-add=NET_RAW \
  -v "$HOME/sentinelot/zeek-lab/real-sensor/logs:/logs" \
  sentinelot-real-sensor

sleep 25

echo "=== Restarting bridges ==="
docker restart zeek-bridge
sleep 3
docker restart conn-bridge

echo ""
echo "=== Interfaces visible to Zeek ==="
docker exec real-sensor sh -c 'ls /sys/class/net' 2>/dev/null || echo "(waiting for sensor)"

echo ""
echo "Done. In the dashboard, go to Settings → Capture and pick an interface."
