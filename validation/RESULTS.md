# SentinelOT — Public Dataset Validation

## Dataset
CIC Modbus Dataset 2023 (Canadian Institute for Cybersecurity, University of New Brunswick).
https://www.unb.ca/cic/datasets/modbus-2023.html
Real Modbus attack traffic from a simulated substation network, independently
captured and labeled by UNB researchers -- not created or influenced by this
project in any way.

## Method
Fed the dataset's raw PCAP files directly into the same Zeek+ICSNPP sensor
image used for live capture (`sentinelot-real-sensor`), via:
    ~/sentinelot/validation/analyze_pcap.sh <pcap file>
This is an offline analysis, not a live replay -- it directly tests whether
the parser correctly understands real third-party Modbus traffic.

## Result
File: attack/compromised-scada/ied1a/ied1a-network-captures/veth3614724-0.pcap
Result: 152,251 real Modbus transactions correctly identified and parsed,
including READ_HOLDING_REGISTERS, READ_INPUT_REGISTERS, and READ_COILS
function codes -- genuine protocol content, not just connection metadata.

## Honest note
Not every file in the dataset produced Modbus-log output -- some capture
points (e.g. central-agent captures) recorded only failed/unanswered
connection attempts (SYN with no reply) rather than completed Modbus
sessions, which the parser correctly left unparsed since there was no
actual protocol content to extract. This is expected: a large multi-segment
capture includes vantage points that never see the real conversation.
