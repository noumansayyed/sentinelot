import { useEffect, useRef } from "react";
import { OpDevice } from "./api";

interface Props {
  device: OpDevice;
  selectedCount: number;
  selectedRoles: string[];
  x: number;
  y: number;
  onClose: () => void;
  onChangeRoleOne: (d: OpDevice) => void;
  onHideOne:       (d: OpDevice) => void;
  onApproveOne:    (d: OpDevice) => void;
  onDeleteOne:     (d: OpDevice) => void;
  onChangeRoleBulk: () => void;
  onHideBulk:       () => void;
  onApproveBulk:    () => void;
}

export default function RowActions(props: Props) {
  const { device, selectedCount, selectedRoles, x, y, onClose,
          onChangeRoleOne, onHideOne, onApproveOne, onDeleteOne,
          onChangeRoleBulk, onHideBulk, onApproveBulk } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: "fixed",
    top: Math.min(y, window.innerHeight - 320),
    left: Math.min(x, window.innerWidth - 300),
    background: "var(--glass-3)",
    backdropFilter: "blur(60px) saturate(180%)",
    WebkitBackdropFilter: "blur(60px) saturate(180%)",
    border: "1px solid var(--hairline-strong)",
    borderRadius: 14,
    padding: 8,
    minWidth: 260,
    zIndex: 9999,
    boxShadow: "var(--shadow-lg)",
  };

  const item = (label: string, color: string, fn: () => void, disabled = false) => (
    <button
      onClick={() => { if (!disabled) { fn(); onClose(); } }}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "12px 16px",
        borderRadius: 8,
        background: "transparent",
        border: "none",
        color: disabled ? "var(--text-4)" : color,
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "var(--font-sans)",
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </button>
  );

  const divider = () => (
    <div style={{ height: 1, background: "var(--hairline-light)", margin: "6px 0" }} />
  );

  const isBulk = selectedCount > 1;
  const mixedRoles = selectedRoles.length > 1;

  return (
    <div ref={ref} style={style}>
      {/* header */}
      <div style={{
        padding: "10px 16px",
        fontSize: 12,
        color: "var(--text-3)",
        borderBottom: "1px solid var(--hairline-light)",
        marginBottom: 6,
      }}>
        {isBulk ? (
          <>
            <div style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14 }}>
              {selectedCount} devices selected
            </div>
            <div style={{ fontFamily: "var(--font-mono)", marginTop: 4 }}>
              {selectedRoles.join(" · ")}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: "var(--font-mono)", color: "var(--text-1)", fontSize: 13 }}>
            {device.ip.replace("/32", "")} · {device.role}
          </div>
        )}
      </div>

      {isBulk ? (
        <>
          {item("Change role for all " + selectedCount + "…", "var(--accent)", onChangeRoleBulk, mixedRoles)}
          {mixedRoles && (
            <div style={{ padding: "4px 16px 10px", fontSize: 11, color: "var(--warning)", lineHeight: 1.4 }}>
              ✕ Mixed roles in selection — filter to one role to bulk-change.
            </div>
          )}
          {item("Approve all " + selectedCount + " as known", "var(--success)", onApproveBulk)}
          {item("Hide all " + selectedCount + "…", "var(--text-3)", onHideBulk)}
        </>
      ) : (
        <>
          {item("Change role…", "var(--accent)", () => onChangeRoleOne(device))}
          {item("Approve as known", "var(--success)", () => onApproveOne(device))}
          {item("Hide device…", "var(--text-3)", () => onHideOne(device))}
          {divider()}
          {item("Delete device", "var(--danger)", () => onDeleteOne(device))}
        </>
      )}
    </div>
  );
}
