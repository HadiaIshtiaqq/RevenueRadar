import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const db = new Database(path.join(__dirname, "revenueradar.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password      TEXT NOT NULL,
    name          TEXT NOT NULL,
    product_name  TEXT NOT NULL DEFAULT '',
    product_niche TEXT NOT NULL DEFAULT '',
    company_city  TEXT NOT NULL DEFAULT '',
    company_lat   REAL,
    company_lng   REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL DEFAULT (datetime('now', '+30 days')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_tasks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    topic          TEXT    NOT NULL,
    region         TEXT,
    competitors    TEXT,
    status         TEXT    NOT NULL DEFAULT 'Pending',
    retry_count    INTEGER NOT NULL DEFAULT 0,
    start_time     TEXT,
    completed_time TEXT,
    failure_reason TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS research_results (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id              INTEGER REFERENCES research_tasks(id),
    topic                TEXT,
    region               TEXT,
    verified_trend       TEXT,
    pricing_gap          TEXT,
    feature_insights     TEXT,
    confidence_score     INTEGER,
    confidence_rationale TEXT,
    opportunity_score    INTEGER,
    evidence_links       TEXT,
    data_summary         TEXT,
    status               TEXT,
    processed_at         TEXT,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS competitors (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    domain           TEXT NOT NULL,
    pricing_url      TEXT,
    blog_url         TEXT,
    careers_url      TEXT,
    industry         TEXT,
    scope            TEXT NOT NULL DEFAULT 'global',
    monitoring       INTEGER NOT NULL DEFAULT 1,
    discovery_source TEXT NOT NULL DEFAULT 'manual',
    hq_lat           REAL,
    hq_lng           REAL,
    hq_city          TEXT,
    user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS competitor_snapshots (
    id              TEXT PRIMARY KEY,
    competitor_id   TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    url             TEXT NOT NULL,
    structured_data TEXT,
    checksum        TEXT,
    captured_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS competitor_changes (
    id              TEXT PRIMARY KEY,
    competitor_id   TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    change_type     TEXT NOT NULL,
    summary         TEXT NOT NULL,
    impact_score    INTEGER NOT NULL DEFAULT 0,
    details         TEXT,
    detected_at     TEXT NOT NULL,
    acknowledged    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS account_signals (
    id           TEXT PRIMARY KEY,
    account_id   TEXT NOT NULL,
    account_name TEXT NOT NULL,
    signal_type  TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'web',
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    url          TEXT,
    intent_score INTEGER NOT NULL DEFAULT 0,
    metadata     TEXT NOT NULL DEFAULT '{}',
    detected_at  TEXT NOT NULL DEFAULT (datetime('now')),
    acted_on     INTEGER NOT NULL DEFAULT 0,
    user_id      TEXT REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS alert_subscriptions (
    id              TEXT PRIMARY KEY,
    alert_type      TEXT NOT NULL,
    delivery_method TEXT NOT NULL,
    delivery_target TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS competitor_audio_sources (
    id              TEXT PRIMARY KEY,
    competitor_id   TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    label           TEXT NOT NULL DEFAULT '',
    last_scanned_at TEXT,
    last_status     TEXT,
    latest_insight  TEXT,
    user_id         TEXT REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    impact_threshold INTEGER NOT NULL DEFAULT 75,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monitor_log (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    ran_at      TEXT NOT NULL DEFAULT (datetime('now')),
    changes_found INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audio_jobs (
    id                  TEXT PRIMARY KEY,
    speechmatics_job_id TEXT,
    competitor_name     TEXT NOT NULL,
    audio_url           TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'transcribing',
    transcript          TEXT,
    analysis_json       TEXT,
    user_id             TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── Schema migrations (for existing databases) ────────────────────────────────
{
  const userCols = new Set((db.pragma("table_info(users)") as Array<{name: string}>).map(c => c.name));
  if (!userCols.has("company_city")) db.exec("ALTER TABLE users ADD COLUMN company_city TEXT NOT NULL DEFAULT ''");
  if (!userCols.has("company_lat"))  db.exec("ALTER TABLE users ADD COLUMN company_lat REAL");
  if (!userCols.has("company_lng"))  db.exec("ALTER TABLE users ADD COLUMN company_lng REAL");
}
{
  const sessionCols = new Set((db.pragma("table_info(user_sessions)") as Array<{name: string}>).map(c => c.name));
  if (!sessionCols.has("expires_at")) db.exec("ALTER TABLE user_sessions ADD COLUMN expires_at TEXT NOT NULL DEFAULT '2099-12-31 00:00:00'");
}
{
  const cols = new Set((db.pragma("table_info(competitors)") as Array<{name: string}>).map(c => c.name));
  if (!cols.has("discovery_source")) db.exec("ALTER TABLE competitors ADD COLUMN discovery_source TEXT NOT NULL DEFAULT 'manual'");
  if (!cols.has("hq_lat"))           db.exec("ALTER TABLE competitors ADD COLUMN hq_lat REAL");
  if (!cols.has("hq_lng"))           db.exec("ALTER TABLE competitors ADD COLUMN hq_lng REAL");
  if (!cols.has("hq_city"))          db.exec("ALTER TABLE competitors ADD COLUMN hq_city TEXT");
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserRow = {
  id: string; email: string; password: string; name: string;
  product_name: string; product_niche: string;
  company_city: string; company_lat: number | null; company_lng: number | null;
  created_at: string;
};

export type TaskRow = {
  id: number; topic: string; region: string | null; competitors: string | null;
  status: string; retry_count: number; start_time: string | null;
  completed_time: string | null; failure_reason: string | null; created_at: string;
};

export type ResultRow = {
  id: number; task_id: number | null; topic: string | null; region: string | null;
  verified_trend: string | null; pricing_gap: string | null; feature_insights: string | null;
  confidence_score: number | null; confidence_rationale: string | null;
  opportunity_score: number | null; evidence_links: string | null;
  data_summary: string | null; status: string | null; processed_at: string | null; created_at: string;
};

export type CompetitorRow = {
  id: string; name: string; domain: string; pricing_url: string | null;
  blog_url: string | null; careers_url: string | null; industry: string | null;
  scope: string; monitoring: number; discovery_source: string;
  hq_lat: number | null; hq_lng: number | null; hq_city: string | null;
  user_id: string | null; created_at: string;
};

export type SnapshotRow = {
  id: string; competitor_id: string; type: string; url: string;
  structured_data: string | null; checksum: string | null; captured_at: string;
};

export type ChangeRow = {
  id: string; competitor_id: string; change_type: string; summary: string;
  impact_score: number; details: string | null; detected_at: string; acknowledged: number;
};

export type SignalRow = {
  id: string; account_id: string; account_name: string; signal_type: string;
  source: string; title: string; description: string; url: string | null;
  intent_score: number; metadata: string; detected_at: string; acted_on: number;
  user_id: string | null;
};

export type SubscriptionRow = {
  id: string; alert_type: string; delivery_method: string;
  delivery_target: string; enabled: number; user_id: string | null; created_at: string;
};

export type AudioSourceRow = {
  id: string; competitor_id: string; url: string; label: string;
  last_scanned_at: string | null; last_status: string | null;
  latest_insight: string | null; user_id: string | null; created_at: string;
};

// ── Serializers ───────────────────────────────────────────────────────────────

export function taskToApi(row: TaskRow) {
  return {
    id: row.id,
    "Topic":              row.topic,
    "Region":             row.region        ?? "",
    "Target Competitors": row.competitors   ?? "",
    "Status":             row.status,
    "Retry Count":        row.retry_count,
    "StartTime":          row.start_time    ?? "",
    "CompletedTime":      row.completed_time ?? "",
    "FailureReason":      row.failure_reason ?? "",
    created_at:           row.created_at,
  };
}

export function competitorToApi(row: CompetitorRow) {
  return {
    id:                row.id,
    name:              row.name,
    domain:            row.domain,
    pricingUrl:        row.pricing_url    ?? undefined,
    blogUrl:           row.blog_url       ?? undefined,
    careersUrl:        row.careers_url    ?? undefined,
    industry:          row.industry       ?? undefined,
    scope:             row.scope,
    monitoringEnabled: !!row.monitoring,
    discoverySource:   row.discovery_source ?? "manual",
    hqLat:             row.hq_lat          ?? undefined,
    hqLng:             row.hq_lng          ?? undefined,
    hqCity:            row.hq_city         ?? undefined,
    createdAt:         row.created_at,
  };
}

export function signalToApi(row: SignalRow) {
  return {
    id:          row.id,
    accountId:   row.account_id,
    accountName: row.account_name,
    signalType:  row.signal_type,
    source:      row.source,
    title:       row.title,
    description: row.description,
    url:         row.url ?? undefined,
    intentScore: row.intent_score,
    metadata:    (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })(),
    detectedAt:  row.detected_at,
    actedOn:     !!row.acted_on,
  };
}

export function subscriptionToApi(row: SubscriptionRow) {
  return {
    id:             row.id,
    alertType:      row.alert_type,
    deliveryMethod: row.delivery_method,
    deliveryTarget: row.delivery_target,
    enabled:        !!row.enabled,
    createdAt:      row.created_at,
  };
}

export function changeToApi(row: ChangeRow & { competitor_name?: string }) {
  return {
    id:             row.id,
    competitorId:   row.competitor_id,
    competitorName: row.competitor_name ?? "Unknown",
    changeType:     row.change_type,
    summary:        row.summary,
    impactScore:    row.impact_score,
    details:        (() => { try { return JSON.parse(row.details ?? "{}"); } catch { return {}; } })(),
    detectedAt:     row.detected_at,
    acknowledged:   !!row.acknowledged,
  };
}

export default db;
