"""Settings API — per-site get/update + capture restart + purge."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from uuid import UUID
import asyncpg, os, socket as _socket, json as _json

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]
DEMO_TENANT = UUID("11111111-1111-1111-1111-111111111111")


def _clean_value(v):
    """Strip wrapping quotes/backslashes from string values."""
    if isinstance(v, str):
        s = v
        for _ in range(3):
            s2 = s.strip()
            if (s2.startswith('"') and s2.endswith('"')) or (s2.startswith("'") and s2.endswith("'")):
                s = s2[1:-1]
            else:
                break
        return s
    return v


class SettingUpdate(BaseModel):
    key: str
    value: Any
    site_id: UUID | None = None


async def _resolve_site(pool, site_id: UUID | None) -> UUID:
    """If site_id not provided, use the oldest non-archived site."""
    if site_id is not None:
        return site_id
    found = await pool.fetchval(
        "SELECT id FROM sites WHERE archived_at IS NULL ORDER BY created_at LIMIT 1"
    )
    if found is None:
        raise HTTPException(404, "no active site")
    return found


@router.get("/v1/settings")
async def get_settings(site_id: UUID | None = None):
    """Return all settings for one site. If site_id is omitted, uses the
    first non-archived site."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        sid = await _resolve_site(pool, site_id)
        rows = await pool.fetch(
            "SELECT key, value, updated_at FROM settings WHERE site_id = $1 ORDER BY key",
            sid,
        )
        return [
            {
                "key": r["key"],
                "value": _clean_value(r["value"]),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ]
    finally:
        await pool.close()


@router.put("/v1/settings")
async def update_setting(body: SettingUpdate):
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        sid = await _resolve_site(pool, body.site_id)
        tenant_id = await pool.fetchval(
            "SELECT tenant_id FROM sites WHERE id = $1", sid
        )
        if tenant_id is None:
            raise HTTPException(404, "site not found")

        await pool.execute(
            """INSERT INTO settings (tenant_id, site_id, key, value)
               VALUES ($1, $2, $3, $4::jsonb)
               ON CONFLICT (site_id, key) DO UPDATE
                 SET value = EXCLUDED.value, updated_at = now()""",
            tenant_id, sid, body.key, _json.dumps(body.value),
        )
        return {"ok": True, "key": body.key, "site_id": str(sid)}
    finally:
        await pool.close()


@router.get("/v1/settings/interfaces")
async def list_interfaces():
    """Static list of interfaces available to the sensor container."""
    return {"interfaces": ["eth0", "eth1", "eth2", "any"]}


@router.post("/v1/settings/restart-sensor")
async def restart_sensor():
    """Recreate real-sensor with IFACE from current site's settings.
    Uses Docker unix socket over HTTP, no CLI needed."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        sid = await _resolve_site(pool, None)
        iface = await pool.fetchval(
            "SELECT value FROM settings WHERE site_id = $1 AND key = 'capture.interface'",
            sid,
        )
        if isinstance(iface, str):
            iface = iface.strip('"')
        if not iface:
            iface = "eth0"
    finally:
        await pool.close()

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
        _docker_call("DELETE", "/containers/real-sensor?force=true")
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
        code, payload = _docker_call("POST", "/containers/real-sensor/start")
        if code not in (204, 304):
            raise HTTPException(500, f"docker start failed: {code} {payload[:300].decode(errors='replace')}")
        return {"ok": True, "interface": iface, "note": "real-sensor recreated; Zeek needs ~25s"}
    except HTTPException:
        raise
    except FileNotFoundError:
        raise HTTPException(500, "/var/run/docker.sock not mounted in the API container")
    except Exception as e:
        raise HTTPException(500, f"{type(e).__name__}: {e}")


@router.post("/v1/settings/purge-events")
async def purge_events(days: int = 30, site_id: UUID | None = None):
    """Delete protocol_events older than N days for one site (or all)."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        if site_id is None:
            result = await pool.execute(
                "DELETE FROM protocol_events WHERE time < now() - interval '1 day' * $1",
                days,
            )
        else:
            result = await pool.execute(
                "DELETE FROM protocol_events WHERE site_id = $1 AND time < now() - interval '1 day' * $2",
                site_id, days,
            )
        return {"ok": True, "deleted": result}
    finally:
        await pool.close()
