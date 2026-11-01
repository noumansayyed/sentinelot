#!/usr/bin/env python3
"""Rogue device for SentinelOT detection testing.
Attacks lab targets on rotating schedule. Does NOT label events —
the stream-processor's detectors decide the category.
Fixed source IP: 172.18.0.30 (set at docker run via --ip)
"""
import sys
import time
import random
import socket
import logging

from pymodbus.client import ModbusTcpClient

logging.basicConfig(
    level=logging.INFO,
    format="[rogue] %(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("rogue")

MODBUS_TARGETS = [("plc-modbus", 502)]
S7_TARGET      = ("s7-plc", 102)
OPCUA_TARGET   = ("opcua-server", 4840)
STEP_GAP = 3
COOLDOWN = 30


def tcp_probe(host, port, timeout=3.0):
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        log.info("tcp_probe %s:%d ok", host, port)
        return True
    except Exception as e:
        log.warning("tcp_probe %s:%d failed: %s", host, port, e)
        return False


def modbus_read(host, port=502):
    try:
        c = ModbusTcpClient(host, port=port, timeout=3.0)
        c.connect()
        c.read_holding_registers(0, 10)
        c.close()
        log.info("modbus_read %s:%d ok", host, port)
        return True
    except Exception as e:
        log.warning("modbus_read %s:%d failed: %s", host, port, e)
        return False


def modbus_write(host, port=502):
    try:
        c = ModbusTcpClient(host, port=port, timeout=3.0)
        c.connect()
        c.write_register(0, random.randint(1, 65535))
        c.close()
        log.info("modbus_write %s:%d ok", host, port)
        return True
    except Exception as e:
        log.warning("modbus_write %s:%d failed: %s", host, port, e)
        return False


def timing_split(host, port):
    log.info("timing_split %s:%d — first event", host, port)
    modbus_read(host, port) if port == 502 else tcp_probe(host, port)
    log.info("timing_split %s:%d — sleeping 30s", host, port)
    time.sleep(30)
    log.info("timing_split %s:%d — second event", host, port)
    modbus_read(host, port) if port == 502 else tcp_probe(host, port)


def one_cycle(n):
    mh, mp = random.choice(MODBUS_TARGETS)
    log.info("=== cycle %d start (modbus=%s:%d) ===", n, mh, mp)
    modbus_read(mh, mp);               time.sleep(STEP_GAP)
    modbus_read(mh, mp);               time.sleep(STEP_GAP)
    modbus_write(mh, mp);              time.sleep(STEP_GAP)
    timing_split(mh, mp)
    log.info("=== cycle %d complete — cooldown %ds ===", n, COOLDOWN)
    time.sleep(COOLDOWN)


def main():
    log.info("rogue starting — fixed IP must be 172.18.0.30")
    n = 0
    while True:
        n += 1
        try:
            one_cycle(n)
        except KeyboardInterrupt:
            sys.exit(0)
        except Exception as e:
            log.error("cycle %d failed: %s", n, e)
            time.sleep(5)


if __name__ == "__main__":
    main()
