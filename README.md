# SentinelOT

Live demo/SPAN instructions: validation/runbooks/span_demo.md

## Daily start
1. Start Docker Desktop. Wait for "running".
2. Open Ubuntu and run: ~/sentinelot/start.sh   (about 2 minutes, do not press Ctrl+C)
3. Open http://localhost:8090/dashboard, log in, press Start PLC if it is stopped.
4. Open http://localhost:3000 and press Ctrl+Shift+R.
5. Attack demo: docker start rogue-device

Notes: start.sh keeps all data. Never wipe the database before a demo.
Use the same browser (Audit Report and KNOWN/UNKNOWN approvals are saved in the browser).

## Off-hours demo
1. Set off-hours to the current hour (24h, India time): ~/sentinelot/set-offhours.sh 14
2. Wait about 1 minute: devices that are still talking get an "Off-hours activity" alert.
3. Put back to normal: ~/sentinelot/set-offhours.sh 22

## Setup on another laptop/PC
1. Install Docker Desktop (WSL2 on) and git.
2. git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot
3. Copy .env from the old machine (key names are in .env.example).
4. Create the lab network: edit parent= in setup/network.txt to your network interface (check with: ip a), then run: bash setup/network.txt
5. Build the lab images from their folders in zeek-lab/ (image names and IPs are listed in setup/lab-containers.txt), then: docker compose up -d --build
6. Pull the AI model: docker exec ollama ollama pull qwen2.5:1.5b
7. Keycloak: open http://localhost:8080, log in as admin, import setup/keycloak-realm.json as a realm, create user "operator" (non-temporary password).
8. OpenPLC: open http://localhost:8090/dashboard, upload zeek-lab/openplc-program/simple_plc.st, compile, press Start PLC.
9. Run ~/sentinelot/start.sh
