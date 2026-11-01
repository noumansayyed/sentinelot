#!/bin/bash
set -e
echo "=== stopping rogue-device ==="
docker stop rogue-device 2>/dev/null || echo "(not running)"
docker rm   rogue-device 2>/dev/null || echo "(already removed)"
echo "rogue-device stopped and removed."
