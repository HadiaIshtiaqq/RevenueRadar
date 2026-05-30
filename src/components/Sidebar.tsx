import { useState, useEffect } from "react";
import { LayoutDashboard, Swords, Building2, BellRing, Settings, ArrowUpRight, FlaskConical } from "lucide-react";
import { ViewType } from "../types";
import { LogoFull } from "./Logo";

interface SidebarProps {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  hasUnreadAlerts?: boolean;
  onGoToLanding?: () => void;
  user?: { name: string; email: string; productName?: string } | null;
}

const NAV = [
  { id: "dashboard"   as ViewType, label: "Dashboard",   icon: LayoutDashboard },
  { id: "competitors" as ViewType, label: "Competitors",  icon: Swords,        badge: "Threats" },
  { id: "accounts"    as ViewType, label: "Accounts",     icon: Building2 },
  { id: "research"    as ViewType, label: "Research",     icon: FlaskConical },
  { id: "alerts"      as ViewType, label: "Alerts",       icon: BellRing,      isAlert: true },
  { id: "settings"    as ViewType, label: "Settings",     icon: Settings },
];

export default function Sidebar({ currentView, setView, hasUnreadAlerts = true, onGoToLanding, user }: SidebarProps) {
  const [competitorCount, setCompetitorCount] = useState(0);
  const [changeCount,     setChangeCount]     = useState(0);
  const [liveToday,       setLiveToday]       = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [compsRes, changesRes, trendRes] = await Promise.all([
          fetch("/api/competitors"),
          fetch("/api/intelligence/changes"),
          fetch("/api/intelligence/trend?days=1"),
        ]);
        if (compsRes.ok)   { const d = await compsRes.json();   setCompetitorCount((d.data ?? d).length ?? 0); }
        if (changesRes.ok) { const d = await changesRes.json(); setChangeCount((d.data ?? d).length ?? 0); }
        if (trendRes.ok)   { const d = await trendRes.json();   setLiveToday((d.data?.[0]?.count ?? 0)); }
      } catch { /* silent */ }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="w-64 bg-white border-r border-slate-100 flex flex-col h-screen sticky top-0 shrink-0 shadow-sm">

      {/* ── Logo header ─────────────────────────────────────────────────── */}
      <button
        onClick={onGoToLanding}
        className="p-5 border-b border-slate-100 text-left hover:bg-slate-50/50 transition-colors group"
      >
        <LogoFull />
        <p className="text-[10px] text-slate-400 mt-2.5 font-medium leading-tight">
          GTM intelligence, real-time web signals, AI battlecards
        </p>
      </button>

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 pb-2">Workspace</p>
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 group ${
                active
                  ? "bg-indigo-50 text-indigo-700 shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 transition-colors ${
                    active ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"
                  }`}
                />
                {item.label}
              </div>

              {item.badge && (
                <span className="text-[9px] font-bold bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                  {item.badge}
                </span>
              )}
              {item.isAlert && hasUnreadAlerts && (
                <span className="flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600" />
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Status banner ───────────────────────────────────────────────── */}
      <div className="mx-3 mb-3 px-3 py-2.5 bg-emerald-50 border border-emerald-100 rounded-xl">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">Signals Active</span>
        </div>
        <p className="text-[10px] text-emerald-600 mt-0.5 font-medium">
          Monitoring {competitorCount} competitor{competitorCount !== 1 ? "s" : ""} · {changeCount} change{changeCount !== 1 ? "s" : ""} detected
        </p>
        {liveToday > 0 && (
          <p className="text-[10px] font-bold text-emerald-700 mt-0.5 flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-500 animate-ping inline-block" />
            {liveToday} live signal{liveToday !== 1 ? "s" : ""} detected today
          </p>
        )}
      </div>

      {/* ── User footer ─────────────────────────────────────────────────── */}
      {user && (
        <div className="p-3 border-t border-slate-100">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-bold shadow">
                {user.name?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div className="absolute bottom-0 right-0 w-2 h-2 bg-emerald-500 rounded-full border-2 border-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-400 truncate flex items-center gap-0.5">
                {user.productName ?? user.email} <ArrowUpRight className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
