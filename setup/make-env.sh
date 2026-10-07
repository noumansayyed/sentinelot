#!/bin/bash
cd ~/sentinelot
[ -f .env ] && { echo ".env already exists, not touching it"; exit 0; }
while IFS= read -r l; do case "$l" in *=) echo "${l}$(openssl rand -hex 12)";; *) echo "$l";; esac; done < .env.example > .env
grep -q "^MINIO_ROOT_USER=" .env || echo "MINIO_ROOT_USER=minioadmin" >> .env
grep -q "^MINIO_ROOT_PASSWORD=" .env || echo "MINIO_ROOT_PASSWORD=$(openssl rand -hex 12)" >> .env
grep -q "^REDIS_PASSWORD=" .env || echo "REDIS_PASSWORD=$(openssl rand -hex 12)" >> .env
echo ".env created with fresh random passwords"
