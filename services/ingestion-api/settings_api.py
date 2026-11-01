"""Settings API — get/update per-tenant config + capture restart."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from uuid import UUID
import asyncpg, os, subprocess, asyncio

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]
DEMO_TENANT = UUID("11111111-1111-1111-1111-111111111111")

def _clean_value(v):
    """Strip wrapping quotes/backslashes from string values (data-quality fix)."""
    if isinstance(v, str):
        s = v
        # Repeatedly strip wrapping quotes and backslashes
        for _ in range(3):
            s2 = s.strip()
            if (s2.startswith('"') and s2.endswith('"')) or (s2.startswith("'") and s2.endswith("'")):
                s = s2[1:-1]
            else:
                break
        return s.replace("\\", "\\").replace('\\"', '"')
    return v




class SettingUpdate(BaseModel):
    key: str
    value: Any


@router.get("/v1/settings")
async def get_settings(tenant_id: UUID = DEMO_TENANT):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        rows = await pool.fetch(
            "SELECT key, value, updated_at FROM settings WHERE tenant_id = $1 ORDER BY key",
            tenant_id,
        )
        return [{"key": r["key"], "value": _clean_value(r["value"]), "updated_at": r["updated_at"].isoformat()} for r in rows]
    finally:
        await pool.close()


@router.put("/v1/settings")
async def update_setting(body: SettingUpdate, tenant_id: UUID = DEMO_TENANT):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        import json
        await pool.execute(
            """INSERT INTO settings (tenant_id, key, value) VALUES ($1, $2, $3::jsonb)
               ON CONFLICT (tenant_id, key) DO UPDATE
               SET value = EXCLUDED.value, updated_at = now()""",
            tenant_id, body.key, json.dumps(body.value),
        )
        return {"ok": True, "key": body.key}
    finally:
        await pool.close()


@router.get("/v1/settings/interfaces")
async def list_interfaces():
    """Return the interfaces available inside the real-sensor container's netns.
    Hardcoded because:
      - the sensor's netns is only reachable from the sensor container itself
      - the realistic set is small and stable (eth0 in the lab, whichever
        interface the SPAN is on in production)
      - querying the host and getting "lo" or Docker bridges is misleading
    Operators override with `capture.interface = <name>`; the sensor recreates
    with `IFACE=<name>` on next Apply & Restart."""
    return {"interfaces": ["eth0", "eth1", "eth2", "any"]}


@router.post("/v1/settings/restart-sensor")
async def restart_sensor():
    """Recreate real-sensor so IFACE setting takes effect.
    Talks to the Docker daemon over its unix socket (mounted into the API
    container). No `docker` CLI required — uses HTTP-over-unix-socket, which
    works with the standard `requests-unixsocket` or, here, the raw socket."""
    import socket as _socket
    import json as _json

    # 1) Read current interface
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        row = await pool.fetchrow(
            "SELECT value FROM settings WHERE tenant_id = $1 AND key = 'capture.interface'",
            DEMO_TENANT,
        )
        iface = row["value"] if row else "eth0"
        if isinstance(iface, str):
            iface = iface.strip('"')
    finally:
        await pool.close()

    # 2) Talk to Docker daemon over unix socket
    SOCK = "/var/run/docker.sock"

    def _docker_call(method, path, body=None):
        s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        s.settimeout(30)
        try:
            s.connect(SOCK)
            body_bytes = b""
            headers = [f"{method} {path} HTTP/1.1", "Host: docker", "Connection: close"]
            if body is not None:
                body_bytes = _json.dumps(body).encode()
                headers.append("Content-Type: application/json")
                headers.append(f"Content-Length: {len(body_bytes)}")
            req = ("\r\n".join(headers) + "\r\n\r\n").encode() + body_bytes
            s.sendall(req)
            chunks = []
            while True:
                buf = s.recv(65536)
                if not buf:
                    break
                chunks.append(buf)
            raw = b"".join(chunks)
        finally:
            s.close()
        header, _, payload = raw.partition(b"\r\n\r\n")
        status_line = header.split(b"\r\n", 1)[0].decode(errors="replace")
        try:
            code = int(status_line.split()[1])
        except (IndexError, ValueError):
            code = 0
        return code, payload

    try:
        # 3) Remove existing (ignore 404)
        code, _ = _docker_call("DELETE", "/containers/real-sensor?force=true")
        # 4) Create new with current IFACE
        create_body = {
            "Image": "sentinelot-real-sensor",
            "Env": [f"IFACE={iface}"],
            "HostConfig": {
                "NetworkMode": "container:plc-modbus",
                "Binds": [os.path.expanduser("~/sentinelot/zeek-lab/real-sensor/logs:/logs")],
                "CapAdd": ["NET_ADMIN", "NET_RAW"],
                "RestartPolicy": {"Name": "unless-stopped"},
            },
        }
        code, payload = _docker_call("POST", "/containers/create?name=real-sensor", create_body)
        if code not in (200, 201):
            raise HTTPException(500, f"docker create failed: {code} {payload[:300].decode(errors='replace')}")
        # 5) Start it
        code, payload = _docker_call("POST", "/containers/real-sensor/start")
        if code not in (204, 304):
            raise HTTPException(500, f"docker start failed: {code} {payload[:300].decode(errors='replace')}")
        return {"ok": True, "interface": iface, "note": "real-sensor recreated; Zeek needs ~25s to come up"}
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(500, "/var/run/docker.sock not mounted in the API container")
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@router.post("/v1/settings/purge-events")
async def purge_events(days: int = 30):
    """Delete protocol_events older than N days."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        result = await pool.execute(
            "DELETE FROM protocol_events WHERE time < now() - interval '1 day' * $1",
            days,
        )
        return {"ok": True, "deleted": result}
    finally:
        await pool.close()
