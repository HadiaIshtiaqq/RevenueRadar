import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  TrendingUp, Target, Activity, ArrowRight,
  Sparkle, Swords, RefreshCw, Info, Clock, Loader2, Globe, Newspaper, ExternalLink,
  MessageCircle, ThumbsUp, ThumbsDown, Minus, MapPin,
} from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { GoogleMap, useJsApiLoader, OverlayView, Circle } from "@react-google-maps/api";
import { ViewType } from "../types";
import type { AuthUser } from "./LandingPage";
import { getDemandRegions } from "../data/niche-demand";


interface Change {
  id: string; competitorId: string; competitorName: string;
  changeType: string; summary: string; impactScore: number;
  detectedAt: string; acknowledged: boolean;
}
interface Competitor {
  id: string; name: string; domain: string; monitoringEnabled: boolean;
  hqLat?: number; hqLng?: number; hqCity?: string; discoverySource?: string;
}
interface DashMetrics {
  changeCount: number;
  signalCount: number;
  highImpactValue: string;
  competitorCount: number;
  lastUpdated: string;
}
interface NewsArticle {
  title: string;
  url: string;
  snippet: string;
  date?: string;
  source?: string;
}

const GOOGLE_MAPS_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY as string ?? "";


// Default user location per niche (approximate)
function getUserLocation(niche: string): { lat: number; lng: number; city: string } {
  const n = niche.toLowerCase();
  if (/india|south asia/.test(n))                    return { lat: 28.6139, lng: 77.2090, city: "New Delhi" };
  if (/europe|uk|german|french|spain/.test(n))       return { lat: 51.5074, lng: -0.1278, city: "London" };
  if (/china|asia|japan|korea/.test(n))              return { lat: 31.2304, lng: 121.4737, city: "Shanghai" };
  if (/australia|oceania/.test(n))                   return { lat: -33.8688, lng: 151.2093, city: "Sydney" };
  return { lat: 37.7749, lng: -122.4194, city: "San Francisco" };
}

const MAP_STYLE = [
  { elementType: "geometry",              stylers: [{ color: "#0d1b2e" }] },
  { elementType: "labels.text.stroke",    stylers: [{ color: "#0d1b2e" }] },
  { elementType: "labels.text.fill",      stylers: [{ color: "#4a6fa5" }] },
  { featureType: "water",   elementType: "geometry",       stylers: [{ color: "#0a1628" }] },
  { featureType: "landscape",elementType: "geometry",      stylers: [{ color: "#152f4a" }] },
  { featureType: "road",                  stylers: [{ visibility: "off" }] },
  { featureType: "poi",                   stylers: [{ visibility: "off" }] },
  { featureType: "transit",               stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1a3a5c" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#4a6fa5" }] },
];

const GMAP_OPTIONS = {
  disableDefaultUI: true,
  styles: MAP_STYLE,
  gestureHandling: "none" as const,
  zoomControl: false,
  scrollwheel: false,
  draggable: false,
  backgroundColor: "#0d1b2e",
};



