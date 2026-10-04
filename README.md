# SentinelOT

Live demo / SPAN instructions: validation/runbooks/span_demo.md

## Start
1. Start Docker Desktop. Wait for "running".
2. Open Ubuntu and run: ~/sentinelot/start.sh   (about 2 minutes, do not press Ctrl+C)
3. Open http://localhost:8090/dashboard, log in, press Start PLC if it is stopped.
4. Open http://localhost:3000 and press Ctrl+Shift+R.
5. Attack demo: docker start rogue-device

start.sh keeps all data.

## Change the off-hours time (demo)
Where it lives: services/stream-processor/main.py, function is_off_hours (India time, IST).
1. Off-hours start at the current hour (24h clock, example 2 PM):  ~/sentinelot/set-offhours.sh 14
2. Wait about 1 minute. Each device still talking gets an "Off-hours activity" alert (max once per 15 min per device).
3. Say: "Working hours are configured for this demo, and traffic after that hour triggers the rule."
4. Back to normal (10 PM):  ~/sentinelot/set-offhours.sh 22

## Setup on a new laptop/PC (nothing needed from the old one)
1. Install WSL + Ubuntu. Open PowerShell as Administrator and run: wsl --install -d Ubuntu
   Restart the PC when asked. Ubuntu opens by itself: choose a username and password.
2. Install Docker Desktop from https://www.docker.com/products/docker-desktop (keep "Use WSL 2" ticked), restart if asked.
   Open Docker Desktop, then Settings > Resources > WSL integration > turn ON Ubuntu > Apply & restart.
3. In Ubuntu run: sudo apt update && sudo apt install -y git curl openssl python3
   Then check: docker version   (must show both Client and Server)
4. git clone https://github.com/noumansayyed/sentinelot.git ~/sentinelot && cd ~/sentinelot
   (If the repo is private, git asks for a username and a GitHub personal access token, not your password.)
5. bash setup/make-env.sh        (creates .env with random passwords)
6. ip a      (find your network interface name, example eth0)
   Edit parent=eth0 in setup/network.txt to that name, then: bash setup/network.txt
7. bash setup/new-machine.sh     (builds images, starts everything, recreates the lab devices, pulls the AI model, creates login operator / operator123)
8. Open http://localhost:8090/dashboard, log in, upload zeek-lab/openplc-program/simple_plc.st, compile, press Start PLC.
9. ~/sentinelot/start.sh
