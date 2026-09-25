# SentinelOT — Physical Switch/SPAN Port Demo Runbook

## What you need
- This laptop, with Docker running, SentinelOT stack already up (backend + dashboard)
- One Ethernet cable
- A managed switch with port-mirroring support (e.g. TP-Link TL-SG105E), OR
  use an existing switch at the demo site if it already supports mirroring
- A USB-to-Ethernet adapter if your laptop has no built-in Ethernet port

## Step 1 -- Ask the network admin to configure port mirroring
Tell them: "Please configure one switch port as a mirror/SPAN destination,
mirroring the port(s) carrying PLC/SCADA/OT traffic. I'll plug a laptop
into that mirror port only -- it only receives a copy, it never
transmits, so it cannot disrupt production even if unplugged mid-demo."

## Step 2 -- Physically connect
Plug the Ethernet cable from your laptop into the switch's configured
mirror port. No changes needed to any PLC, HMI, RTU, or sensor.

## Step 3 -- Find the real interface name
    ip link show
Identify the new physical interface (commonly eth1, enp0s3, or similar --
NOT the Docker-internal eth0 already in use by other containers).

## Step 4 -- Run the sensor against the real interface
    docker rm -f real-sensor
    mkdir -p ~/sentinelot/zeek-lab/real-sensor/logs/zeek ~/sentinelot/zeek-lab/real-sensor/logs/suricata
    docker run -d --name real-sensor --network host --cap-add=NET_ADMIN --cap-add=NET_RAW \
      -e IFACE=<real interface name from Step 3> \
      -v ~/sentinelot/zeek-lab/real-sensor/logs:/logs \
      sentinelot-real-sensor

Note: --network host (not container:plc-modbus) is required here, since
there is no lab PLC container to share a namespace with -- the sensor
needs direct access to the laptop's own physical NIC.

## Step 5 -- Watch real traffic arrive
    tail -f ~/sentinelot/zeek-lab/real-sensor/logs/zeek/conn.log
Within moments, real connections from the actual plant network should
appear. If protocol-specific logs appear (modbus.log, s7comm.log, etc.),
say so explicitly -- that is the exact same parser validated on 152,251
real transactions from the CIC Modbus Dataset (see validation/RESULTS.md).

## Step 6 -- Bridge into the backend (same as lab, just repointed)
Update zeek-bridge/bridge.py's LOG_PATH if the log location differs,
then run it as usual to forward real discovered assets and alerts into
the dashboard at http://localhost:3000.

## What to say if no protocol traffic appears
This is a legitimate, honest outcome if the mirrored segment does not
carry live PLC traffic at that exact moment (e.g. a quiet shift, or the
mirrored port covers the wrong VLAN segment) -- not a flaw in the sensor.
Point to: (1) the conn.log showing genuine TCP/UDP traffic is being
captured regardless, proving the tap works, and (2) the CIC dataset
validation as independent proof the parsers work on real traffic when
present.
