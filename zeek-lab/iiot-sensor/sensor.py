"""
SentinelOT lab — IIoT vibration/temperature sensor.
Represents a predictive-maintenance sensor: fast, frequent read-only
polling, a distinct behavioral pattern from the HMI's slower cadence.
"""
import time
from pymodbus.client import ModbusTcpClient

PLC_HOST = "172.28.240.211"

def main():
    client = ModbusTcpClient(PLC_HOST, port=502)
    print(f"IIoT sensor starting, polling PLC at {PLC_HOST} ...")
    while True:
        if not client.connect():
            time.sleep(2)
            continue
        result = client.read_holding_registers(address=20, count=2, slave=1)
        if result.isError():
            print("read error:", result)
        else:
            print("IIoT sensor reading:", result.registers)
        time.sleep(1)

if __name__ == "__main__":
    main()
