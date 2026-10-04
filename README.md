
## Startup (after reboot)
See validation/runbooks/span_demo.md for SPAN/live demo instructions.
Telemetry API runs on sentinelot_default + macvlan IP 172.28.240.221.

## Daily start

1. Start Docker Desktop and wait for it to say "running".
2. Open Ubuntu (WSL) and run `~/sentinelot/start.sh` (about 2 minutes). Do not press Ctrl+C.
3. Open http://localhost:3000 and press Ctrl+Shift+R.
4. Open http://localhost:8090/dashboard, log in, and press **Start PLC** if the program is stopped.
   The PLC must be running or the Modbus card and live chart stay empty.
5. Attack demo: `docker start rogue-device`

start.sh keeps all data (devices, alerts, history). Never run a TRUNCATE before a demo.
The Audit Report and KNOWN/UNKNOWN approvals are stored in the browser, so use the same browser.

## Demo policy: off-hours rule

Off-hours is decided in India time (IST). To trigger the rule during a demo,
set the start of off-hours to the current hour (24-hour clock):

    ~/sentinelot/set-offhours.sh 14

Within about a minute, each device still talking gets an "Off-hours activity" alert.
The same device alerts at most once per 15 minutes.
Say: "Working hours are configured for this demo, and traffic after that hour triggers the rule."

To put it back to normal:

    ~/sentinelot/set-offhours.sh 22

## Setting up on another laptop or PC

Requirements: Windows with WSL2 Ubuntu, Docker Desktop with WSL integration on, git,
and enough RAM for the local LLM (ollama). Then:

1. Clone the repo into ~/sentinelot.
2. Recreate the lab network `sentinelot-net` (macvlan, 172.28.240.0/20). The parent interface differs per machine.
3. Build the local images (real-sensor, opcua-server, telemetry-api, dashboard-react, and the lab devices) from their Dockerfiles.
4. Pull the ollama model used by llm-triage.
5. Run start.sh, then start the PLC program from http://localhost:8090/dashboard.
