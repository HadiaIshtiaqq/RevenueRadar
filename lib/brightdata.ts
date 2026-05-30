import * as cheerio from "cheerio";
import { BD_API_KEY, BD_SERP_ZONE, BD_UNLOCKER_ZONE, BD_BROWSER_ZONE, BD_MCP_URL, SLACK_WEBHOOK, SERPAPI_KEY, TRIGGERWARE_API_KEY } from "./config.js";
import { serpCache, scrapeCache, type SerpResult } from "./cache.js";

// ─── HTML SERP parser ─────────────────────────────────────────────────────────

function parseGoogleSerpHtml(html: string): SerpResult[] {
  const $ = cheerio.load(html);
  const results: SerpResult[] = [];
  $("h3").each((_i, el) => {
    const h3     = $(el);
    const anchor = h3.closest("a[href]");
    if (!anchor.length) return;
    let href = anchor.attr("href") || "";
    if (href.startsWith("/url?q=")) href = new URL(href, "https://www.google.com").searchParams.get("q") || href;
    if (!href.startsWith("http")) return;
    const title  = h3.text().trim();
    const block  = h3.closest("div[data-hveid], div.g, div[jscontroller]");
    const snippet = block.find(".VwiC3b, [data-sncf='1'], .s, .st").first().text().trim()
      || block.text().replace(title, "").trim().slice(0, 250);
    if (title && href) results.push({ title, url: href, snippet });
  });
  return results;
}

// ─── SerpAPI fallback ─────────────────────────────────────────────────────────

export async function serpApiSearch(query: string, num: number): Promise<SerpResult[]> {
  if (!SERPAPI_KEY) return [];
  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=${num}&hl=en&gl=us`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as { organic_results?: { title: string; link: string; snippet?: string }[] };
    return (data.organic_results ?? []).slice(0, num).map(r => ({
      title: r.title, url: r.link, snippet: r.snippet ?? "",
    }));
  } catch { return []; }
}

// ─── Bright Data SERP ─────────────────────────────────────────────────────────

export async function bdSerp(query: string, num = 10): Promise<SerpResult[]> {
  const cacheKey = `serp:${query}:${num}`;
  const cached = serpCache.get(cacheKey);
  if (cached) return cached;

  if (!BD_API_KEY) return serpApiSearch(query, num);

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us`;
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_SERP_ZONE, url: searchUrl, format: "json" }),
    });

    if (!resp.ok) {
      console.error(`[BD SERP] HTTP ${resp.status} — zone=${BD_SERP_ZONE}`);
      return serpApiSearch(query, num);
    }

    const rawText = await resp.text();
    type OrgR = { title: string; link?: string; url?: string; description?: string; snippet?: string };
    type Body = { organic?: OrgR[]; results?: OrgR[] };
    let data: Body & { body?: string | Body; status_code?: number };
    try { data = JSON.parse(rawText); } catch { return serpApiSearch(query, num); }

    let organic: OrgR[] = data.organic ?? data.results ?? [];
    if (!organic.length && data.body && typeof data.body === "object") {
      organic = (data.body as Body).organic ?? (data.body as Body).results ?? [];
    }
    if (!organic.length && data.body && typeof data.body === "string") {
      try { organic = (JSON.parse(data.body) as Body).organic ?? []; } catch { /* */ }
      if (!organic.length) organic = parseGoogleSerpHtml(data.body);
    }

    if (organic.length) {
      const results = organic.slice(0, num).map(r => ({
        title: r.title || "", url: r.link || r.url || "", snippet: r.description || r.snippet || "",
      }));
      serpCache.set(cacheKey, results);
      return results;
    }

    return serpApiSearch(query, num);
  } catch (e) { console.error("[BD SERP] error:", e); return serpApiSearch(query, num); }
}

// ─── Bright Data News SERP ────────────────────────────────────────────────────

