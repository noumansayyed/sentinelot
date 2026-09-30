import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Reading { t: string; value: number }
const POLL_MS = 2500, MAX_POINTS = 60;

export default function PLCChart() {
  const [data, setData] = useState<Reading[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastVal, setLastVal] = useState<number | null>(null);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = async () => {
    try {
      const r = await fetch("http://localhost:8001/telemetry");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const readings: Reading[] = j.readings ?? [];
      setData(readings.slice(-MAX_POINTS));
      if (readings.length) setLastVal(readings[readings.length - 1].value);
      setError(null);
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    fetch_();
    ref.current = setInterval(fetch_, POLL_MS);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, []);

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
  const vals = data.map(d => d.value);
  const avg = vals.length ? vals.reduce((a,b) => a+b, 0) / vals.length : null;

  return (
    <div style={{ background:"#FFFFFF", border:"1px solid #D1D1D6", borderRadius:14, padding:20, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ position:"relative", display:"inline-flex", width:10, height:10 }}>
            <span style={{ position:"absolute", inset:0, borderRadius:"50%", background: error ? "#FF3B30" : "#34C759", opacity:0.6, animation:"ping 1.2s infinite" }}/>
            <span style={{ position:"relative", display:"inline-block", borderRadius:"50%", width:10, height:10, background: error ? "#FF3B30" : "#34C759" }}/>
          </span>
          <span style={{ fontSize:13, fontWeight:600, color:"#1C1C1E" }}>PLC Live — Modbus HR0</span>
          <span style={{ fontSize:11, color:"#6C6C70", fontFamily:"'JetBrains Mono',monospace" }}>172.28.240.211:502</span>
        </div>
        <div>
          {lastVal !== null && <span style={{ fontSize:26, fontWeight:700, color:"#007AFF", fontFamily:"'JetBrains Mono',monospace" }}>{lastVal}</span>}
          {error && <span style={{ fontSize:11, color:"#CC2A20", marginLeft:8 }}>⚠ {error}</span>}
        </div>
      </div>

      {data.length===0 && !error ? (
        <div style={{ height:160, display:"flex", alignItems:"center", justifyContent:"center", color:"#6C6C70", fontSize:13 }}>Waiting for PLC data…</div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top:4, right:8, left:-20, bottom:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F2F2F7" />
            <XAxis dataKey="t" tickFormatter={fmt} tick={{ fill:"#6C6C70", fontSize:10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fill:"#6C6C70", fontSize:10 }} />
            <Tooltip
              contentStyle={{ background:"#FFFFFF", border:"1px solid #D1D1D6", borderRadius:10, boxShadow:"0 4px 12px rgba(0,0,0,0.1)" }}
              labelStyle={{ color:"#6C6C70", fontSize:11 }}
              itemStyle={{ color:"#007AFF" }}
              labelFormatter={fmt}
              formatter={(v: number) => [v, "Register value"]}
            />
            {avg !== null && (
              <ReferenceLine y={avg} stroke="#FF9500" strokeDasharray="4 2"
                label={{ value:`avg ${avg.toFixed(1)}`, fill:"#FF9500", fontSize:10 }} />
            )}
            <Line type="monotone" dataKey="value" dot={false} stroke="#007AFF" strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
      <p style={{ fontSize:11, color:"#6C6C70", marginTop:8, textAlign:"right" }}>
        Live poll 2.5 s · {data.length}/{MAX_POINTS} pts · real Modbus reads
      </p>
    </div>
  );
}
