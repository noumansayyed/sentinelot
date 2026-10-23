"""
SentinelOT — lab bridge script (dev/lab-only simplification of edge_agent.py)
Tails Zeek's real modbus.log JSON output and forwards each parsed
transaction to the SentinelOT ingestion API over plain HTTP with the
dev fingerprint header -- NOT how a real deployed sensor authenticates
(that requires mTLS behind a reverse proxy, per the earlier security
note). This script exists only to prove real Zeek-captured traffic can
reach the same pipeline already validated with curl.
"""
import json
import time
import requests

LOG_PATH = "/logs/zeek/modbus.log"
INGEST_URL = "http://sentinelot-ingestion-api-1:8000/v1/ingest/events"
SENSOR_ID = "33333333-3333-3333-3333-333333333333"
import os
SITE_ID = os.environ.get("SITE_ID", "22222222-2222-2222-2222-222222222222")
FINGERPRINT = "dev-test-fingerprint-000"

FIELDS = ["ts", "uid", "id.orig_h", "id.orig_p", "id.resp_h", "id.resp_p",
          "tid", "unit", "func", "pdu_type", "exception"]


def parse_tsv_line(line: str) -> dict:
    values = line.rstrip("\n").split("\t")
    return dict(zip(FIELDS, values))


def to_event(row: dict) -> dict:
    ts = float(row["ts"])
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
        "zeek_uid": row["uid"],
        "protocol": "modbus_tcp",
        "src_ip": row["id.orig_h"],
        "dst_ip": row["id.resp_h"],
        "function_code": row.get("func"),
        "payload_summary": {"pdu_type": row.get("pdu_type"), "unit": row.get("unit")},
    }


def main():
    print(f"Tailing {LOG_PATH} ...")
    with open(LOG_PATH, "r") as f:
        # skip Zeek's TSV header lines (start with '#'), start at end of
        # file's existing content so we only forward NEW events from here on
        f.seek(0, 2)
        while True:
            line = f.readline()
            if not line:
                time.sleep(1)
                continue
            if line.startswith("#"):
                continue
            try:
                row = parse_tsv_line(line)
                event = to_event(row)
            except Exception as exc:
                print("skip (parse error):", exc)
                continue

            resp = requests.post(
                INGEST_URL,
                headers={"X-Client-Cert-Fingerprint": FINGERPRINT},
                json={"sensor_id": SENSOR_ID, "site_id": SITE_ID, "events": [event]},
                timeout=5,
            )
            print(f"forwarded {event['function_code']} ({event['zeek_uid']}) -> {resp.status_code}")


if __name__ == "__main__":
    main()
