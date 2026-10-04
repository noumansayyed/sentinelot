#!/bin/bash
cd ~/sentinelot
[ -f .env ] && { echo ".env already exists, not touching it"; exit 0; }
while IFS= read -r l; do case "$l" in *=) echo "${l}$(openssl rand -hex 12)";; *) echo "$l";; esac; done < .env.example > .env
echo ".env created with fresh random passwords"
