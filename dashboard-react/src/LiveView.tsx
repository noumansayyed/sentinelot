import { useEffect, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { fetchAlerts, fetchAssets, acknowledgeAlert, Alert, Asset } from "./api";

function detectionMethod(desc: string): string {
  if (desc.startsWith("[Suricata signature match]")) return "Suricata — signature match";
  if (desc.startsWith("Behavioral anomaly")) return "Welford's algorithm — statistical baseline deviation";
  if (desc.startsWith("New device seen")) return "Zeek — new device discovery rule";
  if (desc.startsWith("Unauthorized write")) return "Zeek — behavioral rule (first-ever write)";
  return "Zeek — rule-based detection";
}
function recommendedAction(a: Alert): string {
  if (a.llm_explanation) {
    const s = a.llm_explanation.split(/(?<=[.!?])\s+/);
    const last = s[s.length - 1];
    return last && last.length > 15 ? last : a.llm_explanation;
  }
  return "Explanation pending from AI triage layer...";
}
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const sevClasses: Record<string, { text: string; border: string; bg: string; dot: string }> = {
  critical: { text: "text-red-400", border: "border-red-500/40", bg: "bg-red-500/10", dot: "bg-red-500" },
  high: { text: "text-orange-400", border: "border-orange-500/40", bg: "bg-orange-500/10", dot: "bg-orange-500" },
  medium: { text: "text-yellow-400", border: "border-yellow-500/40", bg: "bg-yellow-500/10", dot: "bg-yellow-500" },
  low: { text: "text-blue-400", border: "border-blue-500/40", bg: "bg-blue-500/10", dot: "bg-blue-500" },
};

export default function LiveView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);
  // Real, since-page-load sparkline of open-alert count -- genuine observed
  // trend, not fabricated history, clearly scoped to "this session."
  const [sparkline, setSparkline] = useState<{ t: string; count: number }[]>([]);
  const startTime = useRef(Date.now());

  async function refresh() {
    try {
      const [a, s] = await Promise.all([fetchAlerts(), fetchAssets()]);
      setAlerts(a); setAssets(s);
      const now = new Date();
      setLastUpdated(now.toLocaleTimeString());
      setSparkline(prev => [...prev, { t: now.toLocaleTimeString(), count: a.filter(x => x.status === "open").length }].slice(-30));
      setError("");
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, []);

  const open = alerts.filter(a => a.status === "open");
  const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  open.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });
  const liveDevices = assets.filter(a => (Date.now() - new Date(a.last_seen).getTime()) / 1000 < 15).length;
  const sessionMinutes = Math.max(1, Math.round((Date.now() - startTime.current) / 60000));

  const StatCard = ({ label, value, accent }: { label: string; value: string | number; accent: string }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Live Monitoring</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
            <span className="text-emerald-400 text-xs font-semibold">LIVE</span>
            <span className="text-slate-500 text-xs">refreshing every 3s · last update {lastUpdated}</span>
          </div>
        </div>
        {counts.critical + counts.high > 0 && (
          <span className="bg-red-500/15 text-red-400 border border-red-500/30 px-3 py-1.5 rounded-full text-xs font-semibold animate-pulse">
            🔔 {counts.critical + counts.high} high-priority alert{counts.critical + counts.high > 1 ? "s" : ""} need attention
          </span>
        )}
      </div>
      {error && <div className="text-red-400 text-sm">Connection error: {error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard label="Devices Monitored" value={assets.length} accent="text-blue-400" />
        <StatCard label="Active Now" value={liveDevices} accent="text-emerald-400" />
        <StatCard label="Open Alerts" value={open.length} accent="text-slate-100" />
        <StatCard label="Critical" value={counts.critical} accent="text-red-400" />
        <StatCard label="High" value={counts.high} accent="text-orange-400" />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="text-sm font-semibold text-slate-300 mb-1">Open Alert Count — This Session</div>
        <div className="text-xs text-slate-500 mb-3">Live observed trend since dashboard opened ({sessionMinutes} min ago) — not historical, not predicted</div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={sparkline}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="t" stroke="#64748b" fontSize={10} interval="preserveStartEnd" />
            <YAxis stroke="#64748b" fontSize={10} allowDecimals={false} width={24} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={true} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {assets.map(asset => {
          const deviceAlerts = open.filter(a => a.description.includes(asset.ip_address));
          const isLive = (Date.now() - new Date(asset.last_seen).getTime()) / 1000 < 15;
          const worst = deviceAlerts.reduce((w, a) => {
            const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
            return (rank[a.severity] || 0) > (rank[w] || 0) ? a.severity : w;
          }, "");
          const isExpanded = expanded === asset.ip_address;
          const sc = worst ? sevClasses[worst] : null;

          return (
            <div key={asset.ip_address} className={`rounded-xl border bg-slate-900/60 p-5 transition-colors hover:border-slate-600 ${sc ? sc.border : "border-slate-800"}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      {isLive && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${isLive ? "bg-emerald-400" : "bg-slate-600"}`}></span>
                    </span>
                    <span className="font-mono font-bold text-base">{asset.ip_address}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {(asset.protocols || []).join(", ") || "protocol unknown"} · {isLive ? "active now" : `last seen ${timeAgo(asset.last_seen)}`}
                  </div>
                </div>
                {deviceAlerts.length > 0 ? (
                  <span className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full ${sc!.bg} ${sc!.text}`}>{deviceAlerts.length} alert{deviceAlerts.length > 1 ? "s" : ""}</span>
                ) : (
                  <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400">Normal</span>
                )}
              </div>
              {deviceAlerts.length > 0 && (
                <button onClick={() => setExpanded(isExpanded ? null : asset.ip_address)}
                  className="mt-3 w-full text-xs text-slate-400 border border-slate-800 rounded-lg py-1.5 hover:bg-slate-800/50 hover:text-slate-200 transition-colors">
                  {isExpanded ? "Hide details ▲" : "View alert details ▼"}
                </button>
              )}
              {isExpanded && deviceAlerts.map(a => {
                const asc = sevClasses[a.severity];
                return (
                  <div key={a.id} className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                    <div className="flex justify-between">
                      <span className={`text-xs font-bold uppercase ${asc.text}`}>{a.severity}</span>
                      <span className="text-xs text-slate-500">{timeAgo(a.time)}</span>
                    </div>
                    <div className="text-sm">{a.description}</div>
                    <div className="text-xs text-blue-400">Detected by: {detectionMethod(a.description)}</div>
                    <div className="text-xs text-slate-400 bg-slate-950 rounded-lg p-2.5">
                      <span className="text-slate-300 font-medium">Recommended action: </span>{recommendedAction(a)}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => acknowledgeAlert(a.id, "acknowledged").then(refresh)}
                        className="flex-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg py-1.5 transition-colors">
                        Acknowledge
                      </button>
                      <button onClick={() => acknowledgeAlert(a.id, "resolved").then(refresh)}
                        className="flex-1 text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 rounded-lg py-1.5 transition-colors">
                        Resolve
                      </button>
                      <button onClick={() => acknowledgeAlert(a.id, "false_positive").then(refresh)}
                        className="flex-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-500 rounded-lg py-1.5 transition-colors">
                        False Positive
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {assets.length === 0 && <div className="text-slate-600 italic">No devices discovered yet.</div>}
    </div>
  );
}
