"""
SentinelOT — lab bridge script for Suricata (dev/lab-only, same pattern
as zeek-bridge/bridge.py). Tails Suricata's eve.json, filters for real
signature-match alerts, and forwards them to the dedicated
/v1/ingest/signature-alerts endpoint.
"""
import json
import time
import requests

LOG_PATH = "/home/dev/sentinelot/zeek-lab/real-sensor/logs/suricata/eve.json"
INGEST_URL = "http://localhost:8000/v1/ingest/signature-alerts"
SENSOR_ID = "33333333-3333-3333-3333-333333333333"
SITE_ID = "22222222-2222-2222-2222-222222222222"
FINGERPRINT = "dev-test-fingerprint-000"

SEVERITY_MAP = {1: "critical", 2: "high", 3: "medium"}  # Suricata's 1-3 scale


def to_signature_alert(event: dict) -> dict:
    alert = event["alert"]
    return {
        "timestamp": event["timestamp"],
        "src_ip": event["src_ip"],
        "dst_ip": event["dest_ip"],
        "signature": alert["signature"],
        "severity": SEVERITY_MAP.get(alert.get("severity"), "medium"),
    }


def main():
    print(f"Tailing {LOG_PATH} ...")
    with open(LOG_PATH, "r") as f:
        f.seek(0, 2)  # only forward NEW alerts from here on
        while True:
            line = f.readline()
            if not line:
                time.sleep(1)
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("event_type") != "alert":
                continue  # skip stats/flow/other eve.json noise

            alert = to_signature_alert(event)
            resp = requests.post(
                INGEST_URL,
                headers={"X-Client-Cert-Fingerprint": FINGERPRINT},
                json={"sensor_id": SENSOR_ID, "site_id": SITE_ID, "alerts": [alert]},
                timeout=5,
            )
            print(f"forwarded [{alert['severity']}] {alert['signature']} -> {resp.status_code} {resp.text}")


if __name__ == "__main__":
    main()
