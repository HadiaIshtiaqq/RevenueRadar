import OpenAI from "openai";
import * as cheerio from "cheerio";
import db, { type CompetitorRow, type ChangeRow, competitorToApi, changeToApi } from "../db.js";
import { AIML_API_KEY, AIML_MODEL, AIML_BASE_URL } from "./config.js";
import {
  bdSerp, bdUnlock, bdScrapeMarkdown, bdScrapeBrowser,
  bdSerpNews, bdSerpJobs, bdDiscover,
  bdMcpSearch, bdMcpCall, extractPricing, sendSlack,
} from "./brightdata.js";
import { tryParseJSON, genId } from "./utils.js";

// ─── AI client (AIML API — OpenAI-compatible) ─────────────────────────────────

export function getAI(): OpenAI | null {
  if (!AIML_API_KEY) return null;
  return new OpenAI({ apiKey: AIML_API_KEY, baseURL: AIML_BASE_URL });
}

// ─── Simple one-shot completion (no tools) ────────────────────────────────────

export async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const ai = getAI();
  if (!ai) throw new Error("AIML_API_KEY not configured.");
  const completion = await aiWithRetry(() =>
    ai.chat.completions.create({
      model: AIML_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt   },
      ],
    })
  );
  return completion.choices[0]?.message?.content ?? "";
}

// ─── Stream event types ───────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "thinking";    content: string }
  | { type: "memory";      content: string }
  | { type: "search";      query: string }
  | { type: "scrape";      url: string }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "report";      content: string }
  | { type: "error";       message: string }
  | { type: "done" };

// ─── Tool declarations (OpenAI function-calling format) ───────────────────────

