import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchAlerts, Alert } from "./api";

export default function HistoryView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { fetchAlerts().then(setAlerts); }, []);

  const bySeverity: Record<string, number> = {};
  alerts.forEach(a => { bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1; });
  const severityData = Object.entries(bySeverity).map(([severity, count]) => ({ severity, count }));

  const byDay: Record<string, number> = {};
  alerts.forEach(a => { const d = new Date(a.time).toLocaleDateString(); byDay[d] = (byDay[d] || 0) + 1; });
  const trendData = Object.entries(byDay).map(([day, count]) => ({ day, count })).reverse();
  const firstDate = alerts.length ? new Date(Math.min(...alerts.map(a => new Date(a.time).getTime()))).toLocaleDateString() : "-";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">History &amp; Trends</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="h-2 w-2 rounded-full bg-blue-400"></span>
          <span className="text-blue-400 text-xs font-semibold">HISTORICAL RECORD</span>
          <span className="text-slate-500 text-xs">data recorded since {firstDate} — not live, does not auto-refresh</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="text-sm font-semibold text-slate-300 mb-3">Alert Volume Over Time</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trendData}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }} />
            <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="text-sm font-semibold text-slate-300 mb-3">Alerts by Severity (total, all recorded)</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={severityData}>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="severity" stroke="#64748b" fontSize={11} />
            <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }} />
            <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="text-sm font-semibold text-slate-300 mb-3">Full Alert History ({alerts.length} records)</div>
        <div className="max-h-96 overflow-y-auto">
          {alerts.map((a, i) => (
            <div key={a.id} className={`flex gap-3 py-2 text-xs ${i === 0 ? "" : "border-t border-slate-800"}`}>
              <span className="text-slate-600 w-6">{i + 1}</span>
              <span className="text-slate-500 w-40 shrink-0">{new Date(a.time).toLocaleString()}</span>
              <span className="w-16 shrink-0 uppercase font-semibold text-slate-400">{a.severity}</span>
              <span className="text-slate-300">{a.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
