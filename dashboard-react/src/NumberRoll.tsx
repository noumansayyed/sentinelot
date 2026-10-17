import { useEffect, useRef, useState } from "react";

export default function NumberRoll({ value, duration = 500, className = "" }: {
  value: number; duration?: number; className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = prev.current;
    const end = value;
    const t0 = performance.now();
    if (start === end) return;

    function tick(now: number) {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else prev.current = end;
    }
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value, duration]);

  return <span className={className}>{display.toLocaleString()}</span>;
}
