/**
 * Protocol-specific ECG trace.
 * Modbus = steady high-freq; S7 = bursty; DNP3 = regular heartbeats; OPC = irregular.
 */
interface Props {
  protocol: string;       // "modbus_tcp" | "s7comm" | "dnp3" | "opcua"
  events: number;         // events in last 30s
  color: string;
  active: boolean;
}

// Different waveform per protocol — like a real ICU monitor
const WAVEFORMS: Record<string, string> = {
  modbus_tcp: "M0,20 L6,20 L8,18 L10,22 L12,20 L18,20 L20,10 L22,30 L24,20 L30,20 L32,18 L34,22 L36,20 L42,20 L44,10 L46,30 L48,20 L54,20 L56,18 L58,22 L60,20 L66,20 L68,10 L70,30 L72,20 L78,20 L80,18 L82,22 L84,20 L90,20 L92,10 L94,30 L96,20 L100,20",
  s7comm:     "M0,20 L20,20 L25,5 L30,35 L35,20 L50,20 L55,10 L60,30 L65,20 L80,20 L85,5 L90,35 L95,20 L100,20",
  dnp3:       "M0,20 L15,20 L18,15 L20,25 L22,20 L35,20 L38,20 L40,5 L42,35 L44,20 L60,20 L63,15 L65,25 L67,20 L80,20 L83,20 L85,5 L87,35 L89,20 L100,20",
  opcua:      "M0,20 L10,20 L15,12 L20,28 L25,20 L40,20 L45,18 L50,22 L55,20 L70,20 L75,8 L80,32 L85,20 L95,20 L100,20",
};

export default function ECGTrace({ protocol, events, color, active }: Props) {
  const path = WAVEFORMS[protocol] || WAVEFORMS.modbus_tcp;

  // Animation speed scales with event rate
  const speed = !active ? "idle"
              : events > 100 ? "fast"
              : events > 20  ? "normal"
              : "slow";

  // Gradient id per protocol color
  const gradientId = `ecg-${protocol}-${color.replace("#","")}`;

  return (
    <div style={{ position: "relative", width: "100%", height: 36, overflow: "hidden",
                  maskImage: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)",
                  WebkitMaskImage: "linear-gradient(90deg, transparent, black 15%, black 85%, transparent)" }}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none"
           style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor={color} stopOpacity="0"/>
            <stop offset="30%"  stopColor={color} stopOpacity={active ? 0.9 : 0.2}/>
            <stop offset="70%"  stopColor={color} stopOpacity={active ? 0.9 : 0.2}/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <g className="ecg-track" data-speed={speed}>
          <path d={path} fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth="0.9" vectorEffect="non-scaling-stroke"/>
          <g transform="translate(100,0)">
            <path d={path} fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth="0.9" vectorEffect="non-scaling-stroke"/>
          </g>
        </g>
      </svg>
    </div>
  );
}
