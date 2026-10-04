#!/bin/bash
# usage: ./set-offhours.sh 14   (24-hour clock, India time)
cd ~/sentinelot
H=${1:?usage: set-offhours.sh HOUR}
F=services/stream-processor/main.py
grep -n "local_hour" $F
if ! grep -q "local_hour >= [0-9]" $F; then echo "!! 'local_hour >= N' not found, nothing changed"; exit 1; fi
sed -i "s/local_hour >= [0-9]*/local_hour >= $H/" $F
grep -n "local_hour" $F
docker compose build stream-processor && docker compose up -d stream-processor
