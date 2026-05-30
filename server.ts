/**
 * RevenueRadar — Express server (routes + startup only)
 *
 * Heavy logic lives in lib/:
 *   lib/agent.ts        — AIML API multi-turn agentic loop + all 17 tools
 *   lib/brightdata.ts   — Bright Data SERP / Unlocker / Scraping Browser / MCP
 *   lib/geocoding.ts    — Company HQ geocoding pipeline
 *   lib/cognee.ts       — Cognee memory sidecar
 *   lib/auth.ts         — Auth helpers (scrypt + session tokens)
 *   lib/cache.ts        — TTL cache (SERP 15 min, scrape 30 min, geocode 24 h)
 *   lib/config.ts       — All env-var constants
 *   lib/utils.ts        — genId, sha256, sanitizeInput, tryParseJSON
 */

import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { fileURLToPath } from "url";
import rateLimit from "express-rate-limit";
import * as cheerio from "cheerio";

import db, {
  taskToApi, competitorToApi, changeToApi, signalToApi, subscriptionToApi,
  type TaskRow, type ResultRow, type CompetitorRow, type SnapshotRow,
  type ChangeRow, type SignalRow, type SubscriptionRow, type UserRow, type AudioSourceRow,
} from "./db.js";

import { PORT, BD_API_KEY, BD_SERP_ZONE, BD_UNLOCKER_ZONE, BD_BROWSER_ZONE, BD_MCP_URL, SLACK_WEBHOOK, AIML_MODEL, TRIGGERWARE_API_KEY, updateRuntimeConfig } from "./lib/config.js";
import { genId, sha256, sanitizeInput, tryParseJSON } from "./lib/utils.js";
import { requireAuth, hashPassword, verifyPassword, getToken, type AuthRequest } from "./lib/auth.js";
import { startCogneeServer, isCogneeReady, cogneeAdd, cogneeSearch } from "./lib/cognee.js";
import { resolveHq, geocodeCompanyHQ, domainToName, HQ_COORDS, photonGeocodeCity } from "./lib/geocoding.js";
import {
  bdSerp, bdUnlock,
  bdSerpNews, bdSerpJobs, bdMcpCall, extractPricing, sendSlack, sendTriggerWare,
} from "./lib/brightdata.js";
import {
  runAgent, runAgentStream, callAI, getAI,
  TOOL_DECLARATIONS, type StreamEvent,
} from "./lib/agent.js";
import { getNicheSeeds } from "./lib/niche-seeds.js";
import { isSpeechmaticsReady, submitTranscriptionJob, submitTranscriptionJobFromBuffer, getJobStatus, getTranscript } from "./lib/speechmatics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Competitor Discovery ─────────────────────────────────────────────────────

import { extractHost, isListSiteDomain, isDevAgencyDomain, isResearchSiteDomain, SKIP_DISCOVERY_DOMAINS } from "./lib/geocoding.js";

type DiscoveredCompetitor = { name: string; domain: string; scope: string; source: "serp" | "curated" };

async function discoverCompetitors(productName: string, productNiche: string, _userId: string): Promise<DiscoveredCompetitor[]> {
  const isSoftware = /software|saas|platform|app|tech|ai|crm|erp|devops|fintech|edtech|analytics|bi\b|intelligence|cybersec|security|cloud/i.test(productNiche);
  const nicheKw = productNiche.replace(/&/g, "").trim().split(" ").slice(0, 4).join(" ");
  const seeds = getNicheSeeds(productNiche);

  const seen = new Set<string>(seeds.map(s => s.domain));

  if (!isSoftware) {
    const competitors: DiscoveredCompetitor[] = seeds.slice(0, 10).map(s => ({ ...s, source: "curated" as const }));
    try {
      const serpRes = await bdSerp(`${nicheKw} brands service companies`, 12);
      for (const r of serpRes) {
        if (competitors.length >= 10) break;
        const host = extractHost(r.url);
        if (!host || seen.has(host) || SKIP_DISCOVERY_DOMAINS.has(host)) continue;
        if (isListSiteDomain(host) || isResearchSiteDomain(host) || isDevAgencyDomain(host)) continue;
        if (host.toLowerCase().includes(productName.toLowerCase().split(" ")[0])) continue;
        seen.add(host);
        competitors.push({ name: domainToName(host), domain: host, scope: "global", source: "serp" });
      }
    } catch { /* use seeds only */ }
    return competitors.slice(0, 10);
  }

  try {
    const [globalRes, directRes] = await Promise.all([
      bdSerp(`${nicheKw} software companies site:crunchbase.com`, 12),
      bdSerp(`best ${nicheKw} platforms tools 2026`, 10),
    ]);

    const ai = getAI();
    if (ai) {
      try {
        const snippets = [...globalRes, ...directRes].slice(0, 16)
          .map(r => `- ${r.title} | ${r.url} | ${r.snippet?.slice(0, 80)}`).join("\n");
        const prompt = `Extract 6-10 real competitor COMPANIES for "${productName}" in "${productNiche}". Exclude directories, review sites, news sites. Return JSON only: [{"name":"...","domain":"...","scope":"global"}]\n\n${snippets}`;
        const rawText = await callAI("You are a competitive intelligence engine.", prompt);
        const parsed = tryParseJSON<Array<{ name: string; domain: string; scope: string }>>(rawText);
        if (Array.isArray(parsed) && parsed.length >= 3) {
          return parsed.slice(0, 10).filter(c => c.name && c.domain).map(c => ({ ...c, source: "serp" as const }));
        }
      } catch { /* fall through */ }
    }

    const competitors: DiscoveredCompetitor[] = [];
    for (const r of [...globalRes, ...directRes]) {
      if (competitors.length >= 10) break;
      const host = extractHost(r.url);
      if (!host || seen.has(host) || SKIP_DISCOVERY_DOMAINS.has(host)) continue;
      if (isListSiteDomain(host) || isResearchSiteDomain(host)) continue;
      seen.add(host);
      competitors.push({ name: domainToName(host), domain: host, scope: "global", source: "serp" });
    }
    for (const seed of seeds) {
      if (competitors.length >= 10 || seen.has(seed.domain)) continue;
      seen.add(seed.domain);
      competitors.push({ ...seed, source: "curated" });
    }
    return competitors.slice(0, 10);
  } catch {
    return seeds.slice(0, 10).map(s => ({ ...s, source: "curated" as const }));
  }
}

// ─── Signal helpers ───────────────────────────────────────────────────────────

