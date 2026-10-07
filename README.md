# SentinelOT

Passive OT/IIoT asset-visibility and threat-detection platform. Runs on one laptop with Docker.
Dashboard: http://localhost:3000    OpenPLC page: http://localhost:8090/dashboard
Live demo / SPAN instructions: validation/runbooks/span_demo.md

## 1. Daily start (same laptop)
1. Start Docker Desktop. Wait for "running".
2. Open Ubuntu and run (about 2 minutes, do not press Ctrl+C):
~/sentinelot/start.sh
3. Open http://localhost:8090/dashboard, log in (default openplc / openplc), press Start PLC if it is stopped.
4. Open http://localhost:3000 and press Ctrl+Shift+R.
5. Attack demo:
docker start rogue-device
start.sh keeps all data. Never wipe the database before a demo.
Use the same browser: the Audit Report and KNOWN/UNKNOWN approvals are saved in the browser.

## 2. Demo order
1. Live Command: PLC chart, then the four protocol cards, then Alerts by Type.
2. Run: docker start rogue-device. The device .213 shows UNKNOWN and an Unauthorized write alert appears.
3. Acknowledge the alert (enter name and reason), then open Audit Report and Download CSV.
4. Historical Analytics: filter, change action, device column.
Modbus has full message-level detection. S7comm, DNP3 and OPC-UA show real connections seen by Zeek (connection-level).

## 3. Off-hours demo
Rule: services/stream-processor/main.py, function is_off_hours (India time).
~/sentinelot/set-offhours.sh 14
(use the current hour, 24h clock). Wait about 1 minute: each device still talking gets an Off-hours alert (once per 15 min per device).
Back to normal:
~/sentinelot/set-offhours.sh 22

## 4. Setup on a new laptop/PC (nothing needed from the old one)
1. PowerShell as Administrator, then restart when asked and create the Ubuntu username and password:
wsl --install -d Ubuntu
2. Install Docker Desktop (https://www.docker.com/products/docker-desktop), keep "Use WSL 2" ticked.
   Settings > Resources > WSL integration > turn ON Ubuntu > Apply and restart.
3. In Ubuntu:
sudo apt update && sudo apt install -y git curl openssl python3
docker version
(docker version must show Client and Server.)
4. Download the project (private repo: username + GitHub personal access token, not your password):
git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot && cd ~/sentinelot
5. Create the passwords file:
bash setup/make-env.sh
6. Create the lab network. Find the interface name first (usually eth0), edit it if different, then create:
ip -br a
sed -i 's/parent=eth0/parent=YOUR_INTERFACE/' setup/network.txt
bash setup/network.txt
7. Build and start everything (30 to 60 minutes the first time, do not press Ctrl+C):
bash setup/new-machine.sh
8. Open http://localhost:8090/dashboard, log in (openplc / openplc), upload the counter program zeek-lab/openplc-program/simple_plc.st, compile, press Start PLC.
9. Optional: load the saved devices and alerts (replaces current data):
bash setup/restore-data.sh
10. Start the system:
~/sentinelot/start.sh
11. Open http://localhost:3000 and press Ctrl+Shift+R.

## 5. Save and load the data
Save current devices, alerts and events into the repo:
cd ~/sentinelot && bash setup/export-data.sh && git add -A && git commit -m "Save data" && git push
Load them on any machine: bash setup/restore-data.sh
The audit log is stored in the browser: open Audit Report and press Download CSV, then keep the file in setup/data/.

## 6. Problems
- start.sh says "No such container": run step 7 of section 4 first (new machine).
- Dashboard shows Failed to fetch or is empty: bash setup/keycloak-import.sh (realm import 201 or 409 is fine).
- Stream processor log says password authentication failed: bash setup/fix-db.sh
- Modbus card empty and chart says Waiting for PLC data: press Start PLC in the OpenPLC page, then run start.sh again.
- mkdir Permission denied: sudo chown -R $USER:$USER ~/sentinelot
- A rebuilt dashboard shows old screens: press Ctrl+Shift+R.

## 7. Files that matter
- start.sh: daily start. set-offhours.sh: change off-hours time.
- setup/make-env.sh: creates .env (never stored in git). .env.example lists the keys.
- setup/network.txt: lab network command. setup/recreate-lab.sh: lab device containers. setup/new-machine.sh: full setup.
- setup/keycloak-realm.json, setup/keycloak-import.sh: login setup (operator / operator123).
- setup/export-data.sh, setup/restore-data.sh, setup/data/: saved devices, alerts, events.
- zeek-lab/: lab devices, sensor and PLC counter program. services/: backend. dashboard-react/: dashboard.
