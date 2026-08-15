"""
Minimal simulated PLC speaking real Modbus TCP.
Standard pymodbus 3.x synchronous server pattern -- this is the
documented, stable API, not a placeholder.
"""
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.server import StartTcpServer

def main():
    store = ModbusSlaveContext(
        di=ModbusSequentialDataBlock(0, [0] * 100),
        co=ModbusSequentialDataBlock(0, [0] * 100),
        hr=ModbusSequentialDataBlock(0, [17] * 100),  # holding registers, arbitrary starting values
        ir=ModbusSequentialDataBlock(0, [0] * 100),
    )
    context = ModbusServerContext(slaves=store, single=True)
    print("Simulated PLC listening on 0.0.0.0:5020 (Modbus TCP)")
    StartTcpServer(context=context, address=("0.0.0.0", 5020))

if __name__ == "__main__":
    main()
