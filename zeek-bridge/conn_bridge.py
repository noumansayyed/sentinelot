import time, requests, os
LOG="/logs/zeek/conn.log"
URL="http://sentinelot-ingestion-api-1:8000/v1/ingest/events"
SENSOR="33333333-3333-3333-3333-333333333333"
SITE=os.environ.get("SITE_ID", "22222222-2222-2222-2222-222222222222")
FP="dev-test-fingerprint-000"
PORTS={"102":"s7comm","20000":"dnp3","4840":"opcua","502":"modbus_tcp","5020":"modbus_tcp"}
import os
def _open():
    f = open(LOG)
    f.seek(0, 2)
    return f, os.stat(LOG).st_ino

f, cur_ino = _open()
print("tailing", LOG, "inode=", cur_ino, flush=True)

while True:
    # Detect rotation (real-sensor restart recreates conn.log)
    try:
        if os.stat(LOG).st_ino != cur_ino:
            print("File rotated, reopening...", flush=True)
            f.close()
            f, cur_ino = _open()
            print("tailing", LOG, "inode=", cur_ino, flush=True)
            continue
    except FileNotFoundError:
        time.sleep(1)
        continue
    line = f.readline()
    if not line:
        time.sleep(1)
        continue
    if line.startswith("#"): continue
    c = line.rstrip("\n").split("\t")
    if len(c) < 12 or c[5] not in PORTS: continue
    
    proto = PORTS[c[5]]
    conn_state = c[11]
    function_code = "CONNECT_SUCCESS" if conn_state == "SF" else "CONNECT_FAILED"
    orig_bytes = int(c[9]) if c[9].isdigit() else 0
    resp_bytes = int(c[10]) if c[10].isdigit() else 0
    
    ev = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(c[0]))),
        "zeek_uid": c[1],
        "protocol": proto,
        "src_ip": c[2],
        "dst_ip": c[4],
        "function_code": function_code,
        "payload_summary": {"source": "zeek conn.log", "level": "connection-only",
                            "conn_state": conn_state,
                            "orig_bytes": orig_bytes,
                            "resp_bytes": resp_bytes}
    }
    try:
        r = requests.post(URL, headers={"X-Client-Cert-Fingerprint": FP},
                          json={"sensor_id": SENSOR, "site_id": SITE, "events": [ev]}, timeout=5)
        print(proto, c[2], "->", c[4], conn_state, function_code, r.status_code, flush=True)
    except Exception as e:
        print("forward error:", e, flush=True)
