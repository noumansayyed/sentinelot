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
    """Return the network interfaces visible to the real-sensor container.

    In lab mode (--network container:plc-modbus), this is only eth0 (the
    Docker bridge) — you cannot monitor the host's real NIC from a container
    sharing another container's netns.

    In production mode (--network host), this returns every physical NIC on
    the host: eth0, eth1, enp3s0, wlan0, usb0, whatever exists. Pick the one
    connected to your SPAN/mirror port.
    """
    SOCK = "/var/run/docker.sock"

    def _docker_call(method, path, timeout=10):
        s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        s.settimeout(timeout)
        try:
            s.connect(SOCK)
            req = f"{method} {path} HTTP/1.1\r\nHost: docker\r\nConnection: close\r\n\r\n".encode()
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

    # Ask the container what /sys/class/net looks like inside it
    interfaces: list[str] = []
    network_mode = "unknown"

    try:
        # 1. Check the container's network mode
        code, payload = _docker_call("GET", "/containers/real-sensor/json")
        if code == 200:
            info = _json.loads(payload.decode())
            network_mode = info.get("HostConfig", {}).get("NetworkMode", "unknown")

        # 2. Exec `ls /sys/class/net` inside the container
        exec_body = {
            "AttachStdout": True, "AttachStderr": True,
            "Cmd": ["sh", "-c", "ls /sys/class/net"],
        }
        code, payload = _docker_call("POST", "/containers/real-sensor/exec")
        # Note: we need to pass the body; the simple _docker_call above
        # doesn't support POST bodies. Re-do with body.
        s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        s.settimeout(10)
        try:
            s.connect(SOCK)
            body_bytes = _json.dumps(exec_body).encode()
            headers = [
                "POST /containers/real-sensor/exec HTTP/1.1",
                "Host: docker",
                "Content-Type: application/json",
                f"Content-Length: {len(body_bytes)}",
                "Connection: close",
            ]
            s.sendall(("\r\n".join(headers) + "\r\n\r\n").encode() + body_bytes)
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

        if code in (200, 201):
            exec_id = _json.loads(payload.decode()).get("Id")
            if exec_id:
                # Start the exec and read its output
                start_body = {"Detach": False, "Tty": False}
                body_bytes = _json.dumps(start_body).encode()
                s = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
                s.settimeout(10)
                try:
                    s.connect(SOCK)
                    headers = [
                        f"POST /exec/{exec_id}/start HTTP/1.1",
                        "Host: docker",
                        "Content-Type: application/json",
                        f"Content-Length: {len(body_bytes)}",
                        "Connection: close",
                    ]
                    s.sendall(("\r\n".join(headers) + "\r\n\r\n").encode() + body_bytes)
                    chunks = []
                    while True:
                        buf = s.recv(65536)
                        if not buf:
                            break
                        chunks.append(buf)
                    raw = b"".join(chunks)
                finally:
                    s.close()
                # Docker exec start returns a multiplexed stream; strip
                # the 8-byte frame headers and collect stdout.
                _, _, stream = raw.partition(b"\r\n\r\n")
                # Strip Docker stream headers (8 bytes per frame)
                text_parts = []
                i = 0
                while i + 8 <= len(stream):
                    hdr = stream[i:i+8]
                    size = int.from_bytes(hdr[4:8], "big")
                    frame = stream[i+8:i+8+size]
                    text_parts.append(frame.decode(errors="replace"))
                    i += 8 + size
                output = "".join(text_parts).strip()
                interfaces = [x for x in output.split("\n") if x and x != "lo"]
    except Exception as e:
        return {
            "interfaces": [],
            "mode": network_mode,
            "error": f"{type(e).__name__}: {e}",
        }

    # Always allow 'any' as a valid Zeek wildcard
    if "any" not in interfaces:
        interfaces.append("any")

    if not interfaces or interfaces == ["any"]:
        return {
            "interfaces": [],
            "mode": network_mode,
            "note": "Cannot detect interfaces inside real-sensor. "
                    "In lab mode (container:plc-modbus), eth0 is a virtual "
                    "bridge with no physical NICs. For production, the sensor "
                    "container must run with --network host.",
        }

    mode_hint = (
        "host network — these are your real physical NICs; pick the one "
        "connected to your SPAN/mirror port"
        if network_mode == "host"
        else "container network — these are virtual Docker bridges, not physical NICs"
    )

    return {
        "interfaces": interfaces,
        "mode": network_mode,
        "note": mode_hint,
    }


@router.post("/v1/settings/restart-sensor")
async def restart_sensor(site_id: UUID | None = None):
    """Recreate real-sensor with IFACE from settings; verify it comes up;
    roll back on failure; restart bridges so they reopen fresh inodes."""
    import subprocess, asyncio as _asyncio

    # 1. Read the current site's iface
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        sid = await _resolve_site(pool, site_id)
        row = await pool.fetchrow(
            "SELECT value FROM settings WHERE site_id = $1 AND key = 'capture.interface'",
            sid,
        )
        iface = row["value"] if row else "eth0"
        if isinstance(iface, str):
            iface = iface.strip('"')
        if not iface:
            iface = "eth0"
    finally:
        await pool.close()

    def _docker(*args, timeout=60):
        r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise HTTPException(
                500,
                f"docker {args[0]} failed: {r.stderr.strip()[:300] or r.stdout.strip()[:300]}",
            )
        return r.stdout

    # 2. Destroy the old container
    _docker("rm", "-f", "real-sensor", timeout=30)

    # 3. Create new
    bind = "/home/user/sentinelot/zeek-lab/real-sensor/logs:/logs"
    try:
        _docker(
            "run", "-d", "--name", "real-sensor",
            "--network", "container:plc-modbus",
            "--restart", "unless-stopped",
            "-e", f"IFACE={iface}",
            "--cap-add=NET_ADMIN", "--cap-add=NET_RAW",
            "-v", bind,
            "sentinelot-real-sensor",
            timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(500, "docker run timed out")

    # 4. Wait + verify
    await _asyncio.sleep(4)
    status = _docker("inspect", "-f", "{{.State.Running}}", "real-sensor").strip()
    if status != "true":
        # Roll back to eth0 (safest default)
        _docker("rm", "-f", "real-sensor", timeout=30)
        _docker(
            "run", "-d", "--name", "real-sensor",
            "--network", "container:plc-modbus",
            "--restart", "unless-stopped",
            "-e", "IFACE=eth0",
            "--cap-add=NET_ADMIN", "--cap-add=NET_RAW",
            "-v", bind,
            "sentinelot-real-sensor",
            timeout=60,
        )
        raise HTTPException(
            500,
            f"real-sensor crashed with IFACE={iface}. Rolled back to eth0. "
            f"Check docker logs real-sensor.",
        )

    # 5. Restart bridges so they attach to fresh inodes
    try:
        _docker("restart", "zeek-bridge", timeout=30)
        _docker("restart", "conn-bridge", timeout=30)
    except Exception as e:
        raise HTTPException(500, f"real-sensor up but bridge restart failed: {e}")

    return {
        "ok": True,
        "interface": iface,
        "note": "sensor recreated + bridges restarted; allow 30s for data to reappear",
    }


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