export const TOOL_DECLARATIONS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web using Bright Data SERP API. Returns recent news, job postings, funding announcements, and competitor mentions with titles, URLs, and snippets.",
      parameters: { type: "object", properties: { query: { type: "string" }, num_results: { type: "integer" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_webpage",
      description: "Fetch any URL using Bright Data Web Unlocker (bypasses bot protection). Use extract_type='pricing' for pricing pages.",
      parameters: { type: "object", properties: { url: { type: "string" }, extract_type: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_competitor",
      description: "Retrieve a stored competitor profile with domain, URLs, and recent changes.",
      parameters: { type: "object", properties: { competitor_id: { type: "string" } }, required: ["competitor_id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_competitors",
      description: "List all monitored competitors with IDs, names, and domains.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "score_buying_intent",
      description: "AI-powered B2B buying intent scoring (0-100) based on a job posting. Returns tier, signals, and recommended outreach actions.",
      parameters: {
        type: "object",
        properties: {
          company_name:    { type: "string" },
          job_title:       { type: "string" },
          job_description: { type: "string" },
          company_context: { type: "string" },
        },
        required: ["company_name", "job_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_competitor_change",
      description: "Persist a detected competitor change (pricing, messaging, hiring, product) to the intelligence store.",
      parameters: {
        type: "object",
        properties: {
          competitor_id: { type: "string" },
          change_type:   { type: "string" },
          summary:       { type: "string" },
          impact_score:  { type: "integer" },
          details:       { type: "string" },
        },
        required: ["competitor_id", "change_type", "summary", "impact_score"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_slack_alert",
      description: "Send a Slack alert for high-impact signals (impact_score >= 70).",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web_mcp",
      description: "Search via Bright Data MCP Server for additional coverage.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_news",
      description: "Search Google News via Bright Data for the latest articles on a company or topic.",
      parameters: { type: "object", properties: { query: { type: "string" }, num_results: { type: "integer" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_jobs",
      description: "Search LinkedIn and job boards via Bright Data for open positions. Combine with score_buying_intent for full signal analysis.",
      parameters: { type: "object", properties: { query: { type: "string" }, num_results: { type: "integer" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_as_markdown",
      description: "Fetch any URL via Bright Data and return clean Markdown. Best for blog posts, articles, product pages.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "scrape_js_page",
      description: "Render a JavaScript-heavy page using Bright Data Scraping Browser. For SPAs, LinkedIn profiles, dashboards.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_linkedin_company",
      description: "Get structured LinkedIn company profile via Bright Data MCP. Returns employee count, industry, specialties, recent posts.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_crunchbase_company",
      description: "Get structured Crunchbase company data via Bright Data MCP. Returns funding rounds, total raised, investors.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_web",
      description: "AI-ranked Bright Data web discovery. Better than standard SERP for research depth.",
      parameters: { type: "object", properties: { query: { type: "string" }, num_results: { type: "integer" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_linkedin_person",
      description: "Get a LinkedIn person profile via Bright Data MCP. Returns title, company, experience, education.",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "monitor_social",
      description: "Monitor Reddit/X for company mentions via Bright Data MCP. Returns posts, sentiment, engagement.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, platform: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function aiWithRetry<T>(
  callFn: () => Promise<T>,
  onRetry?: (attempt: number) => void,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callFn();
    } catch (e: unknown) {
      lastErr = e;
      const msg = String(e);
      const isRateLimit = msg.includes("429") || msg.includes("rate_limit") || msg.includes("Rate limit");
      const isTransient = msg.includes("503") || msg.includes("500") || msg.includes("UNAVAILABLE");
      if ((isRateLimit || isTransient) && attempt < 2) {
        onRetry?.(attempt + 1);
        await new Promise(r => setTimeout(r, isRateLimit ? 8000 : 2000));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {

    case "search_web": {
      const results = await bdSerp(args.query as string, (args.num_results as number) || 5);
      return { results, count: results.length };
    }

    case "fetch_webpage": {
      const url  = args.url as string;
      const type = (args.extract_type as string) || "text";
      if (type === "pricing") {
        const html = await bdUnlock(url);
        if (!html) return { error: "Failed to fetch URL", url };
        return { url, pricing_tiers: extractPricing(html), tier_count: extractPricing(html).length };
      }
      const md = await bdScrapeMarkdown(url);
      if (md) return { url, content: md.slice(0, 6000), format: "markdown" };
      const html = await bdUnlock(url);
      if (!html) return { error: "Failed to fetch URL", url };
      const $ = cheerio.load(html);
      $("script,style,nav,footer").remove();
      return { url, content: $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000), format: "text" };
    }

    case "get_competitor": {
      const c = db.prepare("SELECT * FROM competitors WHERE id = ?").get(args.competitor_id as string) as CompetitorRow | undefined;
      if (!c) return { error: "Competitor not found" };
      const changes = (db.prepare("SELECT * FROM competitor_changes WHERE competitor_id = ? ORDER BY detected_at DESC LIMIT 5").all(c.id) as ChangeRow[]).map(ch => changeToApi(ch));
      return { competitor: competitorToApi(c), recent_changes: changes };
    }

    case "list_competitors": {
      const list = (db.prepare("SELECT * FROM competitors ORDER BY created_at ASC").all() as CompetitorRow[])
        .map(c => ({ id: c.id, name: c.name, domain: c.domain, monitoringEnabled: !!c.monitoring }));
      return { competitors: list, count: list.length };
    }

    case "score_buying_intent": {
      try {
        const prompt = `You are a B2B sales intelligence engine. Score this buying intent signal.

Company: ${args.company_name}
Job Title: ${args.job_title}
Job Description: ${String(args.job_description || "").slice(0, 600)}
Company Context: ${String(args.company_context || "none provided")}

Score 0–100 for B2B software buying intent (100 = purchase decision imminent).
Return JSON only: {"intent_score":82,"tier":"HIGH","buying_signals":["..."],"recommended_actions":["..."]}`;
        const raw = await callAI("You are a B2B sales intelligence engine.", prompt);
        const parsed = tryParseJSON<{ intent_score: number; tier: string; buying_signals: string[]; recommended_actions: string[] }>(raw);
        if (parsed?.intent_score) return parsed;
      } catch { /* fall through to heuristic */ }

      // Heuristic fallback
      const title = (args.job_title as string).toLowerCase();
      const desc  = (args.job_description as string || "").toLowerCase();
      const ctx   = (args.company_context as string || "").toLowerCase();
      let score = 0;
      if (/\b(cto|ciso|cpo|cmo|cfo|ceo|chief)\b/.test(title))      score += 40;
      else if (/\bsvp\b|\bevp\b/.test(title))                        score += 38;
      else if (/\bvp\b|vice president/.test(title))                  score += 35;
      else if (/\bdirector\b/.test(title))                           score += 28;
      else if (/\bhead of\b/.test(title))                            score += 25;
      else if (/\bmanager\b/.test(title))                            score += 15;
      else                                                            score += 8;
      if (/\bbudget\b|\bprocurement\b|\bvendor selection\b/.test(desc)) score += 15;
      if (/\bpurchase\b|\blicense\b|\bcontract\b/.test(desc))           score += 10;
      if (/\bstrategy\b|\broadmap\b/.test(desc))                        score += 5;
      score = Math.min(score, 65);
      if (/\bq[1-4]\b|\burgent\b|\basap\b|\bimmediately\b/.test(desc)) score += 10;
      if (/\bthis quarter\b|\bthis year\b/.test(desc))                  score += 8;
      score = Math.min(score, 80);
      if (/series [b-h]|raised \$\d|funding round/.test(ctx))  score += 15;
      else if (/series a/.test(ctx))                            score += 10;
      if (/growth|scaling|expansion/.test(ctx))                 score += 5;
      score = Math.min(score, 100);
      const tier = score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";
      return {
        intent_score: score, tier,
        buying_signals: [
          score >= 35 ? "Senior title signals budget ownership" : null,
          desc.includes("budget") ? "Budget authority mentioned in job description" : null,
          ctx.includes("series") ? "Recent funding indicates active expansion budget" : null,
        ].filter(Boolean),
        recommended_actions: [
          `Contact ${args.company_name} within 48h — hire signals active budget allocation`,
          `Reference the ${args.job_title} role in outreach to show research`,
          tier === "HIGH" ? "Escalate to enterprise AE for executive outreach" : "Assign to SDR for discovery call",
        ],
      };
    }

    case "save_competitor_change": {
      const compId = args.competitor_id as string;
      if (!db.prepare("SELECT id FROM competitors WHERE id = ?").get(compId)) return { error: "Competitor not found" };
      let details: Record<string, unknown> = {};
      try { details = JSON.parse(args.details as string || "{}"); } catch { /* */ }
      const changeId = genId();
      db.prepare("INSERT INTO competitor_changes (id, competitor_id, change_type, summary, impact_score, details, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(changeId, compId, args.change_type, args.summary, args.impact_score, JSON.stringify(details), new Date().toISOString());
      return { saved: true, change_id: changeId };
    }

    case "send_slack_alert": {
      const sent = await sendSlack(args.message as string);
      return { sent };
    }

    case "search_web_mcp": {
      const mcpRes = await bdMcpSearch(args.query as string);
      if (mcpRes.length) return { results: mcpRes, count: mcpRes.length, source: "brightdata_mcp" };
      const fallback = await bdSerp(args.query as string, 5);
      return { results: fallback, count: fallback.length, source: "serp_fallback" };
    }

    case "search_news": {
      const results = await bdSerpNews(args.query as string, (args.num_results as number) || 5);
      return { results, count: results.length };
    }

    case "search_jobs": {
      const results = await bdSerpJobs(args.query as string, (args.num_results as number) || 6);
      return { results, count: results.length };
    }

    case "scrape_as_markdown": {
      const md = await bdScrapeMarkdown(args.url as string);
      if (!md) return { error: "Failed to fetch URL", url: args.url };
      return { url: args.url, content: md.slice(0, 6000), format: "markdown" };
    }

    case "scrape_js_page": {
      const html = await bdScrapeBrowser(args.url as string);
      if (!html) return { error: "Failed to render page", url: args.url };
      const $ = cheerio.load(html);
      $("script,style,nav,footer").remove();
      return { url: args.url, content: $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000) };
    }

    case "get_linkedin_company": {
      const mcpResult = await bdMcpCall("web_data_linkedin_company_profile", { url: args.url as string });
      if (mcpResult) return { source: "brightdata_dataset", data: mcpResult };
      const md = await bdScrapeMarkdown(args.url as string);
      return { source: "web_unlocker_markdown", content: md.slice(0, 4000) };
    }

    case "get_crunchbase_company": {
      const mcpResult = await bdMcpCall("web_data_crunchbase_company", { url: args.url as string });
      if (mcpResult) return { source: "brightdata_dataset", data: mcpResult };
      const md = await bdScrapeMarkdown(args.url as string);
      return { source: "web_unlocker_markdown", content: md.slice(0, 4000) };
    }

    case "discover_web": {
      const results = await bdDiscover(args.query as string, (args.num_results as number) || 5);
      return { results, count: results.length, source: "brightdata_discover" };
    }

    case "get_linkedin_person": {
      const mcpResult = await bdMcpCall("web_data_linkedin_person_profile", { url: args.url as string });
      if (mcpResult) return { source: "brightdata_dataset", data: mcpResult };
      const html = await bdScrapeBrowser(args.url as string);
      const $ = cheerio.load(html);
      $("script,style,nav,footer").remove();
      return { source: "scraping_browser", content: $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000) };
    }

    case "monitor_social": {
      const platform = ((args.platform as string) || "reddit").toLowerCase();
      const mcpResult = await bdMcpCall(platform === "x" ? "web_data_x_posts" : "web_data_reddit_posts", { query: args.query as string, count: 10 });
      if (mcpResult) return { source: "brightdata_dataset", platform, data: mcpResult };
      const serpQuery = platform === "x"
        ? `site:x.com "${args.query as string}" -filter:retweets`
        : `site:reddit.com "${args.query as string}"`;
      const results = await bdSerp(serpQuery, 8);
      return { source: "serp_fallback", platform, results, count: results.length };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Tool result summarizer ───────────────────────────────────────────────────

export function summarizeToolResult(name: string, result: unknown): string {
  if (!result || typeof result !== "object") return String(result).slice(0, 200);
  const r = result as Record<string, unknown>;
  if (name === "search_web" || name === "search_web_mcp") return `Found ${(r.results as unknown[])?.length ?? 0} results`;
  if (name === "search_news")   return `Found ${(r.results as unknown[])?.length ?? 0} news articles`;
  if (name === "search_jobs")   return `Found ${(r.results as unknown[])?.length ?? 0} job listings`;
  if (name === "fetch_webpage") {
    const tiers = (r.pricing_tiers as unknown[])?.length;
    return tiers != null ? `Extracted ${tiers} pricing tiers` : `Fetched ${((r.content as string) ?? "").length} chars`;
  }
  if (name === "score_buying_intent") return `Intent score: ${r.intent_score} (${r.tier})`;
  if (name === "save_competitor_change") return (r.saved as boolean) ? "Change saved" : "Save failed";
  if (name === "send_slack_alert")     return (r.sent as boolean) ? "Alert sent" : "Slack not configured";
  if (name === "scrape_as_markdown")   return `Scraped ${((r.content as string) ?? "").length} chars as markdown`;
  if (name === "scrape_js_page")       return `Rendered ${((r.content as string) ?? "").length} chars`;
  if (name === "get_linkedin_company") return r.source === "brightdata_dataset" ? "LinkedIn structured data retrieved" : `LinkedIn page: ${((r.content as string) ?? "").length} chars`;
  if (name === "get_crunchbase_company") return r.source === "brightdata_dataset" ? "Crunchbase data retrieved" : `Crunchbase: ${((r.content as string) ?? "").length} chars`;
  if (name === "discover_web")         return `Discover: ${(r.results as unknown[])?.length ?? 0} AI-ranked results`;
  if (name === "get_linkedin_person")  return r.source === "brightdata_dataset" ? "LinkedIn person profile retrieved" : `Profile: ${((r.content as string) ?? "").length} chars`;
  if (name === "monitor_social")       return `Social: ${r.source === "brightdata_dataset" ? "dataset retrieved" : `${(r.results as unknown[])?.length ?? 0} posts`}`;
  return JSON.stringify(result).slice(0, 120);
}

// ─── Non-streaming agent ──────────────────────────────────────────────────────

interface AgentOptions {
  systemInstruction: string;
  userMessage: string;
  maxTurns?: number;
  jsonOutput?: boolean;
}

export async function runAgent(opts: AgentOptions): Promise<string> {
  const ai = getAI();
  if (!ai) throw new Error("AIML_API_KEY not configured.");
  const { systemInstruction, userMessage, maxTurns = 10 } = opts;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemInstruction },
    { role: "user",   content: userMessage },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const completion = await aiWithRetry(() =>
      ai.chat.completions.create({ model: AIML_MODEL, messages, tools: TOOL_DECLARATIONS })
    );

    const choice  = completion.choices[0];
    const message = choice.message;

    if (!message.tool_calls?.length) {
      return message.content ?? "";
    }

    messages.push(message as OpenAI.Chat.ChatCompletionMessageParam);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const name = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* */ }
      const result = await executeTool(name, args);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    if (choice.finish_reason === "stop") break;
  }

  return "Agent reached maximum turns.";
}

// ─── Streaming agent ──────────────────────────────────────────────────────────

export async function* runAgentStream(
  systemInstruction: string,
  userMessage: string,
  maxTurns = 8,
): AsyncGenerator<StreamEvent> {
  const ai = getAI();
  if (!ai) {
    yield { type: "error", message: "AIML_API_KEY not configured — add it to .env." };
    yield { type: "done" };
    return;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemInstruction },
    { role: "user",   content: userMessage },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    let completion: OpenAI.Chat.ChatCompletion;
    try {
      completion = await aiWithRetry(
        () => ai.chat.completions.create({ model: AIML_MODEL, messages, tools: TOOL_DECLARATIONS }),
        (attempt) => { /* retrying silently */ void attempt; },
      );
    } catch (e) {
      throw e;
    }

    const choice  = completion.choices[0];
    const message = choice.message;

    if (message.content && !message.tool_calls?.length) {
      yield { type: "report", content: message.content };
      break;
    }

    if (message.content) yield { type: "thinking", content: message.content };

    if (!message.tool_calls?.length) break;

    messages.push(message as OpenAI.Chat.ChatCompletionMessageParam);

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;
      const name = toolCall.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(toolCall.function.arguments); } catch { /* */ }

      if (["search_web", "search_web_mcp", "search_news", "search_jobs"].includes(name)) {
        yield { type: "search", query: args.query as string };
      } else if (["fetch_webpage", "scrape_as_markdown", "scrape_js_page"].includes(name)) {
        yield { type: "scrape", url: args.url as string };
      }

      const result = await executeTool(name, args);
      yield { type: "tool_result", name, summary: summarizeToolResult(name, result) };
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    if (choice.finish_reason === "stop") break;
  }

  yield { type: "done" };
}
