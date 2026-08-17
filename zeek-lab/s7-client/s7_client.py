"""
SentinelOT lab — S7comm engineering workstation.
Plays the role of a Siemens TIA Portal / engineering laptop: periodically
reads a data block from the PLC over real S7comm, on its own real IP,
as a genuinely separate device on the network.
"""
import time
import snap7

PLC_HOST = "172.28.240.211"

def main():
    client = snap7.Client()
    print(f"S7 client starting, connecting to PLC at {PLC_HOST} ...")
    while True:
        try:
            client.connect(PLC_HOST, 0, 1)
            data = client.db_read(1, 0, 16)
            print("S7 read DB1 bytes 0-16:", bytes(data).hex())
        except Exception as exc:
            print("S7 read failed:", exc)
        finally:
            try:
                client.disconnect()
            except Exception:
                pass
        time.sleep(4)

if __name__ == "__main__":
    main()