async function fetchRealCompetitorSignals(name: string): Promise<{ changeType: string; summary: string; impactScore: number; detectedAt: string }[]> {
  try {
    const results = await bdSerp(`${name} pricing hiring product launch 2026`, 5);
    const signals: { changeType: string; summary: string; impactScore: number; detectedAt: string }[] = [];
    for (const r of results) {
      const text = (r.title + " " + r.snippet).toLowerCase();
      let changeType = "web_signal", impactScore = 60;
      if (/pric|cost|fee|plan/.test(text))                                    { changeType = "pricing_change"; impactScore = 82; }
      else if (/hir|job|recruit|vp |director/.test(text))                     { changeType = "hiring_signal";  impactScore = 74; }
      else if (/launch|release|feature|product/.test(text))                   { changeType = "product_launch"; impactScore = 78; }
      else if (/rebrand|messaging|pivot|position/.test(text))                 { changeType = "messaging_pivot";impactScore = 66; }
      else if (/fund|series|raise|invest/.test(text))                         { changeType = "funding";         impactScore = 88; }
      signals.push({
        changeType, impactScore,
        summary: `${r.title.slice(0, 120)} — ${r.snippet.slice(0, 160)}`.trim(),
        detectedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      if (signals.length >= 2) break;
    }
    return signals;
  } catch { return []; }
}

// ─── Research pipeline ────────────────────────────────────────────────────────

const RESEARCH_SYSTEM = `You are RevenueRadar's deep research agent powered by Bright Data live web intelligence.

For any research query, use ALL available Bright Data tools in sequence:
1. search_news (1–2 calls) — latest breaking news and announcements
2. search_web (2–3 calls) — market context, analysis, competitive landscape
3. search_jobs — hiring patterns and org-level signals
4. fetch_webpage or scrape_as_markdown on the most relevant URLs
5. discover_web for AI-ranked research depth
6. Synthesise findings into a comprehensive markdown report

Format your report with:
- ## Executive Summary
- ## Key Findings
- ## Competitive Intelligence
- ## Recommended Actions
- ## Sources

Be specific, cite evidence, and focus on actionable GTM intelligence.`;

async function processResearchTask(taskId: number): Promise<void> {
  const task = db.prepare("SELECT * FROM research_tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task || task.status !== "Pending") return;

  db.prepare("UPDATE research_tasks SET status=?, start_time=? WHERE id=?")
    .run("Processing", new Date().toISOString().replace("T", " ").slice(0, 19), taskId);

  const query = [task.topic, task.region ? `in ${task.region}` : "", task.competitors ? `vs ${task.competitors}` : ""].filter(Boolean).join(" ");
  const priorMemory = await cogneeSearch(query);
  const memoryContext = priorMemory ? `\n\n## Prior Intelligence (RevenueRadar Memory)\n${priorMemory}\n\nVerify and expand on this with fresh live data.\n` : "";

  try {
    let reportContent = "";

    try {
      for await (const event of runAgentStream(RESEARCH_SYSTEM + memoryContext, query, 8)) {
        if (event.type === "report") reportContent = event.content;
        if (event.type === "done") break;
      }
    } catch { /* quota — fall through */ }

    if (!reportContent && BD_API_KEY) {
      const [webResults, newsResults, jobResults] = await Promise.all([
        bdSerp(`${query} 2026`, 8),
        bdSerpNews(query, 6),
        bdSerpJobs(`${query} jobs`, 5),
      ]);
      reportContent = `## Executive Summary\nBright Data live scan: **${webResults.length}** web results, **${newsResults.length}** news articles, **${jobResults.length}** hiring signals.\n\n## Key Web Intelligence\n${webResults.slice(0, 5).map(r => `- **[${r.title}](${r.url})**\n  ${r.snippet}`).join("\n")}\n\n## Breaking News\n${newsResults.slice(0, 5).map(r => `- **${r.title}** *(${r.source ?? "News"}, ${r.date ?? "recent"})*\n  ${r.snippet}`).join("\n")}\n\n## Hiring Signals\n${jobResults.slice(0, 4).map(r => `- **${r.title}** at ${r.company ?? "Unknown"}\n  ${r.snippet}`).join("\n")}\n\n---\n*Live intelligence via Bright Data — ${new Date().toLocaleDateString()}*`;
    }

    if (!reportContent) {
      const changes = db.prepare(`SELECT cc.*, c.name as competitor_name FROM competitor_changes cc JOIN competitors c ON c.id=cc.competitor_id ORDER BY cc.impact_score DESC LIMIT 8`).all() as Array<{ competitor_name: string; change_type: string; summary: string; impact_score: number }>;
      reportContent = `## Offline Mode\n⚠️ Configure BRIGHTDATA_API_KEY and AIML_API_KEY for live intelligence.\n\n${changes.map(c => `### ${c.competitor_name}\n${c.summary}\n> Impact: ${c.impact_score}/100`).join("\n\n")}`;
    }

    let verifiedTrend = "", pricingGap = "", featureInsights = "", confidenceRationale = "";
    let confidenceScore = 70, opportunityScore = 65;
    const ai = getAI();
    if (ai) {
      try {
        const rawText = await callAI("You are a competitive intelligence extractor.", `Extract structured intelligence from this report. Return JSON with keys: verified_trend, pricing_gap, feature_insights, confidence_score (0-100), opportunity_score (0-100), confidence_rationale.\n\n${reportContent.slice(0, 3000)}`);
        const parsed = tryParseJSON<Record<string, unknown>>(rawText);
        if (parsed) {
          verifiedTrend       = String(parsed.verified_trend       ?? "");
          pricingGap          = String(parsed.pricing_gap          ?? "");
          featureInsights     = String(parsed.feature_insights     ?? "");
          confidenceRationale = String(parsed.confidence_rationale ?? "");
          confidenceScore     = Number(parsed.confidence_score)    || 70;
          opportunityScore    = Number(parsed.opportunity_score)   || 65;
        }
      } catch { /* quota */ }
    }

    db.prepare(`INSERT INTO research_results (task_id, topic, region, verified_trend, pricing_gap, feature_insights, confidence_score, confidence_rationale, opportunity_score, data_summary, status, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(taskId, task.topic, task.region ?? null, verifiedTrend || null, pricingGap || null, featureInsights || null, confidenceScore, confidenceRationale || null, opportunityScore, reportContent.slice(0, 8000), "completed", new Date().toISOString().replace("T", " ").slice(0, 19));

    db.prepare("UPDATE research_tasks SET status=?, completed_time=? WHERE id=?")
      .run("Completed", new Date().toISOString().replace("T", " ").slice(0, 19), taskId);

    cogneeAdd(`Topic: ${task.topic}\nDate: ${new Date().toISOString().slice(0, 10)}\n\n${reportContent.slice(0, 4000)}`).catch(() => {});
  } catch (err) {
    db.prepare("UPDATE research_tasks SET status=?, failure_reason=? WHERE id=?")
      .run("Failed", String(err).slice(0, 300), taskId);
  }
}

// ─── Background monitor ───────────────────────────────────────────────────────

async function runBackgroundMonitor(): Promise<void> {
  const users = db.prepare("SELECT id FROM users").all() as { id: string }[];
  let totalNew = 0;
  for (const { id: userId } of users) {
    const comps = db.prepare("SELECT id, name FROM competitors WHERE user_id = ? AND monitoring = 1 LIMIT 3").all(userId) as { id: string; name: string }[];
    for (const comp of comps) {
      const signals = await fetchRealCompetitorSignals(comp.name).catch(() => []);
      for (const s of signals) {
        const exists = db.prepare("SELECT id FROM competitor_changes WHERE competitor_id = ? AND summary = ? AND detected_at > datetime('now','-1 day')").get(comp.id, s.summary);
        if (!exists) {
          db.prepare("INSERT OR IGNORE INTO competitor_changes (id, competitor_id, change_type, summary, impact_score, detected_at) VALUES (?, ?, ?, ?, ?, ?)").run(genId(), comp.id, s.changeType, s.summary, s.impactScore, s.detectedAt);
          totalNew++;
          if (s.impactScore >= 75) {
            sendTriggerWare({
              event: "high_impact_competitor_signal",
              competitor: comp.name,
              changeType: s.changeType,
              summary: s.summary,
              impactScore: s.impactScore,
              detectedAt: s.detectedAt,
            }).catch(() => {});
          }
        }
      }
    }
  }
  db.prepare("INSERT INTO monitor_log (id, user_id, ran_at, changes_found) VALUES (?, ?, datetime('now'), ?)").run(genId(), "system", totalNew);
  if (totalNew > 0) console.log(`[Monitor] ${totalNew} new signals saved.`);
}

// ─── Smart mock GTM answer (offline fallback) ─────────────────────────────────

function generateMockGtmAnswer(query: string, userId?: string): { answer: string; recommendedAlert: unknown } {
  const q = query.toLowerCase();
  const changes = (userId
    ? db.prepare("SELECT cc.*, c.name as competitor_name FROM competitor_changes cc JOIN competitors c ON c.id=cc.competitor_id WHERE c.user_id=? ORDER BY cc.detected_at DESC LIMIT 6").all(userId)
    : db.prepare("SELECT cc.*, c.name as competitor_name FROM competitor_changes cc JOIN competitors c ON c.id=cc.competitor_id ORDER BY cc.detected_at DESC LIMIT 6").all()
  ) as Array<{ competitor_name: string; change_type: string; summary: string; impact_score: number }>;

  const match = changes.find(c =>
    q.includes(c.competitor_name.toLowerCase()) ||
    (q.includes("pric") && c.change_type === "pricing_change") ||
    (q.includes("hir") && c.change_type === "hiring_signal")
  ) || changes[0];

  const topChanges = changes.slice(0, 4).map(c => `- **${c.competitor_name}** — ${c.summary} *(Impact: ${c.impact_score}/100)*`).join("\n");

  return {
    answer: `## Intelligence: ${query}\n\n### Signals Detected\n${topChanges || "_No signals in database yet._"}\n\n### Recommendation\n- Target accounts displaced by ${match?.competitor_name ?? "competitors"} pricing changes\n- Update battlecards with latest positioning intel\n\n*From RevenueRadar local database — configure API keys for live data*`,
    recommendedAlert: { name: `Tracking: ${query.slice(0, 25)}`, targetEntity: match?.competitor_name ?? "Key Accounts", signalTypes: ["Pricing Shift", "Hiring Signal"] },
  };
}

// ─── Express Server ───────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "100mb" }));
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });

  const agentLimiter = rateLimit({
    windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false,
    message: { error: "Too many requests — try again in a minute." },
  });

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    const lastLog = db.prepare("SELECT ran_at, changes_found FROM monitor_log ORDER BY ran_at DESC LIMIT 1").get() as { ran_at: string; changes_found: number } | undefined;
    res.json({
      status: "ok", hasAiKey: !!process.env.AIML_API_KEY, hasBrightDataKey: !!BD_API_KEY,
      hasMcpUrl: !!BD_MCP_URL, hasSlackWebhook: !!SLACK_WEBHOOK,
      hasCogneeMemory: isCogneeReady(), hasSpeechmatics: isSpeechmaticsReady(),
      model: AIML_MODEL,
      agentTools: TOOL_DECLARATIONS.map(t => (t as { function: { name: string } }).function.name),
      timestamp: new Date().toISOString(),
      lastMonitorRan: lastLog?.ran_at ?? null, lastChangesFound: lastLog?.changes_found ?? 0,
    });
  });

  // ── Auth ──────────────────────────────────────────────────────────────────

  app.post("/api/auth/signup", async (req, res) => {
    const { email, password, name, productName, productNiche, companyCity } = req.body as Record<string, string>;
    if (!email || !password || !name || !productName || !productNiche)
      return res.status(400).json({ error: "All fields are required." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim()))
      return res.status(409).json({ error: "An account with this email already exists." });

    let compLat: number | null = null;
    let compLng: number | null = null;
    const cityStr = companyCity?.trim() ?? "";
    if (cityStr) {
      const coords = await photonGeocodeCity(cityStr).catch(() => null);
      if (coords) { compLat = coords.lat; compLng = coords.lng; }
    }

    const userId = genId();
    db.prepare("INSERT INTO users (id, email, password, name, product_name, product_niche, company_city, company_lat, company_lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(userId, email.toLowerCase().trim(), hashPassword(password), name.trim(), productName.trim(), productNiche.trim(), cityStr, compLat, compLng);
    const token = genId();
    db.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").run(token, userId);
    const user = db.prepare("SELECT id, email, name, product_name, product_niche, company_city, company_lat, company_lng FROM users WHERE id = ?").get(userId) as UserRow;
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, productName: user.product_name, productNiche: user.product_niche, companyCity: user.company_city, companyLat: user.company_lat ?? undefined, companyLng: user.company_lng ?? undefined }, competitorCount: 0 });

    setImmediate(async () => {
      try {
        const discovered = await discoverCompetitors(productName, productNiche, userId);
        const insertComp   = db.prepare("INSERT OR IGNORE INTO competitors (id, name, domain, industry, scope, discovery_source, hq_lat, hq_lng, hq_city, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        const insertChange = db.prepare("INSERT OR IGNORE INTO competitor_changes (id, competitor_id, change_type, summary, impact_score, detected_at) VALUES (?, ?, ?, ?, ?, ?)");
        for (const c of discovered) {
          const compId = genId();
          const hq = resolveHq(c.domain);
          insertComp.run(compId, c.name, c.domain, productNiche, c.scope, c.source, hq.lat, hq.lng, hq.city, userId);
          const signals = await fetchRealCompetitorSignals(c.name);
          for (const s of signals) insertChange.run(genId(), compId, s.changeType, s.summary, s.impactScore, s.detectedAt);
        }
      } catch (e) { console.error("[Signup] Background discovery failed:", e); }
    });
  });

  app.post("/api/auth/signin", (req, res) => {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim()) as UserRow | undefined;
    if (!user || !verifyPassword(password, user.password)) return res.status(401).json({ error: "Invalid credentials." });
    const token = genId();
    db.prepare("INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))").run(token, user.id);
    return res.json({ token, user: { id: user.id, email: user.email, name: user.name, productName: user.product_name, productNiche: user.product_niche, companyCity: user.company_city, companyLat: user.company_lat ?? undefined, companyLng: user.company_lng ?? undefined } });
  });

  app.get("/api/auth/me", requireAuth, (req, res) => {
    const user = db.prepare("SELECT id, email, name, product_name, product_niche, company_city, company_lat, company_lng FROM users WHERE id = ?").get((req as AuthRequest).userId) as UserRow | undefined;
    return user ? res.json({ id: user.id, email: user.email, name: user.name, productName: user.product_name, productNiche: user.product_niche, companyCity: user.company_city, companyLat: user.company_lat ?? undefined, companyLng: user.company_lng ?? undefined }) : res.status(404).json({ error: "User not found." });
  });

  app.put("/api/profile", requireAuth, async (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { name, companyCity, productName, productNiche } = req.body as Record<string, string>;

    let compLat: number | null = null;
    let compLng: number | null = null;
    const cityStr = companyCity?.trim() ?? "";
    if (cityStr) {
      const coords = await photonGeocodeCity(cityStr).catch(() => null);
      if (coords) { compLat = coords.lat; compLng = coords.lng; }
    }

    db.prepare("UPDATE users SET name=?, company_city=?, company_lat=?, company_lng=?, product_name=?, product_niche=? WHERE id=?")
      .run(name?.trim() || "", cityStr, compLat, compLng, productName?.trim() || "", productNiche?.trim() || "", uid);

    const user = db.prepare("SELECT id, email, name, product_name, product_niche, company_city, company_lat, company_lng FROM users WHERE id=?").get(uid) as UserRow;
    return res.json({ user: { id: user.id, email: user.email, name: user.name, productName: user.product_name, productNiche: user.product_niche, companyCity: user.company_city, companyLat: user.company_lat ?? undefined, companyLng: user.company_lng ?? undefined } });
  });

  // ── Audio Intelligence (Speechmatics + AI) ───────────────────────────────

  type AudioAnalysis = {
    summary: string;
    pricingSignals: string[];
    productAnnouncements: string[];
    hiringSignals: string[];
    marketPositioning: string[];
    keyQuotes: string[];
    sentiment: "bullish" | "neutral" | "bearish";
  };
  type AudioJob = {
    id: string; speechmaticsJobId: string | null; competitorName: string;
    audioUrl: string; status: "transcribing" | "analyzing" | "done" | "error";
    transcript?: string; analysis?: AudioAnalysis; createdAt: number; userId: string;
  };

  type AudioJobRow = {
    id: string; speechmatics_job_id: string | null; competitor_name: string;
    audio_url: string; status: string; transcript: string | null;
    analysis_json: string | null; user_id: string; created_at: string;
  };

  function loadAudioJob(id: string): AudioJob | undefined {
    const row = db.prepare("SELECT * FROM audio_jobs WHERE id = ?").get(id) as AudioJobRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id, speechmaticsJobId: row.speechmatics_job_id,
      competitorName: row.competitor_name, audioUrl: row.audio_url,
      status: row.status as AudioJob["status"],
      transcript: row.transcript ?? undefined,
      analysis: row.analysis_json ? tryParseJSON<AudioAnalysis>(row.analysis_json) ?? undefined : undefined,
      createdAt: new Date(row.created_at).getTime(), userId: row.user_id,
    };
  }

  function saveAudioJob(job: AudioJob): void {
    db.prepare(`INSERT OR REPLACE INTO audio_jobs (id, speechmatics_job_id, competitor_name, audio_url, status, transcript, analysis_json, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(job.id, job.speechmaticsJobId, job.competitorName, job.audioUrl, job.status,
           job.transcript ?? null, job.analysis ? JSON.stringify(job.analysis) : null,
           job.userId, new Date(job.createdAt).toISOString().replace("T", " ").slice(0, 19));
  }

  function startAudioPipeline(jobId: string) {
    const job = loadAudioJob(jobId);
    if (!job?.speechmaticsJobId) return;

    const poll = setInterval(async () => {
      try {
        const s = await getJobStatus(job.speechmaticsJobId!);
        if (!s) return;
        if (s.status === "done") {
          clearInterval(poll);
          const transcript = await getTranscript(job.speechmaticsJobId!);
          const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
          if (wordCount < 30) {
            const current = loadAudioJob(jobId);
            if (current) saveAudioJob({ ...current, status: "error", transcript,
              analysis: { summary: wordCount === 0 ? "No speech detected — audio appears to be silent or music." : `Only ${wordCount} words transcribed — audio may not contain usable speech.`, pricingSignals: [], productAnnouncements: [], hiringSignals: [], marketPositioning: [], keyQuotes: [], sentiment: "neutral" } });
            return;
          }
          const current = loadAudioJob(jobId);
          if (!current) return;
          saveAudioJob({ ...current, status: "analyzing", transcript });

          const prompt = `You are a senior competitive intelligence analyst reviewing audio content about "${job.competitorName}".

STEP 1 — RELEVANCE CHECK: Is this transcript actually from or about "${job.competitorName}", their products, pricing, or industry? If it is unrelated content (historical news, music, random audio), respond with exactly: IRRELEVANT_AUDIO

STEP 2 — If relevant, return ONLY valid JSON (no markdown):
{
  "summary": "2-3 sentence executive summary of competitive insights",
  "pricingSignals": ["each pricing change, tier mention, or discount strategy found"],
  "productAnnouncements": ["each new feature, product launch, or roadmap item mentioned"],
  "hiringSignals": ["each team expansion, department growth, or key hire signal"],
  "marketPositioning": ["how they position against competitors or define their market"],
  "keyQuotes": ["exact verbatim quotes most relevant to sales battlecards"],
  "sentiment": "bullish"
}

Sentiment: "bullish" = confident/growing/aggressive, "neutral" = steady/cautious, "bearish" = defensive/cutting/declining.
Empty array [] if a category has no signals.

TRANSCRIPT (first 12 000 chars):
---
${transcript.slice(0, 12_000)}
---`;

          try {
            const rawText = await callAI("You are a senior competitive intelligence analyst.", prompt);
            const raw = rawText.replace(/```json\n?|\n?```/g, "").trim();
            const updated = loadAudioJob(jobId);
            if (!updated) return;
            if (raw === "IRRELEVANT_AUDIO" || raw.startsWith("IRRELEVANT")) {
              saveAudioJob({ ...updated, status: "error", analysis: {
                summary: `Audio is not about ${job.competitorName} — provide an actual podcast, earnings call, or keynote featuring their executives.`,
                pricingSignals: [], productAnnouncements: [], hiringSignals: [],
                marketPositioning: [], keyQuotes: [], sentiment: "neutral",
              }});
            } else {
              const analysis = tryParseJSON<AudioAnalysis>(raw);
              saveAudioJob({ ...updated, status: analysis ? "done" : "error", analysis: analysis ?? undefined });
            }
          } catch {
            const updated = loadAudioJob(jobId);
            if (updated) saveAudioJob({ ...updated, status: "error" });
          }

        } else if (["rejected", "deleted", "expired"].includes(s.status)) {
          clearInterval(poll);
          const current = loadAudioJob(jobId);
          if (current) saveAudioJob({ ...current, status: "error" });
        }
      } catch {
        clearInterval(poll);
        const current = loadAudioJob(jobId);
        if (current) saveAudioJob({ ...current, status: "error" });
      }
    }, 6_000);

    setTimeout(() => {
      clearInterval(poll);
      const j = loadAudioJob(jobId);
      if (j && j.status !== "done") saveAudioJob({ ...j, status: "error" });
    }, 12 * 60 * 1_000);
  }

  app.post("/api/intel/audio-analyze", requireAuth, async (req, res) => {
    const { audioUrl, competitorName, language = "en" } = req.body as { audioUrl: string; competitorName: string; language?: string };
    if (!audioUrl?.trim() || !competitorName?.trim())
      return res.status(400).json({ error: "audioUrl and competitorName are required." });
    if (!isSpeechmaticsReady())
      return res.status(503).json({ error: "SPEECHMATICS_API_KEY not set — add it to .env to enable audio intelligence." });

    const smJobId = await submitTranscriptionJob(audioUrl.trim(), language);
    if (!smJobId) return res.status(502).json({ error: "Speechmatics rejected the audio URL. Ensure it is a direct MP3/WAV/MP4 link." });

    const jobId = genId();
    saveAudioJob({
      id: jobId, speechmaticsJobId: smJobId, competitorName: competitorName.trim(),
      audioUrl: audioUrl.trim(), status: "transcribing", createdAt: Date.now(),
      userId: (req as AuthRequest).userId,
    });
    startAudioPipeline(jobId);
    return res.json({ jobId, status: "transcribing" });
  });

  app.get("/api/intel/audio-analyze/:jobId", requireAuth, (req, res) => {
    const job = loadAudioJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (job.userId !== (req as AuthRequest).userId) return res.status(403).json({ error: "Forbidden." });
    return res.json({
      jobId: job.id, status: job.status, competitorName: job.competitorName,
      analysis: job.analysis ?? null,
      transcriptPreview: job.transcript ? job.transcript.slice(0, 400) : undefined,
    });
  });

  // ── Podcast & Keynote Monitor ─────────────────────────────────────────────

  const podcastScanJobs = new Map<string, { sourceId: string; smJobId: string }>();

  async function runPodcastScan(sourceId: string, competitorId: string, competitorName: string, smJobId: string) {
    const poll = setInterval(async () => {
      try {
        const s = await getJobStatus(smJobId);
        if (!s) return;
        if (s.status === "done") {
          clearInterval(poll);
          const transcript = await getTranscript(smJobId);
          const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;

          // Guard: music / silence produces < 30 words — don't send to AI or it will hallucinate
          if (wordCount < 30) {
            const msg = wordCount === 0
              ? "No speech detected — audio appears to be silent or music. Provide a direct URL to a spoken podcast or earnings call."
              : `Too little speech detected (${wordCount} words) — audio may be music or mostly silent. Use a spoken audio source.`;
            db.prepare("UPDATE competitor_audio_sources SET last_status=?, last_scanned_at=?, latest_insight=? WHERE id=?")
              .run("no_speech", new Date().toISOString().replace("T", " ").slice(0, 19), msg, sourceId);
            podcastScanJobs.delete(sourceId);
            return;
          }

          const prompt = `You are a B2B competitive intelligence analyst reviewing a transcript to check if it contains useful intel about ${competitorName}.

STEP 1 — RELEVANCE CHECK: Does this transcript appear to be from or about ${competitorName} executives, their products, pricing, strategy, or industry? If the audio is unrelated (news from a different era, music, unrelated topic, random content), respond with exactly: IRRELEVANT_AUDIO

STEP 2 — If relevant, return ONLY valid JSON with no markdown:
{
  "keyInsight": "1-2 sentence most actionable competitive intel for a sales team",
  "roadmapHints": ["specific product or feature direction hinted at"],
  "positioningShifts": ["changes in how they describe their market, ICP, or value prop"],
  "competitiveMentions": ["direct or indirect mentions of rival companies or categories"],
  "growthSignals": ["expansion plans, metrics, headcount growth, new market entry"],
  "toneShift": "bullish",
  "impactScore": 65
}

impactScore 0-100: 75+ = pricing/major pivots/product launches; 50-74 = positioning/growth signals; <50 = generic marketing.
toneShift must be "bullish", "neutral", or "defensive".

TRANSCRIPT (first 14000 chars):
---
${transcript.slice(0, 14_000)}
---`;

          try {
            const rawText = await callAI("You are a B2B competitive intelligence analyst.", prompt);
            const raw = rawText.replace(/```json\n?|\n?```/g, "").trim();

            if (raw === "IRRELEVANT_AUDIO" || raw.startsWith("IRRELEVANT")) {
              db.prepare("UPDATE competitor_audio_sources SET last_status=?, last_scanned_at=?, latest_insight=? WHERE id=?")
                .run("no_speech", new Date().toISOString().replace("T", " ").slice(0, 19),
                  `Audio is not about ${competitorName} — please provide an actual podcast, earnings call, or keynote featuring ${competitorName} executives.`, sourceId);
            } else {
              const analysis = tryParseJSON<{ keyInsight: string; impactScore: number; toneShift: string; roadmapHints: string[]; positioningShifts: string[]; competitiveMentions: string[]; growthSignals: string[] }>(raw);
              if (analysis) {
                const now = new Date().toISOString().replace("T", " ").slice(0, 19);
                db.prepare("INSERT INTO competitor_changes (id, competitor_id, change_type, summary, impact_score, details, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
                  .run(genId(), competitorId, "podcast_intel", analysis.keyInsight.slice(0, 300), analysis.impactScore, JSON.stringify(analysis), now);
                db.prepare("UPDATE competitor_audio_sources SET last_status=?, last_scanned_at=?, latest_insight=? WHERE id=?")
                  .run("done", now, analysis.keyInsight.slice(0, 300), sourceId);
              } else {
                db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("error", sourceId);
              }
            }
          } catch { db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("error", sourceId); }
          podcastScanJobs.delete(sourceId);

        } else if (["rejected", "deleted", "expired"].includes(s.status)) {
          clearInterval(poll);
          db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("error", sourceId);
          podcastScanJobs.delete(sourceId);
        }
      } catch { clearInterval(poll); db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("error", sourceId); podcastScanJobs.delete(sourceId); }
    }, 6_000);

    setTimeout(() => {
      clearInterval(poll);
      const src = db.prepare("SELECT last_status FROM competitor_audio_sources WHERE id=?").get(sourceId) as { last_status: string } | undefined;
      if (src?.last_status === "scanning") db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("error", sourceId);
      podcastScanJobs.delete(sourceId);
    }, 15 * 60 * 1_000);
  }

  app.get("/api/competitors/:compId/podcast-analysis", requireAuth, (req, res) => {
    const { compId } = req.params;
    const uid = (req as AuthRequest).userId;
    if (!db.prepare("SELECT id FROM competitors WHERE id=? AND user_id=?").get(compId, uid))
      return res.status(404).json({ error: "Not found." });
    const change = db.prepare(
      "SELECT details, summary, impact_score, detected_at FROM competitor_changes WHERE competitor_id=? AND change_type='podcast_intel' ORDER BY detected_at DESC LIMIT 1"
    ).get(compId) as { details: string; summary: string; impact_score: number; detected_at: string } | undefined;
    if (!change) return res.json({ analysis: null });
    return res.json({
      analysis: tryParseJSON(change.details ?? "{}"),
      summary: change.summary,
      impactScore: change.impact_score,
      detectedAt: change.detected_at,
    });
  });

  app.get("/api/competitors/:compId/audio-sources", requireAuth, (req, res) => {
    const { compId } = req.params;
    const uid = (req as AuthRequest).userId;
    const comp = db.prepare("SELECT id FROM competitors WHERE id=? AND user_id=?").get(compId, uid);
    if (!comp) return res.status(404).json({ error: "Competitor not found." });
    const sources = db.prepare("SELECT * FROM competitor_audio_sources WHERE competitor_id=? AND user_id=? ORDER BY created_at DESC").all(compId, uid) as AudioSourceRow[];
    return res.json({ data: sources.map(s => ({ id: s.id, url: s.url, label: s.label, lastScannedAt: s.last_scanned_at, lastStatus: s.last_status, latestInsight: s.latest_insight, createdAt: s.created_at })) });
  });

  // Upload a local audio file (base64-encoded JSON) — no public URL needed
  app.post("/api/competitors/:compId/audio-sources/upload",
    requireAuth,
    async (req, res) => {
      const { compId } = req.params;
      const uid = (req as AuthRequest).userId;
      if (!isSpeechmaticsReady()) return res.status(503).json({ error: "SPEECHMATICS_API_KEY not configured." });
      const comp = db.prepare("SELECT name FROM competitors WHERE id=? AND user_id=?").get(compId, uid) as { name: string } | undefined;
      if (!comp) return res.status(404).json({ error: "Competitor not found." });

      const { filename, data } = req.body as { filename?: string; data?: string };
      if (!filename || !data) return res.status(400).json({ error: "filename and data (base64) required." });

      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const buffer = Buffer.from(data, "base64");
      if (!buffer.length) return res.status(400).json({ error: "Empty file." });

      const smJobId = await submitTranscriptionJobFromBuffer(buffer, safeFilename, "en");
      if (!smJobId) return res.status(502).json({ error: "Speechmatics rejected the file. Ensure it is MP3, WAV, or MP4 format." });

      const label = safeFilename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim().slice(0, 80) || safeFilename;
      const sourceId = genId();
      db.prepare("INSERT INTO competitor_audio_sources (id, competitor_id, url, label, last_status, user_id) VALUES (?, ?, ?, ?, ?, ?)")
        .run(sourceId, compId, `uploaded://${safeFilename}`, label, "scanning", uid);

      podcastScanJobs.set(sourceId, { sourceId, smJobId });
      runPodcastScan(sourceId, compId, comp.name, smJobId);
      return res.status(201).json({ id: sourceId, label, url: `uploaded://${safeFilename}`, lastStatus: "scanning", lastScannedAt: null, latestInsight: null });
    }
  );

  app.post("/api/competitors/:compId/audio-sources", requireAuth, (req, res) => {
    const { compId } = req.params;
    const uid = (req as AuthRequest).userId;
    const { url } = req.body as { url: string };
    if (!url?.trim()) return res.status(400).json({ error: "url is required." });
    const comp = db.prepare("SELECT id FROM competitors WHERE id=? AND user_id=?").get(compId, uid);
    if (!comp) return res.status(404).json({ error: "Competitor not found." });
    const autoLabel = (() => {
      try {
        const u = new URL(url.trim());
        const host = u.hostname.replace(/^www\./, "");
        const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
        const clean = decodeURIComponent(seg).replace(/[-_]/g, " ").replace(/\.[^.]+$/, "").trim();
        return clean.length > 4 ? `${host} — ${clean.slice(0, 60)}` : host;
      } catch { return url.trim().slice(0, 80); }
    })();
    const id = genId();
    db.prepare("INSERT INTO competitor_audio_sources (id, competitor_id, url, label, user_id) VALUES (?, ?, ?, ?, ?)").run(id, compId, url.trim(), autoLabel, uid);
    return res.status(201).json({ id, url: url.trim(), label: autoLabel, lastScannedAt: null, lastStatus: null, latestInsight: null });
  });

  app.delete("/api/competitors/:compId/audio-sources/:sourceId", requireAuth, (req, res) => {
    const { sourceId } = req.params;
    const uid = (req as AuthRequest).userId;
    db.prepare("DELETE FROM competitor_audio_sources WHERE id=? AND user_id=?").run(sourceId, uid);
    podcastScanJobs.delete(sourceId);
    return res.json({ ok: true });
  });

  app.post("/api/competitors/:compId/audio-sources/:sourceId/scan", requireAuth, async (req, res) => {
    const { compId, sourceId } = req.params;
    const uid = (req as AuthRequest).userId;
    if (!isSpeechmaticsReady()) return res.status(503).json({ error: "SPEECHMATICS_API_KEY not configured." });
    if (podcastScanJobs.has(sourceId)) return res.json({ status: "scanning" });
    const source = db.prepare("SELECT * FROM competitor_audio_sources WHERE id=? AND user_id=?").get(sourceId, uid) as AudioSourceRow | undefined;
    if (!source) return res.status(404).json({ error: "Audio source not found." });
    const comp = db.prepare("SELECT name FROM competitors WHERE id=?").get(compId) as { name: string } | undefined;
    if (!comp) return res.status(404).json({ error: "Competitor not found." });
    const smJobId = await submitTranscriptionJob(source.url, "en");
    if (!smJobId) return res.status(502).json({ error: "Speechmatics rejected the URL. Ensure it is a direct MP3/WAV/MP4 link." });
    db.prepare("UPDATE competitor_audio_sources SET last_status=? WHERE id=?").run("scanning", sourceId);
    podcastScanJobs.set(sourceId, { sourceId, smJobId });
    runPodcastScan(sourceId, compId, comp.name, smJobId);
    return res.json({ status: "scanning" });
  });

  // ── Speechmatics Transcription ────────────────────────────────────────────

  app.post("/api/transcribe", requireAuth, async (req, res) => {
    const { audioUrl, language = "en" } = req.body as { audioUrl: string; language?: string };
    if (!audioUrl?.trim()) return res.status(400).json({ error: "audioUrl is required." });
    if (!isSpeechmaticsReady()) return res.status(503).json({ error: "SPEECHMATICS_API_KEY not configured." });
    const jobId = await submitTranscriptionJob(audioUrl.trim(), language);
    if (!jobId) return res.status(502).json({ error: "Failed to submit transcription job." });
    return res.json({ jobId, status: "running", message: "Transcription job submitted. Poll /api/transcribe/:jobId for status." });
  });

  app.get("/api/transcribe/:jobId", requireAuth, async (req, res) => {
    const { jobId } = req.params;
    if (!isSpeechmaticsReady()) return res.status(503).json({ error: "SPEECHMATICS_API_KEY not configured." });
    const job = await getJobStatus(jobId);
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (job.status !== "done") return res.json({ jobId, status: job.status });
    const transcript = await getTranscript(jobId);
    return res.json({ jobId, status: "done", transcript });
  });

  app.post("/api/auth/signout", requireAuth, (req, res) => {
    const token = getToken(req);
    if (token) db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    return res.json({ status: "ok" });
  });

  // ── GTM Query ────────────────────────────────────────────────────────────

  app.post("/api/query-gtm", requireAuth, agentLimiter, async (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { query } = req.body as { query: string };
    if (!query?.trim()) return res.status(400).json({ error: "Query is required." });
    const safeQuery = sanitizeInput(query, 500);
    try {
      const ai = getAI();
      if (ai) {
        const system = `You are RevenueRadar, an elite GTM competitive intelligence analyst. Use 1-2 targeted tool calls then synthesise. Return JSON: { "answer": "markdown analysis", "recommendedAlert": { "name": "...", "targetEntity": "...", "signalTypes": [...] } | null }`;
        const raw = await runAgent({ systemInstruction: system, userMessage: safeQuery, jsonOutput: true, maxTurns: 3 });
        const parsed = tryParseJSON<{ answer: string; recommendedAlert: unknown }>(raw);
        return res.json(parsed || { answer: raw, recommendedAlert: null });
      }
    } catch { /* fall through */ }
    return res.json(generateMockGtmAnswer(safeQuery, uid));
  });

  // ── Company Enrichment ────────────────────────────────────────────────────

  app.post("/api/enrich-company", requireAuth, agentLimiter, async (req, res) => {
    const { domain } = req.body as { domain: string };
    if (!domain) return res.status(400).json({ error: "Domain is required." });
    const clean = sanitizeInput(domain.toLowerCase().trim(), 100);
    const ai = getAI();
    if (!ai) return res.status(503).json({ error: "AIML_API_KEY required for enrichment." });

    try {
      const system = `You are a firmographic and GTM signal enrichment engine. Research "${clean}" using Bright Data tools: search_news, search_web, search_jobs, get_linkedin_company, get_crunchbase_company. Return ONLY valid JSON:\n{"name":"...","domain":"...","intentScore":85,"isPublicTarget":true,"hqLocation":"City, State","firmographics":{"fundingTotal":"$X","fundingStage":"Series X","revenueRange":"$X–$Y","revenueDetails":"Estimated ARR","employees":"X+","growthYoY":"+X% YoY","industry":"...","industryDetails":"..."},"technographics":["..."],"timeline":[{"id":"t1","type":"hiring","title":"...","time":"Xh ago","description":"..."}],"aiSynthesis":{"recommendedAngle":"...","outreachMessage":"...","personas":[{"name":"...","title":"...","initials":"AB"}],"marketMaturity":72,"marketContext":"..."}}`;
      const raw    = await runAgent({ systemInstruction: system, userMessage: `Research and enrich: ${clean}`, jsonOutput: true, maxTurns: 8 });
      const parsed = tryParseJSON<Record<string, unknown>>(raw);
      return res.json(parsed || { name: clean, domain: clean, raw });
    } catch (err) {
      return res.status(500).json({ error: "Enrichment failed.", details: String(err) });
    }
  });

  // ── Competitor Battlecard ─────────────────────────────────────────────────

  app.post("/api/competitor-battlecard", requireAuth, agentLimiter, async (req, res) => {
    const rawName = (req.body as { name: string }).name;
    if (!rawName) return res.status(400).json({ error: "Competitor name is required." });
    const name = sanitizeInput(rawName, 100);
    const ai = getAI();
    if (!ai) return res.status(503).json({ error: "AIML_API_KEY required for battlecard." });

    try {
      const system = `You are a competitive battlecard strategist. Research "${name}" using: search_news, search_web for pricing/product/reviews, search_jobs for hiring patterns, fetch_webpage on their pricing page. Return ONLY valid JSON:\n{"competitorName":"${name}","threatLevel":82,"marketOverlap":88,"featureParity":72,"timeline":[{"id":"c1","type":"pricing","title":"...","time":"2h ago","description":"..."}],"strategicSummary":{"weaknesses":["..."],"strengths":["..."]},"battlecards":[{"title":"...","category":"price","content":"..."}]}`;
      const agentPromise = runAgent({ systemInstruction: system, userMessage: `Battlecard for: ${name}`, jsonOutput: true, maxTurns: 6 });
      const raw    = await Promise.race([agentPromise, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 45_000))]);
      const parsed = tryParseJSON<Record<string, unknown>>(raw);
      return res.json(parsed || { competitorName: name, raw });
    } catch (err) {
      // Graceful deterministic fallback — real DB hash so scores are stable across requests
      const nameHash = parseInt(sha256(name).slice(0, 6), 16);
      const cap = name.charAt(0).toUpperCase() + name.slice(1);
      return res.json({
        _offlineMode: true,
        competitorName: cap, threatLevel: (nameHash % 26) + 64, marketOverlap: ((nameHash >> 4) % 20) + 70, featureParity: ((nameHash >> 8) % 25) + 58,
        timeline: [
          { id: "t1", type: "pricing",   title: `${cap} Mid-Market Price Increase`,   time: "3h ago",  description: `${cap} raised mid-tier pricing 18%.` },
          { id: "t2", type: "product",   title: "AI Feature Launch Detected",          time: "2d ago",  description: `${cap} released an autonomous workflow module.` },
          { id: "t3", type: "hiring",    title: "Aggressive GTM Hiring Signal",        time: "5d ago",  description: `${cap} posted 12 sales & engineering roles.` },
          { id: "t4", type: "messaging", title: "Website Messaging Pivot",             time: "1w ago",  description: `${cap} shifted to outcome-led homepage positioning.` },
        ],
        strategicSummary: {
          weaknesses: [`${cap} implementation timelines average 6+ months.`, "Limited mobile support cited in customer reviews."],
          strengths:  ["Strong brand recognition in enterprise segment.", "Native integrations across 400+ SaaS connectors."],
        },
        battlecards: [
          { title: "Pricing & TCO", category: "price",   content: `${cap} recently raised mid-tier pricing by ~18%. Ask prospects if they've received a renewal quote — now is a strong time to anchor on total cost of ownership.` },
          { title: "Speed to Value", category: "product", content: `${cap} deployments average 6+ months per customer reviews. Use speed-to-value as a qualifying question: "How quickly do you need to see results?"` },
          { title: "Data Governance", category: "privacy", content: `${cap} operates a multi-tenant architecture. In regulated industries, ask prospects about their data residency requirements — this is a known evaluation criterion.` },
        ],
      });
    }
  });

  // ── Competitor Monitor ────────────────────────────────────────────────────

  app.post("/api/competitors/:id/monitor", requireAuth, agentLimiter, async (req, res) => {
    const comp = db.prepare("SELECT * FROM competitors WHERE id = ?").get(req.params.id) as CompetitorRow | undefined;
    if (!comp) return res.status(404).json({ error: "Competitor not found." });
    if (!comp.pricing_url) return res.status(400).json({ error: "No pricingUrl configured." });
    const ai = getAI();
    if (!ai) return res.json({ status: "success", data: { changed: false, message: "AIML_API_KEY required." } });
    try {
      const previous = db.prepare("SELECT * FROM competitor_snapshots WHERE competitor_id = ? ORDER BY captured_at DESC LIMIT 1").get(comp.id) as SnapshotRow | undefined;
      const system = `You are an automated pricing monitor for "${comp.name}". Fetch their pricing page, compare with previous snapshot, save any changes, send Slack alert if impact >= 70. Return JSON: {"changed":bool,"tiers_found":int,"change_saved":bool,"alert_sent":bool,"summary":"..."}`;
      const raw    = await runAgent({ systemInstruction: system, userMessage: `Monitor ${comp.name} at ${comp.pricing_url}. Previous: ${previous?.structured_data ?? "none"}`, jsonOutput: true, maxTurns: 6 });
      const result = tryParseJSON<{ changed: boolean; tiers_found: number; summary: string }>(raw);
      if (result) {
        const html  = await bdUnlock(comp.pricing_url!);
        const tiers = extractPricing(html);
        db.prepare("INSERT INTO competitor_snapshots (id, competitor_id, type, url, structured_data, checksum, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(genId(), comp.id, "pricing", comp.pricing_url!, JSON.stringify({ tiers }), sha256(JSON.stringify(tiers)), new Date().toISOString());
      }
      return res.json({ status: "success", data: result || { changed: false, summary: raw } });
    } catch (err) { return res.status(500).json({ error: "Monitor failed.", details: String(err) }); }
  });

  // ── Account Signal Enrichment ─────────────────────────────────────────────

  app.post("/api/accounts/enrich-signals", requireAuth, agentLimiter, async (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { accountName, domain } = req.body as { accountName: string; domain: string };
    if (!accountName) return res.status(400).json({ error: "accountName required." });
    const ai = getAI();
    if (!ai) return res.json({ status: "success", data: { signals: [] } });
    try {
      const system = `You are a buying-intent signal detection agent. For the company below, use search_jobs, search_news, discover_web, monitor_social, score_buying_intent. Return JSON: {"signals":[{"type":"...","title":"...","description":"...","intentScore":85,"source":"..."}]}`;
      const raw    = await runAgent({ systemInstruction: system, userMessage: `Find signals for: ${accountName} (${domain || "unknown domain"})`, jsonOutput: true, maxTurns: 8 });
      const parsed = tryParseJSON<{ signals: unknown[] }>(raw);
      if (parsed?.signals) {
        const stmt = db.prepare("INSERT OR IGNORE INTO account_signals (id, account_id, account_name, signal_type, source, title, description, url, intent_score, metadata, detected_at, acted_on, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        for (const s of parsed.signals as Record<string, unknown>[]) {
          stmt.run(genId(), domain || accountName, accountName, s.type || "web", s.source || "web", s.title || "Signal", s.description || "", s.url || null, Number(s.intentScore ?? 50), "{}", new Date().toISOString(), 0, uid);
        }
      }
      return res.json({ status: "success", data: parsed || { signals: [] } });
    } catch (err) { return res.status(500).json({ error: "Signal agent failed.", details: String(err) }); }
  });

  // ── Intelligence Natural Language Query ───────────────────────────────────

  app.post("/api/intelligence/query", requireAuth, async (req, res) => {
    const { query } = req.body as { query: string };
    if (!query?.trim()) return res.status(400).json({ error: "Query is required." });
    const ai = getAI();
    if (!ai) return res.status(503).json({ error: "AIML_API_KEY not configured." });
    const competitorList = (db.prepare("SELECT name, domain FROM competitors").all() as CompetitorRow[]).map(c => `${c.name} (${c.domain})`).join(", ");
    const system = `You are RevenueRadar's intelligence engine. Monitored competitors: ${competitorList || "none yet"}. Use search_web and fetch_webpage for live intelligence. Be specific and tactical.`;
    const answer = await runAgent({ systemInstruction: system, userMessage: query, maxTurns: 6 }).catch(err => `Error: ${String(err)}`);
    return res.json({ status: "success", data: { answer } });
  });

  // ── Competitors CRUD ──────────────────────────────────────────────────────

  app.get("/api/competitors", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    return res.json({ status: "success", data: (db.prepare("SELECT * FROM competitors WHERE user_id = ? ORDER BY created_at ASC").all(uid) as CompetitorRow[]).map(competitorToApi) });
  });

  app.post("/api/competitors", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { name, domain, pricingUrl, blogUrl, careersUrl, industry } = req.body as Record<string, string>;
    if (!name || !domain) return res.status(400).json({ error: "name and domain required." });
    const id = genId();
    const hq = resolveHq(domain);
    db.prepare("INSERT INTO competitors (id, name, domain, pricing_url, blog_url, careers_url, industry, hq_lat, hq_lng, hq_city, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, name, domain, pricingUrl ?? null, blogUrl ?? null, careersUrl ?? null, industry ?? null, hq.lat, hq.lng, hq.city, uid);
    setImmediate(() => {
      geocodeCompanyHQ(name, domain).then(coords => {
        db.prepare("UPDATE competitors SET hq_lat=?, hq_lng=?, hq_city=? WHERE id=?").run(coords.lat, coords.lng, coords.city, id);
      }).catch(() => {});
    });
    return res.status(201).json({ status: "success", data: competitorToApi(db.prepare("SELECT * FROM competitors WHERE id = ?").get(id) as CompetitorRow) });
  });

  app.post("/api/competitors/clean-names", requireAuth, async (req, res) => {
    const uid = (req as AuthRequest).userId;
    const comps = db.prepare("SELECT id, name, domain FROM competitors WHERE user_id = ?").all(uid) as { id: string; name: string; domain: string }[];
    const updates: { id: string; old: string; new: string }[] = [];
    for (const comp of comps) {
      if (comp.name.includes(" ")) continue; // already clean
      try {
        const ai = getAI();
        if (ai) {
          const raw = await callAI(
            "You return ONLY a company's proper display name — nothing else. No quotes, no explanation.",
            `What is the proper company display name for the domain "${comp.domain}"? If unsure, format "${comp.name}" as a readable company name by splitting it into words. Return ONLY the name.`
          );
          const cleaned = raw.trim().replace(/^["']+|["']+$/g, "").replace(/\.$/, "").slice(0, 80);
          if (cleaned && cleaned.length > 1 && cleaned !== comp.name) {
            db.prepare("UPDATE competitors SET name = ? WHERE id = ?").run(cleaned, comp.id);
            updates.push({ id: comp.id, old: comp.name, new: cleaned });
          }
        } else {
          // No AI — use domainToName improvement
          const { domainToName } = await import("./lib/geocoding.js");
          const cleaned = domainToName(comp.domain);
          if (cleaned !== comp.name) {
            db.prepare("UPDATE competitors SET name = ? WHERE id = ?").run(cleaned, comp.id);
            updates.push({ id: comp.id, old: comp.name, new: cleaned });
          }
        }
      } catch { /* skip this one */ }
    }
    return res.json({ updated: updates.length, updates });
  });

  app.post("/api/competitors/validate", requireAuth, async (req, res) => {
    const { name } = req.body as { name: string };
    const clean = name?.trim() ?? "";
    if (clean.length < 2) return res.status(400).json({ valid: false, error: "Name too short — enter a full company name." });
    if (/^[^a-zA-Z]/.test(clean)) return res.status(400).json({ valid: false, error: "Company name must start with a letter." });

    try {
      const results = await bdSerp(`${clean} official company website`, 3);
      if (!results.length) return res.json({ valid: false, error: `No results found for "${clean}". Check the spelling.` });
      const domain = extractHost(results[0]?.url ?? "") || `${clean.toLowerCase().replace(/\s+/g, "")}.com`;
      return res.json({ valid: true, name: clean, domain });
    } catch {
      // No Bright Data key — accept the name as-is
      return res.json({ valid: true, name: clean, domain: `${clean.toLowerCase().replace(/\s+/g, "")}.com` });
    }
  });

  app.get("/api/competitors/:id", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM competitors WHERE id = ? AND user_id = ?").get(req.params.id, (req as AuthRequest).userId) as CompetitorRow | undefined;
    return row ? res.json({ status: "success", data: competitorToApi(row) }) : res.status(404).json({ error: "Not found." });
  });

  app.put("/api/competitors/:id", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM competitors WHERE id = ? AND user_id = ?").get(req.params.id, (req as AuthRequest).userId) as CompetitorRow | undefined;
    if (!row) return res.status(404).json({ error: "Not found." });
    const b = req.body as Record<string, string>;
    db.prepare("UPDATE competitors SET name=?, domain=?, pricing_url=?, blog_url=?, careers_url=?, industry=?, monitoring=? WHERE id=?")
      .run(b.name ?? row.name, b.domain ?? row.domain, b.pricingUrl ?? row.pricing_url, b.blogUrl ?? row.blog_url, b.careersUrl ?? row.careers_url, b.industry ?? row.industry, b.monitoringEnabled === "false" ? 0 : 1, row.id);
    return res.json({ status: "success", data: competitorToApi(db.prepare("SELECT * FROM competitors WHERE id = ?").get(row.id) as CompetitorRow) });
  });

  app.delete("/api/competitors/:id", requireAuth, (req, res) => {
    if (!db.prepare("SELECT id FROM competitors WHERE id = ? AND user_id = ?").get(req.params.id, (req as AuthRequest).userId)) return res.status(404).json({ error: "Not found." });
    db.prepare("DELETE FROM competitors WHERE id = ?").run(req.params.id);
    return res.json({ status: "success" });
  });

  app.get("/api/competitors/:id/changes", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM competitors WHERE id = ? AND user_id = ?").get(req.params.id, (req as AuthRequest).userId) as CompetitorRow | undefined;
    if (!row) return res.status(404).json({ error: "Not found." });
    return res.json({ status: "success", data: { competitor: { id: row.id, name: row.name }, changes: (db.prepare("SELECT * FROM competitor_changes WHERE competitor_id = ? ORDER BY detected_at DESC").all(row.id) as ChangeRow[]).map(ch => changeToApi(ch)) } });
  });

  // ── Intelligence Feed ─────────────────────────────────────────────────────

  app.get("/api/intelligence/changes", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const rows = db.prepare("SELECT cc.*, c.name AS competitor_name FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ? ORDER BY cc.detected_at DESC LIMIT 50").all(uid) as (ChangeRow & { competitor_name: string })[];
    return res.json({ status: "success", data: rows.map(r => changeToApi(r)) });
  });

  app.patch("/api/intelligence/changes/:id", requireAuth, (req, res) => {
    const row = db.prepare("SELECT cc.id, cc.acknowledged FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE cc.id = ? AND c.user_id = ?").get(req.params.id, (req as AuthRequest).userId) as { id: string; acknowledged: number } | undefined;
    if (!row) return res.status(404).json({ error: "Not found." });
    const next = row.acknowledged ? 0 : 1;
    db.prepare("UPDATE competitor_changes SET acknowledged = ? WHERE id = ?").run(next, row.id);
    return res.json({ status: "ok", acknowledged: !!next });
  });

  app.delete("/api/intelligence/changes/:id", requireAuth, (req, res) => {
    const row = db.prepare("SELECT cc.id FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE cc.id = ? AND c.user_id = ?").get(req.params.id, (req as AuthRequest).userId) as { id: string } | undefined;
    if (!row) return res.status(404).json({ error: "Not found." });
    db.prepare("DELETE FROM competitor_changes WHERE id = ?").run(row.id);
    return res.json({ status: "ok" });
  });

  app.get("/api/intelligence/stats", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const totalChanges = (db.prepare("SELECT COUNT(*) as n FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ?").get(uid) as { n: number }).n;
    const last7d = (db.prepare("SELECT COUNT(*) as n FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ? AND cc.detected_at > datetime('now','-7 days')").get(uid) as { n: number }).n;
    const prev7d = (db.prepare("SELECT COUNT(*) as n FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ? AND cc.detected_at > datetime('now','-14 days') AND cc.detected_at <= datetime('now','-7 days')").get(uid) as { n: number }).n;
    const highImpact = (db.prepare("SELECT COUNT(*) as n FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ? AND cc.impact_score >= 75").get(uid) as { n: number }).n;
    return res.json({ totalChanges, last7dChanges: last7d, velocityPct: prev7d > 0 ? Math.round(((last7d - prev7d) / prev7d) * 100) : last7d > 0 ? 100 : 0, highImpactCount: highImpact });
  });

  app.get("/api/intelligence/signals", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    return res.json({ status: "success", data: (db.prepare("SELECT * FROM account_signals WHERE user_id = ? ORDER BY intent_score DESC LIMIT 50").all(uid) as SignalRow[]).map(signalToApi) });
  });

  app.get("/api/intelligence/news", requireAuth, async (req, res) => {
    const q     = ((req.query.q as string) || "").trim();
    const limit = Math.min(Number(req.query.limit) || 8, 20);
    if (!q) return res.status(400).json({ error: "q param required" });
    return res.json({ status: "success", data: await bdSerpNews(q, limit), query: q });
  });

  app.get("/api/intelligence/trend", requireAuth, (req, res) => {
    const uid  = (req as AuthRequest).userId;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const rows = db.prepare(`SELECT date(cc.detected_at) AS day, COUNT(*) AS count FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id WHERE c.user_id = ? AND cc.detected_at >= date('now', '-${days} days') GROUP BY date(cc.detected_at) ORDER BY day ASC`).all(uid) as { day: string; count: number }[];
    return res.json({ status: "success", data: rows });
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  app.get("/api/settings", requireAuth, (req, res) => {
    const row = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get((req as AuthRequest).userId) as { impact_threshold: number } | undefined;
    return res.json({ impactThreshold: row?.impact_threshold ?? 75 });
  });

  app.put("/api/settings", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { impactThreshold } = req.body as { impactThreshold: number };
    if (typeof impactThreshold !== "number" || impactThreshold < 0 || impactThreshold > 100) return res.status(400).json({ error: "impactThreshold must be 0–100" });
    db.prepare("INSERT INTO user_settings (user_id, impact_threshold, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET impact_threshold = excluded.impact_threshold, updated_at = excluded.updated_at").run(uid, impactThreshold);
    return res.json({ status: "ok", impactThreshold });
  });

  // ── Alert Subscriptions ───────────────────────────────────────────────────

  app.get("/api/alerts/subscriptions", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    return res.json({ status: "success", data: (db.prepare("SELECT * FROM alert_subscriptions WHERE user_id = ? ORDER BY created_at ASC").all(uid) as SubscriptionRow[]).map(subscriptionToApi) });
  });

  app.post("/api/alerts/subscriptions", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const { alertType, deliveryMethod, deliveryTarget } = req.body as Record<string, string>;
    if (!alertType || !deliveryMethod || !deliveryTarget) return res.status(400).json({ error: "alertType, deliveryMethod, deliveryTarget required." });
    const id = genId();
    db.prepare("INSERT INTO alert_subscriptions (id, alert_type, delivery_method, delivery_target, user_id) VALUES (?, ?, ?, ?, ?)").run(id, alertType, deliveryMethod, deliveryTarget, uid);
    return res.status(201).json({ status: "success", data: subscriptionToApi(db.prepare("SELECT * FROM alert_subscriptions WHERE id = ?").get(id) as SubscriptionRow) });
  });

  app.put("/api/alerts/subscriptions/:id", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const row = db.prepare("SELECT * FROM alert_subscriptions WHERE id = ? AND user_id = ?").get(req.params.id, uid) as SubscriptionRow | undefined;
    if (!row) return res.status(404).json({ error: "Not found." });
    const b = req.body as Record<string, unknown>;
    db.prepare("UPDATE alert_subscriptions SET alert_type=?, delivery_method=?, delivery_target=?, enabled=? WHERE id=?")
      .run(b.alertType ?? row.alert_type, b.deliveryMethod ?? row.delivery_method, b.deliveryTarget ?? row.delivery_target, b.enabled === false || b.enabled === 0 ? 0 : 1, row.id);
    return res.json({ status: "success", data: subscriptionToApi(db.prepare("SELECT * FROM alert_subscriptions WHERE id = ?").get(row.id) as SubscriptionRow) });
  });

  app.delete("/api/alerts/subscriptions/:id", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    if (!db.prepare("SELECT id FROM alert_subscriptions WHERE id = ? AND user_id = ?").get(req.params.id, uid)) return res.status(404).json({ error: "Not found." });
    db.prepare("DELETE FROM alert_subscriptions WHERE id = ?").run(req.params.id);
    return res.json({ status: "success" });
  });

  // ── Force-run background monitor (demo trigger) ──────────────────────────

  app.post("/api/monitor/run-now", requireAuth, async (_req, res) => {
    try {
      await runBackgroundMonitor();
      const log = db.prepare("SELECT ran_at, changes_found FROM monitor_log ORDER BY ran_at DESC LIMIT 1").get() as { ran_at: string; changes_found: number } | undefined;
      return res.json({ status: "ok", changesFound: log?.changes_found ?? 0, ranAt: log?.ran_at });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── Cognee seed from existing DB signals ──────────────────────────────────

  app.post("/api/cognee/seed", requireAuth, async (req, res) => {
    if (!isCogneeReady()) return res.status(503).json({ error: "Cognee not ready." });
    const uid = (req as AuthRequest).userId;
    const changes = db.prepare(`
      SELECT cc.change_type, cc.summary, cc.impact_score, cc.detected_at, c.name as competitor_name
      FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id
      WHERE c.user_id = ? ORDER BY cc.impact_score DESC LIMIT 20
    `).all(uid) as Array<{ change_type: string; summary: string; impact_score: number; detected_at: string; competitor_name: string }>;
    if (changes.length === 0) return res.json({ seeded: 0 });
    const text = changes.map(c =>
      `Competitor: ${c.competitor_name} | Signal: ${c.change_type} | Date: ${c.detected_at} | Impact: ${c.impact_score}/100\n${c.summary}`
    ).join("\n\n---\n\n");
    await cogneeAdd(`RevenueRadar Competitive Intelligence — ${new Date().toISOString().slice(0,10)}\n\n${text}`);
    return res.json({ seeded: changes.length });
  });

  // ── Public feed for TriggerWare (no auth required) ───────────────────────

  app.get("/api/public/signals", (_req, res) => {
    const rows = db.prepare(`
      SELECT cc.id, cc.change_type, cc.summary, cc.impact_score, cc.detected_at,
             c.name as competitor_name
      FROM competitor_changes cc
      JOIN competitors c ON c.id = cc.competitor_id
      WHERE cc.impact_score >= 75
      ORDER BY cc.detected_at DESC
      LIMIT 20
    `).all() as Array<{ id: string; change_type: string; summary: string; impact_score: number; detected_at: string; competitor_name: string }>;
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.json(rows.map(r => ({
      id: r.id,
      competitorName: r.competitor_name,
      changeType: r.change_type,
      summary: r.summary,
      impactScore: r.impact_score,
      detectedAt: r.detected_at,
    })));
  });

  // ── TriggerWare ───────────────────────────────────────────────────────────

  app.get("/api/ngrok-status", (_req, res) => {
    fetch("http://localhost:4040/api/tunnels")
      .then(r => r.json())
      .then((d: { tunnels?: { public_url: string; proto: string }[] }) => {
        const tunnel = (d.tunnels ?? []).find(t => t.proto === "https");
        res.json({ url: tunnel?.public_url ?? null });
      })
      .catch(() => res.json({ url: null }));
  });

  app.post("/api/triggerware/test", requireAuth, async (_req, res) => {
    const ok = await sendTriggerWare({
      event: "test",
      message: "RevenueRadarAI TriggerWare integration is active — automated competitive signals will fire here.",
    });
    return ok
      ? res.json({ status: "success", message: "TriggerWare webhook fired successfully." })
      : res.status(503).json({ error: "TRIGGERWARE_API_KEY not set or request failed. Add it via Settings → Integrations." });
  });

  // ── Cognee memories ───────────────────────────────────────────────────────

  app.get("/api/cognee/memories", requireAuth, async (req, res) => {
    const q = ((req.query.q as string) || "competitor pricing intelligence signals").trim().slice(0, 200);
    if (!isCogneeReady()) return res.json({ ready: false, entries: [] });
    const raw = await cogneeSearch(q);
    const entries = raw
      ? raw.split(/\n\n+/).filter(Boolean).map((text, i) => ({ id: i, text: text.slice(0, 400) }))
      : [];
    return res.json({ ready: true, entries, query: q });
  });

  // ── Runtime API key configuration ─────────────────────────────────────────

  app.post("/api/config/keys", requireAuth, (req, res) => {
    const { AIML_API_KEY, BD_API_KEY, SPEECHMATICS_API_KEY, TRIGGERWARE_API_KEY } =
      req.body as Record<string, string>;
    updateRuntimeConfig({
      AIML_API_KEY:         AIML_API_KEY?.trim()         || undefined,
      BD_API_KEY:           BD_API_KEY?.trim()           || undefined,
      SPEECHMATICS_API_KEY: SPEECHMATICS_API_KEY?.trim() || undefined,
      TRIGGERWARE_API_KEY:  TRIGGERWARE_API_KEY?.trim()  || undefined,
    });
    return res.json({ status: "ok", message: "Runtime config updated — active for this server session." });
  });

  app.get("/api/config/status", requireAuth, async (_req, res) => {
    const { AIML_API_KEY: ak, BD_API_KEY: bk, SPEECHMATICS_API_KEY: sk, TRIGGERWARE_API_KEY: tw } =
      await import("./lib/config.js");
    return res.json({
      hasAiKey:        !!ak,
      hasBrightData:   !!bk,
      hasSpeechmatics: !!sk,
      hasTriggerWare:  !!tw,
      hasCognee:       isCogneeReady(),
      hasSlack:        !!SLACK_WEBHOOK,
    });
  });

  app.post("/api/alerts/test-slack", async (_req, res) => {
    const ok = await sendSlack("🔔 *RevenueRadar Test Alert*\nYour Slack integration is working.");
    return ok ? res.json({ status: "success" }) : res.status(500).json({ error: "Failed to send. Check SLACK_WEBHOOK_URL." });
  });

  // ── Research Pipeline Tasks (server-side processor) ───────────────────────

  app.get("/api/db/tasks", requireAuth, (req, res) => {
    const { status } = req.query as { status?: string };
    const rows = (status ? db.prepare("SELECT * FROM research_tasks WHERE status = ? ORDER BY created_at ASC").all(status) : db.prepare("SELECT * FROM research_tasks ORDER BY created_at ASC").all()) as TaskRow[];
    return res.json(rows.map(taskToApi));
  });

  app.post("/api/db/tasks", requireAuth, (req, res) => {
    const { topic, region, competitors } = req.body as { topic?: string; region?: string; competitors?: string };
    if (!topic?.trim()) return res.status(400).json({ error: "topic required" });
    const info = db.prepare("INSERT INTO research_tasks (topic, region, competitors) VALUES (?, ?, ?)").run(topic.trim(), region ?? null, competitors ?? null);
    return res.status(201).json(taskToApi(db.prepare("SELECT * FROM research_tasks WHERE id = ?").get(info.lastInsertRowid) as TaskRow));
  });

  app.patch("/api/db/tasks/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM research_tasks WHERE id = ?").get(id) as TaskRow | undefined;
    if (!row) return res.status(404).json({ error: "Task not found" });
    const body = req.body as Record<string, unknown>;
    const allowed: (keyof TaskRow)[] = ["status", "retry_count", "start_time", "completed_time", "failure_reason"];
    const sets: string[] = [], vals: unknown[] = [];
    for (const key of allowed) { if (body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(body[key]); } }
    if (sets.length) db.prepare(`UPDATE research_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
    return res.json(taskToApi(db.prepare("SELECT * FROM research_tasks WHERE id = ?").get(id) as TaskRow));
  });

  app.get("/api/db/results", requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return res.json(db.prepare("SELECT * FROM research_results ORDER BY created_at DESC LIMIT ?").all(limit) as ResultRow[]);
  });

  app.post("/api/db/results", requireAuth, (req, res) => {
    const b = req.body as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
    const info = db.prepare("INSERT INTO research_results (task_id, topic, region, verified_trend, pricing_gap, feature_insights, confidence_score, confidence_rationale, opportunity_score, evidence_links, data_summary, status, processed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(b.task_id ?? null, b.topic ?? null, b.region ?? null, b.verified_trend ?? null, str(b.pricing_gap), str(b.feature_insights), b.confidence_score ?? null, b.confidence_rationale ?? null, b.opportunity_score ?? null, str(b.evidence_links), str(b.data_summary), b.status ?? null, b.processed_at ?? new Date().toISOString());
    return res.status(201).json({ id: info.lastInsertRowid, ...b });
  });

  // ── Live Stats ────────────────────────────────────────────────────────────

  app.get("/api/stats", requireAuth, (req, res) => {
    const uid = (req as AuthRequest).userId;
    const competitorCount = (db.prepare("SELECT COUNT(*) as n FROM competitors WHERE user_id = ? AND monitoring = 1").get(uid) as { n: number }).n;
    const changeCount     = (db.prepare("SELECT COUNT(*) as n FROM competitor_changes cc JOIN competitors c ON c.id=cc.competitor_id WHERE c.user_id = ?").get(uid) as { n: number }).n;
    const taskCount       = (db.prepare("SELECT COUNT(*) as n FROM research_tasks").get() as { n: number }).n;
    const completedCount  = (db.prepare("SELECT COUNT(*) as n FROM research_tasks WHERE status = 'Completed'").get() as { n: number }).n;
    return res.json({ competitorCount, changeCount, taskCount, completedCount });
  });

  // ── Live Research SSE ─────────────────────────────────────────────────────

  app.get("/api/research/stream", requireAuth, agentLimiter, async (req, res) => {
    const query = ((req.query.query as string) || "").trim();
    if (!query) { res.status(400).json({ error: "query param required" }); return; }
    const safeQuery = sanitizeInput(query, 500);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (event: StreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const priorMemory = await cogneeSearch(safeQuery);
    if (priorMemory) write({ type: "memory", content: `Prior intelligence from RevenueRadar memory:\n${priorMemory.slice(0, 400)}…` });

    const systemPrompt = RESEARCH_SYSTEM + (priorMemory ? `\n\n## Prior Intelligence (Memory)\n${priorMemory.slice(0, 2000)}\n\nVerify and expand with fresh live data.` : "");

    try {
      let fullReport = "";
      for await (const event of runAgentStream(systemPrompt, safeQuery, 8)) {
        write(event);
        if (event.type === "report") fullReport = event.content;
        if (event.type === "done") break;
      }
      if (fullReport) cogneeAdd(`Topic: ${safeQuery}\nDate: ${new Date().toISOString().slice(0, 10)}\n\n${fullReport.slice(0, 4000)}`).catch(() => {});
    } catch (err) {
      const msg = String(err);
      const retryMatch = msg.match(/retry in ([\d.]+)s/i);
      const retryInfo  = retryMatch ? ` — retry in ${Math.ceil(Number(retryMatch[1]))}s` : "";
      const isQuota    = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
      const userMsg    = isQuota
        ? `AI API rate limit hit${retryInfo}. Check your AIML_API_KEY quota at aimlapi.com or wait for the rate limit window to reset.`
        : `Agent error: ${msg.slice(0, 300)}`;
      write({ type: "error", message: userMsg });
      const changes = db.prepare("SELECT cc.*, c.name as competitor_name FROM competitor_changes cc JOIN competitors c ON c.id=cc.competitor_id ORDER BY cc.impact_score DESC LIMIT 8").all() as Array<{ competitor_name: string; change_type: string; summary: string; impact_score: number }>;
      if (changes.length > 0) {
        write({ type: "report", content: `## Stored Signals (Local DB)\n*Live AI research unavailable — showing cached competitor signals from your database.*\n\n${changes.map(c => `### ${c.competitor_name}\n${c.summary}\n> Impact: ${c.impact_score}/100`).join("\n\n")}` });
      }
      write({ type: "done" });
    }
    res.end();
  });

  // ── Buying Signals ────────────────────────────────────────────────────────

  app.get("/api/buying-signals", requireAuth, agentLimiter, async (req, res) => {
    const company = sanitizeInput((req.query.company as string) || "", 100);
    if (!company) return res.status(400).json({ error: "company param required" });
    try {
      const [seniorJobs, generalJobs] = await Promise.all([
        bdSerp(`site:linkedin.com/jobs "${company}" (VP OR Director OR "Head of" OR CTO OR CMO) 2026`, 8),
        bdSerp(`site:linkedin.com "${company}" hiring jobs`, 8),
      ]);
      type RawJob = { title: string; url: string; snippet: string };
      const allJobs: RawJob[] = [...seniorJobs, ...generalJobs].filter((r, i, arr) => r.url && arr.findIndex(x => x.url === r.url) === i);
      if (!allJobs.length) return res.json({ company, signals: [], overallScore: 0 });

      const ai = getAI();
      let signals: (RawJob & { intentScore: number; signalType: string; reason: string })[] = [];

      if (ai) {
        try {
          const prompt = `Score B2B buying intent for each job posting at "${company}". Return JSON: [{"title":"...","intentScore":85,"signalType":"Executive Hire|Team Expansion|Tech Investment","reason":"one sentence"}]\n\nJobs: ${JSON.stringify(allJobs.slice(0, 10).map(j => ({ title: j.title, snippet: j.snippet })))}`;
          const rawText = await callAI("You are a B2B buying intent scorer.", prompt);
          const scored = tryParseJSON<{ title: string; intentScore: number; signalType: string; reason: string }[]>(rawText) ?? [];
          signals = allJobs.slice(0, 10).map((job, i) => ({ ...job, intentScore: scored[i]?.intentScore ?? 55, signalType: scored[i]?.signalType ?? "Hiring Signal", reason: scored[i]?.reason ?? "" }));
        } catch { signals = allJobs.map(j => ({ ...j, intentScore: 55, signalType: "Hiring Signal", reason: "" })); }
      } else {
        signals = allJobs.map(j => ({ ...j, intentScore: 55, signalType: "Hiring Signal", reason: "" }));
      }
      signals.sort((a, b) => b.intentScore - a.intentScore);
      const overallScore = signals.length ? Math.round(signals.slice(0, 5).reduce((s, x) => s + x.intentScore, 0) / Math.min(signals.length, 5)) : 0;
      return res.json({ company, signals: signals.slice(0, 8), overallScore, source: "brightdata_serp_linkedin" });
    } catch (err) { return res.status(500).json({ error: String(err) }); }
  });

  // ── Reddit Social Sentiment ───────────────────────────────────────────────

  app.get("/api/social/reddit", requireAuth, async (req, res) => {
    const company = sanitizeInput((req.query.company as string) || "", 100);
    if (!company) return res.status(400).json({ error: "company param required" });
    try {
      const mcpResult = await bdMcpCall("web_data_reddit_posts", { keyword: company, limit: 10 }) as { posts?: Record<string, string>[] } | null;
      type RedditPost = { title: string; url: string; snippet: string; sentiment: "positive" | "negative" | "neutral" };
      let posts: RedditPost[] = [];
      if (mcpResult?.posts?.length) {
        posts = mcpResult.posts.map(p => ({ title: p.title || "", url: p.url || p.permalink || "", snippet: p.selftext || "", sentiment: "neutral" as const }));
      } else {
        const serp = await bdSerp(`site:reddit.com "${company}" discussion opinion`, 10);
        posts = serp.map(r => ({ ...r, sentiment: "neutral" as const }));
      }
      const ai = getAI();
      if (ai && posts.length) {
        try {
          const prompt = `Classify sentiment for these Reddit posts about "${company}" as "positive","negative","neutral". Return JSON array: ["positive","negative",...]\n\nPosts: ${JSON.stringify(posts.slice(0, 8).map(p => ({ title: p.title, snippet: p.snippet?.slice(0, 100) })))}`;
          const rawText = await callAI("You are a sentiment classifier.", prompt);
          const sentiments = tryParseJSON<string[]>(rawText) ?? [];
          posts = posts.map((p, i) => ({ ...p, sentiment: (sentiments[i] as RedditPost["sentiment"]) ?? "neutral" }));
        } catch { /* keep neutral */ }
      }
      const pos = posts.filter(p => p.sentiment === "positive").length;
      const neg = posts.filter(p => p.sentiment === "negative").length;
      return res.json({ company, posts: posts.slice(0, 8), overallSentiment: pos > neg ? "positive" : neg > pos ? "negative" : "neutral", positiveCount: pos, negativeCount: neg, source: mcpResult ? "brightdata_mcp" : "brightdata_serp" });
    } catch (err) { return res.status(500).json({ error: String(err) }); }
  });

  // ── Pricing Scan ──────────────────────────────────────────────────────────

  app.post("/api/pricing-scan", requireAuth, agentLimiter, async (req, res) => {
    const { url, competitorName } = req.body as { url?: string; competitorName?: string };
    if (!url) return res.status(400).json({ error: "url required" });
    const name = competitorName || url.replace(/https?:\/\/(www\.)?/, "").split("/")[0];

    let html = "";
    let source = "direct";

    try {
      const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" }, signal: AbortSignal.timeout(10_000) });
      if (resp.ok) html = await resp.text();
    } catch { /* try BD */ }

    if (html.length < 500 && BD_API_KEY) {
      const resp = await fetch("https://api.brightdata.com/request", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` }, body: JSON.stringify({ zone: BD_UNLOCKER_ZONE, url, format: "raw" }), signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (resp?.ok) { html = await resp.text(); source = "web_unlocker"; }
    }

    if (html.length < 500 && BD_API_KEY && BD_BROWSER_ZONE) {
      const resp = await fetch("https://api.brightdata.com/request", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` }, body: JSON.stringify({ zone: BD_BROWSER_ZONE, url, format: "raw" }), signal: AbortSignal.timeout(45_000) }).catch(() => null);
      if (resp?.ok) { html = await resp.text(); source = "scraping_browser"; }
    }

    if (!html || html.length < 200) return res.status(422).json({ error: `Could not fetch pricing page for ${name}.`, url });

    const $ = cheerio.load(html);
    $("script,style,noscript,nav,footer,header").remove();
    const pageText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);
    let tiers = extractPricing(html);

    if (!tiers.length) {
      const TIER_NAMES = /\b(free|basic|starter|standard|plus|pro|growth|business|team|professional|scale|enterprise|premium)\b/gi;
      const PRICES = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\/?(?:mo|month|yr|year|user|seat))?/gi;
      const foundNames = [...pageText.matchAll(TIER_NAMES)].map(m => m[0]);
      const foundPrices = [...pageText.matchAll(PRICES)].map(m => `$${m[1]}`);
      if (foundPrices.length) {
        const uniqueNames = [...new Set(foundNames.map(n => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()))];
        tiers = foundPrices.slice(0, 4).map((price, i) => ({ name: uniqueNames[i] ?? `Tier ${i + 1}`, price, features: [] }));
      }
    }

    let pricingIntel: { tiers: unknown[]; changes: string[]; summary: string } = { tiers, changes: [], summary: `${name} pricing page scanned via ${source}. Found ${tiers.length} tier${tiers.length !== 1 ? "s" : ""}.` };
    const ai = getAI();
    if (ai && pageText.length > 100) {
      try {
        const rawText = await callAI("You are a pricing intelligence extractor.", `Extract pricing intelligence for ${name}. Return JSON only: {"tiers":[{"name":"...","price":"...","billing":"monthly|annual","features":["..."]}],"changes":["..."],"summary":"..."}\n\nContent: ${pageText}`);
        const parsed = tryParseJSON<{ tiers: unknown[]; changes: string[]; summary: string }>(rawText);
        if (parsed?.tiers?.length) pricingIntel = parsed;
      } catch { /* quota */ }
    }

    let changed = false;
    if (competitorName) {
      const comp = db.prepare("SELECT id FROM competitors WHERE name LIKE ?").get(`%${competitorName}%`) as { id: string } | undefined;
      if (comp) {
        const checksum = sha256(JSON.stringify(pricingIntel.tiers));
        const prev = db.prepare("SELECT checksum FROM competitor_snapshots WHERE competitor_id=? ORDER BY captured_at DESC LIMIT 1").get(comp.id) as { checksum: string } | undefined;
        // Only flag as changed if we actually found real prices (not N/A or empty)
        const hasRealPrices = pricingIntel.tiers.some((t: { price?: string }) => t.price && t.price !== "N/A" && t.price !== "—" && t.price.trim() !== "");
        changed = hasRealPrices && prev ? prev.checksum !== checksum : false;
        db.prepare("INSERT INTO competitor_snapshots (id,competitor_id,type,url,structured_data,checksum,captured_at) VALUES(?,?,?,?,?,?,?)").run(genId(), comp.id, "pricing", url, JSON.stringify(pricingIntel), checksum, new Date().toISOString());
      }
    }
    return res.json({ ...pricingIntel, changed, source, url });
  });

  // ── Debug ─────────────────────────────────────────────────────────────────

  app.get("/api/debug/brightdata", requireAuth, async (_req, res) => {
    if (!BD_API_KEY) return res.json({ error: "BRIGHTDATA_API_KEY not set", zone: BD_SERP_ZONE });
    try {
      const resp = await fetch("https://api.brightdata.com/request", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` }, body: JSON.stringify({ zone: BD_SERP_ZONE, url: "https://www.google.com/search?q=test&num=3", format: "json" }) });
      return res.json({ status: resp.status, ok: resp.ok, zone: BD_SERP_ZONE, rawBody: (await resp.text()).slice(0, 500) });
    } catch (e) { return res.json({ error: String(e) }); }
  });

  // ── Vite / Static ─────────────────────────────────────────────────────────

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(__dirname, "dist");
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.listen(PORT, "::", () => {
    console.log(`\n🚀  RevenueRadar  →  http://localhost:${PORT}`);
    console.log(`    AIML API (${AIML_MODEL}):        ${process.env.AIML_API_KEY ? "✓" : "✗ AIML_API_KEY missing"}`);
    console.log(`    Bright Data SERP:          ${BD_API_KEY ? "✓" : "✗ BRIGHTDATA_API_KEY missing"}`);
    console.log(`    Bright Data Web Unlocker:  ${BD_API_KEY ? "✓" : "✗"}`);
    console.log(`    Bright Data Scraping Browser: ${BD_BROWSER_ZONE ? "✓" : "✗ BRIGHTDATA_BROWSER_ZONE missing"}`);
    console.log(`    Bright Data MCP:           ${BD_MCP_URL ? "✓" : "✗ BRIGHTDATA_MCP_URL missing"}`);
    console.log(`    Slack Alerts:              ${SLACK_WEBHOOK ? "✓" : "✗ SLACK_WEBHOOK_URL missing"}`);
    console.log(`    Agent tools loaded: ${TOOL_DECLARATIONS.length}\n`);

    // HQ geocoding backfill
    setImmediate(async () => {
      try {
        const all = db.prepare("SELECT id, name, domain, hq_lat, hq_lng FROM competitors").all() as Array<{ id: string; name: string; domain: string; hq_lat: number | null; hq_lng: number | null }>;
        const upd = db.prepare("UPDATE competitors SET hq_lat=?, hq_lng=?, hq_city=?, name=? WHERE id=?");
        let count = 0;
        for (const c of all) {
          const parentDomain = c.domain.split(".").length > 2 ? c.domain.split(".").slice(-2).join(".") : c.domain;
          const dictHq = HQ_COORDS[c.domain] ?? HQ_COORDS[parentDomain] ?? null;
          const isSF = Math.abs((c.hq_lat ?? 0) - 37.7749) < 0.0001 && Math.abs((c.hq_lng ?? 0) + 122.4194) < 0.0001;
          const hasDefaultSF = c.hq_lat == null || isSF;
          const needsApiGeocode = !dictHq && hasDefaultSF;
          const needsDictUpdate = !!dictHq && hasDefaultSF;
          const cleanName = c.name.trim().split(/\s+/).length > 4 ? domainToName(c.domain) : c.name;
          if (!needsApiGeocode && !needsDictUpdate && cleanName === c.name) continue;
          const hq = dictHq ?? (needsApiGeocode ? await geocodeCompanyHQ(cleanName, c.domain) : resolveHq(c.domain));
          upd.run(hq.lat, hq.lng, hq.city, cleanName, c.id);
          count++;
          if (needsApiGeocode) await new Promise(r => setTimeout(r, 250));
        }
        if (count > 0) console.log(`[Startup] Geocoded/fixed ${count} competitor HQ locations`);
      } catch (e) { console.error("[Startup] Geocode backfill failed:", e); }
    });

    setInterval(() => {
      db.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now')").run();
    }, 60 * 60 * 1000);

    startCogneeServer();

    // Seed Cognee with existing signals once it comes up (30-second wait)
    setTimeout(async () => {
      if (!isCogneeReady()) return;
      try {
        const changes = db.prepare(`
          SELECT cc.change_type, cc.summary, cc.impact_score, cc.detected_at, c.name as competitor_name
          FROM competitor_changes cc JOIN competitors c ON c.id = cc.competitor_id
          ORDER BY cc.impact_score DESC LIMIT 30
        `).all() as Array<{ change_type: string; summary: string; impact_score: number; detected_at: string; competitor_name: string }>;
        if (changes.length > 0) {
          const text = changes.map(c =>
            `Competitor: ${c.competitor_name} | Signal: ${c.change_type} | Date: ${c.detected_at} | Impact: ${c.impact_score}/100\n${c.summary}`
          ).join("\n\n---\n\n");
          await cogneeAdd(`RevenueRadar Competitive Intelligence Seed — ${new Date().toISOString().slice(0,10)}\n\n${text}`);
          console.log(`[Cognee] Seeded ${changes.length} competitive signals into memory graph.`);
        }
      } catch (e) { console.warn("[Cognee] Seed failed:", e); }
    }, 30_000);

    // Resume any audio analysis jobs that were in-flight before a restart
    setImmediate(() => {
      const stuckJobs = db.prepare("SELECT id, status FROM audio_jobs WHERE status IN ('transcribing','analyzing') AND created_at > datetime('now','-2 hours')").all() as { id: string; status: string }[];
      for (const row of stuckJobs) {
        console.log(`[Audio] Resuming in-flight job ${row.id} (${row.status})`);
        startAudioPipeline(row.id);
      }
    });

    runBackgroundMonitor().catch(e => console.error("[Monitor]", e));
    setInterval(() => runBackgroundMonitor().catch(() => {}), 5 * 60 * 1000);

    const processPending = () => {
      const pending = db.prepare("SELECT id FROM research_tasks WHERE status = 'Pending' ORDER BY created_at ASC LIMIT 1").get() as { id: number } | undefined;
      if (pending) processResearchTask(pending.id).catch(() => {});
    };
    processPending();
    setInterval(processPending, 2 * 60 * 1000);
  });
}

startServer();
