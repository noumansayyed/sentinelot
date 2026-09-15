"""SentinelOT lab — OPC-UA server (represents a real OPC-UA gateway/SCADA node)."""
import asyncio
from asyncua import Server

async def main():
    server = Server()
    await server.init()
    server.set_endpoint("opc.tcp://0.0.0.0:4840/sentinelot/")
    uri = "http://sentinelot.example/opcua"
    idx = await server.register_namespace(uri)
    obj = await server.nodes.objects.add_object(idx, "PlantData")
    var = await obj.add_variable(idx, "Temperature", 25.0)
    await var.set_writable()
    print("OPC-UA server started on port 4840")
    async with server:
        while True:
            await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(main())
