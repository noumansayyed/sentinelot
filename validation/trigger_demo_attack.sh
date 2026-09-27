#!/bin/bash
# SentinelOT — on-demand demo trigger.
# Sends ONE real unauthorized Modbus write from a NEW simulated device,
# on the spot, for live demonstration. Not a fake alert -- a real
# Modbus WRITE_SINGLE_REGISTER command genuinely hits the real PLC.
set -e
echo "Sending live unauthorized write to PLC..."
docker run --rm --network sentinelot-net --ip=172.28.240.230 \
  sentinelot-combined python3 -c "
from pymodbus.client import ModbusTcpClient
c = ModbusTcpClient('172.28.240.211', port=502)
c.connect()
r = c.write_register(address=5, value=999, slave=1)
print('Write result:', 'OK' if not r.isError() else r)
"
echo "Done. Watch the dashboard now -- an alert should appear within ~5-10 seconds."
