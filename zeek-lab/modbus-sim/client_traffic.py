"""
Generates real, periodic Modbus TCP read requests against the simulated
PLC -- this is the "normal industrial traffic" Zeek will observe.
"""
import time
from pymodbus.client import ModbusTcpClient

def main():
    client = ModbusTcpClient("127.0.0.1", port=5020)
    while True:
        if not client.connect():
            print("could not connect, retrying...")
            time.sleep(2)
            continue
        result = client.read_holding_registers(address=0, count=10)
        if result.isError():
            print("modbus error:", result)
        else:
            print("read holding registers:", result.registers)
        time.sleep(3)

if __name__ == "__main__":
    main()
