import { createContext, useContext, useEffect, useState, ReactNode } from "react";

const API = "http://localhost:8000";
const LS_KEY = "sot_site_id";

export type Site = { id: string; name: string; created_at: string | null };

type Ctx = {
  sites: Site[];
  currentSite: Site | null;
  loading: boolean;
  error: string | null;
  selectSite: (id: string) => void;
  refreshSites: () => Promise<void>;
};

const SiteCtx = createContext<Ctx | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [currentSite, setCurrentSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshSites() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/v1/sites`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const list: Site[] = data.sites || [];
      setSites(list);
      setError(null);

      // Selection logic:
      //   1. If localStorage has a site_id that exists in list → use it
      //   2. Else if exactly 1 site → select it automatically
      //   3. Else → no selection (user must pick)
      const stored = localStorage.getItem(LS_KEY);
      const storedMatches = list.find(s => s.id === stored);
      if (storedMatches) {
        setCurrentSite(storedMatches);
      } else if (list.length === 1) {
        localStorage.setItem(LS_KEY, list[0].id);
        setCurrentSite(list[0]);
      } else {
        setCurrentSite(null);
      }
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  function selectSite(id: string) {
    const s = sites.find(x => x.id === id);
    if (s) {
      localStorage.setItem(LS_KEY, s.id);
      setCurrentSite(s);
    }
  }

  useEffect(() => { refreshSites(); }, []);

  return (
    <SiteCtx.Provider value={{ sites, currentSite, loading, error, selectSite, refreshSites }}>
      {children}
    </SiteCtx.Provider>
  );
}

export function useSite(): Ctx {
  const ctx = useContext(SiteCtx);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}

export function getCurrentSiteId(): string | null {
  return localStorage.getItem(LS_KEY);
}
