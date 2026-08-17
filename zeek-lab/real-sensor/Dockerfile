FROM zeek/zeek:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpcap-dev git ca-certificates suricata \
    && rm -rf /var/lib/apt/lists/*

RUN zkg autoconfig --force
RUN zkg install --force zeek/cisagov/icsnpp-modbus
RUN zkg install --force zeek/cisagov/icsnpp-s7comm

RUN echo 'redef LogAscii::use_json = T;' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-modbus' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-s7comm' >> /usr/local/zeek/share/zeek/site/local.zeek

RUN mkdir -p /logs/zeek /logs/suricata /var/lib/suricata/rules
COPY suricata-rules/ics.rules /var/lib/suricata/rules/suricata.rules

COPY run.sh /run.sh
RUN chmod +x /run.sh

WORKDIR /logs
CMD ["/run.sh"]
