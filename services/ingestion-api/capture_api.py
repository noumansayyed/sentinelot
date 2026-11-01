"""Capture mode + interface discovery for the real-sensor container.

Two modes:
  - 'lab'  : real-sensor shares plc-modbus netns (only eth0 visible)
  - 'host' : real-sensor runs with --network host (all host NICs visible)

Mode is detected by inspecting real-sensor's HostConfig.NetworkMode.
Mode switch recreates the container with the new mode.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from uuid import UUID
import asyncpg, os, subprocess, asyncio

router = APIRouter()
DATABASE_URL = os.environ["DATABASE_URL"]

# Host paths — hardcoded because API container's $HOME differs from host
HOST_LOG_DIR = "/home/user/sentinelot/zeek-lab/real-sensor/logs"
REAL_SENSOR_IMAGE = "sentinelot-real-sensor"


def _docker(*args, timeout=60):
    r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise HTTPException(
            500,
            f"docker {args[0]} failed: {r.stderr.strip()[:300] or r.stdout.strip()[:300]}",
        )
    return r.stdout


def _inspect_network_mode() -> str:
    """Return 'host', 'container:<name>', 'offline' (if not running), or 'unknown'."""
    try:
        out = _docker("inspect", "-f", "{{.HostConfig.NetworkMode}}", "real-sensor", timeout=10).strip()
        if out:
            return out
    except HTTPException:
        pass
    return "offline"


def _is_running() -> bool:
    try:
        out = _docker("inspect", "-f", "{{.State.Running}}", "real-sensor", timeout=10).strip()
        return out == "true"
    except HTTPException:
        return False


def _list_interfaces() -> list[str]:
    """List REAL network interfaces visible to real-sensor, filtering out
    Docker plumbing (veth*, br-*, docker0), loopback, and other virtual
    interfaces that are not usable for passive monitoring."""
    try:
        out = _docker(
            "exec", "real-sensor", "sh", "-c", "ls /sys/class/net",
            timeout=10,
        )
        all_ifaces = [x.strip() for x in out.split("\n") if x.strip()]
    except HTTPException:
        return []

    # Interfaces to exclude — Docker plumbing and loopback
    EXCLUDE_PREFIXES = ("veth", "br-", "docker", "lo", "virbr", "vmnet")
    EXCLUDE_EXACT = {"services1", "lo", "docker0"}

    usable = []
    for iface in all_ifaces:
        if iface in EXCLUDE_EXACT:
            continue
        if any(iface.startswith(p) for p in EXCLUDE_PREFIXES):
            continue
        usable.append(iface)

    # Always offer "any" — Zeek wildcard for all interfaces
    usable.append("any")
    return usable


def _start_sensor(network_mode: str, iface: str) -> None:
    """Recreate real-sensor with the given network mode + iface."""
    _docker("rm", "-f", "real-sensor", timeout=30)

    if network_mode == "host":
        net_args = ["--network", "host"]
    elif network_mode == "lab":
        net_args = ["--network", "container:plc-modbus"]
    else:
        raise HTTPException(400, f"unknown mode: {network_mode}")

    _docker(
        "run", "-d", "--name", "real-sensor",
        *net_args,
        "--restart", "unless-stopped",
        "-e", f"IFACE={iface}",
        "--cap-add=NET_ADMIN", "--cap-add=NET_RAW",
        "-v", f"{HOST_LOG_DIR}:/logs",
        REAL_SENSOR_IMAGE,
        timeout=60,
    )


class ModeBody(BaseModel):
    value: str  # 'host' or 'lab'


@router.get("/v1/capture/mode")
async def get_capture_mode():
    mode = _inspect_network_mode()
    running = _is_running()
    if mode.startswith("container:"):
        return {"mode": "lab", "raw": mode, "running": running}
    return {"mode": mode, "raw": mode, "running": running}


@router.post("/v1/capture/mode")
async def set_capture_mode(body: ModeBody):
    if body.value not in ("host", "lab"):
        raise HTTPException(400, "mode must be 'host' or 'lab'")

    # Pick a default interface for the new mode
    if body.value == "host":
        # Prefer eth0, then enp*, then wlp*, then anything non-Docker
        default_iface = "eth0"
        # We can't see host ifaces until sensor is in host mode.
        # Use 'any' to be safe — Zeek will listen on all.
        default_iface = "any"
    else:
        default_iface = "eth0"

    prev_mode_raw = _inspect_network_mode()
    prev_mode = "lab" if prev_mode_raw.startswith("container:") else prev_mode_raw

    _start_sensor(body.value, default_iface)
    await asyncio.sleep(5)

    if not _is_running():
        # Roll back
        try:
            _start_sensor(prev_mode if prev_mode in ("host", "lab") else "lab", "eth0")
        except HTTPException:
            pass
        raise HTTPException(
            500,
            f"real-sensor failed to start in {body.value} mode. Rolled back. "
            f"Check docker logs real-sensor.",
        )

    # Restart bridges so they pick up new inodes
    try:
        _docker("restart", "zeek-bridge", timeout=20)
        _docker("restart", "conn-bridge", timeout=20)
    except HTTPException:
        pass

    return {"ok": True, "mode": body.value, "default_interface": default_iface}


@router.get("/v1/capture/interfaces")
async def list_interfaces():
    """List interfaces visible inside real-sensor right now."""
    mode = _inspect_network_mode()
    running = _is_running()
    ifaces = _list_interfaces() if running else []
    return {
        "mode": "lab" if mode.startswith("container:") else mode,
        "running": running,
        "interfaces": ifaces,
    }
