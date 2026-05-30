import { useState, useEffect, useCallback, useRef } from "react";
import { FlaskConical, Plus, RefreshCw, Clock, CheckCircle2, XCircle, Loader2,
         ChevronDown, ChevronUp, Search, Zap, Radio, Globe, FileText, Brain } from "lucide-react";

interface TaskRow {
  id: number;
  Topic: string;
  Region: string;
  "Target Competitors": string;
  Status: string;
  "Retry Count": number;
  StartTime: string;
  CompletedTime: string;
  FailureReason: string;
  created_at: string;
}

interface ResultRow {
  id: number;
  task_id: number | null;
  topic: string | null;
  region: string | null;
  verified_trend: string | null;
  pricing_gap: string | null;
  feature_insights: string | null;
  confidence_score: number | null;
  confidence_rationale: string | null;
  opportunity_score: number | null;
  evidence_links: string | null;
  data_summary: string | null;
  status: string | null;
  processed_at: string | null;
  created_at: string;
}

type StreamEvent =
  | { type: "thinking";    content: string }
  | { type: "memory";      content: string }
  | { type: "search";      query: string }
  | { type: "scrape";      url: string }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "report";      content: string }
  | { type: "error";       message: string }
  | { type: "done" };

interface ActivityEntry {
  id: number;
  event: StreamEvent;
  ts: number;
}

function statusConfig(status: string) {
  switch (status?.toLowerCase()) {
    case "completed":  return { color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 };
    case "processing": return { color: "bg-blue-100 text-blue-700",    icon: Loader2 };
    case "failed":     return { color: "bg-red-100 text-red-600",      icon: XCircle };
    default:           return { color: "bg-slate-100 text-slate-600",  icon: Clock };
  }
}

