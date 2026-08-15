FROM zeek/zeek:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpcap-dev git ca-certificates python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN zkg autoconfig --force
RUN zkg install --force zeek/cisagov/icsnpp-modbus

RUN echo 'redef LogAscii::use_json = T;' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-modbus' >> /usr/local/zeek/share/zeek/site/local.zeek

RUN pip3 install --no-cache-dir --break-system-packages pymodbus==3.7.4

WORKDIR /app
COPY plc_server.py client_traffic.py ./

RUN mkdir -p /logs
WORKDIR /logs

RUN cat > /app/run.sh << 'SCRIPT'
#!/bin/bash
set -e
echo "Starting Zeek capture on lo..."
zeek -i lo -C &
ZEEK_PID=$!
sleep 3

echo "Starting simulated PLC..."
python3 /app/plc_server.py &
PLC_PID=$!
sleep 2

echo "Starting traffic generator..."
python3 /app/client_traffic.py &
CLIENT_PID=$!

wait $ZEEK_PID $PLC_PID $CLIENT_PID
SCRIPT

RUN chmod +x /app/run.sh
CMD ["/app/run.sh"]
