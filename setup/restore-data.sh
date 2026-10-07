#!/bin/bash
# Replaces the devices, alerts and events in the database with the saved copy in setup/data
cd ~/sentinelot
[ -s setup/data/assets.csv ] || { echo "no saved data found in setup/data"; exit 1; }
docker stop sentinelot-stream-processor-1 sentinelot-ingestion-api-1 zeek-bridge conn-bridge llm-triage >/dev/null 2>&1
P="docker exec -i sentinelot-postgres-1 psql -U sentinelot -d sentinelot"
$P -c "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_by TEXT; ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;"
$P -c "SET lock_timeout='20s'; TRUNCATE TABLE alerts, protocol_events, assets RESTART IDENTITY CASCADE;"
for t in assets alerts protocol_events; do $P -c "\copy $t from stdin csv header" < setup/data/$t.csv; done
docker start sentinelot-ingestion-api-1 sentinelot-stream-processor-1 llm-triage zeek-bridge conn-bridge >/dev/null 2>&1
echo "data restored"
