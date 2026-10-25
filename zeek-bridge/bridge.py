import json, time, os, requests

LOG_PATH = "/logs/zeek/modbus.log"
INGEST_URL = "http://sentinelot-ingestion-api-1:8000/v1/ingest/events"
SENSOR_ID = "33333333-3333-3333-3333-333333333333"
SITE_ID = os.environ.get("SITE_ID", "22222222-2222-2222-2222-222222222222")
FINGERPRINT = "dev-test-fingerprint-000"
FIELDS = ["ts","uid","id.orig_h","id.orig_p","id.resp_h","id.resp_p","tid","unit","func","pdu_type","exception"]

def to_event(row):
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(row["ts"]))),
        "zeek_uid": row["uid"], "protocol": "modbus_tcp",
        "src_ip": row["id.orig_h"], "dst_ip": row["id.resp_h"],
        "function_code": row.get("func"),
        "payload_summary": {"pdu_type": row.get("pdu_type"), "unit": row.get("unit")},
    }

def main():
    print("zeek-bridge starting...", flush=True)
    while True:
        # Wait for file to exist
        if not os.path.exists(LOG_PATH):
            print(f"Waiting for {LOG_PATH}...", flush=True)
            time.sleep(3)
            continue
        
        print(f"Opening {LOG_PATH}", flush=True)
        try:
            with open(LOG_PATH, "r") as f:
                f.seek(0, 2)  # go to end
                current_inode = os.fstat(f.fileno()).st_ino
                print(f"Tailing (inode={current_inode})", flush=True)
                while True:
                    # Check for rotation
                    try:
                        if os.stat(LOG_PATH).st_ino != current_inode:
                            print("File rotated, reopening...", flush=True)
                            break
                    except FileNotFoundError:
                        print("File removed, waiting...", flush=True)
                        break
                    
                    line = f.readline()
                    if not line:
                        time.sleep(0.5)
                        continue
                    if line.startswith("#"):
                        continue
                    try:
                        values = line.rstrip("\n").split("\t")
                        row = dict(zip(FIELDS, values))
                        if not row.get("uid") or not row.get("id.orig_h"):
                            continue
                        event = to_event(row)
                        resp = requests.post(
                            INGEST_URL,
                            headers={"X-Client-Cert-Fingerprint": FINGERPRINT},
                            json={"sensor_id": SENSOR_ID, "site_id": SITE_ID, "events": [event]},
                            timeout=5,
                        )
                        print(f"forwarded {event['function_code']} -> {resp.status_code}", flush=True)
                    except Exception as e:
                        print(f"skip: {e}", flush=True)
        except Exception as e:
            print(f"error: {e}", flush=True)
            time.sleep(2)

if __name__ == "__main__":
    main()
