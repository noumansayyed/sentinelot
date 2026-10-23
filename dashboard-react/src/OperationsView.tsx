import { useEffect, useState, useRef } from "react";
import { getToken, isKnown } from "./api";
import {
  fetchOperations, Operations, OpDevice,
  fetchAssetInbox, classifyAsset, bulkClassify, InboxAsset, SITE_ID,
} from "./api";
import RowActions from "./RowActions";
import NumberRoll from "./NumberRoll";
import ECGTrace from "./ECGTrace";

interface Props { card: React.CSSProperties }
const ACTOR = localStorage.getItem("sot_actor") || "operator";

const PROTO_COLORS: Record<string,string> = {
  modbus_tcp:"#0A84FF", s7comm:"#FF9F0A", dnp3:"#30D158", opcua:"#BF5AF2",
};
const PROTO_NAMES: Record<string,string> = {
  modbus_tcp:"Modbus TCP", s7comm:"S7comm", dnp3:"DNP3", opcua:"OPC-UA",
};
const ROLE_ORDER = ["plc","hmi","rtu","sensor","engineering_workstation","switch","unknown"] as const;
const ROLE_LABEL: Record<string,string> = {
  plc:"PLCs", hmi:"HMIs", rtu:"RTUs", sensor:"Sensors",
  engineering_workstation:"Engineering Workstations", switch:"Switches", unknown:"Unclassified",
};
const ROLE_COLOR: Record<string,string> = {
  plc:"#FF453A", hmi:"#0A84FF", rtu:"#30D158", sensor:"#BF5AF2",
  engineering_workstation:"#FF9F0A", switch:"#8E8E93", unknown:"#FF9F0A",
};

