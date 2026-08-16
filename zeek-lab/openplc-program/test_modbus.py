from pymodbus.client import ModbusTcpClient
import time

c = ModbusTcpClient('172.28.240.211', port=502)
c.connect()
for i in range(5):
    r = c.read_holding_registers(address=0, count=1, slave=1)
    print('register 0 =', r.registers if not r.isError() else r)
    time.sleep(1)
