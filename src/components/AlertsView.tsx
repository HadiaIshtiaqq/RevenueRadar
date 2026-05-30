import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkle,
  Trash2,
  Sliders,
  MessageSquare,
  Mail,
  Webhook,
  Plus,
  AlertCircle,
  TrendingUp,
  Activity,
  Loader2,
} from "lucide-react";
import { Alert } from "../types";

interface IntelStats {
  totalChanges: number;
  last7dChanges: number;
  velocityPct: number;
  highImpactCount: number;
  lastMonitorRan: string | null;
}

function changeToAlert(c: {
  id: string; competitorName: string; changeType: string; summary: string;
  impactScore: number; detectedAt: string; acknowledged: boolean;
}): Alert {
  const t = c.changeType;
  const signalType = t.includes("pric") ? "Pricing Shift"
    : t.includes("hir")  ? "Hiring Signal"
    : t.includes("mess") ? "Messaging Pivot"
    : t.includes("fund") ? "Funding"
    : t.includes("prod") ? "Product Launch"
    : "Signal";
  const ago = (() => {
    const s = Math.floor((Date.now() - new Date(c.detectedAt).getTime()) / 1000);
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  })();
  return {
    id: c.id,
    name: c.summary.slice(0, 55) + (c.summary.length > 55 ? "…" : ""),
    targetEntity: c.competitorName,
    entityAbbreviation: c.competitorName.slice(0, 2).toUpperCase(),
    signalTypes: [signalType],
    channels: ["chat"],
    status: !c.acknowledged,
    lastTrigger: ago,
    totalEvents: 1,
    impactScore: c.impactScore,
  };
}

