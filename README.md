# RevenueRadar AI

> **Autonomous competitive intelligence for GTM teams** — monitors the entire public web for competitor signals, synthesises them with AI, and delivers executive-grade battlecards to your sales team in real time.

Built for the **Bright Data Web Scraping Hackathon 2026** using four Bright Data products, three partner integrations, and a fully agentic AI research loop.

---

## What It Does

Sales teams lose deals because they find out about competitor moves too late — price changes, product launches, funding rounds, exec hires. RevenueRadar fixes that.

Sign up with your product name and niche → the system automatically discovers your top 10 competitors → monitors them 24/7 → alerts your Slack when something high-impact happens.

---

## Live Demo

```bash
git clone https://github.com/HadiaIshtiaqq/RevenueRadar.git
cd RevenueRadar
npm install
cp .env.example .env   # add your API keys
npm run dev            # open http://localhost:3000
```

---

## Bright Data Integration — 4 Products

| Feature | Bright Data Product |
|:---|:---|
| Competitor discovery at signup | **SERP API** — parallel Google searches |
| Background signal monitor (every 5 min) | **SERP API** — pricing / hiring / news |
| Live competitor page scraping | **Web Unlocker** — bot-bypass HTML → Markdown |
| JavaScript-heavy pages (LinkedIn, SPAs) | **Scraping Browser** — full JS rendering |
| LinkedIn company / person profiles | **MCP Web Scraper API** — structured datasets |
| Crunchbase firmographics | **MCP Web Scraper API** — funding data |
| Reddit social sentiment | **MCP Web Scraper API** — Reddit dataset |
| Account buying-signal enrichment | **SERP API** — LinkedIn job search |

---

## Partner Integrations

| Partner | How It's Used |
|:---|:---|
| **Speechmatics** | Transcribe competitor podcasts, keynotes, earnings calls — AI extracts roadmap hints and positioning shifts |
| **Cognee** | Graph memory sidecar — persists intelligence across research sessions, agent recalls prior findings |
| **Slack** | Automated alerts for any signal scoring 75+ impact — fires within minutes of detection |

---

## Key Features

### Executive Intelligence Dashboard
- Live competitor change feed with AI-classified signal types (pricing, hiring, product, messaging)
- GTM Pressure Velocity chart — 7-day rolling average of competitor activity
- Sentinel Intel Map — Google Maps with geocoded competitor HQs and demand zones

### Competitor Battlecards
- AI-generated threat scores, market overlap, feature parity ratings
- Timeline signals feed filtered by type
- Objection battlecards with one-click copy of sales talk tracks
- Live Pricing Scanner — scrapes competitor pricing pages via Bright Data Web Unlocker

### Research Agent (Streaming)
- AIML API GPT-4o agentic loop with **17 registered Bright Data tools**
- Streams tool calls live to the UI — judges can watch it think, search, and scrape in real time
- Three-tier fallback: AI + Bright Data → Bright Data only → local DB cache

### Audio / Podcast Intelligence
- Paste any MP3/WAV URL or upload a file
- Speechmatics transcribes the audio
- AI extracts roadmap hints, pricing signals, competitive mentions, growth signals

### Account Enrichment
- Enter any company domain → firmographics, tech stack, hiring signals, AI outreach draft
- Powered by Bright Data MCP (LinkedIn, Crunchbase) + Web Unlocker

### Alerts
- Slack webhook delivery for high-impact signals
- Configurable impact threshold (0–100)
- TriggerWare webhook integration for workflow automation

---

## Architecture

