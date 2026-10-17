/**
 * Continuous distinct ECG traces per protocol.
 * Modbus: Heartbeat (fast, steady)
 * S7comm: Sharp spikes (slow, then sudden)
 * DNP3: Slow rolling wave
 * OPC-UA: Square wave (digital)
 */
interface Props {
  protocol: string;
  events: number;
  color: string;
  active: boolean;
}

// Completely different SVG paths for each
const WAVEFORMS: Record<string, string> = {
  // Steady heartbeats
  modbus_tcp: "M0,20 L5,20 L7,18 L9,22 L11,20 L16,20 L18,5 L20,35 L22,20 L28,20 L30,18 L32,22 L34,20 L40,20 L42,5 L44,35 L46,20 L52,20 L54,18 L56,22 L58,20 L64,20 L66,5 L68,35 L70,20 L76,20 L78,18 L80,22 L82,20 L88,20 L90,5 L92,35 L94,20 L100,20",
  
  // Flat... SHARP SPIKE... flat... SHARP SPIKE
  s7comm: "M0,20 L10,20 L10,10 L30,10 L30,30 L50,30 L50,10 L70,10 L70,30 L90,30 L90,20 L100,20",
  
  // Slow rolling sine-like wave
  dnp3: "M0,20 L10,18 L20,25 L30,15 L40,22 L50,10 L60,30 L70,18 L80,25 L90,15 L100,20",
  
  // Digital square wave
  opcua: "M0,20 L10,20 L10,5 L20,5 L20,35 L30,35 L30,5 L40,5 L40,35 L50,35 L50,5 L60,5 L60,35 L70,35 L70,5 L80,5 L80,35 L90,35 L90,5 L100,5"
};

export default function ECGTrace({ protocol, events, color, active }: Props) {
  const path = WAVEFORMS[protocol] || WAVEFORMS.modbus_tcp;

  // Always animate. If active, go faster.
  const speed = !active ? "idle"
              : events > 100 ? "fast"
              : events > 20  ? "normal"
              : "slow";

  const gradientId = `ecg-${protocol}-${color.replace("#","")}`;

  return (
    <div style={{ position: "relative", width: "100%", height: 36, overflow: "hidden",
                  maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
                  WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)" }}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none"
           style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor={color} stopOpacity="0"/>
            <stop offset="30%"  stopColor={color} stopOpacity={active ? 1.0 : 0.6}/>
            <stop offset="70%"  stopColor={color} stopOpacity={active ? 1.0 : 0.6}/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <g className="ecg-track" data-speed={speed}>
          {/* The waveform repeats twice to allow seamless scrolling */}
          <path d={path} fill="none"
                stroke={color}
                strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          <g transform="translate(100,0)">
            <path d={path} fill="none"
                  stroke={color}
                  strokeWidth="2" vectorEffect="non-scaling-stroke"/>
          </g>
        </g>
      </svg>
    </div>
  );
}
