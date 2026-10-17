import { useEffect, useState } from "react";

type Theme = "dark" | "light";
const KEY = "sot_theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem(KEY) as Theme) || "dark"
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);
  return { theme, setTheme };
}

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button onClick={() => setTheme(next)}
      title={`Switch to ${next} theme`}
      style={{ background: "transparent", border: "1px solid var(--border-light)",
               borderRadius: 8, padding: "6px 10px", cursor: "pointer",
               color: "var(--text-2)", fontSize: 13 }}>
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