export async function bdSerpNews(query: string, num = 6): Promise<{ title: string; url: string; snippet: string; date?: string; source?: string }[]> {
  if (!BD_API_KEY) return (await serpApiSearch(`${query} news`, num)).map(r => ({ ...r }));

  const cacheKey = `news:${query}:${num}`;
  const cached = serpCache.get(cacheKey) as unknown as { title: string; url: string; snippet: string; date?: string; source?: string }[] | undefined;
  if (cached) return cached;

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=nws&num=${num}&hl=en&gl=us`;
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_SERP_ZONE, url: searchUrl, format: "json" }),
    });
    if (!resp.ok) return (await serpApiSearch(`${query} news`, num)).map(r => ({ ...r }));

    type NewsItem = { title: string; link: string; description?: string; snippet?: string; date?: string; published_at?: string; source?: string; displayed_link?: string };
    const data = await resp.json() as { news?: NewsItem[]; organic?: NewsItem[]; body?: string | { news?: NewsItem[]; organic?: NewsItem[] } };
    let items: NewsItem[] = data.news ?? data.organic ?? [];
    if (!items.length && data.body) {
      try { const b = typeof data.body === "string" ? JSON.parse(data.body) : data.body; items = b.news ?? b.organic ?? []; } catch { /* */ }
    }
    if (!items.length) return (await serpApiSearch(`${query} news`, num)).map(r => ({ ...r }));

    return items.slice(0, num).map(r => ({
      title: r.title, url: r.link,
      snippet: r.description || r.snippet || "",
      date: r.date || r.published_at,
      source: r.source || r.displayed_link?.split(".")?.[0],
    }));
  } catch { return (await serpApiSearch(`${query} news`, num)).map(r => ({ ...r })); }
}

// ─── Bright Data Jobs SERP ────────────────────────────────────────────────────

export async function bdSerpJobs(query: string, num = 8): Promise<{ title: string; company?: string; url: string; snippet: string; location?: string }[]> {
  if (!BD_API_KEY) return (await serpApiSearch(`${query} jobs`, num)).map(r => ({ ...r }));

  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&hl=en&gl=us`;
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_SERP_ZONE, url: searchUrl, format: "json" }),
    });
    if (!resp.ok) return (await serpApiSearch(`${query} jobs`, num)).map(r => ({ ...r }));

    type JobItem = { title: string; company?: string; link?: string; url?: string; description?: string; snippet?: string; location?: string };
    const data = await resp.json() as { jobs?: JobItem[]; organic?: JobItem[]; body?: string | { jobs?: JobItem[]; organic?: JobItem[] } };
    let items: JobItem[] = data.jobs ?? data.organic ?? [];
    if (!items.length && data.body) {
      try { const b = typeof data.body === "string" ? JSON.parse(data.body) : data.body; items = b.jobs ?? b.organic ?? []; } catch { /* */ }
    }
    if (!items.length) return (await serpApiSearch(`${query} jobs`, num)).map(r => ({ ...r }));

    return items.slice(0, num).map(r => ({
      title: r.title, company: r.company, url: r.link || r.url || "",
      snippet: r.description || r.snippet || "", location: r.location,
    }));
  } catch { return (await serpApiSearch(`${query} jobs`, num)).map(r => ({ ...r })); }
}

// ─── Bright Data Web Unlocker ─────────────────────────────────────────────────

export async function bdUnlock(url: string): Promise<string> {
  const cached = scrapeCache.get(`raw:${url}`);
  if (cached) return cached;

  if (!BD_API_KEY) return "";

  try {
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_UNLOCKER_ZONE, url, format: "raw" }),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    scrapeCache.set(`raw:${url}`, html);
    return html;
  } catch { return ""; }
}

// ─── Bright Data Markdown Scrape ──────────────────────────────────────────────

export async function bdScrapeMarkdown(url: string): Promise<string> {
  const cached = scrapeCache.get(`md:${url}`);
  if (cached) return cached;

  if (!BD_API_KEY) return "";
  try {
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_UNLOCKER_ZONE, url, format: "raw", data_format: "markdown" }),
    });
    if (!resp.ok) return "";
    const md = await resp.text();
    scrapeCache.set(`md:${url}`, md);
    return md;
  } catch { return ""; }
}

// ─── Bright Data Scraping Browser ─────────────────────────────────────────────

