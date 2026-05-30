import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2,
  MapPin,
  Swords,
  ArrowRight,
  CheckCircle,
  X,
  Plus,
  Search,
  Copy,
  Sparkle,
  DollarSign,
  ShieldCheck,
  Grid,
  TrendingUp,
  ScanLine,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { CompetitorBattlecard, TimelineEvent, BattlecardResource } from "../types";

interface PricingTier { name: string; price: string; billing?: string; features?: string[] }
interface PricingScanResult { tiers: PricingTier[]; changes: string[]; summary: string; changed: boolean; source: string; url: string }

// Well-known SaaS pricing URLs — used to suggest a sensible default
const KNOWN_PRICING_URLS: Record<string, string> = {
  hubspot: "https://www.hubspot.com/pricing",
  salesforce: "https://www.salesforce.com/editions-pricing/overview/",
  pipedrive: "https://www.pipedrive.com/en/pricing",
  monday: "https://monday.com/pricing",
  notion: "https://www.notion.so/pricing",
  slack: "https://slack.com/intl/en-us/pricing",
  zoom: "https://zoom.us/pricing",
  asana: "https://asana.com/pricing",
  clickup: "https://clickup.com/pricing",
  stripe: "https://stripe.com/pricing",
  intercom: "https://www.intercom.com/pricing",
  zendesk: "https://www.zendesk.com/pricing/",
  freshworks: "https://www.freshworks.com/pricing/",
  zoho: "https://www.zoho.com/pricing.html",
};

function guessPricingUrl(competitorName: string): string {
  const key = competitorName.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, url] of Object.entries(KNOWN_PRICING_URLS)) {
    if (key.includes(k) || k.includes(key)) return url;
  }
  return `https://${key}.com/pricing`;
}

function sourceLabel(source: string) {
  if (source === "scraping_browser") return { text: "Scraping Browser", cls: "bg-emerald-600 text-white" };
  if (source === "web_unlocker")     return { text: "Web Unlocker",     cls: "bg-blue-600 text-white" };
  if (source === "direct")           return { text: "Direct Fetch",     cls: "bg-slate-600 text-white" };
  return { text: "Bright Data", cls: "bg-emerald-600 text-white" };
}

// ─── Podcast & Keynote Monitor ────────────────────────────────────────────────

interface AudioSource {
  id: string; url: string; label: string;
  lastScannedAt: string | null; lastStatus: string | null;
  latestInsight: string | null; createdAt: string;
}

