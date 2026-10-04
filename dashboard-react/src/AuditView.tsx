import { useState } from "react";
import { getAudit } from "./audit";
export default function AuditView({ card }: { card: React.CSSProperties }) {
  const [rows] = useState(getAudit());
  const list = rows.slice().reverse();
  function csv() {
    const q = (x:string) => '"' + x.replace(/"/g, '""') + '"';
    const body = ["time,by,type,target,from,to,reason", ...rows.map(r => [r.at,r.by,r.kind,r.target,r.from,r.to,r.reason].map(q).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type:"text/csv" }));
    a.download = "sentinelot-audit-report.csv"; a.click();
  }
  const th: React.CSSProperties = { padding:"10px 12px", textAlign:"left", fontSize:11, color:"#D1D1D6" };
  const td: React.CSSProperties = { padding:"10px 12px", fontSize:12, color:"#F5F5F7", verticalAlign:"top" };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700 }}>Audit Report</h1>
          <div style={{ fontSize:12, color:"#D1D1D6", marginTop:4 }}>Every change to device approval status and alert actions: who, what, why, when.</div>
        </div>
        <button onClick={csv} style={{ fontSize:12, padding:"8px 16px", borderRadius:8, border:"1px solid #48484A", background:"#2C2C2E", color:"#F5F5F7", cursor:"pointer" }}>Download CSV</button>
      </div>
      <div style={{ ...card, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:"#2C2C2E" }}>{["TIME","BY","TYPE","TARGET","FROM","TO","REASON"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {list.length===0 && <tr><td colSpan={7} style={{ ...td, textAlign:"center", padding:40 }}>No changes recorded yet.</td></tr>}
            {list.map((r,i) => (
              <tr key={i} style={{ borderTop:"1px solid #3A3A3C" }}>
                <td style={{ ...td, whiteSpace:"nowrap" }}>{new Date(r.at).toLocaleString()}</td>
                <td style={td}>{r.by}</td><td style={td}>{r.kind==="device"?"Device approval":"Alert action"}</td>
                <td style={td}>{r.target}</td><td style={td}>{r.from}</td><td style={td}><b>{r.to}</b></td><td style={td}>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