export async function bdScrapeBrowser(url: string): Promise<string> {
  if (!BD_API_KEY) return bdUnlock(url);
  if (!BD_BROWSER_ZONE) return bdUnlock(url);
  try {
    const resp = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${BD_API_KEY}` },
      body: JSON.stringify({ zone: BD_BROWSER_ZONE, url, format: "raw" }),
    });
    if (!resp.ok) return bdUnlock(url);
    return await resp.text();
  } catch { return bdUnlock(url); }
}

// ─── Bright Data Discover ─────────────────────────────────────────────────────

export async function bdDiscover(query: string, count = 5): Promise<(SerpResult & { score?: number })[]> {
  const [a, b] = await Promise.all([bdSerp(query, count), bdSerp(`${query} analysis report 2026`, count)]);
  const seen = new Set<string>();
  const merged: (SerpResult & { score?: number })[] = [];
  for (const [idx, results] of [a, b].entries()) {
    for (const r of results) {
      if (!seen.has(r.url)) {
        seen.add(r.url);
        merged.push({ ...r, score: Math.max(100 - idx * 15 - merged.length * 5, 10) });
      }
    }
  }
  return merged.slice(0, count);
}

// ─── Pricing HTML Extractor ───────────────────────────────────────────────────

export function extractPricing(html: string) {
  const $ = cheerio.load(html);
  const tiers: { name: string; price: string; features: string[] }[] = [];
  for (const sel of [".pricing-card", ".price-card", "[class*='pricing']", "[class*='plan']"]) {
    $(sel).each((_i, el) => {
      const name  = $(el).find("h2,h3,.tier-name,.plan-name").first().text().trim();
      const price = $(el).find(".price,[class*='price'],[class*='amount']").first().text().trim();
      const feats = $(el).find("li,.feature").map((_j, f) => $(f).text().trim()).get().filter(Boolean);
      if (name || price) tiers.push({ name, price, features: feats });
    });
    if (tiers.length) break;
  }
  return tiers;
}

// ─── Slack ────────────────────────────────────────────────────────────────────

export async function sendSlack(message: string): Promise<boolean> {
  if (!SLACK_WEBHOOK) return false;
  try {
    const r = await fetch(SLACK_WEBHOOK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    return r.ok;
  } catch { return false; }
}

// ─── Bright Data MCP Client ───────────────────────────────────────────────────

let _mcpSessionUrl: string | null = null;
let _mcpInitialised = false;

export async function bdMcpInit(): Promise<string | null> {
  if (!BD_MCP_URL) return null;
  if (_mcpInitialised) return _mcpSessionUrl;
  _mcpInitialised = true;

  return new Promise((resolve) => {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => { ctrl.abort(); resolve(null); }, 10_000);

    fetch(BD_MCP_URL!, { headers: { Accept: "text/event-stream" }, signal: ctrl.signal })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) { clearTimeout(timer); return resolve(null); }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read().catch(() => ({ done: true as const, value: undefined }));
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (const line of buf.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              const d = JSON.parse(line.slice(5).trim()) as { uri?: string };
              if (d.uri) {
                clearTimeout(timer);
                const base = new URL(BD_MCP_URL!);
                _mcpSessionUrl = `${base.origin}${d.uri}`;
                resolve(_mcpSessionUrl);
                return;
              }
            } catch { /* */ }
          }
        }
        clearTimeout(timer); resolve(null);
      })
      .catch(() => { clearTimeout(timer); resolve(null); });
  });
}

export async function bdMcpCall(toolName: string, toolArgs: Record<string, unknown>): Promise<unknown> {
  const session = await bdMcpInit();
  if (!session) return null;
  try {
    const resp = await fetch(session, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: toolName, arguments: toolArgs } }),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { result?: { content?: { type: string; text?: string }[] } };
    const text = (data.result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
    try { return JSON.parse(text); } catch { return text; }
  } catch { return null; }
}

// ─── TriggerWare.ai automated workflow trigger ────────────────────────────────

export async function sendTriggerWare(payload: Record<string, unknown>): Promise<boolean> {
  if (!TRIGGERWARE_API_KEY) { console.error("[TriggerWare] API key not set"); return false; }
  try {
    // Push signal event as a named query snapshot to TriggerWare
    const name = `Signal: ${String(payload.competitorName ?? "competitor")} — ${String(payload.changeType ?? "change")} [${new Date().toISOString().slice(0, 16)}]`;
    const resp = await fetch("https://api.triggerware.com/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Api-Key": TRIGGERWARE_API_KEY },
      body: JSON.stringify({
        name: name.slice(0, 100),
        description: `SELECT * FROM signals`,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await resp.json() as { status?: string; name?: string };
    console.log(`[TriggerWare] query created status=${resp.status} name=${body.name} state=${body.status}`);
    return resp.ok;
  } catch (e) { console.error("[TriggerWare] fetch failed:", e); return false; }
}

export async function bdMcpSearch(query: string): Promise<SerpResult[]> {
  const session = await bdMcpInit();
  if (!session) return [];
  try {
    const resp = await fetch(session, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: "web_search", arguments: { query, count: 5 } } }),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { result?: { content?: { type: string; text?: string }[] } };
    const text = (data.result?.content ?? []).filter(c => c.type === "text").map(c => c.text).join("\n");
    const results: SerpResult[] = [];
    for (const block of text.split(/\n---+\n|\n\n/)) {
      const title   = (block.match(/(?:title)[:\s]+(.+)/i)?.[1] ?? "").trim();
      const url     = (block.match(/(https?:\/\/\S+)/)?.[1] ?? "").trim();
      const snippet = (block.match(/(?:snippet|description)[:\s]+(.+)/i)?.[1] ?? block).trim().slice(0, 300);
      if (title || url) results.push({ title, url, snippet });
    }
    return results.slice(0, 5);
  } catch { return []; }
}