function changeTypeColor(type: string) {
  if (type.includes("pric")) return "border-rose-200 text-rose-700 bg-rose-50";
  if (type.includes("mess") || type.includes("brand")) return "border-amber-200 text-amber-700 bg-amber-50";
  if (type.includes("hir")) return "border-indigo-200 text-indigo-700 bg-indigo-50";
  return "border-slate-200 text-slate-600 bg-slate-50";
}
function changeTypeLabel(type: string) {
  if (type.includes("pric")) return "PRICE CHANGE";
  if (type.includes("mess") || type.includes("brand")) return "MESSAGING";
  if (type.includes("hir")) return "HIRING SIGNAL";
  return type.toUpperCase().replace(/_/g, " ");
}
function parseUtc(iso: string): Date {
  // SQLite stores "YYYY-MM-DD HH:MM:SS" (UTC, no tz suffix) — normalize for cross-browser safety
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}
function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - parseUtc(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface Props {
  setView: (v: ViewType) => void;
  onSetEnrichedCompany: (d: string) => void;
  onSetCompetitorName: (n: string) => void;
  user?: AuthUser | null;
}

export default function DashboardView({ setView, onSetEnrichedCompany, onSetCompetitorName, user }: Props) {
  const [timeframe,     setTimeframe]     = useState<"30"|"90">("30");
  const [metrics,       setMetrics]       = useState<DashMetrics | null>(null);
  const [changes,       setChanges]       = useState<Change[]>([]);
  const [competitors,   setCompetitors]   = useState<Competitor[]>([]);
  const [hoveredPoint,  setHoveredPoint]  = useState<string | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [dismissedIds,  setDismissedIds]  = useState<Set<string>>(new Set());
  const [trendData,     setTrendData]     = useState<{ day: string; GtmPressure: number; RollingAvg: number }[]>([]);
  const [news,          setNews]          = useState<NewsArticle[]>([]);
  const [newsLoading,   setNewsLoading]   = useState(false);
  const [reddit,        setReddit]        = useState<{ title: string; url: string; snippet: string; sentiment: "positive"|"negative"|"neutral" }[]>([]);
  const [redditLoading, setRedditLoading] = useState(false);
  const [redditSentiment, setRedditSentiment] = useState<"positive"|"negative"|"neutral">("neutral");
  const [detecting,     setDetecting]     = useState(false);
  const [detectResult,  setDetectResult]  = useState<{ changesFound: number } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const days = timeframe === "90" ? 90 : 30;
      const [changesRes, compsRes, signalsRes, trendRes] = await Promise.all([
        fetch("/api/intelligence/changes"),
        fetch("/api/competitors"),
        fetch("/api/intelligence/signals"),
        fetch(`/api/intelligence/trend?days=${days}`),
      ]);
      const changesData  = await changesRes.json();
      const compsData    = await compsRes.json();
      const signalsData  = await signalsRes.json();
      const trendRaw: { day: string; count: number }[] = (await trendRes.json()).data ?? [];

      // GtmPressure  = raw daily competitor signal count (live from DB)
      // RollingAvg   = 7-day rolling mean of the same data (real smoothed baseline)
      const maxCount = Math.max(1, ...trendRaw.map(r => r.count));
      setTrendData(trendRaw.map((r, i) => {
        const window = trendRaw.slice(Math.max(0, i - 6), i + 1);
        const avg = window.reduce((s, d) => s + d.count, 0) / window.length;
        return {
          day: r.day.slice(5),
          GtmPressure: Math.min(100, Math.round((r.count / maxCount) * 90 + 5)),
          RollingAvg:  Math.min(100, Math.round((avg   / maxCount) * 90 + 5)),
        };
      }));

      let allChanges: Change[]     = changesData.data  ?? [];
      const allComps:   Competitor[]  = compsData.data    ?? [];
      const allSignals                = signalsData.data  ?? [];

      const highImpact = allChanges.filter((c: Change) => c.impactScore >= 70);
      const totalImpactDollars = highImpact.length * 0.4;

      setChanges(allChanges);
      setCompetitors(allComps);

      // Fetch live news once we know which competitors to query
      const topComp = allComps[0]?.name || "SaaS GTM";
      const newsQ = allComps.length > 0
        ? allComps.slice(0, 3).map((c: Competitor) => c.name).join(" OR ") + " competitive intelligence 2026"
        : "SaaS GTM competitive intelligence 2026";

      setNewsLoading(true);
      fetch(`/api/intelligence/news?q=${encodeURIComponent(newsQ)}&limit=8`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.data) setNews(d.data); })
        .catch(() => { /* silent */ })
        .finally(() => setNewsLoading(false));

      // Fetch Reddit social sentiment for top competitor
      setRedditLoading(true);
      fetch(`/api/social/reddit?company=${encodeURIComponent(topComp)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d?.posts) {
            setReddit(d.posts);
            setRedditSentiment(d.overallSentiment ?? "neutral");
          }
        })
        .catch(() => { /* silent */ })
        .finally(() => setRedditLoading(false));

      setMetrics({
        changeCount:     allChanges.length,
        signalCount:     allSignals.length,
        highImpactValue: totalImpactDollars > 0 ? `$${totalImpactDollars.toFixed(1)}M` : "$0",
        competitorCount: allComps.length,
        lastUpdated:     new Date().toISOString(),
      });
    } catch {
      /* silently degrade */
    } finally { setLoading(false); }
  }, [timeframe]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const feed = changes.filter(c => !dismissedIds.has(c.id)).slice(0, 6);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-sans font-bold text-slate-900 tracking-tight">Executive Intelligence Terminal</h2>
          <p className="text-sm text-slate-500 mt-1">Active competitive monitoring and strategic threat assessments</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setDetecting(true); setDetectResult(null);
              try {
                const r = await fetch("/api/monitor/run-now", { method: "POST" });
                const d = await r.json() as { changesFound: number };
                setDetectResult(d);
                if (d.changesFound > 0) fetchData();
                setTimeout(() => setDetectResult(null), 5000);
              } catch { /* silent */ } finally { setDetecting(false); }
            }}
            disabled={detecting}
            className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-3.5 py-2 rounded-lg transition-colors shadow-sm"
          >
            {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {detecting ? "Detecting…" : "Detect Now"}
          </button>
          {detectResult && (
            <span className={`text-xs font-bold px-2 py-1 rounded-lg ${detectResult.changesFound > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {detectResult.changesFound > 0 ? `+${detectResult.changesFound} new signals!` : "No new signals"}
            </span>
          )}
          <div className="flex items-center gap-2 text-xs font-semibold bg-indigo-50 border border-indigo-100 text-indigo-700 px-3.5 py-2 rounded-lg">
            <Activity className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
            <span>LIVE · 30s</span>
            {metrics?.lastUpdated && (
              <span className="text-indigo-400 font-mono text-[10px] flex items-center gap-1">
                <Clock className="w-3 h-3" />{timeAgo(metrics.lastUpdated)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <MetricCard
          label="Competitive Signals"
          value={loading ? "—" : String(metrics?.changeCount ?? 0)}
          sub={`${metrics?.competitorCount ?? 0} competitor${(metrics?.competitorCount ?? 0) !== 1 ? "s" : ""} monitored`}
          badge="+Live"
          badgeColor="emerald"
          dot="indigo"
        />
        <MetricCard
          label="High-Intent Accounts"
          value={loading ? "—" : String(metrics?.signalCount ?? 0)}
          sub="active signal qualifiers"
          badge="Enriched"
          badgeColor="indigo"
          dot="emerald"
        />
        <MetricCard
          label="High-Impact Changes"
          value={loading ? "—" : String(changes.filter(c => c.impactScore >= 70).length)}
          sub="scoring 70+ impact"
          badge="Risk"
          badgeColor="rose"
          dot="rose"
        />
      </div>

      {/* Chart + Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Area Chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-2 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Competitor Signal Velocity
                <Info className="w-3.5 h-3.5 text-slate-400" aria-label="Live competitor changes detected per day via Bright Data, with 7-day rolling average baseline" />
              </h3>
              <p className="text-xs text-slate-500">
                Live signals from DB · {timeframe}-day window · refreshes every 30s
              </p>
            </div>
            <div className="flex bg-slate-100 border border-slate-200 rounded-lg p-0.5">
              {(["30","90"] as const).map(t => (
                <button key={t} onClick={() => setTimeframe(t)}
                  className={`text-xs px-2.5 py-1 rounded-md font-bold transition-colors ${timeframe === t ? "bg-white text-indigo-700 shadow-xs" : "text-slate-500 hover:text-slate-900"}`}>
                  {t} Days
                </button>
              ))}
            </div>
          </div>
          <div className="h-64 mt-4">
            {trendData.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2">
                <Activity className="w-8 h-8 text-slate-300" />
                <p className="text-xs text-slate-400 font-medium">No signal data yet</p>
                <p className="text-[10px] text-slate-400">Competitor changes will appear here once Bright Data monitoring detects activity.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorGtm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorAvg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.12}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="day" stroke="#64748b" fontSize={10} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={10} tickLine={false} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#fff", borderColor: "#e2e8f0", borderRadius: "8px", fontSize: "11px" }}
                    formatter={(value: number, name: string) => [value, name === "GtmPressure" ? "Daily Signals" : "7-Day Avg"]}
                  />
                  <Area name="GtmPressure" type="monotone" dataKey="GtmPressure" stroke="#ef4444" fill="url(#colorGtm)" strokeWidth={2} dot={false} />
                  <Area name="RollingAvg"  type="monotone" dataKey="RollingAvg"  stroke="#6366f1" fill="url(#colorAvg)"  strokeWidth={2} dot={false} strokeDasharray="4 2" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-sm bg-rose-500/20 border border-rose-500 inline-block" />
              Daily Signals (live)
            </span>
            <span className="flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/20 border border-indigo-500 inline-block" style={{ backgroundImage: "repeating-linear-gradient(90deg,#6366f1 0,#6366f1 3px,transparent 3px,transparent 6px)" }} />
              7-Day Rolling Avg
            </span>
          </div>
        </div>

        {/* Priority Intelligence Feed */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-600" /> Priority Intelligence
            </h3>
            <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 font-bold py-0.5 px-2 rounded">
              {feed.length} ALERTS
            </span>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-80 pr-0.5">
            <AnimatePresence initial={false}>
              {loading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : feed.length === 0 ? (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center py-10 text-slate-400 text-xs">
                  No active signals. Add competitors and run monitoring to populate.
                </motion.div>
              ) : feed.map(item => (
                <motion.div key={item.id}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-slate-50 border border-slate-150 rounded-lg p-3 space-y-1.5 hover:border-slate-300 transition-colors group">
                  <div className="flex items-start justify-between gap-1">
                    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${changeTypeColor(item.changeType)}`}>
                      {changeTypeLabel(item.changeType)}
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono font-bold text-indigo-600">{item.impactScore}</span>
                      <span className="text-[9px] text-slate-400">impact</span>
                    </div>
                  </div>
                  <p className="text-xs font-semibold text-slate-700 group-hover:text-indigo-600 transition-colors line-clamp-2">{item.summary}</p>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <button onClick={() => { onSetCompetitorName(item.competitorName); setView("competitors"); }}
                      className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                      View Battlecard <ArrowRight className="w-3 h-3" />
                    </button>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 font-mono">{timeAgo(item.detectedAt)}</span>
                      <button onClick={() => setDismissedIds(p => new Set([...p, item.id]))}
                        className="text-[10px] text-slate-400 hover:text-slate-600 font-medium">Dismiss</button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {changes.length > 0 && (
            <div className="pt-3 mt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 font-mono">
                {metrics?.lastUpdated ? `Updated ${timeAgo(metrics.lastUpdated)}` : ""}
              </span>
              <button onClick={() => { setDismissedIds(new Set()); fetchData(); }}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-bold font-mono">
                <RefreshCw className="w-3 h-3" /> REFRESH
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Map + Competitive Landscape */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Sentinel Map — Google Maps */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-2 flex flex-col shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <h3 className="text-base font-bold text-slate-900">Sentinel Intel Map</h3>
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[11px] font-bold text-slate-500">GLOBAL SENTIMENT ACTIVE</span>
            </div>
          </div>

          <div className="relative w-full aspect-[2/1] rounded-lg overflow-hidden border border-slate-200/60 select-none">
            <GMap
              hoveredPoint={hoveredPoint}
              setHoveredPoint={setHoveredPoint}
              competitors={competitors}
              userNiche={user?.productNiche ?? ""}
              userName={user?.name ?? ""}
              userLat={user?.companyLat}
              userLng={user?.companyLng}
              userCity={user?.companyCity}
            />
          </div>

          <div className="mt-3 flex items-center gap-5 text-[10px] font-semibold text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500/40 border border-indigo-500 inline-block" />Demand Zone</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />Competitor HQ</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />Your Company</span>
            <span className="flex items-center gap-1.5 ml-auto text-slate-400"><Info className="w-3.5 h-3.5 text-indigo-500/60" /> Hover pins for details</span>
          </div>
        </div>

        {/* Competitive Landscape */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Swords className="w-4 h-4 text-indigo-600" /> Live Landscape
            </h3>
            <span className="text-[10px] bg-slate-100 border border-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded">
              N={competitors.length} MONITORED
            </span>
          </div>

          <div className="space-y-3 flex-1">
            {loading ? (
              [1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded-lg animate-pulse" />)
            ) : competitors.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-xs">
                No competitors added yet.<br />Go to <button onClick={() => setView("competitors")} className="text-indigo-500 underline">Competitors</button> to add one.
              </div>
            ) : competitors.map(comp => {
              const compChanges = changes.filter(c => c.competitorId === comp.id);
              const maxImpact   = compChanges.reduce((m, c) => Math.max(m, c.impactScore), 0);
              const threat      = maxImpact >= 70 ? "High Threat" : maxImpact >= 40 ? "Medium" : "Neutral";
              return (
                <div key={comp.id} onClick={() => { onSetCompetitorName(comp.name); setView("competitors"); }}
                  className="p-3 bg-slate-50/50 border border-slate-200/80 hover:border-indigo-400/40 rounded-lg cursor-pointer transition-all group/row hover:shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800 group-hover/row:text-indigo-600 transition-colors truncate max-w-[110px]">{comp.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {comp.discoverySource && (
                        <span className={`text-[8px] font-bold px-1 py-0.5 rounded border ${comp.discoverySource === "serp" ? "bg-cyan-50 text-cyan-700 border-cyan-200" : comp.discoverySource === "curated" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                          {comp.discoverySource === "serp" ? "SERP" : comp.discoverySource === "curated" ? "DB" : "MANUAL"}
                        </span>
                      )}
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${threat === "High Threat" ? "bg-red-50 text-red-700 border-red-100" : threat === "Medium" ? "bg-amber-50 text-amber-700 border-amber-100" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {threat}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mt-2 text-center border-t border-slate-200 pt-2 text-[11px]">
                    <div className="text-left">
                      <div className="text-slate-400 text-[9px] uppercase font-bold">Changes</div>
                      <div className="text-slate-800 font-extrabold">{compChanges.length}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-slate-400 text-[9px] uppercase font-bold">Max Impact</div>
                      <div className={`font-extrabold ${maxImpact >= 70 ? "text-red-600" : "text-slate-800"}`}>{maxImpact || "—"}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AI forecast */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <div className="flex items-start gap-2.5">
                <Sparkle className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5 fill-indigo-200" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-indigo-700 uppercase font-mono tracking-wider">AI Forecast Pivot</h4>
                  <p className="text-[10.5px] text-slate-600 leading-relaxed">
                    {changes.length > 0
                      ? `${changes.length} change signal${changes.length !== 1 ? "s" : ""} detected across ${competitors.length} competitor${competitors.length !== 1 ? "s" : ""}. Run competitor monitoring to surface battlecard opportunities.`
                      : "Add competitors and run monitoring to generate AI-powered battlecard forecasts."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Live News Feed — Bright Data SERP powered */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Newspaper className="w-4 h-4 text-indigo-600" /> Live Intel News Feed
          </h3>
          <span className="text-[10px] bg-cyan-50 border border-cyan-100 text-cyan-700 font-bold px-2.5 py-0.5 rounded flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" /> BRIGHT DATA LIVE
          </span>
        </div>

        {newsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-28 bg-slate-100 rounded-lg animate-pulse" />)}
          </div>
        ) : news.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            <Newspaper className="w-6 h-6 mx-auto mb-2 text-slate-200" />
            No news articles yet — add competitors to trigger a live Bright Data news feed.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {news.map((article, i) => (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                className="block bg-slate-50 border border-slate-200 rounded-lg p-3 hover:border-indigo-300 hover:shadow-sm transition-all group">
                <p className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors line-clamp-2 leading-snug">{article.title}</p>
                {article.snippet && (
                  <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{article.snippet}</p>
                )}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                  <span className="text-[9px] font-bold text-slate-400 uppercase truncate max-w-[80px]">
                    {article.source || "News"}
                  </span>
                  <div className="flex items-center gap-1 text-[9px] text-slate-400">
                    {article.date && <span>{article.date}</span>}
                    <ExternalLink className="w-2.5 h-2.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Reddit Social Sentiment — Bright Data MCP Dataset */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-orange-500" /> Reddit Social Buzz
          </h3>
          <div className="flex items-center gap-2">
            {redditSentiment !== "neutral" && (
              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                redditSentiment === "positive" ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"}`}>
                {redditSentiment === "positive"
                  ? <ThumbsUp className="w-2.5 h-2.5" />
                  : <ThumbsDown className="w-2.5 h-2.5" />}
                {redditSentiment.toUpperCase()}
              </span>
            )}
            {redditSentiment === "neutral" && !redditLoading && reddit.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                <Minus className="w-2.5 h-2.5" /> NEUTRAL
              </span>
            )}
            <span className="text-[10px] bg-orange-50 border border-orange-100 text-orange-700 font-bold px-2.5 py-0.5 rounded flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" /> BRIGHT DATA LIVE
            </span>
          </div>
        </div>

        {redditLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />)}
          </div>
        ) : reddit.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">
            <MessageCircle className="w-6 h-6 mx-auto mb-2 text-slate-200" />
            No Reddit mentions found — add competitors to pull live social data via Bright Data MCP.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {reddit.map((post, i) => (
              <a key={i} href={post.url} target="_blank" rel="noopener noreferrer"
                className="block bg-slate-50 border border-slate-200 rounded-lg p-3 hover:border-orange-300 hover:shadow-sm transition-all group">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    post.sentiment === "positive" ? "bg-emerald-400"
                    : post.sentiment === "negative" ? "bg-red-400" : "bg-slate-300"}`} />
                  <span className={`text-[9px] font-bold uppercase ${
                    post.sentiment === "positive" ? "text-emerald-600"
                    : post.sentiment === "negative" ? "text-red-600" : "text-slate-400"}`}>
                    {post.sentiment}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-800 group-hover:text-orange-600 transition-colors line-clamp-2 leading-snug">{post.title}</p>
                {post.snippet && (
                  <p className="text-[10px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">{post.snippet.slice(0, 80)}</p>
                )}
                <div className="flex items-center justify-end mt-2 pt-2 border-t border-slate-100">
                  <ExternalLink className="w-2.5 h-2.5 text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function GMap({
  hoveredPoint, setHoveredPoint, competitors, userNiche, userName, userLat, userLng, userCity,
}: {
  hoveredPoint: string | null;
  setHoveredPoint: (id: string | null) => void;
  competitors: Competitor[];
  userNiche: string;
  userName: string;
  userLat?: number;
  userLng?: number;
  userCity?: string;
}) {
  const { isLoaded } = useJsApiLoader({ googleMapsApiKey: GOOGLE_MAPS_KEY });

  const demandRegions = getDemandRegions(userNiche);
  const fallbackLoc   = getUserLocation(userNiche);
  const userLoc = (userLat != null && userLng != null)
    ? { lat: userLat, lng: userLng, city: userCity || fallbackLoc.city }
    : fallbackLoc;

  // Build competitor pins — prefer DB-stored coords, then local BRAND_HQ, then TLD inference
  function inferCity(domain: string): string {
    const tld = domain.split(".").pop() ?? "";
    const map: Record<string, string> = {
      uk: "London", de: "Berlin", fr: "Paris", in: "New Delhi", cn: "Shanghai",
      au: "Sydney", sg: "Singapore", ca: "Toronto", il: "Tel Aviv",
      se: "Stockholm", ee: "Tallinn", nl: "Amsterdam", jp: "Tokyo", br: "São Paulo",
    };
    return map[tld] ?? "San Francisco";
  }

  const rawPins = competitors.map((c, idx) => {
    // Use server-geocoded coords from DB if available (set on signup + manual add)
    if (c.hqLat != null && c.hqLng != null) {
      return { id: c.id, name: c.name, domain: c.domain, lat: c.hqLat, lng: c.hqLng, city: c.hqCity ?? inferCity(c.domain) };
    }
    // Fallback: spread across known tech hubs until geocoding backfills
    const fallbacks = [
      { lat: 40.7128, lng: -74.0060, city: "New York" },
      { lat: 51.5074, lng: -0.1278,  city: "London" },
      { lat: 35.6762, lng: 139.6503, city: "Tokyo" },
      { lat: -33.8688, lng: 151.2093, city: "Sydney" },
      { lat: 1.3521,  lng: 103.8198, city: "Singapore" },
      { lat: 19.0760, lng: 72.8777,  city: "Mumbai" },
    ];
    const fb = fallbacks[idx % fallbacks.length];
    return { id: c.id, name: c.name, domain: c.domain, ...fb };
  });

  // Spread pins that share the same coordinates so they don't stack
  const coordCount = new Map<string, number>();
  const allCompPins = rawPins.map(pin => {
    const key = `${pin.lat.toFixed(2)},${pin.lng.toFixed(2)}`;
    const slot = coordCount.get(key) ?? 0;
    coordCount.set(key, slot + 1);
    if (slot === 0) return pin;
    // Spread in a ring (~165 km radius) so co-located pins are visually distinct
    const angle = (slot * (360 / 8)) * (Math.PI / 180);
    return { ...pin, lat: pin.lat + Math.cos(angle) * 1.5, lng: pin.lng + Math.sin(angle) * 1.5 };
  });

  if (!GOOGLE_MAPS_KEY) {
    const W = 1000, H = 480;
    const proj = (lat: number, lng: number) => ({
      x: ((lng + 180) / 360) * W,
      y: ((90 - lat) / 180) * H,
    });
    // Simplified continent outlines (lat/lng waypoints)
    const continents: [number, number][][] = [
      [[55,-130],[70,-100],[75,-70],[50,-55],[25,-80],[15,-85],[20,-105],[30,-120],[55,-130]],
      [[10,-75],[5,-50],[-15,-35],[-35,-55],[-55,-70],[-20,-80],[10,-75]],
      [[70,10],[60,30],[45,15],[36,28],[36,5],[50,-5],[60,-5],[70,10]],
      [[37,10],[10,45],[-15,35],[-35,30],[-35,18],[-15,-18],[10,-18],[37,10]],
      [[70,30],[70,140],[25,125],[5,100],[20,60],[45,40],[70,30]],
      [[-15,125],[-15,150],[-35,150],[-40,145],[-35,115],[-22,115],[-15,125]],
    ];
    return (
      <div className="relative w-full h-full bg-[#0d1b2e] overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="svgGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          {/* Grid */}
          {[-60,-30,0,30,60].map(lat => { const y = proj(lat,0).y; return <line key={lat} x1={0} y1={y} x2={W} y2={y} stroke="#1a3a5c" strokeWidth={0.5} />; })}
          {[-120,-60,0,60,120].map(lng => { const x = proj(0,lng).x; return <line key={lng} x1={x} y1={0} x2={x} y2={H} stroke="#1a3a5c" strokeWidth={0.5} />; })}
          {/* Continents */}
          {continents.map((pts, ci) => (
            <polygon key={ci}
              points={pts.map(([lat,lng]) => `${proj(lat,lng).x},${proj(lat,lng).y}`).join(" ")}
              fill="#152d4a" stroke="#1e4060" strokeWidth={1} opacity={0.85} />
          ))}
          {/* Demand zones */}
          {demandRegions.slice(0,5).map((r,i) => { const {x,y} = proj(r.lat,r.lng); return (
            <g key={i}>
              <circle cx={x} cy={y} r={38} fill="#6366f1" opacity={0.04}/>
              <circle cx={x} cy={y} r={22} fill="#6366f1" opacity={0.07}/>
              <circle cx={x} cy={y} r={9}  fill="#6366f1" opacity={0.14}/>
            </g>
          ); })}
          {/* Competitor pins */}
          {allCompPins.map(pin => { const {x,y} = proj(pin.lat,pin.lng); return (
            <g key={pin.id} filter="url(#svgGlow)">
              <circle cx={x} cy={y} r={10} fill="#ef4444" opacity={0.18}/>
              <circle cx={x} cy={y} r={4}  fill="#ef4444"/>
              <text x={x} y={y-8} textAnchor="middle" fill="#fca5a5" fontSize={7} fontWeight="700" fontFamily="sans-serif">
                {pin.name.length > 11 ? pin.name.slice(0,10)+"…" : pin.name}
              </text>
            </g>
          ); })}
          {/* User pin */}
          {(() => { const {x,y} = proj(userLoc.lat,userLoc.lng); return (
            <g filter="url(#svgGlow)">
              <circle cx={x} cy={y} r={14} fill="#6366f1" opacity={0.2}/>
              <circle cx={x} cy={y} r={6}  fill="#6366f1"/>
              <text x={x} y={y-12} textAnchor="middle" fill="#a5b4fc" fontSize={7} fontWeight="800" fontFamily="sans-serif">YOU</text>
            </g>
          ); })()}
        </svg>
        <div className="absolute bottom-2 left-2 flex items-center gap-3 text-[9px] font-bold bg-[#0a1628]/80 px-2 py-1 rounded-lg backdrop-blur-sm">
          <span className="flex items-center gap-1 text-indigo-300"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"/> You</span>
          <span className="flex items-center gap-1 text-rose-300"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block"/> Competitor HQ</span>
          <span className="flex items-center gap-1 text-indigo-400/60"><span className="w-2 h-2 rounded-full bg-indigo-500/40 inline-block"/> Demand Zone</span>
        </div>
        <div className="absolute top-2 right-2 text-[8px] text-slate-600 font-mono bg-[#0a1628]/70 px-1.5 py-0.5 rounded">
          Add VITE_GOOGLE_MAPS_API_KEY for interactive map
        </div>
      </div>
    );
  }

  if (!isLoaded) return (
    <div className="w-full h-full bg-[#0d1b2e] flex items-center justify-center">
      <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <GoogleMap
      mapContainerStyle={{ width: "100%", height: "100%" }}
      center={{ lat: 20, lng: 0 }}
      zoom={2}
      options={GMAP_OPTIONS}
      onLoad={(map) => {
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend({ lat: userLoc.lat, lng: userLoc.lng });
        allCompPins.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
        demandRegions.forEach(r => bounds.extend({ lat: r.lat, lng: r.lng }));
        map.fitBounds(bounds, { top: 80, bottom: 60, left: 100, right: 60 });
        window.google.maps.event.addListenerOnce(map, 'idle', () => {
          if ((map.getZoom() ?? 2) > 3) map.setZoom(3);
        });
      }}
    >

      {/* ── Demand heatmap rings ─────────────────────────────────────── */}
      {demandRegions.map((region, i) => (
        <React.Fragment key={`demand-${i}`}>
          {/* Outer faint ring */}
          <Circle
            center={{ lat: region.lat, lng: region.lng }}
            radius={region.r * 1.35}
            options={{ fillColor: "#6366f1", fillOpacity: 0.04, strokeColor: "#6366f1", strokeOpacity: 0.10, strokeWeight: 1 }}
          />
          {/* Main demand zone */}
          <Circle
            center={{ lat: region.lat, lng: region.lng }}
            radius={region.r}
            options={{ fillColor: "#6366f1", fillOpacity: (region.intensity / 100) * 0.14, strokeColor: "#818cf8", strokeOpacity: 0.30, strokeWeight: 1 }}
          />
          {/* Label overlay */}
          <OverlayView position={{ lat: region.lat, lng: region.lng }} mapPaneName={OverlayView.OVERLAY_LAYER} getPixelPositionOffset={() => ({ x: -40, y: -10 })}>
            <div className="text-[9px] font-bold text-indigo-300/60 tracking-widest uppercase pointer-events-none whitespace-nowrap">
              {region.label}
            </div>
          </OverlayView>
        </React.Fragment>
      ))}

      {/* ── Competitor HQ pins ───────────────────────────────────────── */}
      {allCompPins.map(pin => (
        <OverlayView key={pin.id} position={{ lat: pin.lat, lng: pin.lng }}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET} getPixelPositionOffset={() => ({ x: -8, y: -8 })}>
          <div className="relative cursor-pointer" style={{ width: 16, height: 16 }}
            onMouseEnter={() => setHoveredPoint(pin.id)} onMouseLeave={() => setHoveredPoint(null)}>
            {/* Pulse ring */}
            <span className="absolute inset-0 rounded-full bg-amber-400/30 animate-ping" style={{ animationDuration: "2s" }} />
            <span className="absolute inset-0 rounded-full bg-amber-400/15 animate-ping" style={{ animationDuration: "3s", animationDelay: "0.5s" }} />
            {/* Core dot */}
            <div className={`w-4 h-4 rounded-full border-2 shadow-lg transition-all ${
              hoveredPoint === pin.id ? "bg-red-500 border-white scale-125" : "bg-amber-500 border-amber-200"
            }`} />
            {/* Tooltip */}
            <AnimatePresence>
              {hoveredPoint === pin.id && (
                <motion.div initial={{ opacity: 0, y: 6, scale: 0.92 }} animate={{ opacity: 1, y: -4, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
                  className="absolute bottom-7 left-1/2 -translate-x-1/2 w-44 bg-slate-900 border border-slate-700 rounded-lg p-2.5 shadow-xl pointer-events-none z-30 text-left">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <h5 className="text-[10px] font-bold text-white truncate">{pin.name}</h5>
                  </div>
                  <p className="text-[9px] text-slate-400 flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5 text-amber-400 shrink-0" />{pin.city}
                  </p>
                  <p className="text-[9px] text-amber-300 font-mono mt-1">{pin.domain}</p>
                  <div className="mt-1.5 pt-1.5 border-t border-slate-700 text-[9px] text-slate-500 font-mono flex items-center justify-between">
                    <span>Bright Data monitoring</span>
                    {competitors.find(c => c.id === pin.id)?.discoverySource && (
                      <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${competitors.find(c => c.id === pin.id)?.discoverySource === "serp" ? "text-cyan-400" : "text-violet-400"}`}>
                        {competitors.find(c => c.id === pin.id)?.discoverySource === "serp" ? "SERP" : "DB"}
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </OverlayView>
      ))}

      {/* ── Your company pin ────────────────────────────────────────── */}
      <OverlayView position={{ lat: userLoc.lat, lng: userLoc.lng }}
        mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET} getPixelPositionOffset={() => ({ x: -10, y: -10 })}>
        <div className="relative cursor-pointer" style={{ width: 20, height: 20 }}
          onMouseEnter={() => setHoveredPoint("__user")} onMouseLeave={() => setHoveredPoint(null)}>
          {/* Multi-ring radar animation */}
          <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" style={{ animationDuration: "1.5s" }} />
          <span className="absolute -inset-2 rounded-full bg-emerald-400/15 animate-ping" style={{ animationDuration: "2.5s", animationDelay: "0.3s" }} />
          <span className="absolute -inset-4 rounded-full bg-emerald-400/08 animate-ping" style={{ animationDuration: "3.5s", animationDelay: "0.7s" }} />
          {/* Core */}
          <div className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white shadow-lg shadow-emerald-500/30 flex items-center justify-center">
            <span className="w-2 h-2 rounded-full bg-white" />
          </div>
          {/* Tooltip */}
          <AnimatePresence>
            {hoveredPoint === "__user" && (
              <motion.div initial={{ opacity: 0, y: 6, scale: 0.92 }} animate={{ opacity: 1, y: -4, scale: 1 }} exit={{ opacity: 0, scale: 0.92 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 w-44 bg-slate-900 border border-emerald-500/40 rounded-lg p-2.5 shadow-xl pointer-events-none z-30 text-left">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <h5 className="text-[10px] font-bold text-emerald-300 truncate">{userName || "Your Company"}</h5>
                </div>
                <p className="text-[9px] text-slate-400 flex items-center gap-1">
                  <MapPin className="w-2.5 h-2.5 text-emerald-400 shrink-0" />{userLoc.city}
                </p>
                <div className="mt-1.5 pt-1.5 border-t border-slate-700 text-[9px] text-emerald-400/80 font-mono">
                  RevenueRadar HQ · Active
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </OverlayView>

    </GoogleMap>
  );
}

function MetricCard({ label, value, sub, badge, badgeColor, dot }: {
  label: string; value: string; sub: string;
  badge: string; badgeColor: "emerald"|"indigo"|"rose"; dot: "indigo"|"emerald"|"rose";
}) {
  const badgeClass = { emerald: "text-emerald-700 bg-emerald-100 border-emerald-200", indigo: "text-indigo-700 bg-indigo-100 border-indigo-200", rose: "text-rose-700 bg-rose-100 border-rose-200" }[badgeColor];
  const dotClass   = { indigo: "bg-indigo-600 animate-ping", emerald: "bg-emerald-500", rose: "bg-rose-500" }[dot];
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 relative overflow-hidden hover:border-indigo-300 hover:shadow-xs transition-all">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</span>
        <span className={`flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${badgeClass}`}>
          <TrendingUp className="w-3.5 h-3.5" />{badge}
        </span>
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-sans font-bold text-slate-900 tracking-tight">{value}</span>
      </div>
      <div className="mt-4 text-xs text-slate-500 flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        {sub}
      </div>
    </div>
  );
}