function statusColor(s: string) {
  return s === "active" ? "var(--success)" : s === "idle" ? "var(--warning)" : "var(--text-3)";
}
function ago(sec: number | null) {
  if (sec === null) return "never";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec/60)}m`;
  if (sec < 86400) return `${Math.floor(sec/3600)}h`;
  return `${Math.floor(sec/86400)}d`;
}

export default function OperationsView({ card }: Props) {
  const [ops, setOps]             = useState<Operations | null>(null);
  const [inbox, setInbox]         = useState<InboxAsset[]>([]);
  const [err, setErr]             = useState("");
  const [last, setLast]           = useState("");
  const [filter, setFilter]       = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [busy, setBusy]           = useState(false);
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [ctxMenu, setCtxMenu]     = useState<{ device: OpDevice; x: number; y: number } | null>(null);
  const [rolePicker, setRolePicker] = useState<{ target: "one" | "bulk"; device?: OpDevice } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [viewMode, setViewMode] = useState<"live" | "all" | "custom">("live");
  const [customRange, setCustomRange] = useState<"today" | "week" | "month" | "picker">("today");
  const [rangeStart, setRangeStart] = useState<string>("");
  const [rangeEnd, setRangeEnd] = useState<string>("");
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        // Only close if we are in custom mode
        setIsCustomOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function refresh() {
    try {
      const [o, ib] = await Promise.all([fetchOperations(SITE_ID), fetchAssetInbox(SITE_ID)]);
      setOps(o); setInbox(ib);
      setLast(new Date().toLocaleTimeString());
      setErr("");
    } catch(e:any) { setErr(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 1000); return () => clearInterval(id); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 500);
  }

  if (!ops) return <div style={{padding:20,color:"var(--text-3)"}}>Loading plant state…</div>;

  const devices = ops.devices.filter(d => {
    // 1. Hide archived (older than 24h) unless "All" or "Custom" view is selected
    const ageDays = d.seconds_since_seen !== null ? d.seconds_since_seen / 86400 : null;
    
    if (viewMode === "live") {
      // Live: only active or idle, seen in the last hour
      if (d.status !== "active" && d.status !== "idle") return false;
      if (ageDays !== null && ageDays > 1) return false;
    } else if (viewMode === "custom") {
      // Custom: filter by date range based on last_seen
      if (d.seconds_since_seen === null) return false;
      const lastSeenMs = Date.now() - (d.seconds_since_seen * 1000);
      if (customRange === "today") {
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        if (lastSeenMs < startOfDay.getTime()) return false;
      } else if (customRange === "week") {
        if (lastSeenMs < Date.now() - 7 * 86400000) return false;
      } else if (customRange === "month") {
        if (lastSeenMs < Date.now() - 30 * 86400000) return false;
      } else if (customRange === "picker") {
        if (rangeStart && lastSeenMs < new Date(rangeStart).getTime()) return false;
        if (rangeEnd && lastSeenMs > new Date(rangeEnd).getTime() + 86400000) return false;
      }
    }
    // "all" view: no time/status filter
    
    if (!showHidden && d.hidden) return false;
    
    if (filter === "") return true;
    const f = filter.toLowerCase();
    return d.ip.toLowerCase().includes(f) || d.role.toLowerCase().includes(f)
      || d.protocols.some(p => p.toLowerCase().includes(f));
  });

  const grouped: Record<string, OpDevice[]> = {};
  for (const r of ROLE_ORDER) grouped[r] = [];
  for (const d of devices) {
    const role = ROLE_ORDER.includes(d.role as any) ? d.role : "unknown";
    grouped[role].push(d);
  }

  const orderedIds: string[] = [];
  for (const r of ROLE_ORDER) for (const d of grouped[r]) orderedIds.push(d.asset_id);

  function toggleCollapse(role: string) {
    const s = new Set(collapsed);
    s.has(role) ? s.delete(role) : s.add(role);
    setCollapsed(s);
  }
  function toggleSelect(id: string) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  }

  function handleRowClick(e: React.MouseEvent, d: OpDevice, orderedIds: string[]) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "BUTTON" || tag === "A") return;

    if (e.shiftKey && lastClicked) {
      const a = orderedIds.indexOf(lastClicked);
      const b = orderedIds.indexOf(d.asset_id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const s = new Set(selected);
        for (let i = lo; i <= hi; i++) s.add(orderedIds[i]);
        setSelected(s); setLastClicked(d.asset_id); return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const s = new Set(selected);
      s.has(d.asset_id) ? s.delete(d.asset_id) : s.add(d.asset_id);
      setSelected(s); setLastClicked(d.asset_id); return;
    }
    const s = new Set(selected);
    s.has(d.asset_id) ? s.delete(d.asset_id) : s.add(d.asset_id);
    setSelected(s); setLastClicked(d.asset_id);
  }
  function handleRowRightClick(e: React.MouseEvent, d: OpDevice) {
    e.preventDefault();
    setCtxMenu({ device: d, x: e.clientX, y: e.clientY });
  }

  async function rowAction(d: OpDevice, action: "hide" | "change-role") {
    if (action === "hide") {
      const reason = prompt(`Hide ${d.ip}? Reason:`, "infrastructure / not an OT device");
      if (!reason) return;
      setBusy(true);
      try { await classifyAsset(d.asset_id, { actor: ACTOR, hidden: true, reason }); await refresh(); }
      catch(e:any) { setErr(e.message); } finally { setBusy(false); }
    } else {
      setRolePicker({ target: "one", device: d });
    }
  }
  async function handleDelete(d: OpDevice) {
    // Check if the device is classified (known or has a role)
    const known = isKnown(d.ip);
    const hasRole = d.role !== "unknown";
    
    let warning = `Permanently delete ${d.ip}?\n\nThis will remove all history.`;
    
    if (known || hasRole) {
      warning += `\n\n⚠ WARNING: This device is currently ${known ? "APPROVED AS KNOWN" : ""}${known && hasRole ? " and " : ""}${hasRole ? `assigned the role "${d.role.toUpperCase()}"` : ""}.`;
      warning += `\n\nIf you delete it, it will lose its classification and reappear as an UNCLASSIFIED device with a "New Device" alert the next time it talks.`;
      warning += `\n\nAre you sure you want to proceed?`;
    } else {
      warning += `\n\nIf the device is still on the network, it will reappear as a NEW device.`;
    }
    
    if (!confirm(warning)) return;
    setBusy(true);
    try {
      const res = await fetch(`http://localhost:8000/v1/assets/${d.asset_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await getToken()}` }
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function handleApproveKnown(d: OpDevice) {
    setBusy(true);
    try { await classifyAsset(d.asset_id, { actor: ACTOR, role: d.role === "unknown" ? "engineering_workstation" : d.role, reason: "approved as known" }); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  function openRolePickerOne(d: OpDevice) { setRolePicker({ target: "one", device: d }); }
  function openRolePickerBulk() { if (selected.size === 0) return; setRolePicker({ target: "bulk" }); }
  async function applyRole(role: string, criticality?: string) {
    if (!rolePicker) return;
    setBusy(true);
    try {
      if (rolePicker.target === "one" && rolePicker.device) {
        await classifyAsset(rolePicker.device.asset_id, { actor: ACTOR, role, criticality, reason: "operator role picker" });
      } else {
        await bulkClassify({ actor: ACTOR, asset_ids: Array.from(selected), role, criticality, reason: "operator bulk role picker" });
        setSelected(new Set());
      }
      setRolePicker(null); await refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function approveBulk() {
    if (selected.size === 0) return;
    setBusy(true);
    try { await bulkClassify({ actor: ACTOR, asset_ids: Array.from(selected), role: "engineering_workstation", reason: "operator approved" }); setSelected(new Set()); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function hideBulk() {
    if (selected.size === 0) return;
    const reason = prompt(`Hide ${selected.size} device(s)? Reason:`, "infrastructure / not OT");
    if (!reason) return;
    setBusy(true);
    try { await bulkClassify({ actor: ACTOR, asset_ids: Array.from(selected), hidden: true, reason }); setSelected(new Set()); await refresh(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const stats = [
    { label: "TOTAL",        value: ops.device_summary.total,   color: "var(--accent)" },
    { label: "ACTIVE",       value: ops.device_summary.active,  color: "var(--success)" },
    { label: "IDLE",         value: ops.device_summary.idle,    color: "var(--warning)" },
    { label: "OFFLINE",      value: ops.device_summary.offline, color: "var(--text-3)" },
    { label: "UNCLASSIFIED", value: ops.device_summary.unknown, color: "var(--danger)" },
  ];

  return (
    <div style={{display:"flex", flexDirection:"column", gap:24}}>

      <div className="float-in"
           style={{display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16}}>
        <div>
          <div className="t-h1">{ops.site.name}</div>
          <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:10 }}>
            <span className="status-dot" data-live="true"
                  style={{ background: "var(--success)", color: "var(--success)" }}/>
            <span className="t-label">Passive monitoring · {last}</span>
          </div>
        </div>
        {inbox.length > 0 && (
          <div className="glass-2" style={{ padding:"12px 20px",
                                             border:"1px solid rgba(255,159,10,0.35)",
                                             color:"var(--warning)", fontSize:14, fontWeight:600 }}>
            ⚠ {inbox.length} device{inbox.length>1?"s":""} need classification
          </div>
        )}
      </div>

      <div className="float-in-1"
           style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:16 }}>
        {stats.map((s) => (
          <div key={s.label} className="glass" style={{ padding:22 }}>
            <div className="t-label" style={{ letterSpacing:"0.4px", fontWeight:600 }}>{s.label}</div>
            <div className="t-mono"
                 style={{ fontSize:42, fontWeight:700, marginTop:8, color:s.color,
                          letterSpacing:"-1.5px", lineHeight:1 }}>
              <NumberRoll value={s.value} className="num-roll"/>
            </div>
          </div>
        ))}
      </div>

      <div className="float-in-2 glass" style={{ padding:24 }}>
        <div className="t-h3" style={{ marginBottom:18 }}>
          Protocol health · live
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:18 }}>
          {["modbus_tcp","s7comm","dnp3","opcua"].map(p => {
            const f = ops.protocols.find(x => x.protocol === p);
            const color = PROTO_COLORS[p];
            const active = f && f.status === "active" && (f.completed_5min || 0) > 0;
            const idle   = f && f.status === "idle" && (f.completed_5min || 0) > 0;
            const offline = !f || f.completed_5min === 0;
            // This ensures if the backend says it's live, the UI shows LIVE
            return (
              <div key={p} style={{ padding:18, borderRadius:14,
                                    background: active ? "var(--glass-2)" : "transparent",
                                    border: "1px solid var(--hairline-light)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                  <span className="status-dot"
                        data-live={active ? "true" : "false"}
                        style={{ background: active ? color : (idle ? "var(--warning)" : "var(--text-4)"),
                                 color }}/>
                  <span className="t-h3" style={{ color:"var(--text-1)" }}>{PROTO_NAMES[p]}</span>
                  {active && <span style={{ marginLeft:6, fontSize:10, fontWeight:600, color:"var(--text-3)" }}>MONITORING</span>}
                  {idle && <span style={{ marginLeft:6, fontSize:10, fontWeight:600, color:"var(--text-3)" }}>IDLE</span>}
                </div>
                <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                  <span className="t-mono"
                        style={{ fontSize:32, fontWeight:700, color, letterSpacing:"-1px" }}>
                    <NumberRoll value={f?.successful_devices || 0}/>
                  </span>
                  <span className="t-meta">devices active</span>
                </div>
                <ECGTrace protocol={p} events={f?.completed_5min || 0} color={color} active={!!active}/>
                <div className="t-meta" style={{ marginTop:6 }}>
                  {!f || f.status === "offline" ? "not seen in 10s" : (f.status === "idle" ? "seen — no successful traffic" : "Passive sensor active")}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="float-in-3 glass" style={{ padding:18, display:"flex", gap:14, alignItems:"center", flexWrap:"wrap", overflow: "visible", position: "relative", zIndex: 50 }}>
        <input value={filter} onChange={e=>setFilter(e.target.value)}
          placeholder="Search IP, role, protocol…"
          style={{ background:"var(--glass-2)", border:"1px solid var(--hairline-light)",
                   borderRadius:12, color:"var(--text-1)", padding:"10px 16px",
                   fontSize:14, width:320, fontFamily:"var(--font-sans)", outline:"none" }}/>
        <span style={{flex:1}}/>
        
        {/* INLINE FILTERS */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginRight:16 }}>
          <span style={{ fontSize:11, fontWeight:600, color:"var(--text-3)" }}>VIEW:</span>
          <button onClick={() => setViewMode("live")} className={viewMode === "live" ? "btn btn-primary" : "btn"} style={{ padding: "6px 12px", fontSize: 11 }}>Live</button>
          <button onClick={() => setViewMode("all")} className={viewMode === "all" ? "btn btn-primary" : "btn"} style={{ padding: "6px 12px", fontSize: 11 }}>All</button>
          
          <div style={{ position:"relative" }} ref={dropdownRef}>
            <button onClick={() => { setViewMode("custom"); setIsCustomOpen(!isCustomOpen); }} className={viewMode === "custom" ? "btn btn-primary" : "btn"} style={{ padding: "6px 12px", fontSize: 11 }}>Customize ▾</button>
            {isCustomOpen && (
              <div className="glass-3" style={{ position:"absolute", top:"100%", right:0, marginTop:8, padding:8, borderRadius:12, zIndex: 9999, display:"flex", flexDirection:"column", gap:4, width:200, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}>
                <button onClick={() => { setCustomRange("today"); setIsCustomOpen(false); }} className={customRange === "today" ? "btn btn-primary" : "btn"} style={{ fontSize:11, padding:"4px 8px", textAlign:"left" }}>Today</button>
                <button onClick={() => { setCustomRange("week"); setIsCustomOpen(false); }} className={customRange === "week" ? "btn btn-primary" : "btn"} style={{ fontSize:11, padding:"4px 8px", textAlign:"left" }}>Last 7 days</button>
                <button onClick={() => { setCustomRange("month"); setIsCustomOpen(false); }} className={customRange === "month" ? "btn btn-primary" : "btn"} style={{ fontSize:11, padding:"4px 8px", textAlign:"left" }}>Last 30 days</button>
                <button onClick={() => setCustomRange("picker")} className={customRange === "picker" ? "btn btn-primary" : "btn"} style={{ fontSize:11, padding:"4px 8px", textAlign:"left" }}>Custom range…</button>
                
                {customRange === "picker" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, borderTop: "1px solid var(--hairline-light)", paddingTop: 8 }}>
                    <input type="date" value={rangeStart} onChange={e => { setRangeStart(e.target.value); if(rangeEnd) setIsCustomOpen(false); }}
                      style={{ background: "var(--glass-2)", color: "var(--text-1)", border: "1px solid var(--hairline-light)", borderRadius: 6, padding: "4px 8px", fontSize: 11 }} />
                    <input type="date" value={rangeEnd} onChange={e => { setRangeEnd(e.target.value); if(rangeStart) setIsCustomOpen(false); }}
                      style={{ background: "var(--glass-2)", color: "var(--text-1)", border: "1px solid var(--hairline-light)", borderRadius: 6, padding: "4px 8px", fontSize: 11 }} />
                  </div>
                )}
              </div>
            )}
          </div>

          <label style={{fontSize:11, color:"var(--text-2)", display:"flex", alignItems:"center", gap:6, marginLeft:8}}>
            <input type="checkbox" checked={showHidden} onChange={e=>setShowHidden(e.target.checked)}/>
            Show hidden
          </label>
          <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: 8 }}>
            {devices.length} of {ops.devices.length}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn"
            style={{ padding: "4px 10px", fontSize: 11, marginLeft: 8,
                     display: "inline-flex", alignItems: "center", gap: 4 }}
            title="Refresh now"
          >
            <span style={{ display: "inline-block",
                           animation: refreshing ? "spin 700ms linear infinite" : "none",
                           fontSize: 13 }}>⟳</span>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {selected.size > 0 && (
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <span className="t-body" style={{ color:"var(--accent)", fontWeight:600 }}>
              {selected.size} selected
            </span>
            <button className="btn" onClick={openRolePickerBulk} disabled={busy}>Change role…</button>
            <button className="btn" onClick={approveBulk} disabled={busy}>Approve known</button>
            <button className="btn" onClick={hideBulk} disabled={busy}>Hide</button>
          </div>
        )}
      </div>

      <div className="float-in-4 glass" style={{ padding:0, overflow:"hidden" }}>
        {ROLE_ORDER.map(role => {
          const rows = grouped[role];
          const isCollapsed = collapsed.has(role);
          const color = ROLE_COLOR[role];
          return (
            <div key={role}>
              <div onClick={()=>toggleCollapse(role)}
                   style={{ padding:"16px 24px", background:"rgba(0,0,0,0.12)",
                            borderTop:"1px solid var(--hairline-light)",
                            display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
                <span className="t-meta">{isCollapsed?"▶":"▼"}</span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }}/>
                <span className="t-h3">{ROLE_LABEL[role]}</span>
                <span className="t-meta">({rows.length})</span>
                {role === "unknown" && (
                  <span style={{ marginLeft:"auto", fontSize:13, color:"var(--warning)", fontWeight:600 }}>
                    requires classification →
                  </span>
                )}
              </div>
              {!isCollapsed && (
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:14 }}>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: "16px 24px", color: "var(--text-3)", fontSize: 13, fontStyle: "italic" }}>
                          No devices active
                        </td>
                      </tr>
                    )}
                    {rows.map(d => (
                      <tr key={d.asset_id}
                          onClick={(e)=>handleRowClick(e,d,orderedIds)}
                          onContextMenu={(e)=>handleRowRightClick(e,d)}
                          style={{ borderTop:"1px solid var(--hairline-soft)",
                                   cursor:"pointer",
                                   background: selected.has(d.asset_id) ? "rgba(10,132,255,0.08)" : undefined,
                                   boxShadow: selected.has(d.asset_id) ? "inset 3px 0 0 var(--accent)" : undefined }}>
                        <td style={{ padding:"14px 24px", width:30 }} onClick={e=>e.stopPropagation()}>
                          <input type="checkbox"
                                 checked={selected.has(d.asset_id)}
                                 onChange={(e)=>{ e.stopPropagation(); toggleSelect(d.asset_id); }}
                                 style={{ cursor:"pointer", width:18, height:18, accentColor:"var(--accent)" }}/>
                        </td>
                        <td style={{ padding:"14px 8px", width:80 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: "0.5px",
                            color: d.status === "active" ? "var(--success)" : d.status === "idle" ? "var(--warning)" : "var(--text-3)",
                            background: d.status === "active" ? "rgba(48,209,88,0.1)" : d.status === "idle" ? "rgba(255,159,10,0.1)" : "transparent",
                            padding: "3px 8px", borderRadius: 4,
                            border: d.status === "active" ? "1px solid rgba(48,209,88,0.3)" : d.status === "idle" ? "1px solid rgba(255,159,10,0.3)" : "1px solid transparent"
                          }}>
                            {d.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="t-mono" style={{ padding:"14px 8px", color:"var(--text-1)", fontSize:14, fontWeight:500 }}>
                          {d.ip.replace("/32","")}
                        </td>
                        <td style={{ padding:"14px 8px" }}>
                          {d.protocols.map(p => (
                            <span key={p}
                                  style={{ display:"inline-block", padding:"3px 8px", margin:"2px",
                                           borderRadius:6, fontSize:11, fontWeight:600,
                                           color: PROTO_COLORS[p] || "var(--text-2)",
                                           background: "var(--glass-2)",
                                           border: "1px solid var(--hairline-light)" }}>
                              {PROTO_NAMES[p] || p}
                            </span>
                          ))}
                        </td>
                        <td className="t-meta" style={{ padding:"14px 8px" }}>
                          {ago(d.seconds_since_seen)} ago
                        </td>
                        <td style={{ padding:"14px 24px", textAlign:"right" }}>
                          <button onClick={(e)=>{e.stopPropagation(); rowAction(d,"change-role");}} disabled={busy}
                                  className="btn" style={{ padding:"6px 14px", fontSize:12, marginRight:8 }}>
                            Role
                          </button>
                          <button onClick={(e)=>{e.stopPropagation(); rowAction(d,"hide");}} disabled={busy}
                                  className="btn" style={{ padding:"6px 14px", fontSize:12 }}>
                            Hide
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {err && <div style={{ color:"var(--danger)", fontSize:14 }}>⚠ {err}</div>}

      {ctxMenu && (() => {
        const sd = ops.devices.filter(x => selected.has(x.asset_id));
        const sr = Array.from(new Set(sd.map(x => x.role))).sort();
        return (
          <RowActions
            device={ctxMenu.device}
            selectedCount={sd.length}
            selectedRoles={sr}
            x={ctxMenu.x} y={ctxMenu.y}
            onClose={()=>setCtxMenu(null)}
            onChangeRoleOne={(d)=>{ setCtxMenu(null); openRolePickerOne(d); }}
            onHideOne={(d)=>{ setCtxMenu(null); rowAction(d,"hide"); }}
            onApproveOne={(d)=>{ setCtxMenu(null); handleApproveKnown(d); }}
            onDeleteOne={(d)=>{ setCtxMenu(null); handleDelete(d); }}
            onChangeRoleBulk={()=>{ setCtxMenu(null); openRolePickerBulk(); }}
            onHideBulk={()=>{ setCtxMenu(null); hideBulk(); }}
            onApproveBulk={()=>{ setCtxMenu(null); approveBulk(); }}
          />
        );
      })()}

      {rolePicker && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
                      backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
                      display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000 }}
             onClick={()=>!busy && setRolePicker(null)}>
          <div onClick={e=>e.stopPropagation()}
               className="glass-3 float-in"
               style={{ padding:28, width:480, maxWidth:"90vw" }}>
            <div className="t-h2" style={{ marginBottom:8 }}>
              {rolePicker.target === "bulk"
                ? `Change role for ${selected.size} selected device(s)`
                : `Change role for ${rolePicker.device?.ip.replace("/32","")}`}
            </div>
            <div className="t-body" style={{ marginBottom:20 }}>
              Set role + criticality in one action.
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                { r:"plc",                    l:"PLC",                   c:"critical" },
                { r:"hmi",                    l:"HMI",                   c:"high" },
                { r:"rtu",                    l:"RTU",                   c:"high" },
                { r:"sensor",                 l:"Sensor",                c:"medium" },
                { r:"engineering_workstation",l:"Engineering Workstation",c:"medium" },
                { r:"switch",                 l:"Switch / Gateway",      c:"low" },
                { r:"unknown",                l:"Unknown",               c:"unclassified" },
              ].map(o => (
                <button key={o.r} disabled={busy}
                  className="btn"
                  onClick={()=>applyRole(o.r, o.c)}
                  style={{ textAlign:"left", fontSize:14 }}>
                  {o.l}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:20 }}>
              <button className="btn" onClick={()=>setRolePicker(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
