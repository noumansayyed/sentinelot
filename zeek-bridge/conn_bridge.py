import time, requests
LOG="/logs/zeek/conn.log"
URL="http://sentinelot-ingestion-api-1:8000/v1/ingest/events"
SENSOR="33333333-3333-3333-3333-333333333333"; import os
SITE=os.environ.get("SITE_ID", "22222222-2222-2222-2222-222222222222")
FP="dev-test-fingerprint-000"
PORTS={"102":"s7comm","20000":"dnp3","4840":"opcua"}
last={}
f=open(LOG); f.seek(0,2); print("tailing",LOG,flush=True)
while True:
    line=f.readline()
    if not line: time.sleep(1); continue
    if line.startswith("#"): continue
    c=line.rstrip("\n").split("\t")
    if len(c)<6 or c[5] not in PORTS: continue
    proto=PORTS[c[5]]; key=(c[2],c[4],c[5]); now=time.time()
    if now-last.get(key,0)<60: continue
    last[key]=now
    ev={"timestamp":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime(float(c[0]))),"zeek_uid":c[1],
        "protocol":proto,"src_ip":c[2],"dst_ip":c[4],"function_code":"CONNECT",
        "payload_summary":{"source":"zeek conn.log","level":"connection-only"}}
    r=requests.post(URL,headers={"X-Client-Cert-Fingerprint":FP},
        json={"sensor_id":SENSOR,"site_id":SITE,"events":[ev]},timeout=5)
    print(proto,c[2],"->",c[4],r.status_code,r.text[:120],flush=True)
