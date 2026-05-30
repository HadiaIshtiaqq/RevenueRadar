import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowRight, Zap, Target, Bell, Globe, TrendingUp,
  Sparkles, Building2, Activity, ChevronRight,
  X, Loader2, Eye, EyeOff, CheckCircle2,
} from "lucide-react";
import { LogoFull } from "./Logo";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  productName: string;
  productNiche: string;
  companyCity?: string;
  companyLat?: number;
  companyLng?: number;
}

interface LandingPageProps {
  onAuth: (token: string, user: AuthUser, isNewUser?: boolean) => void;
}

const FEATURES = [
  { icon: Target,    color: "indigo",  title: "Competitor Monitoring",    desc: "Track pricing pages, blogs, and job boards across all your competitors. Detect changes the moment they happen." },
  { icon: Zap,       color: "violet",  title: "Real-Time Signals",        desc: "Live web scraping via Bright Data surfaces hiring surges, funding rounds, and product launches instantly." },
  { icon: Sparkles,  color: "cyan",    title: "AI Signal Synthesis",      desc: "Every signal is analyzed automatically and distilled into executive-grade battlecards and strategic recommendations." },
  { icon: TrendingUp,color: "emerald", title: "Buying Intent Scoring",    desc: "Score accounts 0-100 based on job postings, funding signals, and leadership changes to prioritise outreach." },
  { icon: Bell,      color: "amber",   title: "Slack Alerts",             desc: "Critical competitor moves land in your Slack channel with AI-generated talk tracks ready to use." },
  { icon: Globe,     color: "rose",    title: "Live Web Intelligence",    desc: "Bright Data's proxy network unlocks any webpage — pricing, careers, news — at scale without blocks." },
];

const LIVE_FEED = [
  { type: "pricing",  company: "Nexus Flow",   msg: "Enterprise plan raised 30% → $1,299/mo",       time: "2m ago",  color: "rose" },
  { type: "hiring",   company: "Quantum SaaS", msg: "VP of Sales posted in London & Berlin",          time: "14m ago", color: "amber" },
  { type: "funding",  company: "Vanguard AI",  msg: "Raised $50M Series B — Sequoia led round",       time: "1h ago",  color: "emerald" },
  { type: "product",  company: "Drift Pro",    msg: "Launched 'Autonomous Compliance' dashboard",     time: "3h ago",  color: "indigo" },
  { type: "pricing",  company: "Nexus Flow",   msg: "Mid-market tier dropped 15% — price war signal", time: "5h ago",  color: "rose" },
];

const colorMap: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  indigo:  { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/20",  badge: "bg-indigo-500/20 text-indigo-300" },
  violet:  { bg: "bg-violet-500/10",  text: "text-violet-400",  border: "border-violet-500/20",  badge: "bg-violet-500/20 text-violet-300" },
  cyan:    { bg: "bg-cyan-500/10",    text: "text-cyan-400",    border: "border-cyan-500/20",    badge: "bg-cyan-500/20 text-cyan-300" },
  emerald: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/20", badge: "bg-emerald-500/20 text-emerald-300" },
  amber:   { bg: "bg-amber-500/10",   text: "text-amber-400",   border: "border-amber-500/20",   badge: "bg-amber-500/20 text-amber-300" },
  rose:    { bg: "bg-rose-500/10",    text: "text-rose-400",    border: "border-rose-500/20",    badge: "bg-rose-500/20 text-rose-300" },
};

const NICHES = [
  // Tech & Software
  "CRM & Sales Software", "Marketing Automation", "Revenue Intelligence", "Data Analytics",
  "DevOps & Infrastructure", "HR & Recruiting", "Customer Success", "Payment Processing",
  "Cybersecurity", "Project Management", "E-commerce Platform", "AI / LLM Tools",
  // Food & Beverage
  "Restaurant & Food Delivery", "Grocery & Supermarket", "Coffee & Beverages",
  "Packaged Food & Snacks", "Health Food & Nutrition",
  // Retail & Fashion
  "Clothing & Apparel", "Footwear", "Luxury Fashion", "Sportswear & Activewear",
  "Accessories & Jewellery", "Beauty & Cosmetics", "Skincare & Personal Care",
  // Health & Wellness
  "Healthcare & Clinics", "Pharmacy & Medicine", "Fitness & Gym", "Mental Health",
  "Supplements & Vitamins",
  // Home & Lifestyle
  "Home Furniture & Decor", "Electronics & Gadgets", "Home Appliances",
  "Cleaning Products", "Pet Products & Supplies",
  // Education & Media
  "Online Education & EdTech", "Books & Publishing", "Streaming & Entertainment",
  "Gaming", "News & Media",
  // Finance & Services
  "Banking & Fintech", "Insurance", "Real Estate", "Travel & Hospitality",
  "Logistics & Shipping", "Automotive",
  // Other
  "Other",
];

