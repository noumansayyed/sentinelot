FROM zeek/zeek:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpcap-dev git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN zkg autoconfig --force
RUN zkg install --force zeek/cisagov/icsnpp-modbus

RUN echo 'redef LogAscii::use_json = T;' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-modbus' >> /usr/local/zeek/share/zeek/site/local.zeek

RUN mkdir -p /logs
WORKDIR /logs

CMD ["zeek", "-i", "eth0", "-C"]
