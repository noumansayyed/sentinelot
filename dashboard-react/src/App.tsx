import { useState } from "react";
import LiveView from "./LiveView";
import HistoryView from "./HistoryView";

export default function App() {
  const [tab, setTab] = useState<"live" | "history">("live");
  const navItem = (id: "live" | "history", label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        tab === id ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-screen bg-[#0a0b0d] text-slate-100">
      <aside className="w-56 shrink-0 border-r border-slate-800 p-4 flex flex-col gap-1">
        <div className="px-2 py-3 mb-2">
          <div className="text-lg font-bold">SentinelOT</div>
          <div className="text-xs text-slate-500">Pune Pilot Plant</div>
        </div>
        {navItem("live", "Live Monitoring")}
        {navItem("history", "History & Trends")}
        <a href="/reports/compliance_report.html" target="_blank"
          className="px-4 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors">
          Compliance Report ↗
        </a>
        <div className="mt-auto px-2 py-3 text-xs text-slate-600 border-t border-slate-800 pt-4">
          OT/IIoT Passive Monitoring<br />4 protocols · dual-engine detection
        </div>
      </aside>
      <main className="flex-1 p-6 overflow-x-hidden">
        {tab === "live" ? <LiveView /> : <HistoryView />}
      </main>
    </div>
  );
}