// ─── Auth Modal ───────────────────────────────────────────────────────────────

function AuthModal({ onClose, onAuth }: { onClose: () => void; onAuth: LandingPageProps["onAuth"] }) {
  const [tab,        setTab]        = useState<"signin" | "signup">("signup");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [showPw,     setShowPw]     = useState(false);

  // Sign-up fields
  const [name,         setName]         = useState("");
  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [productName,  setProductName]  = useState("");
  const [productNiche, setProductNiche] = useState("");
  const [companyCity,  setCompanyCity]  = useState("");
  const [consent,      setConsent]      = useState(false);
  const [modalType,    setModalType]    = useState<"terms" | "privacy" | null>(null);

  const reset = () => { setError(""); };

  const handleSignup = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!name || !email || !password || !productName || !productNiche) {
      setError("Please fill in all fields."); return;
    }
    if (!consent) {
      setError("Please accept the Terms of Service and Privacy Policy to continue."); return;
    }
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, productName, productNiche, companyCity }),
      });
      const data = await r.json() as { token?: string; user?: AuthUser; error?: string };
      if (!r.ok || !data.token) { setError(data.error || "Signup failed."); return; }
      onAuth(data.token, data.user!, true);
    } catch { setError("Network error — is the server running?"); }
    finally { setLoading(false); }
  };

  const handleSignin = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!email || !password) { setError("Email and password required."); return; }
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json() as { token?: string; user?: AuthUser; error?: string };
      if (!r.ok || !data.token) { setError(data.error || "Sign-in failed."); return; }
      onAuth(data.token, data.user!, false);
    } catch { setError("Network error — is the server running?"); }
    finally { setLoading(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-4 overflow-y-auto"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative z-10 w-full max-w-md bg-[#0d1224] border border-white/10 rounded-2xl shadow-2xl overflow-hidden my-auto"
      >
        {/* Header gradient bar */}
        <div className="h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-cyan-500" />

        <div className="p-8">
          {/* Logo + close */}
          <div className="flex items-center justify-between mb-6">
            <LogoFull dark size="sm" />
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab switcher */}
          <div className="flex bg-white/5 rounded-xl p-1 mb-6">
            {(["signup", "signin"] as const).map(t => (
              <button
                key={t}
                onClick={() => { setTab(t); reset(); }}
                className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                  tab === t
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/50"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {t === "signup" ? "Create Account" : "Sign In"}
              </button>
            ))}
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {tab === "signup" ? (
              <motion.form
                key="signup"
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleSignup}
                className="space-y-4"
              >
                <p className="text-xs text-slate-400 -mt-2 mb-4">
                  Tell us about your product and we'll automatically discover your competitors.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Full Name</label>
                    <input
                      value={name} onChange={e => setName(e.target.value)}
                      placeholder="Alex Sterling"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Work Email</label>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="alex@company.com"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div className="col-span-2 relative">
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Password</label>
                    <input
                      type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-8 text-slate-500 hover:text-slate-300">
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Product Name</label>
                    <input
                      value={productName} onChange={e => setProductName(e.target.value)}
                      placeholder="e.g. Stripe, HubSpot"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">
                      Company Location <span className="text-slate-600 normal-case font-normal">(city &amp; country)</span>
                    </label>
                    <input
                      value={companyCity} onChange={e => setCompanyCity(e.target.value)}
                      placeholder="e.g. San Francisco, USA"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Product Category</label>
                    <select
                      value={productNiche} onChange={e => setProductNiche(e.target.value)}
                      className="w-full bg-[#0d1224] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    >
                      <option value="">Select niche…</option>
                      {NICHES.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>

                {/* Custom Modal for Terms / Privacy */}
                {modalType && (
                  <div className="fixed inset-0 z-55 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setModalType(null)} />
                    <div className="relative z-10 w-full max-w-lg bg-[#0d1224] border border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 max-h-[80vh] overflow-y-auto">
                      <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
                        <h4 className="text-base font-bold text-white uppercase tracking-wider">
                          {modalType === "terms" ? "Terms of Service" : "Privacy Policy"}
                        </h4>
                        <button type="button" onClick={() => setModalType(null)} className="text-slate-400 hover:text-white transition-colors">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="text-xs text-slate-300 space-y-3 leading-relaxed">
                        {modalType === "terms" ? (
                          <>
                            <p><strong>1. Introduction</strong>: Welcome to RevenueRadarAI. By using our service, you agree to these terms.</p>
                            <p><strong>2. GTM Intelligence Monitoring</strong>: You authorize RevenueRadarAI to automatically discover and monitor public web signals, pricing tiers, job postings, and search trends for competitors that you designate during signup or in settings.</p>
                            <p><strong>3. Use of Bright Data Infrastructure</strong>: The system utilizes public proxies and scraping tools to aggregate publicly available web information. Users are responsible for ensuring compliance with local laws and regulations governing competitive intelligence collection.</p>
                            <p><strong>4. Disclaimer</strong>: Information is retrieved live and analyzed using AI. We do not guarantee the absolute accuracy of parsed competitor signals.</p>
                          </>
                        ) : (
                          <>
                            <p><strong>1. Information Collection</strong>: We collect your name, work email, hashed passwords, product information, and designated competitor domains to run intelligence queries.</p>
                            <p><strong>2. Signal Scraping Consent</strong>: We collect public domain search engine results (SERPs), job boards, and news articles to compile your dashboard feed. No proprietary client data is sold or shared.</p>
                            <p><strong>3. Third-party APIs</strong>: We process query inputs using AIML API and option-enabled integrations (Speechmatics, Cognee, Slack webhooks).</p>
                          </>
                        )}
                      </div>
                      <button type="button" onClick={() => setModalType(null)} className="w-full mt-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-lg text-xs transition-colors">
                        Close
                      </button>
                    </div>
                  </div>
                )}

                <label className="flex items-start gap-2.5 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5 select-none">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={e => setConsent(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="w-4.5 h-4.5 rounded border border-white/20 bg-white/5 peer-checked:bg-indigo-600 peer-checked:border-indigo-500 flex items-center justify-center transition-all group-hover:border-indigo-400">
                      {consent && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-400 leading-relaxed group-hover:text-slate-300 transition-colors">
                    I agree to the{" "}
                    <button
                      type="button"
                      onClick={() => setModalType("terms")}
                      className="text-indigo-400 underline cursor-pointer inline bg-transparent border-0 p-0 font-normal hover:text-indigo-300"
                    >
                      Terms of Service
                    </button>
                    {" "}and{" "}
                    <button
                      type="button"
                      onClick={() => setModalType("privacy")}
                      className="text-indigo-400 underline cursor-pointer inline bg-transparent border-0 p-0 font-normal hover:text-indigo-300"
                    >
                      Privacy Policy
                    </button>
                    . I understand that RevenueRadar collects competitor signals and web data to power GTM intelligence.
                  </span>
                </label>

                <button
                  type="submit" disabled={loading || !consent}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all shadow-xl shadow-indigo-900/40 mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Discovering your competitors…
                    </>
                  ) : (
                    <>
                      <Activity className="w-4 h-4" />
                      Create Account & Discover Competitors
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-slate-500">
                  Already have an account?{" "}
                  <button type="button" onClick={() => { setTab("signin"); reset(); }} className="text-indigo-400 hover:text-indigo-300 font-semibold">
                    Sign in
                  </button>
                </p>
              </motion.form>
            ) : (
              <motion.form
                key="signin"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.2 }}
                onSubmit={handleSignin}
                className="space-y-4"
              >
                <p className="text-xs text-slate-400 -mt-2 mb-4">
                  Welcome back — your competitor intelligence is ready.
                </p>

                <div>
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Work Email</label>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="alex@company.com"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div className="relative">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Password</label>
                  <input
                    type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Your password"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-3 top-8 text-slate-500 hover:text-slate-300">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-all shadow-xl shadow-indigo-900/40"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  {loading ? "Signing in…" : "Sign In to Dashboard"}
                </button>

                <p className="text-center text-xs text-slate-500">
                  Don't have an account?{" "}
                  <button type="button" onClick={() => { setTab("signup"); reset(); }} className="text-indigo-400 hover:text-indigo-300 font-semibold">
                    Create one free
                  </button>
                </p>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Landing Page ────────────────────────────────────────────────────────

export default function LandingPage({ onAuth }: LandingPageProps) {
  const [showAuth,   setShowAuth]   = useState(false);
  const [feedIndex,  setFeedIndex]  = useState(0);
  const [radarAngle, setRadarAngle] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setFeedIndex(i => (i + 1) % LIVE_FEED.length), 2800);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setRadarAngle(a => (a + 1.5) % 360), 30);
    return () => clearInterval(t);
  }, []);

  const rad = (radarAngle * Math.PI) / 180;

  return (
    <div className="min-h-screen bg-[#080c18] text-white overflow-x-hidden">

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuth && (
          <AuthModal onClose={() => setShowAuth(false)} onAuth={onAuth} />
        )}
      </AnimatePresence>

      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-white/5 bg-[#080c18]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <LogoFull dark size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            {["Competitors", "Signals", "Alerts", "Intelligence"].map(l => (
              <span key={l} className="hover:text-white transition-colors cursor-pointer">{l}</span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowAuth(true)}
              className="text-slate-400 hover:text-white text-sm font-medium transition-colors px-3 py-2"
            >
              Sign In
            </button>
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all shadow-lg shadow-indigo-900/40"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-6 pt-24 pb-20 flex flex-col lg:flex-row items-center gap-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-10 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />
          <div className="absolute top-20 right-1/4 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 flex-1 space-y-7">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <span className="inline-flex items-center gap-2 text-xs font-semibold bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 px-3 py-1.5 rounded-full mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              AI-Powered GTM Intelligence · Bright Data + AIML API
            </span>
            <h1 className="text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
              See every competitor move{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
                before it costs you
              </span>
            </h1>
          </motion.div>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.15 }}
            className="text-lg text-slate-400 max-w-xl leading-relaxed">
            RevenueRadar monitors competitors in real-time — pricing changes, hiring surges, funding rounds — and delivers AI-synthesized intelligence straight to your sales team.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => setShowAuth(true)}
              className="flex items-center gap-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-3.5 rounded-xl transition-all shadow-xl shadow-indigo-900/50 text-sm"
            >
              <Activity className="w-4 h-4" />
              Start Free — Discover Competitors
              <ArrowRight className="w-4 h-4" />
            </button>
            <button className="flex items-center gap-2 text-slate-400 hover:text-white text-sm font-medium transition-colors">
              <ChevronRight className="w-4 h-4" /> See how it works
            </button>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }}
            className="flex flex-wrap gap-8 pt-4 border-t border-white/5">
            {[
              { value: "5,000+", label: "Signals per month" },
              { value: "<60s",   label: "Detection latency" },
              { value: "94%",    label: "Signal accuracy" },
              { value: "20+",    label: "Data sources" },
            ].map(s => (
              <div key={s.label}>
                <p className="text-2xl font-bold text-white">{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Radar + live feed */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }}
          className="relative z-10 flex-shrink-0 w-full max-w-sm">
          <div className="relative w-72 h-72 mx-auto">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 288 288">
              {[126, 96, 66, 36].map((r, i) => (
                <circle key={r} cx="144" cy="144" r={r} stroke="#6366f1" strokeOpacity={0.08 + i * 0.07} strokeWidth="1" fill="none" />
              ))}
              <line x1="144" y1="18" x2="144" y2="270" stroke="#6366f1" strokeOpacity="0.08" strokeWidth="1" />
              <line x1="18" y1="144" x2="270" y2="144" stroke="#6366f1" strokeOpacity="0.08" strokeWidth="1" />
              <path d={`M 144 144 L ${144 + 126 * Math.cos(rad - 0.4)} ${144 + 126 * Math.sin(rad - 0.4)}`} stroke="url(#sweepTrail)" strokeWidth="48" strokeLinecap="round" opacity="0.15" />
              <line x1="144" y1="144" x2={144 + 126 * Math.cos(rad)} y2={144 + 126 * Math.sin(rad)} stroke="url(#beamLine)" strokeWidth="2" strokeLinecap="round" />
              {[{ angle: 0.8, r: 80 }, { angle: 2.1, r: 100 }, { angle: 3.7, r: 60 }, { angle: 5.0, r: 110 }].map((b, i) => (
                <circle key={i} cx={144 + b.r * Math.cos(b.angle)} cy={144 + b.r * Math.sin(b.angle)} r="3" fill="#22d3ee"
                  opacity={Math.abs(Math.sin(radarAngle / 57 - b.angle)) > 0.95 ? 1 : 0.3} className="transition-opacity duration-200" />
              ))}
              <circle cx="144" cy="144" r="5" fill="#6366f1" />
              <defs>
                <linearGradient id="beamLine" x1="144" y1="144" x2={144 + 126 * Math.cos(rad)} y2={144 + 126 * Math.sin(rad)} gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" stopOpacity="0.2" /><stop offset="1" stopColor="#22d3ee" />
                </linearGradient>
                <radialGradient id="sweepTrail" cx="144" cy="144" r="126" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#6366f1" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" />
                </radialGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-[#0d1224] border border-indigo-500/20 rounded-2xl px-4 py-2 shadow-2xl">
                <LogoFull dark size="sm" />
              </div>
            </div>
          </div>

          <div className="mt-6 bg-white/4 backdrop-blur border border-white/8 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Signal Feed
                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-mono">SAMPLE</span>
              </span>
              <span className="text-slate-600 font-mono">BRIGHTDATA+GEMINI</span>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={feedIndex} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.35 }} className="space-y-1.5">
                {(() => {
                  const item = LIVE_FEED[feedIndex];
                  const c = colorMap[item.color];
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${c.badge}`}>{item.type}</span>
                        <span className="text-xs font-semibold text-white">{item.company}</span>
                      </div>
                      <p className="text-xs text-slate-400">{item.msg}</p>
                      <p className="text-[10px] text-slate-600 font-mono">{item.time}</p>
                    </>
                  );
                })()}
              </motion.div>
            </AnimatePresence>
            <div className="flex gap-1.5 justify-center pt-1">
              {LIVE_FEED.map((_, i) => (
                <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${i === feedIndex ? "bg-indigo-400" : "bg-white/10"}`} />
              ))}
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold">Everything your GTM team needs</h2>
          <p className="text-slate-400 mt-3 text-base max-w-xl mx-auto">From real-time competitor scraping to AI-powered battlecards — all in one platform.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            const c = colorMap[f.color];
            return (
              <motion.div key={f.title} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`group relative bg-white/3 hover:bg-white/5 border ${c.border} rounded-2xl p-6 transition-all duration-300`}>
                <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center mb-4`}>
                  <Icon className={`w-5 h-5 ${c.text}`} />
                </div>
                <h3 className="font-bold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-white/5">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold">Set up in 60 seconds</h2>
          <p className="text-slate-400 mt-3 text-base">Enter your product, we find your competitors automatically</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { step: "01", icon: Building2,  title: "Enter your product",         desc: "Tell us your product name and category. RevenueRadar immediately searches the web via Bright Data to identify your top global and local competitors." },
            { step: "02", icon: Sparkles,   title: "AI discovers competitors",   desc: "AI analyses search results, G2 categories, and market data to surface the most relevant companies competing in your space." },
            { step: "03", icon: CheckCircle2, title: "Dashboard activates",      desc: "Your workspace populates instantly with live pricing, hiring signals, and news for each discovered competitor. Monitoring starts immediately." },
          ].map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.step} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.12 }} className="relative">
                {i < 2 && <div className="hidden md:block absolute top-5 left-full w-full h-px bg-gradient-to-r from-indigo-500/30 to-transparent" style={{ width: "calc(100% - 2rem)" }} />}
                <div className="text-5xl font-black text-white/4 mb-4 leading-none font-mono">{s.step}</div>
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-indigo-400" />
                </div>
                <h3 className="font-bold text-white mb-2">{s.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{s.desc}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Ticker */}
      <section className="py-12 border-y border-white/5 overflow-hidden relative">
        <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#080c18] to-transparent z-10" />
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#080c18] to-transparent z-10" />
        <div className="flex gap-6 ticker-track">
          {[...LIVE_FEED, ...LIVE_FEED].map((item, i) => {
            const c = colorMap[item.color];
            return (
              <div key={i} className={`shrink-0 flex items-center gap-3 bg-white/3 border ${c.border} rounded-xl px-4 py-2.5`}>
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${c.badge}`}>{item.type}</span>
                <span className="text-xs font-semibold text-white">{item.company}</span>
                <span className="text-xs text-slate-400 max-w-xs truncate">{item.msg}</span>
                <span className="text-[10px] text-slate-600 font-mono">{item.time}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-28 text-center">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live — monitoring competitors right now
          </div>
          <h2 className="text-4xl font-bold">Stop being surprised by your competitors</h2>
          <p className="text-slate-400 text-base leading-relaxed max-w-xl mx-auto">
            Every pricing change, product launch, and key hire is a signal. RevenueRadar catches them all so your sales team can act first.
          </p>
          <button onClick={() => setShowAuth(true)}
            className="inline-flex items-center gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold px-8 py-4 rounded-xl transition-all shadow-2xl shadow-indigo-900/50 text-base">
            <Activity className="w-5 h-5" />
            Start Free — No Credit Card Required
            <ArrowRight className="w-5 h-5" />
          </button>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <LogoFull dark size="sm" />
          <div className="flex items-center gap-6 text-xs text-slate-600">
            {["Bright Data", "AIML API", "Google Maps", "GTM Intelligence"].map(t => <span key={t}>{t}</span>)}
          </div>
          <p className="text-xs text-slate-700">Built for Web Data UNLOCKED Hackathon 2026</p>
        </div>
      </footer>
    </div>
  );
}
