import { useEffect, useState } from "react";

const API = "http://localhost:8000";

type Setting = { key: string; value: any; updated_at: string };

type SaveState = "idle" | "saving" | "saved" | "failed";
type SectionState = { status: SaveState; message?: string };

export default function SettingsView({ card }: { card: React.CSSProperties }) {
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState<Record<string, any>>({});
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [detectionState, setDetectionState] = useState<SectionState>({ status: "idle" });
  const [captureState, setCaptureState] = useState<SectionState>({ status: "idle" });
  const [retentionState, setRetentionState] = useState<SectionState>({ status: "idle" });

  const DETECTION_KEYS = [
    "detection.off_hours_start",
    "detection.off_hours_end",
    "detection.zscore_threshold",
    "detection.baseline_min_samples",
    "detection.enabled_protocols",
  ];
  const CAPTURE_KEYS = ["capture.interface"];
  const RETENTION_KEYS = ["retention.events_days"];

  async function load() {
    setLoading(true);
    try {
      const [s, i] = await Promise.all([
        fetch(`${API}/v1/settings`).then(r => r.json()),
        fetch(`${API}/v1/settings/interfaces`).then(r => r.json()),
      ]);
      const map: Record<string, any> = {};
      (s as Setting[]).forEach(x => { map[x.key] = x.value; });
      setDraft({ ...map });
      setSaved({ ...map });
      setInterfaces(i.interfaces || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function setField(key: string, value: any) {
    setDraft(d => ({ ...d, [key]: value }));
    // clear previous section status when user edits
    if (DETECTION_KEYS.includes(key)) setDetectionState({ status: "idle" });
    if (CAPTURE_KEYS.includes(key)) setCaptureState({ status: "idle" });
    if (RETENTION_KEYS.includes(key)) setRetentionState({ status: "idle" });
  }

  function dirtyCount(keys: string[]): number {
    return keys.filter(k => JSON.stringify(draft[k]) !== JSON.stringify(saved[k])).length;
  }

  async function saveSection(keys: string[], setState: (s: SectionState) => void) {
    const changes = keys.filter(k => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
    if (changes.length === 0) return;
    setState({ status: "saving", message: `saving ${changes.length}…` });
    try {
      await Promise.all(changes.map(k =>
        fetch(`${API}/v1/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: k, value: draft[k] }),
        }).then(r => { if (!r.ok) throw new Error(`${k}: ${r.status}`); })
      ));
      const nextSaved = { ...saved };
      changes.forEach(k => { nextSaved[k] = draft[k]; });
      setSaved(nextSaved);
      setState({ status: "saved", message: `${changes.length} applied live` });
      setTimeout(() => setState({ status: "idle" }), 3000);
    } catch (e: any) {
      setState({ status: "failed", message: String(e.message || e) });
    }
  }

  async function restartSensor() {
    setCaptureState({ status: "saving", message: "restarting sensor…" });
    try {
      const r = await fetch(`${API}/v1/settings/restart-sensor`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setCaptureState({ status: "saved", message: `sensor recreated on ${j.interface} — wait 25s` });
      setTimeout(() => setCaptureState({ status: "idle" }), 8000);
    } catch (e: any) {
      setCaptureState({ status: "failed", message: String(e.message || e) });
    }
  }

  async function saveCaptureAndRestart() {
    setCaptureState({ status: "saving", message: "saving + restarting sensor…" });
    try {
      // 1) Save the interface setting
      const put = await fetch(`${API}/v1/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "capture.interface", value: draft["capture.interface"] }),
      });
      if (!put.ok) throw new Error(`save failed: ${put.status}`);
      setSaved(s => ({ ...s, "capture.interface": draft["capture.interface"] }));
      // 2) Restart the sensor with the saved interface
      const r = await fetch(`${API}/v1/settings/restart-sensor`, { method: "POST" });
      if (!r.ok) throw new Error(`restart failed: ${r.status}`);
      const j = await r.json();
      setCaptureState({ status: "saved", message: `saved · sensor on ${j.interface} — wait 25s` });
      setTimeout(() => setCaptureState({ status: "idle" }), 10000);
    } catch (e: any) {
      setCaptureState({ status: "failed", message: String(e.message || e) });
    }
  }

  async function purgeOldEvents() {
    const days = draft["retention.events_days"] ?? 30;
    if (!confirm(`Purge protocol_events older than ${days} days? This cannot be undone.`)) return;
    setRetentionState({ status: "saving", message: `purging >${days}d…` });
    try {
      const r = await fetch(`${API}/v1/settings/purge-events?days=${days}`, { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRetentionState({ status: "saved", message: `deleted: ${j.deleted}` });
      setTimeout(() => setRetentionState({ status: "idle" }), 4000);
    } catch (e: any) {
      setRetentionState({ status: "failed", message: String(e.message || e) });
    }
  }

  if (loading) return <div style={{ padding: 24 }}>Loading settings…</div>;

  // ── Styles ────────────────────────────────────────────────────────────
  const sectionTitle: React.CSSProperties = {
    fontSize: 13, fontWeight: 700, color: "var(--text-2)",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  };
  const row: React.CSSProperties = {
    display: "grid", gridTemplateColumns: "280px 1fr", gap: 16,
    padding: "12px 16px", borderBottom: "1px solid var(--hairline-soft)",
    alignItems: "center",
  };
  const inputStyle: React.CSSProperties = {
    padding: "8px 10px", borderRadius: 6, border: "1px solid var(--hairline)",
    background: "var(--bg-1)", color: "var(--text-1)", fontSize: 13,
    width: 240,
  };
  const footer: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12,
    padding: "14px 16px", borderTop: "1px solid var(--hairline-soft)",
  };

  function SectionStatus({ state }: { state: SectionState }) {
    if (state.status === "idle") return null;
    const color =
      state.status === "saving" ? "var(--text-3)" :
      state.status === "saved"  ? "#22c55e" :
      "#ef4444";
    const icon =
      state.status === "saving" ? "⏳" :
      state.status === "saved"  ? "✓" :
      "✗";
    return (
      <span style={{ color, fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}>
        {icon} {state.message}
      </span>
    );
  }

  function SaveButton({
    section, keys, state, setState, onClick,
  }: {
    section: string; keys: string[]; state: SectionState;
    setState: (s: SectionState) => void;
    onClick?: () => void;
  }) {
    const dirty = dirtyCount(keys);
    const disabled = state.status === "saving" || dirty === 0;
    const label = state.status === "saving" ? "Saving…"
      : dirty > 0 ? `Save & Apply ${section} (${dirty} change${dirty === 1 ? "" : "s"})`
      : `Save & Apply ${section}`;
    return (
      <button
        className={`btn ${dirty > 0 ? "btn-primary" : ""}`}
        disabled={disabled}
        onClick={() => onClick ? onClick() : saveSection(keys, setState)}
        style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
      >
        {label}
      </button>
    );
  }

  // ── Field renderers ───────────────────────────────────────────────────
  function protocolsFieldWithSave(
    key: string, label: string, help: string,
    saveButton: React.ReactNode, status: React.ReactNode,
  ) {
    let raw = draft[key];
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    const current: string[] = Array.isArray(raw) ? raw : [];
    const all = ["modbus_tcp", "s7comm", "dnp3", "opcua"];
    return (
      <div style={row} key={key}>
        <div>
          <div style={{ fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{help}</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12 }}>
            {all.map(p => (
              <label key={p} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={current.includes(p)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...current, p]
                      : current.filter(x => x !== p);
                    setField(key, next);
                  }}
                />
                {p}
              </label>
            ))}
          </div>
          {saveButton}
          {status}
        </div>
      </div>
    );
  }

  function textField(key: string, label: string, help: string) {
    return (
      <div style={row} key={key}>
        <div>
          <div style={{ fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{help}</div>
        </div>
        <input
          style={inputStyle}
          value={draft[key] ?? ""}
          onChange={e => setField(key, e.target.value)}
        />
      </div>
    );
  }

  function numField(key: string, label: string, help: string) {
    return (
      <div style={row} key={key}>
        <div>
          <div style={{ fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{help}</div>
        </div>
        <input
          type="number" step="0.1"
          style={inputStyle}
          value={draft[key] ?? 0}
          onChange={e => setField(key, parseFloat(e.target.value) || 0)}
        />
      </div>
    );
  }

  function protocolsField(key: string, label: string, help: string) {
    // Coerce: API may return a JSON string or an array depending on encoding
    let raw = draft[key];
    if (typeof raw === "string") {
      try { raw = JSON.parse(raw); } catch { raw = []; }
    }
    const current: string[] = Array.isArray(raw) ? raw : [];
    const all = ["modbus_tcp", "s7comm", "dnp3", "opcua"];
    return (
      <div style={row} key={key}>
        <div>
          <div style={{ fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{help}</div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {all.map(p => (
            <label key={p} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={current.includes(p)}
                onChange={e => {
                  const next = e.target.checked
                    ? [...current, p]
                    : current.filter(x => x !== p);
                  setField(key, next);
                }}
              />
              {p}
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 className="t-h1" style={{ margin: 0 }}>Settings</h1>
        <div className="t-meta" style={{ marginTop: 8 }}>
          Runtime configuration. Each section saves independently. Changes apply within 10 seconds (settings cache).
        </div>
      </div>

      {/* Detection */}
      <div className="glass" style={{ padding: 0 }}>
        <div style={{ padding: "16px 16px 8px 16px", ...sectionTitle }}>Detection</div>
        {textField("detection.off_hours_start", "Off-hours start", "HH:MM (24-hour). Alerts fire 'critical' between start and end, 'high' otherwise.")}
        {textField("detection.off_hours_end", "Off-hours end", "HH:MM (24-hour).")}
        {numField("detection.zscore_threshold", "Z-score threshold", "Statistical anomaly threshold. Default 3.0–4.5 depending on noise tolerance.")}
        {numField("detection.baseline_min_samples", "Baseline min samples", "Minimum events before anomaly baseline engages. Default 30.")}
        {protocolsFieldWithSave(
          "detection.enabled_protocols",
          "Enabled protocols",
          "Protocols that can trigger protocol-activity alerts.",
          <SaveButton section="Detection" keys={DETECTION_KEYS} state={detectionState} setState={setDetectionState} />,
          <SectionStatus state={detectionState} />
        )}
      </div>

      {/* Capture */}
      <div className="glass" style={{ padding: 0 }}>
        <div style={{ padding: "16px 16px 8px 16px", ...sectionTitle }}>Capture</div>
        <div style={row}>
          <div>
            <div style={{ fontWeight: 500 }}>Capture interface</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              Which interface Zeek sniffs. In production this is your SPAN/mirror port. In the lab, usually <code>eth0</code>.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              style={inputStyle}
              value={draft["capture.interface"] ?? "eth0"}
              onChange={e => setField("capture.interface", e.target.value)}
            >
              {interfaces.length === 0 && <option value="eth0">eth0</option>}
              {interfaces.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <button
              className={`btn ${dirtyCount(CAPTURE_KEYS) > 0 ? "btn-primary" : ""}`}
              onClick={saveCaptureAndRestart}
              disabled={captureState.status === "saving" || dirtyCount(CAPTURE_KEYS) === 0}
              style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600 }}
            >
              {captureState.status === "saving" ? "Saving…"
                : dirtyCount(CAPTURE_KEYS) > 0
                  ? `Save & Apply & Restart (${dirtyCount(CAPTURE_KEYS)} change${dirtyCount(CAPTURE_KEYS) === 1 ? "" : "s"})`
                  : "Save & Apply & Restart"}
            </button>
            <SectionStatus state={captureState} />
          </div>
        </div>
      </div>

      {/* Retention */}
      <div className="glass" style={{ padding: 0 }}>
        <div style={{ padding: "16px 16px 8px 16px", ...sectionTitle }}>Retention</div>
        {numField("retention.events_days", "Keep events for (days)", "Older protocol_events are eligible for the purge action below.")}
        <div style={row}>
          <div>
            <div style={{ fontWeight: 500 }}>Purge old events</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              Deletes protocol_events older than the retention window. Assets, alerts, and findings are kept. Cannot be undone.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="btn"
              onClick={purgeOldEvents}
              disabled={retentionState.status === "saving"}
              style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, borderColor: "#ef4444", color: "#ef4444" }}
            >
              Purge old events
            </button>
            <SaveButton section="Retention" keys={RETENTION_KEYS} state={retentionState} setState={setRetentionState} />
            <SectionStatus state={retentionState} />
          </div>
        </div>
      </div>

      <div className="t-meta" style={{ fontSize: 12, color: "var(--text-3)" }}>
        Every setting is read by the detectors on each event (10s cache). No page reload needed after save.
      </div>
    </div>
  );
}
