"""
SentinelOT — Telemetry API.
Continuously polls the real PLC's Modbus holding register 0 (the actual
running counter/process value) and exposes a rolling window of recent
readings, so the dashboard can show a genuinely live-updating process
chart -- not simulated data, an actual live Modbus read every 2 seconds.
"""
import time
import threading
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymodbus.client import ModbusTcpClient

PLC_HOST = "172.28.240.211"
readings = deque(maxlen=60)  # ~2 minutes at 2s interval
lock = threading.Lock()

app = FastAPI(title="SentinelOT Telemetry API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"], allow_headers=["*"],
)


def poll_loop():
    client = ModbusTcpClient(PLC_HOST, port=502)
    while True:
        try:
            if client.connect():
                r = client.read_holding_registers(address=0, count=1, slave=1)
                if not r.isError():
                    with lock:
                        readings.append({
                            "t": datetime.now(timezone.utc).isoformat(),
                            "value": r.registers[0],
                        })
        except Exception:
            pass
        time.sleep(2)


threading.Thread(target=poll_loop, daemon=True).start()


@app.get("/telemetry")
async def get_telemetry():
    with lock:
        return {"readings": list(readings), "source": "PLC holding register 0 (real live Modbus poll)"}


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
