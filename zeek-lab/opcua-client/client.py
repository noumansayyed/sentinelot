"""SentinelOT lab — OPC-UA client (represents a SCADA node polling the gateway)."""
import asyncio
from asyncua import Client

import os
SERVER_URL = os.environ.get("OPCUA_URL", "opc.tcp://plc-modbus:4840/sentinelot/")

async def main():
    while True:
        try:
            async with Client(url=SERVER_URL) as client:
                idx = await client.get_namespace_index("http://sentinelot.example/opcua")
                obj = await client.nodes.objects.get_child([f"{idx}:PlantData"])
                var = await obj.get_child([f"{idx}:Temperature"])
                val = await var.read_value()
                print(f"OPC-UA read Temperature = {val}")
        except Exception as exc:
            print("OPC-UA read failed:", exc)
        await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(main())