function parseUtc(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}
function timeAgoShort(iso: string | null): string {
  if (!iso) return "Never";
  const s = Math.floor((Date.now() - parseUtc(iso).getTime()) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface PodcastAnalysis {
  keyInsight?: string; roadmapHints?: string[]; positioningShifts?: string[];
  competitiveMentions?: string[]; growthSignals?: string[]; toneShift?: string; impactScore?: number;
}

function PodcastMonitor({ competitorId, competitorName }: { competitorId: string; competitorName: string }) {
  const [sources,       setSources]       = useState<AudioSource[]>([]);
  const [urlInput,      setUrlInput]      = useState("");
  const [adding,        setAdding]        = useState(false);
  const [uploading,     setUploading]     = useState(false);
  const [uploadError,   setUploadError]   = useState<string | null>(null);
  const [smReady,       setSmReady]       = useState<boolean | null>(null);
  const [scanning,      setScanning]      = useState<Record<string, boolean>>({});
  const [fullAnalysis,  setFullAnalysis]  = useState<{ analysis: PodcastAnalysis; impactScore: number; detectedAt: string } | null>(null);
  const [showAnalysis,  setShowAnalysis]  = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    const r = await fetch(`/api/competitors/${competitorId}/audio-sources`);
    if (r.ok) { const d = await r.json(); setSources(d.data ?? []); }
  };

  useEffect(() => {
    load();
    fetch("/api/health").then(r => r.json()).then((d: { hasSpeechmatics?: boolean }) => setSmReady(!!d.hasSpeechmatics)).catch(() => setSmReady(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [competitorId]);

  // Auto-poll while any source is scanning
  useEffect(() => {
    const hasActive = sources.some(s => s.lastStatus === "scanning");
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(load, 8_000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [sources]);

  const addSource = async () => {
    if (!urlInput.trim()) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/competitors/${competitorId}/audio-sources`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      if (r.ok) { const s = await r.json(); setSources(prev => [s, ...prev]); setUrlInput(""); }
    } finally { setAdding(false); }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      // Read file as base64 using FileReader (works in all browsers)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read file."));
        reader.readAsDataURL(file);
      });

      const r = await fetch(`/api/competitors/${competitorId}/audio-sources/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, data: base64 }),
      });

      if (r.ok) {
        const s = await r.json();
        setSources(prev => [s, ...prev]);
        if (!pollRef.current) pollRef.current = setInterval(load, 8_000);
      } else {
        const err = await r.json().catch(() => ({ error: `Server error ${r.status}` }));
        setUploadError(err.error || "Upload failed.");
      }
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteSource = async (id: string) => {
    await fetch(`/api/competitors/${competitorId}/audio-sources/${id}`, { method: "DELETE" });
    setSources(prev => prev.filter(s => s.id !== id));
  };

  const loadFullAnalysis = async () => {
    if (showAnalysis) { setShowAnalysis(false); return; }
    setAnalysisLoading(true);
    try {
      const r = await fetch(`/api/competitors/${competitorId}/podcast-analysis`);
      if (r.ok) {
        const d = await r.json() as { analysis: PodcastAnalysis; impactScore: number; detectedAt: string };
        if (d.analysis) { setFullAnalysis(d); setShowAnalysis(true); }
      }
    } finally { setAnalysisLoading(false); }
  };

  const scanSource = async (id: string) => {
    setScanning(prev => ({ ...prev, [id]: true }));
    try {
      const r = await fetch(`/api/competitors/${competitorId}/audio-sources/${id}/scan`, { method: "POST" });
      if (r.ok) {
        setSources(prev => prev.map(s => s.id === id ? { ...s, lastStatus: "scanning" } : s));
        if (!pollRef.current) pollRef.current = setInterval(load, 8_000);
      }
    } finally { setScanning(prev => ({ ...prev, [id]: false })); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <ScanLine className="w-4 h-4 text-indigo-600" /> Podcast &amp; Keynote Monitor
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">SPEECHMATICS</span>
          {smReady === false && <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">KEY NOT SET</span>}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Track {competitorName} executive appearances — podcasts, keynotes, investor calls. Each audio source is transcribed by Speechmatics and analyzed by AI to extract roadmap hints, positioning shifts, and competitive signals.
      </p>

      {/* Add source form */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addSource()}
            placeholder="Direct audio URL (MP3 / WAV / MP4)…"
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 font-mono focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
          <button
            onClick={addSource} disabled={adding || uploading || !urlInput.trim()}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-3 py-2 rounded-lg transition-colors shrink-0"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add URL
          </button>
        </div>
        {/* File upload row */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-medium">or upload a file:</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp3,.wav,.mp4,.m4a,audio/*"
            style={{ position: "absolute", opacity: 0, width: 0, height: 0, overflow: "hidden" }}
            onChange={handleFileUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!smReady || uploading || adding}
            className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 border border-slate-200 text-slate-700 font-bold text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            {uploading ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</> : "📁 Upload MP3 / WAV"}
          </button>
          {!smReady && <span className="text-[10px] text-amber-600">SPEECHMATICS_API_KEY required</span>}
        </div>
        {uploadError && (
          <p className="text-[11px] text-red-600 font-semibold">{uploadError}</p>
        )}
      </div>

      {/* Sources list */}
      {sources.length === 0 ? (
        <div className="text-center py-6 text-[11px] text-slate-400">
          No audio sources tracked yet. Add a podcast episode or keynote URL above.
        </div>
      ) : (
        <div className="space-y-2">
          {sources.map(src => (
            <div key={src.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{src.label}</p>
                  <p className="text-[10px] text-slate-400 font-mono truncate">{src.url}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Status badge */}
                  {src.lastStatus === "scanning" && (
                    <span className="flex items-center gap-1 text-[9px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" /> Scanning
                    </span>
                  )}
                  {src.lastStatus === "done" && (
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                      {timeAgoShort(src.lastScannedAt)}
                    </span>
                  )}
                  {src.lastStatus === "no_speech" && (
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">No Speech</span>
                  )}
                  {src.lastStatus === "error" && (
                    <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">Error</span>
                  )}
                  {!src.lastStatus && (
                    <span className="text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">Not scanned</span>
                  )}
                  <button
                    onClick={() => scanSource(src.id)}
                    disabled={scanning[src.id] || src.lastStatus === "scanning" || !smReady}
                    title={!smReady ? "Add SPEECHMATICS_API_KEY to .env" : "Scan this audio source"}
                    className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded transition-colors"
                  >
                    <ScanLine className="w-3 h-3" /> Scan
                  </button>
                  <button onClick={() => deleteSource(src.id)} className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {src.latestInsight && (
                <div className="space-y-2">
                  <div className="bg-white border border-indigo-100 rounded px-3 py-2 text-[11px] text-slate-700 leading-relaxed flex gap-2">
                    <span className="text-indigo-500 shrink-0">›</span>
                    <span>{src.latestInsight}</span>
                  </div>
                  {src.lastStatus === "done" && (
                    <button
                      onClick={loadFullAnalysis}
                      disabled={analysisLoading}
                      className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors disabled:opacity-50"
                    >
                      {analysisLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {showAnalysis ? "▲ Hide Full Analysis" : "▼ View Full Analysis"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Full analysis panel */}
      {showAnalysis && fullAnalysis?.analysis && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Full Intelligence Report</h4>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${fullAnalysis.analysis.toneShift === "bullish" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : fullAnalysis.analysis.toneShift === "defensive" ? "bg-red-50 text-red-600 border border-red-200" : "bg-slate-100 text-slate-600 border border-slate-200"}`}>
                {(fullAnalysis.analysis.toneShift ?? "neutral").toUpperCase()}
              </span>
              <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                Impact {fullAnalysis.impactScore}/100
              </span>
            </div>
          </div>

          {(["roadmapHints", "positioningShifts", "competitiveMentions", "growthSignals", "keyQuotes"] as const).map(field => {
            const items = fullAnalysis.analysis[field] as string[] | undefined;
            if (!items?.length) return null;
            const labels: Record<string, string> = {
              roadmapHints: "🗺 Roadmap Hints",
              positioningShifts: "🔄 Positioning Shifts",
              competitiveMentions: "⚔️ Competitive Mentions",
              growthSignals: "📈 Growth Signals",
              keyQuotes: "💬 Key Quotes",
            };
            return (
              <div key={field}>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{labels[field]}</p>
                <ul className="space-y-1">
                  {items.map((item, i) => (
                    <li key={i} className="text-[11px] text-slate-700 leading-snug flex gap-1.5">
                      <span className="text-indigo-400 shrink-0 mt-0.5">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PricingScanner({ competitorName }: { competitorName: string }) {
  const [url, setUrl]       = useState(() => guessPricingUrl(competitorName));
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<PricingScanResult | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const scan = async () => {
    setScanning(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/pricing-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, competitorName }),
      });
      if (!r.ok) { const e = await r.json() as { error?: string }; throw new Error(e.error || `HTTP ${r.status}`); }
      setResult(await r.json() as PricingScanResult);
    } catch (e) { setError(String(e)); }
    finally { setScanning(false); }
  };

  const badge = result ? sourceLabel(result.source) : { text: "Web Unlocker", cls: "bg-emerald-600 text-white" };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <ScanLine className="w-4 h-4 text-emerald-600" />
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Live Pricing Scanner</span>
        <span className={`ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${badge.cls}`}>{badge.text}</span>
        {result?.changed && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full ml-auto animate-pulse">
            <AlertTriangle className="w-2.5 h-2.5" /> PRICE CHANGE DETECTED
          </span>
        )}
        {result && !result.changed && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full ml-auto">
            <CheckCircle2 className="w-2.5 h-2.5" /> No Change
          </span>
        )}
      </div>

      <div className="px-4 py-3 flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)}
          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 focus:outline-none focus:border-emerald-400"
          placeholder="https://competitor.com/pricing" />
        <button onClick={scan} disabled={scanning || !url.trim()}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg transition-colors shrink-0">
          {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
          {scanning ? "Fetching…" : "Scan Pricing"}
        </button>
      </div>

      {error && <div className="px-4 pb-3 text-xs text-red-500">{error}</div>}

      {scanning && (
        <div className="px-4 pb-4 text-xs text-slate-400 text-center">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400 mx-auto mb-1" />
          Fetching live pricing page via Bright Data…
        </div>
      )}

      {result && (
        <div className="px-4 pb-4 space-y-3">
          {result.summary && (
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pricing Summary</p>
              <p className="text-xs text-slate-700 leading-relaxed">{result.summary}</p>
            </div>
          )}
          {result.tiers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Detected Tiers</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {result.tiers.map((tier, i) => {
                  const hasPrice = !!(tier.price && tier.price !== "N/A" && tier.price !== "—" && tier.price.trim());
                  return (
                    <div key={i} className={`bg-white border rounded-lg p-3 text-center ${hasPrice ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
                      <p className="text-xs font-bold text-slate-800">{tier.name || `Tier ${i + 1}`}</p>
                      <p className={`text-sm font-extrabold mt-0.5 ${hasPrice ? "text-emerald-700" : "text-slate-400"}`}>
                        {hasPrice ? tier.price : "—"}
                      </p>
                      {tier.billing && <p className="text-[9px] text-slate-400 mt-0.5">{tier.billing}</p>}
                      {!hasPrice && <p className="text-[8px] text-slate-400 mt-0.5">No price listed</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {result.changes.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3">
              <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1">Signals Detected</p>
              {result.changes.map((c, i) => (
                <p key={i} className="text-xs text-red-700 leading-relaxed">• {c}</p>
              ))}
            </div>
          )}
          {result.tiers.length > 0 && result.tiers.every((t: PricingTier) => !t.price || t.price === "N/A" || t.price === "—") && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800">
              Products detected but no prices found — this site links out to retailers.
              Try scanning a retailer page: <span className="font-mono font-bold">walgreens.com</span>, <span className="font-mono font-bold">iherb.com</span>, or <span className="font-mono font-bold">amazon.com</span>
            </div>
          )}
          <p className="text-[9px] text-slate-400">Source: {result.source} · {result.url}</p>
        </div>
      )}
    </div>
  );
}

export default function CompetitorsView({ initialCompetitorName = "Competitor X" }: { initialCompetitorName?: string }) {
  const [activeCompetitor, setActiveCompetitor] = useState<string>("");
  const [competitorList, setCompetitorList] = useState<string[]>([]);
  const [queryInput, setQueryInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [validating, setValidating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  
  // Storage of loaded competitor models
  const [loadedBattlecards, setLoadedBattlecards] = useState<Record<string, CompetitorBattlecard>>({});
  const loadedBattlecardsRef = useRef(loadedBattlecards);
  useEffect(() => { loadedBattlecardsRef.current = loadedBattlecards; });
  
  // Filters for events
  const [eventFilter, setEventFilter] = useState<"all" | "pricing" | "product" | "messaging" | "hiring">("all");
  
  // Expanded battlecard objection IDs
  const [expandedObjection, setExpandedObjection] = useState<number | null>(0);
  const [logoErrors,         setLogoErrors]         = useState<Record<string, boolean>>({});
  const [competitorDetails,  setCompetitorDetails]   = useState<Record<string, { id: string; domain: string; industry?: string; hqCity?: string }>>({});
  const competitorDetailsRef = useRef(competitorDetails);
  useEffect(() => { competitorDetailsRef.current = competitorDetails; }, [competitorDetails]);

  // Load competitor battlecard info
  const fetchCompetitorData = async (compName: string) => {
    if (loadedBattlecardsRef.current[compName]) {
      setActiveCompetitor(compName);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/competitor-battlecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: compName }),
      });

      if (!response.ok) throw new Error("Failed to load competitor battlecard.");

      const data: CompetitorBattlecard = await response.json();

      // If AI returned a cleaner name (e.g. "Nestlé Health Science" vs "Nestlehealthscience"),
      // update the competitor list, cache, and DB
      const aiName = data.competitorName?.trim();
      const displayName = (aiName && aiName !== compName && aiName.length > 1) ? aiName : compName;

      if (displayName !== compName) {
        const detail = competitorDetailsRef.current[compName];
        if (detail?.id) {
          fetch(`/api/competitors/${detail.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: displayName, domain: detail.domain }),
          }).catch(() => {});
        }
        setCompetitorList(prev => prev.map(n => n === compName ? displayName : n));
        setCompetitorDetails(prev => {
          const copy = { ...prev };
          if (copy[compName]) { copy[displayName] = copy[compName]; delete copy[compName]; }
          return copy;
        });
      }

      setLoadedBattlecards(prev => ({ ...prev, [displayName]: data }));
      setActiveCompetitor(displayName);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to initialize competitor data stream.");
    } finally {
      setLoading(false);
    }
  };

  // Load real competitors from DB on mount, then clean up concatenated names via AI
  useEffect(() => {
    fetch("/api/competitors")
      .then(r => r.json())
      .then((d) => {
        const comps = (d.data ?? d) as Array<{ id: string; name: string; domain: string; industry?: string; hqCity?: string }>;
        const names = comps.map(c => c.name);
        const details: Record<string, { id: string; domain: string; industry?: string; hqCity?: string }> = {};
        comps.forEach(c => { details[c.name] = { id: c.id, domain: c.domain, industry: c.industry, hqCity: c.hqCity }; });
        setCompetitorDetails(prev => ({ ...prev, ...details }));
        setCompetitorList(prev => [...new Set([...names, ...prev])]);
        if (names.length > 0 && !activeCompetitor) fetchCompetitorData(names[0]);
      })
      .catch(() => {});

    // Pre-warm first 3 competitors' battlecards silently so clicks are instant
    setTimeout(() => {
      fetch("/api/competitors")
        .then(r => r.json())
        .then((d) => {
          const comps = (d.data ?? d) as Array<{ name: string }>;
          comps.slice(0, 3).forEach(c => {
            if (!loadedBattlecardsRef.current[c.name]) {
              fetch("/api/competitor-battlecard", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: c.name }),
              })
              .then(r => r.ok ? r.json() : null)
              .then((data: CompetitorBattlecard | null) => {
                if (data) setLoadedBattlecards(prev => ({ ...prev, [c.name]: data }));
              })
              .catch(() => {});
            }
          });
        })
        .catch(() => {});
    }, 2000);

    // Clean concatenated domain-based names in background, then reload
    fetch("/api/competitors/clean-names", { method: "POST", headers: { "Content-Type": "application/json" } })
      .then(r => r.ok ? r.json() : null)
      .then((d: { updated: number; updates: { id: string; old: string; new: string }[] } | null) => {
        if (!d || d.updated === 0) return;
        // Reload the competitor list with cleaned names
        return fetch("/api/competitors").then(r => r.json()).then((fresh) => {
          const comps = (fresh.data ?? fresh) as Array<{ id: string; name: string; domain: string; industry?: string; hqCity?: string }>;
          const names = comps.map(c => c.name);
          const details: Record<string, { id: string; domain: string; industry?: string; hqCity?: string }> = {};
          comps.forEach(c => { details[c.name] = { id: c.id, domain: c.domain, industry: c.industry, hqCity: c.hqCity }; });
          setCompetitorDetails(details);
          setCompetitorList(names);
        });
      })
      .catch(() => {});
  }, []);

  // Sync with prop from outside (like clicking "objection handler" on the dashboard)
  useEffect(() => {
    if (initialCompetitorName) {
      if (!competitorList.includes(initialCompetitorName)) {
        setCompetitorList(prev => [...prev, initialCompetitorName]);
      }
      fetchCompetitorData(initialCompetitorName);
    }
  }, [initialCompetitorName]);

  const handleGenerateCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queryInput.trim();
    if (!raw || raw.length < 2) return;

    setErrorMsg(null);
    setValidating(true);

    try {
      // Step 1: Validate company name via SERP
      const validateResp = await fetch("/api/competitors/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: raw }),
      });
      let validateData: { valid: boolean; name?: string; domain?: string; error?: string } = { valid: true, name: raw, domain: `${raw.toLowerCase().replace(/\s+/g, "")}.com` };
      try { validateData = await validateResp.json(); } catch { /* non-JSON — treat as valid, skip server-side check */ }

      if (!validateData.valid) {
        setErrorMsg(validateData.error ?? `"${raw}" doesn't appear to be a valid company name.`);
        return;
      }

      const companyName = validateData.name ?? raw;
      const companyDomain = validateData.domain ?? `${raw.toLowerCase().replace(/\s+/g, "")}.com`;

      setValidating(false);
      setLoading(true);

      // Step 2: Persist to DB if not already tracked
      if (!competitorList.includes(companyName)) {
        const saveResp = await fetch("/api/competitors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: companyName, domain: companyDomain }),
        });
        if (saveResp.ok) {
          const saved = await saveResp.json() as { data: { id: string; domain: string; industry?: string; hqCity?: string } };
          const c = saved.data;
          setCompetitorDetails(prev => ({ ...prev, [companyName]: { id: c.id, domain: c.domain, industry: c.industry, hqCity: c.hqCity } }));
          setCompetitorList(prev => [...prev, companyName]);
        }
      }

      // Step 3: Fetch battlecard
      const response = await fetch("/api/competitor-battlecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: companyName }),
      });

      if (!response.ok) throw new Error("AI extraction failed.");

      const data: CompetitorBattlecard = await response.json();
      setLoadedBattlecards(prev => ({ ...prev, [companyName]: data }));
      setActiveCompetitor(companyName);
      setQueryInput("");
      triggerToast(`Battlecard generated for ${companyName}!`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to add competitor.");
    } finally {
      setLoading(false);
      setValidating(false);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    triggerToast("Battlecard talk track copied to clipboard!");
  };

  // Extract profiles
  const currentCard = loadedBattlecards[activeCompetitor];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      
      {/* Toast alert indicator */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-950 text-white font-sans text-xs font-semibold px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2"
          >
            <Sparkle className="w-4 h-4 text-emerald-400 animate-spin" />
            <span>{toastMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Competitors Sidebar Selection Column */}
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-450 mb-3 flex items-center gap-2">
            <Swords className="w-4 h-4 text-indigo-600" />
            COMPETITOR PIPELINE
          </h3>

          {/* New Competitor Search & AI Generator Form */}
          <form onSubmit={handleGenerateCompetitor} className="mb-4 space-y-1.5">
            <div className="relative">
              <input
                type="text"
                value={queryInput}
                onChange={(e) => { setQueryInput(e.target.value); setErrorMsg(null); }}
                placeholder="Enter company name…"
                disabled={loading || validating}
                className={`w-full bg-white border rounded-lg pl-9 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 transition-colors disabled:opacity-60 ${errorMsg ? "border-red-400 focus:border-red-400 focus:ring-red-300" : "border-slate-300 focus:border-indigo-400 focus:ring-indigo-400"}`}
              />
              <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-450" />
              <button
                type="submit"
                disabled={loading || validating || !queryInput.trim()}
                className="absolute right-2 top-1.5 w-6 h-6 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-indigo-600 rounded-md flex items-center justify-center border border-slate-200 transition-colors"
              >
                {validating || loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
            {validating && (
              <p className="text-[10px] text-indigo-600 font-semibold flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" /> Validating company…
              </p>
            )}
            {errorMsg && (
              <p className="text-[10px] text-red-600 font-semibold leading-snug">{errorMsg}</p>
            )}
          </form>

          {/* List of active targets */}
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {competitorList.map((comp) => {
              const isActive = comp === activeCompetitor;
              return (
                <button
                  id={`competitor-btn-${comp.replace(/\s+/g, '-')}`}
                  key={comp}
                  onClick={() => fetchCompetitorData(comp)}
                  disabled={loading}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-bold transition-all border ${
                    isActive
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "text-slate-650 hover:bg-slate-50 border-transparent hover:text-indigo-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{comp}</span>
                    <ArrowRight className={`w-3.5 h-3.5 transition-transform ${isActive ? "text-indigo-600 translate-x-0.5" : "text-transparent"}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Global Competitor Advisory Box */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 text-[11px] text-slate-500 shadow-sm space-y-1">
          <div className="text-slate-900 font-extrabold font-sans mb-1">Sentinel Advisory</div>
          <p>Search any competitor and click <strong>+</strong> to generate a live battlecard. AI analyses real-time web signals via Bright Data to produce threat intelligence dynamically.</p>
        </div>
      </div>

      {/* Competitor Profile Details */}
      <div className="lg:col-span-3">
        {loading ? (
          <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-16 flex flex-col items-center justify-center text-center space-y-4 h-full">
            <div className="w-12 h-12 rounded-full border-4 border-slate-100 border-t-indigo-600 animate-spin"></div>
            <p className="text-sm font-sans text-slate-600 font-medium">Consulting GTM ledger pipelines and structural updates...</p>
          </div>
        ) : !currentCard ? (
          <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-16 text-center space-y-4">
            <Swords className="w-12 h-12 text-slate-400 mx-auto" />
            <h4 className="text-base text-slate-900 font-bold">Ready to Extract Competitor Battlecard</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">Select a competitor from the left sidebar or type any competitor to parse their firmographic signals and combat tracks.</p>
            <button 
              onClick={() => fetchCompetitorData("Competitor X")}
              className="text-xs bg-indigo-600 text-white font-bold px-4 py-2.5 rounded-lg hover:bg-indigo-700 transition"
            >
              Analyze Competitor X
            </button>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Offline mode notice */}
            {currentCard._offlineMode && (
              <div className="flex items-center gap-3 bg-amber-500 rounded-xl px-5 py-4 text-white shadow-lg">
                <AlertTriangle className="w-5 h-5 shrink-0 text-white" />
                <div>
                  <p className="text-sm font-extrabold tracking-wide">DEMO DATA — NOT LIVE INTELLIGENCE</p>
                  <p className="text-xs font-medium mt-0.5 text-amber-100">AI timed out or AIML_API_KEY not configured. Numbers below are illustrative only — not real competitor data.</p>
                </div>
              </div>
            )}

            {/* Competitor Card Header */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm relative overflow-hidden">
              {(() => {
                const det = competitorDetails[activeCompetitor];
                const domain = det?.domain ?? (activeCompetitor.toLowerCase().replace(/\s+/g, "") + ".com");
                const industry = det?.industry;
                const hqCity = det?.hqCity;
                return (
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                      {logoErrors[activeCompetitor] ? (
                        <span className="text-2xl font-bold text-indigo-600">{activeCompetitor[0]?.toUpperCase()}</span>
                      ) : (
                        <img
                          src={`https://logo.clearbit.com/${domain}`}
                          alt={currentCard.competitorName}
                          className="w-full h-full object-contain p-1.5"
                          onError={() => setLogoErrors(prev => ({ ...prev, [activeCompetitor]: true }))}
                        />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold text-slate-900 capitalize">{currentCard.competitorName}</h2>
                        <span className="text-[10px] bg-rose-50 border border-rose-100 text-rose-700 font-sans py-0.5 px-1.5 rounded uppercase font-bold">
                          Monitored
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-550 mt-1 font-sans font-semibold">
                        {industry && <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5 text-slate-400" />{industry}</span>}
                        {hqCity && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{hqCity}</span>}
                        <span className="flex items-center gap-1 text-slate-400 font-mono text-[10px]">{domain}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 w-full md:w-auto">
                <a 
                  href={`https://${currentCard.competitorName.toLowerCase().replace(/\s+/g, "")}.com`}
                  target="_blank" 
                  rel="noreferrer"
                  className="text-xs bg-slate-50 text-slate-705 border border-slate-200 hover:bg-slate-100 py-1.5 px-3 rounded-lg hover:text-slate-900 font-bold text-center w-full md:w-auto transition-colors"
                >
                  Visit Website
                </a>
              </div>
            </div>

            {/* Core Stats / Radial Threat Dials and Strategic weaknesses bento */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Threat Assessment Gauge */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between items-center text-center shadow-sm">
                <h4 className="text-xs font-bold text-slate-450 uppercase tracking-wider mb-4 w-full text-left">Threat Evaluation</h4>
                
                {/* SVG Radial Gauge */}
                <div className="relative w-36 h-36 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="72" cy="72" r="54" stroke="#f1f3f5" strokeWidth="10" fill="transparent" />
                    <circle 
                      cx="72" 
                      cy="72" 
                      r="54" 
                      stroke="#6366f1" 
                      strokeWidth="10" 
                      fill="transparent" 
                      strokeDasharray={2 * Math.PI * 54}
                      strokeDashoffset={(2 * Math.PI * 54) * (1 - currentCard.threatLevel / 100)}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="text-2xl font-sans font-bold text-slate-900 mb-0.5">{currentCard.threatLevel}%</span>
                    <span className="text-[10px] text-slate-450 uppercase tracking-widest font-bold">THREAT</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 w-full mt-5 border-t border-slate-100 pt-4 text-xs font-semibold">
                  <div>
                    <div className="text-slate-400 text-[9px] uppercase">Market Overlap</div>
                    <div className="text-slate-800 mt-1 font-bold">{currentCard.marketOverlap}%</div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[9px] uppercase">Feature Parity</div>
                    <div className="text-slate-800 mt-1 font-bold">{currentCard.featureParity}%</div>
                  </div>
                </div>
              </div>

              {/* Strategic Summary (Weaknesses vs Strengths) */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 md:col-span-2 flex flex-col justify-between shadow-sm">
                <div>
                  <h4 className="text-xs font-bold text-slate-450 uppercase tracking-wider mb-3 w-full border-b border-slate-105 pb-2">Strategic Summary</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    
                    {/* Strengths */}
                    <div className="space-y-2">
                      <div className="text-emerald-700 text-xs font-bold flex items-center gap-1 uppercase tracking-wider">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Strengths
                      </div>
                      <ul className="space-y-1.5 text-[11px] text-slate-600 list-disc pl-3 font-medium">
                        {currentCard.strategicSummary.strengths.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>

                    {/* Weaknesses */}
                    <div className="space-y-2">
                      <div className="text-rose-700 text-xs font-bold flex items-center gap-1 uppercase tracking-wider">
                        <X className="w-3.5 h-3.5 bg-rose-50 border border-rose-200 text-rose-600 rounded-full" /> Key Vulnerabilities
                      </div>
                      <ul className="space-y-1.5 text-[11px] text-slate-600 list-disc pl-3 font-medium">
                        {currentCard.strategicSummary.weaknesses.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>

                  </div>
                </div>

                {currentCard.strategicSummary.weaknesses.length > 0 && (
                  <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-3 flex items-center gap-2 text-[10.5px] text-indigo-700 font-semibold">
                    <Sparkle className="w-4 h-4 shrink-0 text-indigo-600" />
                    <span>Exploit key gap: {currentCard.strategicSummary.weaknesses[0]}</span>
                  </div>
                )}
              </div>

            </div>

            {/* Timelines and Objection Tracks */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              
              {/* Timeline list */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-3 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-105 pb-3 mb-4">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    Timeline Signals Feed
                  </h3>
                  
                  {/* Inline Timeline Filters */}
                  <div className="flex bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 max-w-max">
                    <button 
                      onClick={() => setEventFilter("all")}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all ${eventFilter === "all" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      All
                    </button>
                    <button 
                      onClick={() => setEventFilter("pricing")}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all ${eventFilter === "pricing" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Pricing
                    </button>
                    <button 
                      onClick={() => setEventFilter("product")}
                      className={`text-[10px] font-bold px-2.5 py-1 rounded transition-all ${eventFilter === "product" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                    >
                      Product
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {currentCard.timeline
                    .filter(ev => eventFilter === "all" || ev.type === eventFilter)
                    .map((ev) => (
                      <div key={ev.id} className="relative pl-5 border-l-2 border-slate-200 space-y-1 group">
                        <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-white transition-colors group-hover:bg-rose-500"></div>
                        
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-mono text-slate-400 font-bold">{ev.time}</span>
                          <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                            ev.type === "pricing" 
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-150" 
                              : "bg-indigo-50 text-indigo-700 border border-indigo-150"
                          }`}>
                            {ev.type}
                          </span>
                        </div>

                        <h5 className="text-xs font-bold text-slate-850">{ev.title}</h5>
                        <p className="text-[11px] text-slate-505 font-medium leading-snug">{ev.description}</p>

                        {/* Special Values Highlight for pricing tier releases etc */}
                        {ev.previousValue && ev.newValue && (
                          <div className="flex items-center gap-2 text-[10px] font-mono mt-1 pt-1 border-t border-slate-100 max-w-max">
                            <span className="text-slate-400 line-through">{ev.previousValue}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="text-emerald-600 font-bold">{ev.newValue}</span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Objection cards list */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-2 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900 pb-3 border-b border-slate-105 mb-4 flex items-center gap-1.5">
                  <Grid className="w-4 h-4 text-indigo-600" />
                  Objection Battlecards
                </h3>

                <div className="space-y-2">
                  {currentCard.battlecards.map((bt, index) => {
                    const isExpanded = expandedObjection === index;
                    return (
                      <div 
                        key={index} 
                        className="bg-slate-50/70 border border-slate-205 rounded-lg overflow-hidden transition-all duration-300 shadow-xs"
                      >
                        <button
                          onClick={() => setExpandedObjection(isExpanded ? null : index)}
                          className="w-full flex items-center justify-between p-3.5 text-left text-xs text-slate-700 hover:text-indigo-650 font-bold"
                        >
                          <span className="truncate">{bt.title}</span>
                          <span className="text-[10px] font-sans uppercase text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-155 bg-indigo-50 font-bold">
                            {bt.category}
                          </span>
                        </button>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: "auto" }}
                              exit={{ height: 0 }}
                              className="overflow-hidden border-t border-slate-150"
                            >
                              <div className="p-3.5 space-y-3">
                                <p className="text-[11px] text-slate-600 leading-relaxed font-sans font-medium">
                                  {bt.content}
                                </p>
                                <button
                                  onClick={() => handleCopyText(bt.content)}
                                  className="text-[10px] font-mono font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 ml-auto"
                                >
                                  <Copy className="w-3.5 h-3.5" /> COPY TALK TRACK
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {competitorDetails[activeCompetitor]?.id && (
              <PodcastMonitor
                competitorId={competitorDetails[activeCompetitor].id}
                competitorName={currentCard.competitorName}
              />
            )}

            {/* Live Pricing Scanner — Bright Data Scraping Browser */}
            <PricingScanner competitorName={currentCard.competitorName} />

          </div>
        )}
      </div>

    </div>
  );
}
