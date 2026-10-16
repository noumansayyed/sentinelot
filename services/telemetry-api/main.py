"""
SentinelOT — Telemetry API.
Polls the real PLC's Modbus holding register 0 and exposes a rolling window.
Hardened: fresh client every iteration, full exception isolation, no crashes.
"""
import time
import threading
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymodbus.client import ModbusTcpClient

PLC_HOST = "172.28.240.211"
PLC_PORT = 502
readings = deque(maxlen=60)
last_error = {"msg": None, "ts": None}
lock = threading.Lock()

app = FastAPI(title="SentinelOT Telemetry API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"], allow_headers=["*"],
)


def poll_loop():
    """Isolated poll loop. Any exception is caught and logged, never kills the container."""
    while True:
        try:
            client = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
            try:
                if client.connect():
                    r = client.read_holding_registers(address=0, count=1, slave=1)
                    if not r.isError():
                        with lock:
                            readings.append({
                                "t": datetime.now(timezone.utc).isoformat(),
                                "value": r.registers[0],
                            })
                        last_error["msg"] = None
                    else:
                        last_error["msg"] = str(r)
                        last_error["ts"] = datetime.now(timezone.utc).isoformat()
                else:
                    last_error["msg"] = "connect() returned False"
                    last_error["ts"] = datetime.now(timezone.utc).isoformat()
            finally:
                try:
                    client.close()
                except Exception:
                    pass
        except Exception as e:
            last_error["msg"] = f"{type(e).__name__}: {e}"
            last_error["ts"] = datetime.now(timezone.utc).isoformat()
        time.sleep(2)


threading.Thread(target=poll_loop, daemon=True).start()


@app.get("/telemetry")
async def get_telemetry():
    with lock:
        now = datetime.now(timezone.utc)
        age = None
        if readings:
            try:
                age = (now - datetime.fromisoformat(readings[-1]["t"])).total_seconds()
            except Exception:
                age = None
        return {
            "readings": list(readings),
            "source": "PLC holding register 0 (real live Modbus poll)",
            "last_reading_age": age,
            "stale": age is not None and age > 10,
            "last_error": last_error,
        }


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "readings": len(readings)}