```
User signup
  └─► discoverCompetitors()
        ├─► bdSerp() × 3 parallel queries          [SERP API]
        └─► GPT-4o extracts structured competitor list

Background monitor (every 5 min)
  └─► fetchRealCompetitorSignals() per competitor
        └─► bdSerp() — pricing/hiring/product       [SERP API]
        └─► Slack alert if impact ≥ 75             [Slack]

Research agent (Server-Sent Events stream)
  └─► runAgentStream() — GPT-4o function-calling loop
        ├─► search_web / search_news / search_jobs  [SERP API]
        ├─► fetch_webpage / scrape_as_markdown      [Web Unlocker]
        ├─► scrape_js_page                          [Scraping Browser]
        ├─► get_linkedin_company / person           [MCP API]
        ├─► get_crunchbase_company                  [MCP API]
        └─► monitor_social                          [MCP API]

Audio intelligence
  └─► submitTranscriptionJob()                     [Speechmatics]
        └─► GPT-4o → competitive signal extraction

Memory layer
  └─► cognee_server.py (Python sidecar)            [Cognee]
        └─► graph knowledge base across sessions
```

---

## Fallback Strategy

The app never goes dark:

1. **Full mode** — AIML API + Bright Data → live agentic intelligence
2. **No AI** — Bright Data only → real web data, no synthesis
3. **No keys** — local SQLite cache → clearly labelled demo mode

---

## Tech Stack

| Layer | Technology |
|:---|:---|
| Frontend | React 19 + TypeScript + Tailwind CSS v4 + Framer Motion + Recharts |
| Backend | Node.js + Express + Vite middleware (single port) |
| AI | AIML API — GPT-4o (17 tool declarations) |
| Web Data | Bright Data SERP + Web Unlocker + Scraping Browser + MCP |
| Database | SQLite (better-sqlite3, WAL mode) |
| Auth | scrypt password hashing, UUID session tokens |
| Audio | Speechmatics speech-to-text |
| Memory | Cognee graph memory (Python sidecar, auto-started) |

---

## Setup

### 1. Install

```bash
git clone https://github.com/HadiaIshtiaqq/RevenueRadar.git
cd RevenueRadar
npm install
pip install cognee fastapi uvicorn   # optional — for memory layer
```

### 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

```env
# Required
BRIGHTDATA_API_KEY=your_key
AIML_API_KEY=your_key

# Bright Data zones (must match your dashboard zone names)
BRIGHTDATA_SERP_ZONE=serp_api1
BRIGHTDATA_UNLOCKER_ZONE=web_unlocker1
BRIGHTDATA_BROWSER_ZONE=scraping_browser1
BRIGHTDATA_MCP_URL=https://mcp.brightdata.com/sse?token=your_token

# Optional integrations
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SPEECHMATICS_API_KEY=your_key
GEMINI_API_KEY=your_key          # for Cognee memory
VITE_GOOGLE_MAPS_API_KEY=your_key
```

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — sign up with your product name and niche, then watch competitor discovery run automatically.

---

## Tests

```bash
npm test
```

```
ℹ tests 49
ℹ pass  49
ℹ fail  0
```

---

## Project Structure

```
RevenueRadar/
├── server.ts              # Express backend + all API routes
├── db.ts                  # SQLite schema + serializers
├── lib/
│   ├── agent.ts           # GPT-4o agentic loop + 17 Bright Data tools
│   ├── brightdata.ts      # SERP / Unlocker / Browser / MCP wrappers
│   ├── geocoding.ts       # Company HQ geocoding pipeline
│   ├── cognee.ts          # Cognee memory sidecar manager
│   ├── auth.ts            # scrypt + session tokens
│   ├── cache.ts           # TTL cache
│   ├── config.ts          # Env-var constants
│   └── utils.ts           # Utilities
├── src/
│   ├── components/
│   │   ├── DashboardView.tsx    # Executive intel terminal + map
│   │   ├── CompetitorsView.tsx  # Battlecards + competitor pipeline
│   │   ├── ResearchView.tsx     # Streaming agent + pipeline
│   │   ├── AccountsView.tsx     # Account enrichment
│   │   ├── AlertsView.tsx       # Alert subscriptions
│   │   └── SettingsView.tsx     # Profile + notifications
│   └── types.ts
├── tests/
│   └── smoke.test.ts      # 49 unit tests
├── cognee_server.py        # Cognee memory sidecar (Python)
└── n8n-workflow.json       # Optional n8n automation
```

---

## License

MIT
