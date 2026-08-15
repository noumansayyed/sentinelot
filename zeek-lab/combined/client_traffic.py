"""
Generates real, periodic Modbus TCP traffic against the simulated PLC --
mostly reads (normal HMI polling), with an occasional write every 5th
cycle to exercise the "unauthorized write" detection rule.
"""
import random
import time
from pymodbus.client import ModbusTcpClient

def main():
    client = ModbusTcpClient("127.0.0.1", port=502)
    cycle = 0
    while True:
        if not client.connect():
            print("could not connect, retrying...")
            time.sleep(2)
            continue

        cycle += 1
        if cycle % 5 == 0:
            value = random.randint(1, 999)
            result = client.write_register(address=5, value=value)
            if result.isError():
                print("modbus write error:", result)
            else:
                print(f">>> WRITE issued: register 5 = {value}")
        else:
            result = client.read_holding_registers(address=0, count=10)
            if result.isError():
                print("modbus error:", result)
            else:
                print("read holding registers:", result.registers)

        time.sleep(3)

if __name__ == "__main__":
    main()