function parseUtc(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}
function timeAgoFromIso(iso: string | null) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - parseUtc(iso).getTime()) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function AlertsView() {
  const [activeAlerts,     setActiveAlerts]     = useState<Alert[]>([]);
  const [stats,            setStats]            = useState<IntelStats | null>(null);
  const [statsLoading,     setStatsLoading]     = useState(true);
  const [intelQuery,       setIntelQuery]       = useState("");
  const [queryLoading,     setQueryLoading]     = useState(false);
  const [aiReportResult,   setAiReportResult]   = useState<string | null>(null);
  const [toastMessage,     setToastMessage]     = useState<string | null>(null);
  const [selectedAlertIds, setSelectedAlertIds] = useState<string[]>([]);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Load changes from DB (real data)
  const loadChanges = () => {
    fetch("/api/intelligence/changes")
      .then(r => r.json())
      .then(d => {
        const rows = d.data ?? [];
        setActiveAlerts(rows.map(changeToAlert));
      })
      .catch(() => {});
  };

  // Load real computed stats
  const loadStats = () => {
    setStatsLoading(true);
    fetch("/api/intelligence/stats")
      .then(r => r.json())
      .then((d: IntelStats) => setStats(d))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  };

  useEffect(() => {
    loadChanges();
    loadStats();
    const id = setInterval(() => { loadChanges(); loadStats(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  const popularShortcuts = [
    { label: "Market Shift Analysis",  text: "Analyze recent competitive pivots in security SaaS compliance markets." },
    { label: "Competitor Churn",       text: "Find indicators showing which customers are migrating away from my top competitor." },
    { label: "Expansion Readiness",    text: "Look up APAC developer hub scaling for payments infrastructure targets." },
    { label: "Pricing Intelligence",   text: "Describe how competitors are scaling midmarket tiers relative to enterprise custom quotes." },
  ];

  const handleCreateTracker = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = intelQuery.trim();
    if (!query) return;
    setQueryLoading(true);
    setAiReportResult(null);
    const timeoutId = setTimeout(() => {
      setQueryLoading(false);
      setAiReportResult("⚠️ **Request timed out** — the AI model is under high demand. Try again in a moment.");
    }, 60_000);
    try {
      const ctrl = new AbortController();
      const killTimer = setTimeout(() => ctrl.abort(), 55_000);
      const response = await fetch("/api/query-gtm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: ctrl.signal,
      });
      clearTimeout(killTimer);
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as { error?: string; details?: string };
        setAiReportResult(`⚠️ **Analysis failed:** ${err.error || "Unknown error"}`);
        return;
      }
      const data = await response.json() as { answer?: string; recommendedAlert?: { name: string; targetEntity: string; signalTypes?: string[] } | null };
      setAiReportResult(data.answer ?? "No response generated.");
      if (data.recommendedAlert) {
        const newAlert: Alert = {
          id: `al-custom-${Date.now()}`,
          name: data.recommendedAlert.name,
          targetEntity: data.recommendedAlert.targetEntity,
          entityAbbreviation: data.recommendedAlert.targetEntity.substring(0, 2).toUpperCase(),
          signalTypes: data.recommendedAlert.signalTypes || ["AI Custom Target"],
          channels: ["chat", "mail"],
          status: true,
          lastTrigger: "Just now",
          totalEvents: 1,
          impactScore: 80,
        };
        setActiveAlerts(prev => [newAlert, ...prev]);
        triggerToast(`Live tracker added: ${newAlert.name}`);
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError"))
        setAiReportResult("⚠️ **Network error** — could not reach the server.");
    } finally {
      clearTimeout(timeoutId);
      setQueryLoading(false);
    }
  };

  // Persist toggle via PATCH
  const handleToggleStatus = async (id: string) => {
    const alert = activeAlerts.find(a => a.id === id);
    if (!alert) return;
    try {
      await fetch(`/api/intelligence/changes/${id}`, { method: "PATCH" });
    } catch { /* optimistic — still update UI */ }
    setActiveAlerts(prev => prev.map(al => al.id === id ? { ...al, status: !al.status } : al));
    triggerToast(`Tracker ${alert.status ? "paused" : "enabled"}: ${alert.name}`);
  };

  // Persist delete via DELETE
  const handleDeleteAlert = async (id: string, name: string) => {
    try {
      await fetch(`/api/intelligence/changes/${id}`, { method: "DELETE" });
    } catch { /* optimistic */ }
    setActiveAlerts(prev => prev.filter(al => al.id !== id));
    setSelectedAlertIds(prev => prev.filter(i => i !== id));
    triggerToast(`Sensor removed: ${name}`);
  };

  const handleToggleSelectOne = (id: string) =>
    setSelectedAlertIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleToggleAll = () => {
    if (activeAlerts.length === 0) return;
    setSelectedAlertIds(selectedAlertIds.length === activeAlerts.length ? [] : activeAlerts.map(al => al.id));
  };

  const handleBulkEnable = () => {
    selectedAlertIds.forEach(id => { fetch(`/api/intelligence/changes/${id}`, { method: "PATCH" }).catch(() => {}); });
    setActiveAlerts(prev => prev.map(al => selectedAlertIds.includes(al.id) ? { ...al, status: true } : al));
    triggerToast(`Enabled ${selectedAlertIds.length} monitors`);
    setSelectedAlertIds([]);
  };

  const handleBulkPause = () => {
    selectedAlertIds.forEach(id => { fetch(`/api/intelligence/changes/${id}`, { method: "PATCH" }).catch(() => {}); });
    setActiveAlerts(prev => prev.map(al => selectedAlertIds.includes(al.id) ? { ...al, status: false } : al));
    triggerToast(`Paused ${selectedAlertIds.length} monitors`);
    setSelectedAlertIds([]);
  };

  const handleBulkDelete = async () => {
    await Promise.allSettled(selectedAlertIds.map(id => fetch(`/api/intelligence/changes/${id}`, { method: "DELETE" })));
    setActiveAlerts(prev => prev.filter(al => !selectedAlertIds.includes(al.id)));
    triggerToast(`Removed ${selectedAlertIds.length} monitors`);
    setSelectedAlertIds([]);
  };

  const velocityLabel = stats
    ? stats.velocityPct > 0 ? `+${stats.velocityPct}% vs prior 7d`
    : stats.velocityPct < 0 ? `${stats.velocityPct}% vs prior 7d`
    : "Stable vs prior 7d"
    : "—";

  return (
    <div className="space-y-6">

      {/* Toast */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2"
          >
            <Sparkle className="w-4 h-4 text-amber-400 animate-spin" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Intelligence Monitoring Console</h2>
          <p className="text-sm text-slate-500 mt-1">Live competitive signals — monitored every 5 minutes via Bright Data.</p>
        </div>
      </div>

      {/* Real stats — computed from DB */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-50 border border-indigo-100 rounded-lg flex items-center justify-center text-indigo-600 shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-bold">Total Signals Detected</div>
            <div className="text-sm font-bold text-slate-900 mt-1">
              {statsLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : `${stats?.totalChanges ?? 0} events`}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {stats?.last7dChanges ?? 0} in the last 7 days
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 shrink-0">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-bold">Signal Velocity</div>
            <div className={`text-sm font-bold mt-1 ${(stats?.velocityPct ?? 0) > 0 ? "text-red-600" : "text-emerald-700"}`}>
              {statsLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : velocityLabel}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">Week-over-week change frequency</div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 bg-rose-50 border border-rose-100 rounded-lg flex items-center justify-center text-rose-600 shrink-0">
            <AlertCircle className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-bold">High-Impact Signals</div>
            <div className="text-sm font-bold text-rose-700 mt-1">
              {statsLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : `${stats?.highImpactCount ?? 0} critical`}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Last scan: {timeAgoFromIso(stats?.lastMonitorRan ?? null)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Query Assistant */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Sparkle className="w-4 h-4 text-indigo-600" /> Query Assistant
              </h3>
              <p className="text-[11px] text-slate-500 mt-1">
                Ask AI to analyse any competitive topic and create a live tracker.
              </p>
            </div>
            <form onSubmit={handleCreateTracker} className="space-y-3">
              <textarea
                value={intelQuery} onChange={e => setIntelQuery(e.target.value)}
                placeholder="Alert when a competitor enters enterprise pricing discussions or scales sales teams..."
                className="w-full h-28 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 resize-none leading-relaxed"
              />
              <button type="submit" disabled={queryLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white transition-all py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2">
                {queryLoading
                  ? <><div className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /><span>Analysing…</span></>
                  : <><Plus className="w-4 h-4" /><span>Analyse & Create Signal Tracker</span></>}
              </button>
            </form>
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Popular Queries</span>
              <div className="grid grid-cols-2 gap-2">
                {popularShortcuts.map((s, i) => (
                  <button key={i} onClick={() => setIntelQuery(s.text)}
                    className="p-2 bg-slate-50 hover:bg-slate-100 text-left text-[10px] text-slate-600 rounded-lg border border-slate-200 truncate font-semibold transition-all">
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tracker table + AI response */}
        <div className="lg:col-span-2 space-y-6">

          <AnimatePresence>
            {aiReportResult && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                className={`border rounded-xl p-4 space-y-3 overflow-hidden text-xs ${aiReportResult.startsWith("⚠️") ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
                <div className={`flex items-center justify-between pb-2 ${aiReportResult.startsWith("⚠️") ? "border-b border-red-100" : "border-b border-emerald-100"}`}>
                  <span className={`uppercase font-bold tracking-wider flex items-center gap-1.5 ${aiReportResult.startsWith("⚠️") ? "text-red-700" : "text-emerald-800"}`}>
                    <Sparkle className="w-4 h-4" />
                    {aiReportResult.startsWith("⚠️") ? "Analysis Error" : "AI Research Report"}
                  </span>
                  <button onClick={() => setAiReportResult(null)} className="text-slate-400 hover:text-slate-700 text-[10px] uppercase font-bold">Dismiss</button>
                </div>
                <div className="text-slate-700 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap p-1">{aiReportResult}</div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-indigo-600" /> Live Signal Sensors
              </h3>
              <span className="text-[11px] font-mono text-slate-500 font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                {activeAlerts.length} ACTIVE
              </span>
            </div>

            <AnimatePresence>
              {selectedAlertIds.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 overflow-hidden">
                  <span className="text-xs text-slate-800 font-bold">{selectedAlertIds.length} selected</span>
                  <div className="flex items-center gap-2">
                    <button onClick={handleBulkEnable} className="bg-white border border-slate-200 text-indigo-700 font-bold text-[11px] py-1.5 px-3 rounded-lg transition-all">Enable</button>
                    <button onClick={handleBulkPause}  className="bg-white border border-slate-200 text-slate-600 font-bold text-[11px] py-1.5 px-3 rounded-lg transition-all">Pause</button>
                    <button onClick={handleBulkDelete} className="bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[11px] py-1.5 px-3 rounded-lg transition-all">Delete</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase">
                    <th className="py-2.5 w-10 text-center">
                      <input type="checkbox" checked={activeAlerts.length > 0 && selectedAlertIds.length === activeAlerts.length}
                        onChange={handleToggleAll} className="rounded border-slate-300 cursor-pointer w-4 h-4" style={{ accentColor: "#4f46e5" }} />
                    </th>
                    <th className="py-2.5">Signal Tracker</th>
                    <th className="py-2.5">Type</th>
                    <th className="py-2.5 text-center">Channel</th>
                    <th className="py-2.5 text-center">Score</th>
                    <th className="py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeAlerts.map(al => (
                    <tr key={al.id} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 text-center">
                        <input type="checkbox" checked={selectedAlertIds.includes(al.id)} onChange={() => handleToggleSelectOne(al.id)}
                          className="rounded border-slate-300 cursor-pointer w-4 h-4" style={{ accentColor: "#4f46e5" }} />
                      </td>
                      <td className="py-3.5 pr-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 shrink-0 font-bold text-xs text-indigo-600 flex items-center justify-center font-mono">
                            {al.entityAbbreviation}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">{al.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono mt-0.5">{al.targetEntity} · {al.lastTrigger}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          {al.signalTypes.map((sig, i) => (
                            <span key={i} className="text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded-md">{sig}</span>
                          ))}
                        </div>
                      </td>
                      <td className="py-3.5 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {al.channels.includes("chat") && <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />}
                          {al.channels.includes("mail") && <Mail className="w-3.5 h-3.5 text-slate-400" />}
                          {al.channels.includes("webhook") && <Webhook className="w-3.5 h-3.5 text-amber-500" />}
                        </div>
                      </td>
                      <td className="py-3.5 text-center font-mono font-bold text-slate-800">{al.impactScore || 85}</td>
                      <td className="py-3.5 text-right">
                        <div className="flex items-center justify-end gap-3.5">
                          <button onClick={() => handleToggleStatus(al.id)}
                            className={`w-9 h-5 rounded-full p-0.5 transition-colors relative focus:outline-none ${al.status ? "bg-indigo-600" : "bg-slate-200"}`}>
                            <span className={`w-4 h-4 rounded-full bg-white block transition-transform ${al.status ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                          <button onClick={() => handleDeleteAlert(al.id, al.name)} className="text-slate-400 hover:text-rose-600 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activeAlerts.length === 0 && (
                <div className="text-center py-12 text-slate-400 text-xs flex flex-col items-center gap-2">
                  <Activity className="w-6 h-6 text-slate-300" />
                  No signals yet — background monitor will populate this automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
