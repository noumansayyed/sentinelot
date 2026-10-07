#!/bin/bash
cd ~/sentinelot; mkdir -p setup/data
for t in assets alerts protocol_events; do
  docker exec sentinelot-postgres-1 psql -U sentinelot -d sentinelot -c "\copy (select * from $t) to stdout csv header" > setup/data/$t.csv
  echo "$t: $(($(wc -l < setup/data/$t.csv)-1)) rows saved"
done
