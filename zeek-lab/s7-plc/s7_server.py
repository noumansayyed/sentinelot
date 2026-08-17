"""
SentinelOT lab — S7comm PLC server.
Runs alongside OpenPLC on the same real device identity, giving the PLC
a second, genuinely real industrial protocol: Siemens S7comm, using
python-snap7's pure-Python S7 server (no native library needed).
"""
import time
import snap7
from snap7.type import SrvArea

server = snap7.Server()
db_data = bytearray(1024)
server.register_area(SrvArea.DB, 1, db_data)
server.start(tcp_port=102)
print("S7comm server started on port 102 (DB1, 1024 bytes)")

try:
    while True:
        time.sleep(10)
except KeyboardInterrupt:
    server.stop()
