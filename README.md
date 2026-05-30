# RevenueRadarAI

**AI-powered competitive intelligence and GTM signal platform** — built for the Bright Data Web Hackathon.

> **Demo:** Run `npm run dev` and open [http://localhost:3000](http://localhost:3000) to see the live dashboard. Screenshots can be added to the `/screenshots` directory.

## What It Does

RevenueRadarAI automatically discovers your competitors and monitors them 24/7 using **four distinct Bright Data products**:

| Feature | Bright Data Product Used |
|---|---|
| Competitor discovery at signup | **SERP API** — multi-angle Google search |
| Live news & competitor signals | **SERP API** — Google News scraping |
| Competitor page scraping (pricing, messaging) | **Web Unlocker** — bot-bypass HTML + Markdown |
| JavaScript-heavy pages (LinkedIn, SPAs) | **Scraping Browser** — full JS rendering |
| LinkedIn company/person profiles | **MCP Web Scraper API** — structured datasets |
| Reddit social sentiment | **MCP Web Scraper API** — Reddit dataset |
| Crunchbase firmographics | **MCP Web Scraper API** — Crunchbase dataset |
| Buying signal enrichment | **SERP API** — LinkedIn job search |

## Key Features

- **Executive Intelligence Dashboard** — live competitor change feed, GTM pressure chart, global HQ map
- **Sentinel Intel Map** — Google Maps visualization of all competitor headquarters with demand zones
- **Competitor Battlecards** — AI-generated positioning analysis and win/loss playbooks
- **Research Agent** — AIML API agentic loop with 17 Bright Data tools; degrades to direct BD queries when AI quota is unavailable
- **Account Enrichment** — enter any domain → get firmographics, tech stack, LinkedIn buying signals, AI-drafted outreach
- **Alert System** — Slack webhook delivery for high-impact competitor changes
- **Background Monitor** — every 5 minutes: scans top competitors via Bright Data SERP, persists new signals
- **Audio / Podcast Intelligence** — transcribe competitor keynotes & podcasts via Speechmatics, extract roadmap hints and positioning shifts with AI

## Tech Stack

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Framer Motion + Recharts + Google Maps
- **Backend**: Node.js + Express + Vite middleware (single-port dev server)
- **AI**: AIML API (OpenAI-compatible) — `gpt-4o-mini` by default, configurable via `AIML_MODEL`
- **Data**: Bright Data SERP + Web Unlocker + Scraping Browser + MCP Server
- **Storage**: SQLite (better-sqlite3, WAL mode)
- **Auth**: scrypt password hashing, UUID session tokens
- **Audio**: Speechmatics speech-to-text for podcast/keynote monitoring
- **Memory**: Cognee graph memory sidecar (optional Python process — see below)

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd RevenueRadarAI
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required — Bright Data
BRIGHTDATA_API_KEY=your_brightdata_api_key

# Required — AIML API (https://aimlapi.com)
AIML_API_KEY=your_aiml_api_key
# Optional: override default model
# AIML_MODEL=gpt-4o-mini

# Optional — Bright Data zones (defaults shown)
BRIGHTDATA_SERP_ZONE=serp_api1
BRIGHTDATA_UNLOCKER_ZONE=mcp_unlocker
BRIGHTDATA_BROWSER_ZONE=scraping_browser1

# Optional — Bright Data MCP (for LinkedIn/Crunchbase datasets)
BRIGHTDATA_MCP_URL=https://mcp.brightdata.com/sse

# Optional — Google Maps (for Sentinel Intel Map)
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key

# Optional — Slack alerts
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Optional — Speechmatics (for audio/podcast intelligence)
SPEECHMATICS_API_KEY=your_speechmatics_key

# Optional — Cognee memory sidecar (requires Python setup below)
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Run

```bash
npm run dev
```

App available at [http://localhost:3000](http://localhost:3000)

## Bright Data Integration Architecture

```
User signup
  └─► discoverCompetitors()
        ├─► bdSerp() × 3 parallel SERP queries        [SERP API]
        └─► AIML API extracts structured competitor list [AI]

Background monitor (every 5 min)
  └─► fetchRealCompetitorSignals() per competitor
        └─► bdSerp() — pricing/hiring/product signals  [SERP API]

Research agent (SSE stream)
  ├─► runAgentStream() — AIML API function-calling loop
  │     ├─► search_web → bdSerp()                     [SERP API]
  │     ├─► search_news → bdSerpNews()                [SERP API]
  │     ├─► search_jobs → bdSerpJobs()                [SERP API]
  │     ├─► fetch_webpage → bdScrapeMarkdown()        [Web Unlocker]
  │     ├─► scrape_js_page → bdScrapeBrowser()        [Scraping Browser]
  │     ├─► get_linkedin_company → bdMcpCall()        [MCP API]
  │     ├─► get_linkedin_person → bdMcpCall()         [MCP API]
  │     ├─► get_crunchbase_company → bdMcpCall()      [MCP API]
  │     └─► monitor_social → bdMcpCall()              [MCP API]
  └─► runBrightDataDirectResearch() [fallback, no AI] [SERP API]

Account enrichment (/api/enrich-company)
  └─► runAgent() — AIML API + BD tools
        ├─► bdSerpJobs() — LinkedIn buying signals    [SERP API]
        ├─► bdScrapeMarkdown() — company pages        [Web Unlocker]
        └─► bdMcpCall() — LinkedIn/Crunchbase         [MCP API]
```

## Fallback Strategy

The app is designed to degrade gracefully:

1. **AIML API + Bright Data available** → Full agentic intelligence
2. **AI quota exhausted, BD available** → Direct Bright Data research (real data, no AI synthesis)
3. **No API keys** → Local database intelligence (clearly labeled as offline / demo mode)

## Cognee Memory Sidecar (Optional)

RevenueRadarAI ships an optional persistent memory layer powered by [Cognee](https://github.com/topoteretes/cognee). It runs as a separate Python process and lets the research agent recall prior intelligence across sessions.

**Setup:**

```bash
pip install cognee fastapi uvicorn
```

The Node.js server auto-starts `cognee_server.py` on boot. If Python is not installed or the process fails to start, the app runs normally without memory — all other features are unaffected. The startup log will show `[Cognee] Memory layer ready ✓` when it's working.

## n8n Workflow Integration (Optional)

The file `n8n-workflow.json` defines an [n8n](https://n8n.io) automation that can complement the built-in background monitor:

- **Schedule Trigger** — fires every 30 minutes
- Calls `GET /api/db/tasks?status=Pending` to find queued research tasks
- Calls `PATCH /api/db/tasks/:id` to trigger processing and poll for completion
- Useful for hosting scenarios where you want an external orchestrator instead of the in-process `setInterval` loop

Import the file into your n8n instance and point the HTTP nodes at your deployed app URL.

## Project Structure

```
RevenueRadarAI/
├── server.ts              # Express backend + AI agent + all BD integrations
├── db.ts                  # SQLite schema, migrations, serializers
├── lib/
│   ├── agent.ts           # AIML API agentic loop + 17 Bright Data tools
│   ├── brightdata.ts      # Bright Data SERP / Unlocker / Browser / MCP
│   ├── geocoding.ts       # Company HQ geocoding pipeline
│   ├── cognee.ts          # Cognee memory sidecar
│   ├── auth.ts            # scrypt hashing + session tokens
│   ├── cache.ts           # TTL cache (SERP 15 min, scrape 30 min)
│   ├── config.ts          # All env-var constants
│   └── utils.ts           # genId, sha256, sanitizeInput, tryParseJSON
├── src/
│   ├── App.tsx            # Root router + auth state
│   ├── components/
│   │   ├── LandingPage.tsx      # Signup/signin
│   │   ├── DashboardView.tsx    # Executive intelligence + Sentinel Map
│   │   ├── CompetitorsView.tsx  # Battlecards + competitor management
│   │   ├── ResearchView.tsx     # Streaming research agent (Pipeline + Live)
│   │   ├── AccountsView.tsx     # Target account enrichment
│   │   ├── AlertsView.tsx       # Alert subscription management
│   │   └── SettingsView.tsx     # User settings
│   └── types.ts           # Shared TypeScript interfaces
├── tests/
│   └── smoke.test.ts      # Unit tests (run with: npm test)
├── cognee_server.py        # Cognee memory sidecar (Python, optional)
├── n8n-workflow.json       # Optional n8n automation workflow
└── .env.example            # Environment variable reference
```