function parseUtc(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}
function timeAgo(iso: string) {
  if (!iso) return "—";
  const diff = Date.now() - parseUtc(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { event } = entry;
  if (event.type === "memory") {
    return (
      <div className="flex gap-2 items-start py-1.5 bg-violet-900/20 rounded px-2 -mx-2 my-0.5">
        <Brain className="w-3.5 h-3.5 text-violet-400 shrink-0 mt-0.5" />
        <div>
          <span className="text-[11px] font-bold text-violet-300">Memory Retrieved</span>
          <p className="text-[10px] text-violet-400/80 mt-0.5 leading-relaxed">{event.content.slice(0, 220)}{event.content.length > 220 ? "…" : ""}</p>
        </div>
      </div>
    );
  }
  if (event.type === "thinking") {
    return (
      <div className="flex gap-2 items-start py-1.5">
        <span className="text-violet-400 mt-0.5">💭</span>
        <p className="text-xs text-slate-500 leading-relaxed italic">{event.content.slice(0, 300)}{event.content.length > 300 ? "…" : ""}</p>
      </div>
    );
  }
  if (event.type === "search") {
    return (
      <div className="flex gap-2 items-center py-1.5">
        <Search className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
        <span className="text-[11px] font-semibold text-indigo-700">Searching:</span>
        <span className="text-[11px] text-slate-600 truncate">{event.query}</span>
      </div>
    );
  }
  if (event.type === "scrape") {
    return (
      <div className="flex gap-2 items-center py-1.5">
        <Globe className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
        <span className="text-[11px] font-semibold text-cyan-700">Scraping:</span>
        <span className="text-[11px] text-slate-500 truncate">{event.url}</span>
      </div>
    );
  }
  if (event.type === "tool_result") {
    return (
      <div className="flex gap-2 items-center py-1.5">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        <span className="text-[11px] font-semibold text-emerald-700">{event.name}:</span>
        <span className="text-[11px] text-slate-500">{event.summary}</span>
      </div>
    );
  }
  if (event.type === "error") {
    // Parse Gemini error envelope if present
    let friendly = event.message;
    try {
      const parsed = JSON.parse(event.message) as { error?: { message?: string; code?: number } };
      if (parsed?.error?.message) {
        const code = parsed.error.code;
        if (code === 503 || parsed.error.message.includes("high demand") || parsed.error.message.includes("UNAVAILABLE")) {
          friendly = "The AI is experiencing high demand — the agent will retry automatically. Please wait a moment.";
        } else if (code === 429 || parsed.error.message.includes("RESOURCE_EXHAUSTED")) {
          friendly = "AI rate limit hit — retrying shortly.";
        } else {
          friendly = parsed.error.message;
        }
      }
    } catch { /* not JSON, use as-is */ }
    return (
      <div className="flex gap-2 items-start py-1.5">
        <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
        <span className="text-[11px] text-red-400 leading-relaxed">{friendly}</span>
      </div>
    );
  }
  if (event.type === "done") {
    return (
      <div className="flex gap-2 items-center py-1.5 border-t border-slate-100 mt-1">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="text-[11px] font-bold text-emerald-700">Research complete</span>
      </div>
    );
  }
  return null;
}

function MarkdownReport({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-2 text-xs leading-relaxed text-slate-700">
      {lines.map((line, i) => {
        if (line.startsWith("## "))
          return <h3 key={i} className="text-sm font-bold text-slate-900 mt-3 first:mt-0">{line.slice(3)}</h3>;
        if (line.startsWith("# "))
          return <h2 key={i} className="text-base font-extrabold text-slate-900 mt-4 first:mt-0">{line.slice(2)}</h2>;
        if (line.startsWith("- ") || line.startsWith("* "))
          return <p key={i} className="pl-3 before:content-['•'] before:mr-2 before:text-indigo-500">{line.slice(2)}</p>;
        if (line.startsWith("**") && line.endsWith("**"))
          return <p key={i} className="font-bold text-slate-800">{line.slice(2, -2)}</p>;
        if (line.trim() === "")
          return <div key={i} className="h-1" />;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function LiveResearchTab() {
  const [query, setQuery]           = useState("");
  const [running, setRunning]       = useState(false);
  const [activity, setActivity]     = useState<ActivityEntry[]>([]);
  const [report, setReport]         = useState<string | null>(null);
  const [cogneeReady, setCogneeReady] = useState<boolean | null>(null);
  const [memories, setMemories]     = useState<{ id: number; text: string }[]>([]);
  const [memLoading, setMemLoading] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const activityRef                 = useRef<HTMLDivElement>(null);
  const counterRef                  = useRef(0);
  const abortRef                    = useRef<AbortController | null>(null);
  const watchdogRef                 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [stallMsg,  setStallMsg]    = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json())
      .then((d: { hasCogneeMemory?: boolean }) => setCogneeReady(d.hasCogneeMemory ?? false))
      .catch(() => setCogneeReady(false));
  }, []);

  const fetchMemories = async () => {
    setMemLoading(true);
    try {
      const q = query.trim() || "competitor pricing intelligence";
      const r = await fetch(`/api/cognee/memories?q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const d = await r.json() as { ready: boolean; entries: { id: number; text: string }[] };
        setMemories(d.entries);
        setShowMemory(true);
      }
    } catch { /* silent */ }
    finally { setMemLoading(false); }
  };

  const scrollToBottom = () => {
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight;
  };

  useEffect(scrollToBottom, [activity]);

  const startResearch = async () => {
    if (!query.trim() || running) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setRunning(true);
    setActivity([]);
    setReport(null);
    setStallMsg(null);
    counterRef.current = 0;

    // Watchdog: if no event arrives within 25s, show a reassurance message
    const resetWatchdog = () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        setStallMsg("AI agent is processing large datasets — this can take up to 60s. Still working…");
      }, 25_000);
    };
    resetWatchdog();

    try {
      const resp = await fetch(`/api/research/stream?query=${encodeURIComponent(query.trim())}`, {
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = "";

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find(l => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
            resetWatchdog(); setStallMsg(null);
            if (event.type === "report") {
              setReport(event.content);
            } else {
              setActivity(prev => [...prev, { id: counterRef.current++, event, ts: Date.now() }]);
            }
            if (event.type === "done") {
              if (watchdogRef.current) clearTimeout(watchdogRef.current);
              setRunning(false); return;
            }
          } catch { /* malformed line */ }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        setActivity(prev => [...prev, {
          id: counterRef.current++,
          event: { type: "error", message: String(err) },
          ts: Date.now(),
        }]);
      }
    } finally {
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      setStallMsg(null);
      setRunning(false);
    }
  };

  const stop = () => { abortRef.current?.abort(); setRunning(false); };

  return (
    <div className="space-y-4">
      {/* Query bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !running && startResearch()}
            placeholder="e.g. SaaS pricing trends in EMEA, Salesforce vs HubSpot competitive moves…"
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
          {running ? (
            <button onClick={stop}
              className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors">
              <XCircle className="w-3.5 h-3.5" /> Stop
            </button>
          ) : (
            <button onClick={startResearch} disabled={!query.trim()}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors">
              <Radio className="w-3.5 h-3.5" /> Live Research
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-[10px] text-slate-400">
            Powered by AIML API + Bright Data — watch the agent think, search, and scrape in real time.
          </p>
          {cogneeReady === true && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full shrink-0">
              <Brain className="w-3 h-3" /> Memory ON
            </span>
          )}
          {cogneeReady === false && (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
              <Brain className="w-3 h-3" /> Memory OFF
            </span>
          )}
        </div>
      </div>

      {/* Agent Brain Memory panel */}
      {cogneeReady && (
        <div className="bg-white border border-violet-100 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-100">
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-500" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Agent Brain Memory</span>
              <span className="text-[9px] font-bold text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-full">COGNEE</span>
            </div>
            <button
              onClick={showMemory ? () => setShowMemory(false) : fetchMemories}
              disabled={memLoading}
              className="flex items-center gap-1.5 text-[11px] font-bold text-violet-600 hover:text-violet-800 transition-colors disabled:opacity-50"
            >
              {memLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
              {showMemory ? "Hide" : "Recall Memory"}
            </button>
          </div>
          {showMemory && (
            <div className="px-4 py-3 max-h-48 overflow-y-auto space-y-2">
              {memories.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No memories stored yet. Run a research query to populate the knowledge graph.</p>
              ) : (
                memories.map(m => (
                  <div key={m.id} className="flex gap-2 text-xs text-slate-600 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 leading-relaxed">
                    <span className="text-violet-400 shrink-0 font-bold">›</span>
                    <span>{m.text}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Split panel */}
      {(activity.length > 0 || report || running) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Activity log */}
          <div className="bg-[#0d1117] border border-slate-700 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 border-b border-slate-700 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${running ? "bg-green-400 animate-pulse" : "bg-slate-500"}`} />
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Agent Activity</span>
              {running && <Loader2 className="w-3 h-3 text-indigo-400 animate-spin ml-auto" />}
            </div>
            <div ref={activityRef} className="px-4 py-3 max-h-80 overflow-y-auto divide-y divide-slate-800">
              {activity.length === 0 && running && (
                <div className="py-4 text-center text-[11px] text-slate-500">Starting agent…</div>
              )}
              {stallMsg && running && (
                <div className="flex gap-2 items-center py-2 px-2 bg-amber-900/20 rounded my-1">
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin shrink-0" />
                  <span className="text-[11px] text-amber-300">{stallMsg}</span>
                </div>
              )}
              {activity.map(entry => (
                <div key={entry.id} className="[&>div]:text-slate-300 [&_.text-indigo-700]:text-indigo-400 [&_.text-cyan-700]:text-cyan-400 [&_.text-emerald-700]:text-emerald-400 [&_.text-red-600]:text-red-400 [&_.text-slate-500]:text-slate-400 [&_.text-slate-600]:text-slate-400 [&_.text-violet-400]:text-violet-300">
                  <ActivityRow entry={entry} />
                </div>
              ))}
            </div>
          </div>

          {/* Report panel */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-indigo-500" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Research Report</span>
            </div>
            <div className="px-4 py-3 max-h-80 overflow-y-auto">
              {report ? (
                <MarkdownReport content={report} />
              ) : (
                <div className="py-8 text-center">
                  {running
                    ? <><Loader2 className="w-5 h-5 animate-spin text-indigo-300 mx-auto mb-2" /><p className="text-xs text-slate-400">Report generating…</p></>
                    : <><FileText className="w-6 h-6 text-slate-200 mx-auto mb-2" /><p className="text-xs text-slate-400">Report will appear here</p></>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {activity.length === 0 && !report && !running && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
          <Radio className="w-8 h-8 text-slate-200 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-400">Live Research</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Type a GTM intelligence question above and watch the AI agent search and synthesise data in real time.</p>
        </div>
      )}
    </div>
  );
}

export default function ResearchView() {
  const [tab, setTab] = useState<"pipeline" | "live">("live");

  const [tasks, setTasks]             = useState<TaskRow[]>([]);
  const [results, setResults]         = useState<ResultRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [expandedTask, setExpandedTask] = useState<number | null>(null);

  const [topic,       setTopic]       = useState("");
  const [region,      setRegion]      = useState("");
  const [competitors, setCompetitors] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [tasksRes, resultsRes] = await Promise.all([
        fetch("/api/db/tasks"),
        fetch("/api/db/results"),
      ]);
      if (tasksRes.ok)   setTasks(await tasksRes.json());
      if (resultsRes.ok) setResults(await resultsRes.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 20_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/db/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), region: region.trim(), competitors: competitors.trim() }),
      });
      setTopic(""); setRegion(""); setCompetitors("");
      await fetchData();
    } catch { /* silent */ }
    finally { setSubmitting(false); }
  };

  const counts = {
    total:      tasks.length,
    pending:    tasks.filter(t => t.Status === "Pending").length,
    processing: tasks.filter(t => t.Status === "Processing").length,
    completed:  tasks.filter(t => t.Status === "Completed").length,
    failed:     tasks.filter(t => t.Status === "Failed").length,
  };

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header + tab switcher */}
      <div className="border-b border-slate-150 pb-3 flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Research</h2>
          <p className="text-sm text-slate-500 mt-1">Live AI-powered research or server-side pipeline tasks.</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 mt-1">
          <button
            onClick={() => setTab("live")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${tab === "live" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <Radio className="w-3.5 h-3.5" /> Live
          </button>
          <button
            onClick={() => setTab("pipeline")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${tab === "pipeline" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <FlaskConical className="w-3.5 h-3.5" /> Pipeline
          </button>
        </div>
      </div>

      {tab === "live" && <LiveResearchTab />}

      {tab === "pipeline" && (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total",      value: counts.total,      color: "text-slate-800",   bg: "bg-white" },
              { label: "Pending",    value: counts.pending,    color: "text-amber-600",   bg: "bg-amber-50" },
              { label: "Processing", value: counts.processing, color: "text-blue-600",    bg: "bg-blue-50" },
              { label: "Completed",  value: counts.completed,  color: "text-emerald-700", bg: "bg-emerald-50" },
              { label: "Failed",     value: counts.failed,     color: "text-red-600",     bg: "bg-red-50" },
            ].map(s => (
              <div key={s.label} className={`${s.bg} border border-slate-200 rounded-xl p-3 text-center shadow-sm`}>
                <p className={`text-xl font-extrabold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Add Task Form */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-2 mb-4">
              <Plus className="w-4 h-4 text-indigo-600" /> Queue Research Task
            </h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-1 space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Topic *</label>
                  <input value={topic} onChange={e => setTopic(e.target.value)} required
                    placeholder="e.g. AI pricing trends in SaaS"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Region</label>
                  <input value={region} onChange={e => setRegion(e.target.value)}
                    placeholder="e.g. North America, EMEA"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Target Competitors</label>
                  <input value={competitors} onChange={e => setCompetitors(e.target.value)}
                    placeholder="e.g. Salesforce, HubSpot"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" disabled={submitting || !topic.trim()}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2 rounded-lg transition-colors">
                  {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {submitting ? "Queuing…" : "Queue Task"}
                </button>
              </div>
            </form>
          </div>

          {/* Task Queue */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-800">Task Queue</h3>
              <button onClick={() => { setLoading(true); fetchData(); }}
                className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-indigo-600 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            </div>

            {loading ? (
              <div className="p-8 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400 mx-auto" />
                <p className="text-xs text-slate-400 mt-2">Loading task queue…</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="p-10 text-center">
                <Search className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-400">No research tasks yet</p>
                <p className="text-xs text-slate-400 mt-1">Queue a task above to start AI-powered market analysis.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {tasks.map(task => {
                  const cfg = statusConfig(task.Status);
                  const Icon = cfg.icon;
                  const taskResults = results.filter(r => r.task_id === task.id);
                  const isExpanded = expandedTask === task.id;

                  return (
                    <div key={task.id} className="hover:bg-slate-50/50 transition-colors">
                      <div className="px-5 py-3.5 flex items-start gap-3 cursor-pointer"
                        onClick={() => setExpandedTask(isExpanded ? null : task.id)}>
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${task.Status === "Processing" ? "animate-spin" : ""} ${cfg.color.split(" ")[1]}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-slate-800 truncate">{task.Topic}</span>
                            {task.Region && (
                              <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">{task.Region}</span>
                            )}
                            {task["Target Competitors"] && (
                              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full truncate max-w-[140px]">
                                vs {task["Target Competitors"]}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${cfg.color}`}>{task.Status}</span>
                            {task["Retry Count"] > 0 && (
                              <span className="text-[9px] text-amber-600 font-semibold">↻ {task["Retry Count"]} retries</span>
                            )}
                            <span className="text-[10px] text-slate-400">{timeAgo(task.created_at)}</span>
                            {taskResults.length > 0 && (
                              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                {taskResults.length} result{taskResults.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {task.FailureReason && (
                            <p className="text-[10px] text-red-500 mt-1 font-medium truncate">{task.FailureReason}</p>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
                      </div>

                      {isExpanded && taskResults.length > 0 && (
                        <div className="px-5 pb-4 space-y-3">
                          {taskResults.map(result => (
                            <div key={result.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                              <div className="flex items-center gap-3 flex-wrap">
                                {result.confidence_score != null && (
                                  <div className="text-center">
                                    <p className="text-lg font-extrabold text-indigo-700">{result.confidence_score}<span className="text-xs font-bold text-slate-400">/100</span></p>
                                    <p className="text-[9px] text-slate-400 uppercase font-bold">Confidence</p>
                                  </div>
                                )}
                                {result.opportunity_score != null && (
                                  <div className="text-center">
                                    <p className="text-lg font-extrabold text-emerald-700">{result.opportunity_score}<span className="text-xs font-bold text-slate-400">/100</span></p>
                                    <p className="text-[9px] text-slate-400 uppercase font-bold">Opportunity</p>
                                  </div>
                                )}
                                {result.processed_at && (
                                  <span className="ml-auto text-[10px] text-slate-400">Processed {timeAgo(result.processed_at)}</span>
                                )}
                              </div>
                              {result.verified_trend && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Verified Trend</p>
                                  <p className="text-xs text-slate-700 leading-relaxed">{result.verified_trend}</p>
                                </div>
                              )}
                              {result.pricing_gap && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pricing Gap</p>
                                  <p className="text-xs text-slate-700 leading-relaxed">{result.pricing_gap}</p>
                                </div>
                              )}
                              {result.feature_insights && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Feature Insights</p>
                                  <p className="text-xs text-slate-700 leading-relaxed">{result.feature_insights}</p>
                                </div>
                              )}
                              {result.confidence_rationale && (
                                <div>
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Rationale</p>
                                  <p className="text-xs text-slate-500 leading-relaxed">{result.confidence_rationale}</p>
                                </div>
                              )}
                              {result.data_summary && (
                                <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                                  <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">AI Summary</p>
                                  <p className="text-xs text-indigo-800 leading-relaxed">{result.data_summary}</p>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {isExpanded && taskResults.length === 0 && task.Status !== "Completed" && (
                        <div className="px-5 pb-4">
                          <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-center text-xs text-slate-400">
                            {task.Status === "Failed" ? "No results — task failed before completion." : "Results will appear here once the research pipeline processes this task."}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
