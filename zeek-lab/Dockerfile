FROM zeek/zeek:latest

# Build tools needed to compile the ICSNPP Modbus parser plugin via zkg
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ cmake make libpcap-dev git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN zkg autoconfig --force
RUN zkg install --force zeek/cisagov/icsnpp-modbus

# Enable JSON logging and load the Modbus parser for every Zeek run
RUN echo 'redef LogAscii::use_json = T;' >> /usr/local/zeek/share/zeek/site/local.zeek \
    && echo '@load icsnpp-modbus' >> /usr/local/zeek/share/zeek/site/local.zeek

WORKDIR /logs
