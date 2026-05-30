import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2,
  Search,
  MapPin,
  DollarSign,
  Users,
  TrendingUp,
  Cpu,
  BellRing,
  Sparkle,
  Copy,
  ArrowRight,
  Info,
  Linkedin,
  Zap,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { CompanyEnrichment } from "../types";

interface BuyingSignal {
  title: string; url: string; snippet: string;
  intentScore: number; signalType: string; reason: string;
}
interface BuyingSignalsResult {
  company: string; signals: BuyingSignal[]; overallScore: number; source: string;
}

function IntentScoreBadge({ score }: { score: number }) {
  const color = score >= 75 ? "bg-red-100 text-red-700 border-red-200"
    : score >= 55 ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${color}`}>{score}</span>
  );
}

function BuyingIntentPanel({ companyName }: { companyName: string }) {
  const [data, setData]       = useState<BuyingSignalsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const fetch_ = async () => {
    setLoading(true); setError(null); setData(null);
    try {
      const r = await fetch(`/api/buying-signals?company=${encodeURIComponent(companyName)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json() as BuyingSignalsResult);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Linkedin className="w-4 h-4 text-blue-600" />
        <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">LinkedIn Buying Intent</span>
        <span className="ml-1 text-[9px] font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded uppercase">Bright Data Live</span>
        {data && (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500">Intent Score:</span>
            <span className={`text-sm font-extrabold ${data.overallScore >= 70 ? "text-red-600" : data.overallScore >= 50 ? "text-amber-600" : "text-slate-600"}`}>
              {data.overallScore}
            </span>
            <span className="text-[10px] text-slate-400">/100</span>
          </div>
        )}
        <button onClick={fetch_} disabled={loading}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg ml-2 transition-colors">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          {loading ? "Scanning…" : "Scan LinkedIn"}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 text-xs text-red-500">{error}</div>
      )}

      {!data && !loading && !error && (
        <div className="px-4 py-6 text-center text-xs text-slate-400">
          <Linkedin className="w-6 h-6 text-slate-200 mx-auto mb-1" />
          Click "Scan LinkedIn" to detect live buying intent signals from Bright Data
        </div>
      )}

      {loading && (
        <div className="px-4 py-6 text-center text-xs text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-blue-400 mx-auto mb-1" />
          Scraping LinkedIn via Bright Data SERP…
        </div>
      )}

      {data && data.signals.length === 0 && (
        <div className="px-4 py-4 text-xs text-slate-400 text-center">No LinkedIn signals found for {data.company}.</div>
      )}

      {data && data.signals.length > 0 && (
        <div className="divide-y divide-slate-50">
          {data.signals.map((sig, i) => (
            <div key={i} className="px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={sig.url} target="_blank" rel="noreferrer"
                      className="text-xs font-semibold text-slate-800 hover:text-blue-600 truncate flex items-center gap-0.5">
                      {sig.title.slice(0, 60)}{sig.title.length > 60 ? "…" : ""}
                      <ExternalLink className="w-2.5 h-2.5 opacity-50 shrink-0" />
                    </a>
                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full shrink-0">{sig.signalType}</span>
                  </div>
                  {sig.reason && <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{sig.reason}</p>}
                  {sig.snippet && !sig.reason && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sig.snippet.slice(0, 100)}</p>}
                </div>
                <IntentScoreBadge score={sig.intentScore} />
              </div>
            </div>
          ))}
          <div className="px-4 py-2 bg-slate-50 flex items-center gap-1.5">
            <span className="text-[9px] text-slate-400">Source: Bright Data SERP LinkedIn • {data.signals.length} signals found</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AccountsView({ initialDomain = "stripe.com" }: { initialDomain?: string }) {
  const [domainQuery, setDomainQuery] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeProfile, setActiveProfile] = useState<CompanyEnrichment | null>(null);
  
  // Custom outreach drafted value so they can edit inline!
  const [draftedEmail, setDraftedEmail] = useState<string>("");

  const runAccountEnrichment = async (domain: string) => {
    if (!domain) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/enrich-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });

      if (!res.ok) {
        let errMsg = "Enrichment failed.";
        try {
          const body = await res.json() as { error?: string; details?: string };
          const details = body.details ?? body.error ?? "";
          const retryMatch = details.match(/retry in ([\d.]+)s/i);
          if (retryMatch) errMsg = `AI rate limit — retry in ${Math.ceil(Number(retryMatch[1]))}s.`;
          else if (details.includes("429") || details.includes("rate_limit")) errMsg = "AI rate limit exceeded — try again in a moment.";
          else errMsg = body.error || errMsg;
        } catch { /* response was not JSON */ }
        throw new Error(errMsg);
      }

      const data: CompanyEnrichment = await res.json();
      setActiveProfile(data);
      setDraftedEmail(data.aiSynthesis?.outreachMessage || "");
      if (domain !== "stripe.com") {
        triggerToast(`Successfully enriched GTM signals for ${data.name}!`);
      }
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to query server intelligence databases.");
    } finally {
      setLoading(false);
    }
  };

  // Only auto-enrich when explicitly navigated from another view (non-default domain)
  useEffect(() => {
    if (initialDomain && initialDomain !== "stripe.com") {
      runAccountEnrichment(initialDomain);
    }
  }, [initialDomain]);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg(null);
    }, 3000);
  };

  const handleEnrichForm = (e: React.FormEvent) => {
    e.preventDefault();
    const query = domainQuery.trim();
    if (query) {
      runAccountEnrichment(query);
      setDomainQuery("");
    }
  };

  const handleCopyClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    triggerToast("Outreach email copy saved to clipboard!");
  };

  return (
    <div className="space-y-6">
      
      {/* Dynamic Toast Alert */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div 
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-950 text-white font-sans text-xs font-semibold px-4 py-2.5 rounded-lg shadow-2xl flex items-center gap-2"
          >
            <Sparkle className="w-4 h-4 text-amber-400 animate-spin" />
            <span>{toastMsg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Account Query Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            Target Account Enrichment
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Track firmographics, technographics, and custom sales outreach generation.
          </p>
        </div>

        {/* Search tool block */}
        <form onSubmit={handleEnrichForm} className="flex gap-2 w-full md:w-80">
          <input
            type="text"
            value={domainQuery}
            onChange={(e) => setDomainQuery(e.target.value)}
            placeholder="enrich e.g., adyen.com, strip..."
            className="flex-1 bg-white border border-slate-300 rounded-lg py-2 px-3 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white transition-colors py-2 px-4 rounded-lg text-xs font-bold flex items-center gap-1.5 shrink-0"
          >
            {loading ? "Enriching..." : "Analyze"}
            <Search className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {loading ? (
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-20 text-center flex flex-col items-center justify-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-indigo-600 animate-spin"></div>
          <p className="text-sm text-slate-600 font-medium">Consulting global web signals registry and computing sales vectors...</p>
        </div>
      ) : errorMessage || !activeProfile ? (
        <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-16 text-center space-y-4">
          <Building2 className="w-12 h-12 text-slate-450 mx-auto" />
          <h3 className="text-lg font-bold text-slate-800">No Account Loaded</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {errorMessage || "Use the search bar above to look up any domain or company name for comprehensive target profiling."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Account Info Column */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Header Profile Info card */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-4 relative overflow-hidden shadow-sm">
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/5 to-transparent rounded-bl-3xl"></div>
              
              <div className="w-16 h-16 bg-slate-50 border border-slate-200 rounded-lg shrink-0 flex items-center justify-center overflow-hidden p-2">
                <img
                  src={`https://logo.clearbit.com/${activeProfile.domain}`}
                  onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `https://www.google.com/s2/favicons?domain=${activeProfile.domain}&sz=128`; }}
                  alt={`${activeProfile.name} logo`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain mix-blend-multiply opacity-100 rounded bg-transparent"
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900 truncate">{activeProfile.name}</h3>
                  <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold py-0.5 px-2 rounded-full border border-indigo-100">
                    Intent Score: {activeProfile.intentScore}/100
                  </span>
                  
                  {activeProfile.isPublicTarget && (
                    <span className="text-[10px] bg-emerald-50 border border-emerald-150 text-emerald-700 font-bold py-0.5 px-2 rounded-full uppercase">
                      Core target
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 text-xs text-slate-500 mt-1.5 font-sans font-medium">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" /> {activeProfile.hqLocation}</span>
                  <span>•</span>
                  <a 
                    href={`https://${activeProfile.domain}`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="text-indigo-600 hover:text-indigo-800 font-bold transition-colors"
                  >
                    {activeProfile.domain}
                  </a>
                </div>
              </div>
            </div>

            {/* Firmographics Bento Grid */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-indigo-600" /> Account Firmographics
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-150">
                  <div className="text-[10px] uppercase text-slate-450 font-bold">Funding</div>
                  <div className="text-slate-800 font-extrabold text-sm mt-1 flex items-center gap-1">
                    <DollarSign className="w-4 h-4 text-indigo-600 shrink-0" />
                    {activeProfile.firmographics?.fundingTotal || "N/A"}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">{activeProfile.firmographics?.fundingStage || "Stage N/A"}</div>
                </div>

                <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-150">
                  <div className="text-[10px] uppercase text-slate-450 font-bold">ARR (Estimated)</div>
                  <div className="text-slate-800 font-extrabold text-sm mt-1">
                    {activeProfile.firmographics?.revenueRange || "N/A"}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">{activeProfile.firmographics?.revenueDetails || "N/A"}</div>
                </div>

                <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-150">
                  <div className="text-[10px] uppercase text-slate-450 font-bold">Employees</div>
                  <div className="text-slate-800 font-extrabold text-sm mt-1 flex items-center gap-1">
                    <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                    {activeProfile.firmographics?.employees || "N/A"}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">{activeProfile.firmographics?.growthYoY || "Stable"}</div>
                </div>

                <div className="p-3 bg-slate-50/70 rounded-lg border border-slate-150">
                  <div className="text-[10px] uppercase text-slate-450 font-bold">Industry Segment</div>
                  <div className="text-slate-800 font-extrabold text-sm mt-1">
                    {activeProfile.firmographics?.industry || "SaaS"}
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">{activeProfile.firmographics?.industryDetails || "Technology"}</div>
                </div>
              </div>
            </div>

            {/* Technographics widget */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-600" /> Core Technographic Stack
              </h4>

              <div className="flex flex-wrap gap-2">
                {activeProfile.technographics?.map((tech, i) => (
                  <span 
                    key={i} 
                    className="text-xs bg-slate-50 text-slate-705 font-bold border border-slate-200 px-3 py-1 rounded-md hover:border-indigo-300 transition-all font-mono"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* Live Web Signals timeline */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-indigo-600 animate-pulse" /> Recent Live Web Signals
              </h4>

              <div className="space-y-4">
                {activeProfile.timeline?.map((ev) => (
                  <div key={ev.id} className="relative pl-6 border-l border-slate-200 space-y-1">
                    <div className="absolute -left-1.5 top-1.5 w-3 h-3 rounded-full bg-indigo-50 border border-indigo-600"></div>
                    
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-slate-400 font-bold uppercase">{ev.type}</span>
                      <span className="text-slate-500 font-semibold">{ev.time}</span>
                    </div>

                    <h5 className="text-xs font-bold text-slate-800">{ev.title}</h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed font-medium">{ev.description}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>

          {/* LinkedIn Buying Intent Panel */}
          <div className="lg:col-span-2">
            <BuyingIntentPanel companyName={activeProfile.name || domainQuery || "Stripe"} />
          </div>

          {/* AI Sales Outreach Angle & Custom message drawer */}
          <div className="lg:col-span-1 space-y-6">
            
            {/* AI Sales Synthesis Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h4 className="text-xs font-bold text-slate-450 uppercase tracking-wider flex items-center gap-2">
                  <Sparkle className="w-4 h-4 text-indigo-600" />
                  AI GTM Synthesis
                </h4>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold border border-indigo-100 py-0.5 px-2 rounded">
                  Copilot V1.4
                </span>
              </div>

              {/* Recommended Sales Angle */}
              <div className="space-y-1.5">
                <div className="text-[11px] uppercase text-slate-450 font-bold flex items-center gap-1">
                  <Info className="w-3.5 h-3.5 text-slate-400" /> Outreach Angle
                </div>
                <p className="text-xs text-slate-600 leading-relaxed font-medium bg-slate-50 border border-slate-150 rounded-lg p-3">
                  {activeProfile.aiSynthesis?.recommendedAngle}
                </p>
              </div>

              {/* Outreach templates with inline edits */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="uppercase text-slate-450 font-bold">DRAFT OUTBOUND MESSAGE</span>
                  <button 
                    onClick={() => handleCopyClipboard(draftedEmail)}
                    className="text-indigo-600 hover:text-indigo-850 transition-colors flex items-center gap-1 font-bold"
                  >
                    <Copy className="w-3 h-3" /> COPY TEMPLATE
                  </button>
                </div>
                
                <textarea
                  value={draftedEmail}
                  onChange={(e) => setDraftedEmail(e.target.value)}
                  className="w-full h-44 bg-slate-50 text-slate-800 text-xs font-mono p-3 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 leading-relaxed resize-none"
                />
              </div>

              {/* Stakeholder Personas Target grid */}
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="text-[11px] uppercase text-slate-450 font-bold">TARGET OUTREACH DIRECTIVES</div>
                
                <div className="space-y-2">
                  {activeProfile.aiSynthesis?.personas?.map((pers, i) => (
                    <div key={i} className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-lg border border-slate-200 hover:border-slate-350 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 font-bold text-xs text-indigo-700 flex items-center justify-center">
                        {pers.initials || "PE"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-805 truncate">{pers.name}</div>
                        <div className="text-[10px] text-slate-500 font-semibold truncate">{pers.title}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

    </div>
  );
}
