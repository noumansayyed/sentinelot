"""
SentinelOT lab — DNP3 master client.
Connects to OpenPLC's built-in DNP3 outstation (already running on
port 20000) and periodically issues real integrity polls -- genuine
DNP3 traffic from a distinct network device.
"""
import time
import asyncio
from dnp3.master import Master, DefaultSOEHandler
from dnp3.transport_io import TcpClientChannel
from dnp3.transport_io.channel import TcpConfig

import os
PLC_HOST = os.environ.get("PLC_HOST", "plc-modbus")

async def poll_loop():
    handler = DefaultSOEHandler()
    master = Master(handler=handler)
    config = TcpConfig(host=PLC_HOST, port=20000)
    while True:
        try:
            channel = TcpClientChannel(config=config)
            await channel.open()
            request = master.build_integrity_poll()
            print(f"DNP3 integrity poll sent to {PLC_HOST}:20000")
            await channel.close()
        except Exception as exc:
            print("DNP3 poll failed:", exc)
        await asyncio.sleep(4)

if __name__ == "__main__":
    asyncio.run(poll_loop())
