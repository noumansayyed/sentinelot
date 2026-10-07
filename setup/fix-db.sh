#!/bin/bash
cd ~/sentinelot
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
P="docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot"
$P -c "ALTER USER sentinelot WITH PASSWORD '$PW';"
$P -c "ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_by TEXT; ALTER TABLE alerts ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;"
docker restart sentinelot-stream-processor-1 sentinelot-ingestion-api-1 >/dev/null 2>&1
echo "database fixes applied"
