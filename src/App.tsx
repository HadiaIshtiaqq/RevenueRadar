import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  BellRing, HelpCircle, ChevronRight, Compass,
  X, Info, LogOut, Loader2, CheckCircle2, Globe,
} from "lucide-react";
import Sidebar from "./components/Sidebar";
import DashboardView from "./components/DashboardView";
import CompetitorsView from "./components/CompetitorsView";
import AccountsView from "./components/AccountsView";
import AlertsView from "./components/AlertsView";
import SettingsView from "./components/SettingsView";
import ResearchView from "./components/ResearchView";
import LandingPage, { type AuthUser } from "./components/LandingPage";
import { ViewType } from "./types";

const TOKEN_KEY = "rr_token";
const USER_KEY  = "rr_user";

// ─── Discovery Loading Screen ─────────────────────────────────────────────────

function DiscoveryScreen({ user, onDone }: { user: AuthUser; onDone: () => void }) {
  const [step, setStep] = useState(0);

  const steps = [
    { label: "Searching the web for competitors…",                icon: Globe },
    { label: "Analysing market landscape via Bright Data…",       icon: Globe },
    { label: "Ranking competitors by relevance…",                 icon: CheckCircle2 },
    { label: "Discovery running in background — opening workspace…", icon: CheckCircle2 },
  ];

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 1200),
      setTimeout(() => setStep(2), 2600),
      setTimeout(() => setStep(3), 3800),
      setTimeout(() => onDone(),   5000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onDone]);

  return (
    <div className="min-h-screen bg-[#080c18] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md text-center space-y-8"
      >
        {/* Animated radar */}
        <div className="relative w-32 h-32 mx-auto">
          <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20 animate-ping" />
          <div className="absolute inset-4 rounded-full border border-indigo-500/30 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <Globe className="w-8 h-8 text-indigo-400 animate-spin" style={{ animationDuration: "3s" }} />
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-bold text-white mb-2">
            Discovering your competitors, {user.name.split(" ")[0]}
          </h2>
          <p className="text-slate-400 text-sm">
            Scanning the web for companies competing in <span className="text-indigo-400 font-semibold">{user.productNiche}</span>
          </p>
          <p className="text-slate-600 text-xs mt-1">
            Competitor discovery continues in the background — your dashboard will populate as signals arrive.
          </p>
        </div>

        <div className="space-y-3 text-left">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const active = i === step;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: i <= step ? 1 : 0.3, x: 0 }}
                transition={{ delay: i * 0.15 }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                  active ? "bg-indigo-500/10 border-indigo-500/30" :
                  done   ? "bg-white/3 border-white/5" :
                           "border-transparent"
                }`}
              >
                {active ? (
                  <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                ) : done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <Icon className="w-4 h-4 text-slate-600 shrink-0" />
                )}
                <span className={`text-sm ${active ? "text-white font-medium" : done ? "text-slate-300" : "text-slate-600"}`}>
                  {s.label}
                </span>
              </motion.div>
            );
          })}
        </div>

        <p className="text-xs text-slate-600">Powered by Bright Data live web intelligence</p>
      </motion.div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [token,        setToken]        = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user,         setUser]         = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  });
  const [discovering,  setDiscovering]  = useState(false);
  const [currentView,  setView]         = useState<ViewType>("dashboard");
  const [activeEnrichmentDomain,  setActiveEnrichmentDomain]  = useState("stripe.com");
  const [activeCompetitorName,    setActiveCompetitorName]    = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [lastSyncAt,   setLastSyncAt]   = useState<string | null>(null);
  const [syncChecked,  setSyncChecked]  = useState(false);

  // Poll /api/health to get real last-monitor timestamp
  useEffect(() => {
    if (!token) return;
    const check = () =>
      fetch("/api/health")
        .then(r => r.ok ? r.json() : null)
        .then((d: { lastMonitorRan?: string | null } | null) => {
          if (d) { setLastSyncAt(d.lastMonitorRan ?? null); setSyncChecked(true); }
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [token]);

  // Patch global fetch to inject Authorization header for all /api/ calls
  useEffect(() => {
    if (!token) return;
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (url.startsWith("/api/") || url.includes("/api/")) {
        init = { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } };
      }
      return orig(input, init);
    };
    // Validate token on mount — clear if server rejects it
    fetch("/api/auth/me").then(r => { if (!r.ok) handleSignOut(); }).catch(() => {});
    return () => { window.fetch = orig; };
  }, [token]);

  const handleAuth = (newToken: string, newUser: AuthUser, isNewUser = false) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    if (isNewUser) setDiscovering(true);
  };

  const handleSignOut = () => {
    if (token) {
      fetch("/api/auth/signout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setDiscovering(false);
  };

  // Not authenticated — show landing
  if (!token || !user) {
    return (
      <AnimatePresence>
        <motion.div key="landing" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
          <LandingPage onAuth={handleAuth} />
        </motion.div>
      </AnimatePresence>
    );
  }

  // New user — show competitor discovery loading screen
  if (discovering) {
    return <DiscoveryScreen user={user} onDone={() => setDiscovering(false)} />;
  }

  const handleSetEnrichedCompany = (domain: string) => {
    setActiveEnrichmentDomain(domain);
    setView("accounts");
  };

  const handleSetCompetitorName = (name: string) => {
    setActiveCompetitorName(name);
    setView("competitors");
  };

  const renderView = () => {
    switch (currentView) {
      case "dashboard":
        return <DashboardView setView={setView} onSetEnrichedCompany={handleSetEnrichedCompany} onSetCompetitorName={handleSetCompetitorName} user={user} />;
      case "competitors":
        return <CompetitorsView initialCompetitorName={activeCompetitorName} />;
      case "accounts":
        return <AccountsView initialDomain={activeEnrichmentDomain} />;
      case "alerts":
        return <AlertsView />;
      case "research":
        return <ResearchView />;
      case "settings":
        return <SettingsView user={user} onUserUpdate={(updated) => {
          setUser(updated);
          localStorage.setItem(USER_KEY, JSON.stringify(updated));
        }} />;
      default:
        return <div className="text-center py-20 text-slate-500">View under development.</div>;
    }
  };

  return (
    <div className="flex bg-[#F8FAFC] text-slate-900 min-h-screen font-sans antialiased overflow-hidden">
      <Sidebar currentView={currentView} setView={setView} hasUnreadAlerts={true} onGoToLanding={handleSignOut} user={user} />

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <header id="app-top-header" className="h-16 border-b border-slate-200 px-8 flex items-center justify-between bg-white shadow-sm relative z-30 shrink-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <Compass className="w-4 h-4 text-indigo-600" />
            <span className="font-bold text-slate-700">RevenueRadar</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
            <span className="text-indigo-600 capitalize font-semibold">{currentView}</span>
          </div>

          <div className="flex items-center gap-4">
            {syncChecked ? (
              lastSyncAt ? (
                <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 px-3 py-1 rounded-full uppercase leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Signals Live · {(() => { const d = lastSyncAt!; const t = new Date(d.includes("T") ? d : d.replace(" ", "T") + "Z").getTime(); const s = Math.floor((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s/60)}m ago` : `${Math.floor(s/3600)}h ago`; })()}
                </div>
              ) : (
                <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full uppercase leading-none">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  Monitor Starting…
                </div>
              )
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-3 py-1 rounded-full uppercase leading-none">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                Connecting…
              </div>
            )}

            {/* User badge */}
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5">
              <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-[10px]">
                {user.name[0]?.toUpperCase()}
              </div>
              <span className="font-medium text-slate-700 hidden md:block">{user.name}</span>
            </div>

            <button onClick={() => setShowHelpModal(true)} className="text-slate-400 hover:text-indigo-600 transition-colors" title="Help">
              <HelpCircle className="w-4.5 h-4.5" />
            </button>

            <div onClick={() => setView("alerts")} className="relative cursor-pointer text-slate-400 hover:text-indigo-600 transition-colors" title="Alerts">
              <BellRing className="w-4.5 h-4.5" />
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white animate-bounce" />
            </div>

            <button onClick={handleSignOut} className="text-slate-400 hover:text-red-500 transition-colors" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8 relative z-10">
          <AnimatePresence mode="wait">
            <motion.div key={currentView} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25, ease: "easeOut" }} className="h-full">
              {renderView()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Help Modal */}
      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowHelpModal(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md relative z-10 shadow-2xl space-y-4">
              <button onClick={() => setShowHelpModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
              <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 shrink-0">
                  <Info className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">RevenueRadar Intelligence</h3>
                  <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase">V1.4 Sentinel Suite</p>
                </div>
              </div>
              <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                <p>Monitoring <strong>{user.productName}</strong> against competitors in <strong>{user.productNiche}</strong>.</p>
                <p>RevenueRadar leverages Bright Data's proxy network for real-time web intelligence and AI (AIML API) for signal synthesis and battlecard generation.</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[11px] leading-snug text-slate-500 font-medium">
                  <strong>Signed in as:</strong> {user.email}
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setShowHelpModal(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded-lg text-xs">
                  Got it
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
