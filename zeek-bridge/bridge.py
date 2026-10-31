import json, time, os, requests

LOG_PATH = "/logs/zeek/modbus.log"
INGEST_URL = "http://sentinelot-ingestion-api-1:8000/v1/ingest/events"
SENSOR_ID = "33333333-3333-3333-3333-333333333333"
SITE_ID = os.environ.get("SITE_ID", "22222222-2222-2222-2222-222222222222")
FINGERPRINT = "dev-test-fingerprint-000"

FIELDS = ["ts","uid","id.orig_h","id.orig_p","id.resp_h","id.resp_p",
          "tid","unit","func","pdu_type","exception"]

BATCH_SIZE = 50
BATCH_MAX_AGE = 2.0      # seconds — flush a partial batch at least every 2s
MAX_BUFFER = 5000        # safety cap if API is down


def to_event(row):
    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(row["ts"]))),
        "zeek_uid": row["uid"],
        "protocol": "modbus_tcp",
        "src_ip": row["id.orig_h"],
        "dst_ip": row["id.resp_h"],
        "function_code": row.get("func"),
        "payload_summary": {"pdu_type": row.get("pdu_type"), "unit": row.get("unit")},
    }


def post_batch(events):
    """POST a batch of events. Returns True on success, False to retry."""
    try:
        r = requests.post(
            INGEST_URL,
            headers={"X-Client-Cert-Fingerprint": FINGERPRINT},
            json={"sensor_id": SENSOR_ID, "site_id": SITE_ID, "events": events},
            timeout=10,
        )
        if r.status_code == 202:
            return True
        print(f"API returned {r.status_code}: {r.text[:200]}", flush=True)
        return False
    except Exception as e:
        print(f"POST failed: {e}", flush=True)
        return False


def main():
    print("zeek-bridge starting...", flush=True)
    while True:
        if not os.path.exists(LOG_PATH):
            print(f"Waiting for {LOG_PATH}...", flush=True)
            time.sleep(3)
            continue

        print(f"Opening {LOG_PATH}", flush=True)
        try:
            with open(LOG_PATH, "r") as f:
                f.seek(0, 2)
                current_inode = os.fstat(f.fileno()).st_ino
                print(f"Tailing (inode={current_inode})", flush=True)

                buffer = []
                last_flush = time.time()
                total_forwarded = 0

                while True:
                    # Detect file rotation
                    try:
                        if os.stat(LOG_PATH).st_ino != current_inode:
                            print("File rotated, reopening...", flush=True)
                            break
                    except FileNotFoundError:
                        print("File removed, waiting...", flush=True)
                        break

                    line = f.readline()
                    if not line:
                        # No new line. Flush buffer if it's been too long.
                        if buffer and (time.time() - last_flush) >= BATCH_MAX_AGE:
                            if post_batch(buffer):
                                total_forwarded += len(buffer)
                                print(f"forwarded batch of {len(buffer)} (total {total_forwarded})", flush=True)
                                buffer = []
                            last_flush = time.time()
                        time.sleep(0.2)
                        continue

                    if line.startswith("#"):
                        continue

                    try:
                        values = line.rstrip("\n").split("\t")
                        row = dict(zip(FIELDS, values))
                        if not row.get("uid") or not row.get("id.orig_h"):
                            continue
                        buffer.append(to_event(row))
                    except Exception as e:
                        print(f"parse error: {e}", flush=True)
                        continue

                    # Cap buffer
                    if len(buffer) > MAX_BUFFER:
                        print(f"WARN: buffer over {MAX_BUFFER}, dropping oldest", flush=True)
                        buffer = buffer[-MAX_BUFFER:]

                    # Flush when batch is full
                    if len(buffer) >= BATCH_SIZE:
                        if post_batch(buffer):
                            total_forwarded += len(buffer)
                            print(f"forwarded batch of {len(buffer)} (total {total_forwarded})", flush=True)
                            buffer = []
                            last_flush = time.time()
                        else:
                            # API failed — don't drop events, backoff and retry
                            time.sleep(2)
                            # buffer stays intact, retries next loop iteration

        except Exception as e:
            print(f"error: {e}", flush=True)
            time.sleep(2)


if __name__ == "__main__":
    main()
