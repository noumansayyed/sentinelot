FROM zeek/zeek:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpcap-dev git ca-certificates suricata \
    && rm -rf /var/lib/apt/lists/*

# Remove the broken JavaScript plugin that ships with Zeek 9.0.0
RUN rm -rf /usr/local/zeek/lib/zeek/plugins/Zeek_JavaScript || true

RUN zkg autoconfig --force
RUN zkg install --force zeek/cisagov/icsnpp-modbus
RUN zkg install --force zeek/cisagov/icsnpp-s7comm v2.0.0
RUN zkg install --force zeek/cisagov/icsnpp-dnp3 v2.0.0
RUN zkg install --force zeek/cisagov/icsnpp-opcua-binary

RUN echo 'redef LogAscii::use_json = T;' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-modbus' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-s7comm' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-dnp3' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-opcua-binary' >> /usr/local/zeek/share/zeek/site/local.zeek

RUN mkdir -p /logs/zeek /logs/suricata /var/lib/suricata/rules
COPY suricata-rules/ics.rules /var/lib/suricata/rules/suricata.rules
COPY run.sh /run.sh
RUN chmod +x /run.sh
WORKDIR /logs
CMD ["/run.sh"]
