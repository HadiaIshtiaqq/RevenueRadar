import React, { useState, useEffect } from "react";
import {
  User, Bell, Check, Send, MapPin, Loader2, Zap,
} from "lucide-react";
import type { AuthUser } from "./LandingPage";


interface Props {
  user: AuthUser | null;
  onUserUpdate: (updated: AuthUser) => void;
}

export default function SettingsView({ user, onUserUpdate }: Props) {
  // Profile state
  const [profileName,    setProfileName]    = useState(user?.name        ?? "");
  const [companyCity,    setCompanyCity]    = useState(user?.companyCity ?? "");
  const [productName,    setProductName]    = useState(user?.productName  ?? "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaved,   setProfileSaved]   = useState(false);
  const [profileError,   setProfileError]   = useState("");

  // Notifications state
  const [slackWebhook,     setSlackWebhook]     = useState("");
  const [slackError,       setSlackError]       = useState("");
  const [impactThreshold,  setImpactThreshold]  = useState(75);
  const [notifLoading,     setNotifLoading]     = useState(false);
  const [notifSaved,       setNotifSaved]       = useState(false);
  const [testLoading,      setTestLoading]      = useState(false);
  const [testResult,       setTestResult]       = useState<{ ok: boolean; message: string } | null>(null);

  const isValidSlackUrl = (url: string) =>
    /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+$/.test(url.trim());

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.ok ? r.json() : null)
      .then((d: { impactThreshold?: number } | null) => {
        if (d?.impactThreshold !== undefined) setImpactThreshold(d.impactThreshold);
      })
      .catch(() => {});
  }, []);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError("");
    try {
      const resp = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: profileName, companyCity, productName }),
      });
      let data: { user?: AuthUser; error?: string } = {};
      try { data = await resp.json(); } catch { /* non-JSON response */ }
      if (!resp.ok) { setProfileError(data.error || `Server error (${resp.status}) — restart the dev server if this is the first save.`); return; }
      if (data.user) onUserUpdate(data.user);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3500);
    } catch { setProfileError("Network error — make sure the dev server is running."); }
    finally { setProfileLoading(false); }
  };

  const saveNotifications = async (e: React.FormEvent) => {
    e.preventDefault();
    if (slackWebhook.trim() && !isValidSlackUrl(slackWebhook)) {
      setSlackError("Must be a valid Slack webhook: https://hooks.slack.com/services/…");
      return;
    }
    setSlackError("");
    setNotifLoading(true);
    try {
      const calls: Promise<unknown>[] = [
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ impactThreshold }),
        }),
      ];
      if (slackWebhook.trim()) {
        calls.push(fetch("/api/alerts/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertType: "pricing_change", deliveryMethod: "slack", deliveryTarget: slackWebhook.trim() }),
        }));
      }
      await Promise.all(calls);
      setNotifSaved(true);
      setTimeout(() => setNotifSaved(false), 3500);
    } catch { /* silent */ }
    finally { setNotifLoading(false); }
  };

  const [twLoading, setTwLoading]  = useState(false);
  const [twResult,  setTwResult]   = useState<{ ok: boolean; message: string } | null>(null);
  const [keyStatus, setKeyStatus]  = useState<Record<string, boolean>>({});
  const [ngrokUrl,  setNgrokUrl]   = useState<string>("");

  useEffect(() => {
    fetch("/api/config/status")
      .then(r => r.ok ? r.json() : null)
      .then((d: Record<string, boolean> | null) => { if (d) setKeyStatus(d); })
      .catch(() => {});
    fetch("/api/ngrok-status")
      .then(r => r.ok ? r.json() : null)
      .then((d: { url: string } | null) => { if (d?.url) setNgrokUrl(d.url); })
      .catch(() => {});
  }, []);

  const testTriggerWare = async () => {
    setTwLoading(true); setTwResult(null);
    try {
      const r = await fetch("/api/triggerware/test", { method: "POST" });
      const d = await r.json();
      setTwResult({ ok: r.ok, message: r.ok ? d.message : d.error });
    } catch { setTwResult({ ok: false, message: "Network error." }); }
    finally { setTwLoading(false); setTimeout(() => setTwResult(null), 6000); }
  };

  const testSlack = async () => {
    if (!slackWebhook.trim()) return;
    if (!isValidSlackUrl(slackWebhook)) {
      setSlackError("Must be a valid Slack webhook: https://hooks.slack.com/services/…");
      return;
    }
    setSlackError("");
    setTestLoading(true);
    setTestResult(null);
    try {
      const resp = await fetch("/api/alerts/test-slack", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: slackWebhook.trim() }),
      });
      const data = await resp.json();
      setTestResult({ ok: resp.ok, message: resp.ok ? "Test alert delivered successfully." : data.error || "Send failed." });
    } catch { setTestResult({ ok: false, message: "Network error." }); }
    finally { setTestLoading(false); setTimeout(() => setTestResult(null), 5000); }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="border-b border-slate-150 pb-3">
        <h2 className="text-2xl font-bold text-slate-900">Settings</h2>
        <p className="text-sm text-slate-500 mt-1">Manage your profile, notifications, and integrations.</p>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────── */}
      <form onSubmit={saveProfile} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <User className="w-4 h-4 text-indigo-600" /> Profile
          </h3>
          {profileSaved && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <Check className="w-3.5 h-3.5 stroke-[3]" /> Saved
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Full Name</label>
            <input
              value={profileName} onChange={e => setProfileName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
              Email <span className="text-slate-400 normal-case font-normal">(read-only)</span>
            </label>
            <input
              value={user?.email ?? ""}
              readOnly
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Product / Company Name</label>
            <input
              value={productName} onChange={e => setProductName(e.target.value)}
              placeholder="e.g. Stripe, HubSpot"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Company Location
            </label>
            <input
              value={companyCity} onChange={e => setCompanyCity(e.target.value)}
              placeholder="e.g. San Francisco, USA"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-colors"
            />
            <p className="text-[10px] text-slate-400 mt-1">Used to pin your company on the Sentinel Intel Map.</p>
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">
              Industry / Niche <span className="text-slate-400 normal-case font-normal">(read-only)</span>
            </label>
            <input
              value={user?.productNiche ?? ""}
              readOnly
              className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-400 cursor-not-allowed"
            />
            <p className="text-[10px] text-slate-400 mt-1">Set at signup — determines competitor discovery and demand map regions.</p>
          </div>
        </div>

        {profileError && <p className="text-xs text-red-600 font-semibold">{profileError}</p>}

        <div className="flex justify-end">
          <button type="submit" disabled={profileLoading}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs py-2.5 px-5 rounded-lg transition-colors">
            {profileLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : "Save Profile"}
          </button>
        </div>
      </form>

      {/* ── Notifications ───────────────────────────────────────────────── */}
      <form onSubmit={saveNotifications} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-indigo-600" /> Notifications
          </h3>
          {notifSaved && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <Check className="w-3.5 h-3.5 stroke-[3]" /> Saved
            </span>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Slack Webhook URL</label>
            <div className="flex gap-2">
              <input
                type="text" value={slackWebhook}
                onChange={e => { setSlackWebhook(e.target.value); setSlackError(""); }}
                onBlur={() => {
                  if (slackWebhook.trim() && !isValidSlackUrl(slackWebhook)) {
                    setSlackWebhook("");
                    setSlackError("Invalid URL cleared. Slack webhooks must start with https://hooks.slack.com/services/");
                  }
                }}
                placeholder="https://hooks.slack.com/services/…"
                className={`flex-1 bg-slate-50 border rounded-lg px-3 py-2.5 text-xs text-slate-800 font-mono focus:outline-none transition-colors ${slackError && slackWebhook.trim() ? "border-red-400 focus:border-red-400 focus:ring-1 focus:ring-red-400" : "border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"}`}
              />
              <button type="button" onClick={testSlack} disabled={testLoading}
                className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-bold text-xs px-3 py-2 rounded-lg transition-colors shrink-0">
                <Send className="w-3.5 h-3.5" />{testLoading ? "…" : "Test"}
              </button>
            </div>
            {testResult && (
              <p className={`text-[11px] font-semibold mt-1 ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>{testResult.message}</p>
            )}
            <p className="text-[10px] text-slate-400 mt-1">
              Paste your Slack Incoming Webhook URL. Get one at{" "}
              <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-indigo-500 underline">api.slack.com/apps</a>
              {" "}→ Incoming Webhooks → Add New Webhook.
            </p>
          </div>

          <div>
            <div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1">
              <span>Minimum alert threshold</span>
              <span className="text-indigo-600 font-bold">{impactThreshold} / 100</span>
            </div>
            <input type="range" min="0" max="100" value={impactThreshold}
              onChange={e => setImpactThreshold(Number(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              Only competitor changes scoring {impactThreshold}+ impact will trigger Slack alerts.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={notifLoading}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs py-2.5 px-5 rounded-lg transition-colors">
            {notifLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : "Save Notifications"}
          </button>
        </div>
      </form>

      {/* ── TriggerWare Automation ────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
            <Zap className="w-4 h-4 text-amber-500" /> TriggerWare Automated Workflows
          </h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${keyStatus.hasTriggerWare ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-400 border-slate-200"}`}>
            {keyStatus.hasTriggerWare ? "✓ API Key Active" : "No API Key"}
          </span>
        </div>

        {/* Live public endpoint */}
        <div className="space-y-1">
          <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Public Signals Endpoint</label>
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono text-slate-700 truncate">
              {ngrokUrl ? `${ngrokUrl}/api/public/signals` : "/api/public/signals — returns signals with impact ≥ 75"}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(`${ngrokUrl || window.location.origin}/api/public/signals`)}
              className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 hover:text-indigo-800 shrink-0 transition-colors"
            >
              <Check className="w-3 h-3" /> Copy URL
            </button>
          </div>
        </div>

        {/* Fire test */}
        <div className="flex items-center gap-3">
          <button onClick={testTriggerWare} disabled={twLoading || !keyStatus.hasTriggerWare}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors">
            {twLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            Fire Test Webhook
          </button>
          {!keyStatus.hasTriggerWare && <span className="text-[10px] text-slate-400">Add TriggerWare API key above first</span>}
          {twResult && (
            <span className={`text-[11px] font-semibold ${twResult.ok ? "text-emerald-600" : "text-red-500"}`}>{twResult.message}</span>
          )}
        </div>
      </div>

    </div>
  );
}
