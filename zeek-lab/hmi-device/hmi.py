"""
SentinelOT lab — HMI device.
Plays the role of a plant operator workstation: continuously reads
OpenPLC's counter register over real Modbus TCP, on its own real IP,
as a genuinely separate device on the network.
"""
import time
from pymodbus.client import ModbusTcpClient

import os
PLC_HOST = os.environ.get("PLC_HOST", "plc-modbus")
PLC_PORT = 502

def main():
    client = ModbusTcpClient(PLC_HOST, port=PLC_PORT)
    print(f"HMI starting, polling PLC at {PLC_HOST}:{PLC_PORT} ...")
    while True:
        if not client.connect():
            print("could not connect to PLC, retrying...")
            time.sleep(3)
            continue
        result = client.read_holding_registers(address=0, count=1, slave=1)
        if result.isError():
            print("modbus read error:", result)
        else:
            print("HMI read counter value:", result.registers)
        time.sleep(3)

if __name__ == "__main__":
    main()
