/**
 * Smoke tests — run with: npm test
 * Uses Node.js built-in test runner (no extra deps required).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { genId, sha256, sanitizeInput, tryParseJSON } from "../lib/utils.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { TTLCache } from "../lib/cache.js";
import { extractHost, domainToName, isListSiteDomain } from "../lib/geocoding.js";
import { isCogneeReady } from "../lib/cognee.js";

// ─── lib/utils ────────────────────────────────────────────────────────────────

describe("lib/utils — genId", () => {
  test("returns a UUID string", () => {
    const id = genId();
    assert.equal(typeof id, "string");
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("each call produces a unique id", () => {
    const ids = new Set(Array.from({ length: 500 }, genId));
    assert.equal(ids.size, 500);
  });
});

describe("lib/utils — sha256", () => {
  test("is deterministic", () => {
    assert.equal(sha256("hello"), sha256("hello"));
  });

  test("different inputs produce different hashes", () => {
    assert.notEqual(sha256("foo"), sha256("bar"));
  });

  test("returns 64-char hex string", () => {
    const h = sha256("test");
    assert.equal(h.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(h));
  });
});

describe("lib/utils — sanitizeInput", () => {
  test("trims leading and trailing whitespace", () => {
    assert.equal(sanitizeInput("  hello  ", 100), "hello");
  });

  test("truncates to maxLen", () => {
    assert.equal(sanitizeInput("a".repeat(200), 10).length, 10);
  });

  test("passes through normal strings unchanged", () => {
    assert.equal(sanitizeInput("normal string", 100), "normal string");
  });
});

describe("lib/utils — tryParseJSON", () => {
  test("parses valid JSON object", () => {
    assert.deepEqual(tryParseJSON<{ x: number }>('{"x":1}'), { x: 1 });
  });

  test("returns null for invalid JSON", () => {
    assert.equal(tryParseJSON("not json"), null);
  });

  test("returns null for empty string", () => {
    assert.equal(tryParseJSON(""), null);
  });

  test("parses arrays", () => {
    assert.deepEqual(tryParseJSON<number[]>("[1,2,3]"), [1, 2, 3]);
  });
});

// ─── lib/auth ─────────────────────────────────────────────────────────────────

describe("lib/auth — hashPassword / verifyPassword", () => {
  test("correct password verifies true", () => {
    const hash = hashPassword("s3cr3t!");
    assert.equal(verifyPassword("s3cr3t!", hash), true);
  });

  test("wrong password verifies false", () => {
    const hash = hashPassword("s3cr3t!");
    assert.equal(verifyPassword("wrong", hash), false);
  });

  test("each hash is unique (random salts)", () => {
    const h1 = hashPassword("same");
    const h2 = hashPassword("same");
    assert.notEqual(h1, h2);
  });

  test("hash format is salt:hash", () => {
    const parts = hashPassword("pw").split(":");
    assert.equal(parts.length, 2);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
  });

  test("empty password round-trips correctly", () => {
    const hash = hashPassword("");
    assert.equal(verifyPassword("", hash), true);
    assert.equal(verifyPassword("x", hash), false);
  });
});

// ─── lib/cache ────────────────────────────────────────────────────────────────

describe("lib/cache — TTLCache", () => {
  test("get returns undefined for missing key", () => {
    const c = new TTLCache<string>(1000);
    assert.equal(c.get("missing"), undefined);
  });

  test("set and get round-trips", () => {
    const c = new TTLCache<number>(5000);
    c.set("k", 42);
    assert.equal(c.get("k"), 42);
  });

  test("expired entry returns undefined", async () => {
    const c = new TTLCache<string>(50); // 50 ms TTL
    c.set("x", "value");
    await new Promise(r => setTimeout(r, 100));
    assert.equal(c.get("x"), undefined);
  });

  test("wrap returns cached value on second call", async () => {
    const c = new TTLCache<number>(5000);
    let calls = 0;
    const fn = () => Promise.resolve(++calls);
    assert.equal(await c.wrap("k", fn), 1);
    assert.equal(await c.wrap("k", fn), 1); // cached
    assert.equal(calls, 1);
  });
});

// ─── lib/geocoding ────────────────────────────────────────────────────────────

describe("lib/geocoding — extractHost", () => {
  test("extracts domain from full URL", () => {
    assert.equal(extractHost("https://www.salesforce.com/products"), "salesforce.com");
  });

  test("strips common subdomains", () => {
    assert.equal(extractHost("https://blog.stripe.com/post"), "stripe.com");
  });

  test("returns empty string for invalid URL", () => {
    assert.equal(extractHost("not-a-url"), "");
  });
});

describe("lib/geocoding — domainToName", () => {
  test("capitalises first letter", () => {
    assert.equal(domainToName("hubspot.com"), "Hubspot");
  });

  test("converts hyphens to spaces", () => {
    assert.equal(domainToName("just-eat.com"), "Just Eat");
  });

  test("splits two concatenated common words", () => {
    assert.equal(domainToName("standardprocess.com"), "Standard Process");
  });

  test("splits food + digital", () => {
    assert.equal(domainToName("fooddigital.com"), "Food Digital");
  });

  test("splits nutraceuticals + world", () => {
    assert.equal(domainToName("nutraceuticalsworld.com"), "Nutraceuticals World");
  });

  test("brand prefix + common word suffix", () => {
    // "abbott" is brand prefix, "nutrition" is in dict
    const result = domainToName("abbottnutrition.com");
    assert.ok(result.toLowerCase().includes("nutrition"), `expected 'nutrition' in "${result}"`);
  });

  test("brand prefix + two common words", () => {
    // "nestle" prefix, "health" + "science" from dict
    const result = domainToName("nestlehealthscience.us");
    assert.ok(result.toLowerCase().includes("health"), `expected 'health' in "${result}"`);
    assert.ok(result.toLowerCase().includes("science"), `expected 'science' in "${result}"`);
  });
});

describe("lib/geocoding — isListSiteDomain", () => {
  test("flags review site as list site", () => {
    assert.equal(isListSiteDomain("best-software-reviews.com"), true);
  });

  test("passes real product domain", () => {
    assert.equal(isListSiteDomain("salesforce.com"), false);
  });
});

// ─── lib/cognee ───────────────────────────────────────────────────────────────

describe("lib/cognee — isCogneeReady", () => {
  test("returns false before server is started", () => {
    assert.equal(isCogneeReady(), false);
  });
});

// ─── db serializers ───────────────────────────────────────────────────────────

import {
  taskToApi, competitorToApi, changeToApi, subscriptionToApi,
  type TaskRow, type CompetitorRow, type ChangeRow, type SubscriptionRow,
} from "../db.js";

describe("db — competitorToApi", () => {
  const base: CompetitorRow = {
    id: "c1", name: "Acme", domain: "acme.com", pricing_url: null,
    blog_url: null, careers_url: null, industry: "SaaS", scope: "global",
    monitoring: 1, discovery_source: "serp", hq_lat: 37.77, hq_lng: -122.41,
    hq_city: "San Francisco", user_id: "u1", created_at: "2026-01-01 00:00:00",
  };

  test("maps monitoring integer to boolean", () => {
    assert.equal(competitorToApi({ ...base, monitoring: 1 }).monitoringEnabled, true);
    assert.equal(competitorToApi({ ...base, monitoring: 0 }).monitoringEnabled, false);
  });

  test("nullable fields become undefined", () => {
    const out = competitorToApi({ ...base, pricing_url: null, blog_url: null });
    assert.equal(out.pricingUrl, undefined);
    assert.equal(out.blogUrl, undefined);
  });

  test("preserves coordinates", () => {
    const out = competitorToApi(base);
    assert.equal(out.hqLat, 37.77);
    assert.equal(out.hqLng, -122.41);
  });
});

describe("db — changeToApi", () => {
  const base: ChangeRow & { competitor_name: string } = {
    id: "ch1", competitor_id: "c1", competitor_name: "Acme",
    change_type: "pricing_change", summary: "Price raised 20%",
    impact_score: 82, details: null, detected_at: "2026-05-01 10:00:00", acknowledged: 0,
  };

  test("maps acknowledged integer to boolean", () => {
    assert.equal(changeToApi({ ...base, acknowledged: 0 }).acknowledged, false);
    assert.equal(changeToApi({ ...base, acknowledged: 1 }).acknowledged, true);
  });

  test("falls back to 'Unknown' when competitor_name is missing", () => {
    const { competitor_name: _, ...noName } = base;
    assert.equal(changeToApi(noName as ChangeRow).competitorName, "Unknown");
  });

  test("parses valid details JSON", () => {
    const out = changeToApi({ ...base, details: '{"foo":1}' });
    assert.deepEqual(out.details, { foo: 1 });
  });

  test("returns empty object for invalid details JSON", () => {
    const out = changeToApi({ ...base, details: "not-json" });
    assert.deepEqual(out.details, {});
  });
});

describe("db — subscriptionToApi", () => {
  const base: SubscriptionRow = {
    id: "s1", alert_type: "pricing_change", delivery_method: "slack",
    delivery_target: "https://hooks.slack.com/x", enabled: 1,
    user_id: "u1", created_at: "2026-01-01 00:00:00",
  };

  test("maps enabled integer to boolean", () => {
    assert.equal(subscriptionToApi({ ...base, enabled: 1 }).enabled, true);
    assert.equal(subscriptionToApi({ ...base, enabled: 0 }).enabled, false);
  });

  test("exposes alert_type as alertType", () => {
    assert.equal(subscriptionToApi(base).alertType, "pricing_change");
  });
});

describe("db — taskToApi", () => {
  const base: TaskRow = {
    id: 1, topic: "SaaS pricing trends", region: null, competitors: null,
    status: "Pending", retry_count: 0, start_time: null,
    completed_time: null, failure_reason: null, created_at: "2026-01-01 00:00:00",
  };

  test("null region becomes empty string", () => {
    assert.equal(taskToApi(base)["Region"], "");
  });

  test("preserves topic", () => {
    assert.equal(taskToApi(base)["Topic"], "SaaS pricing trends");
  });

  test("null failure_reason becomes empty string", () => {
    assert.equal(taskToApi(base)["FailureReason"], "");
  });
});

// ─── lib/utils — extra edge cases ─────────────────────────────────────────────

describe("lib/utils — sanitizeInput edge cases", () => {
  test("handles empty string", () => {
    assert.equal(sanitizeInput("", 100), "");
  });

  test("truncates exactly at maxLen", () => {
    const result = sanitizeInput("hello", 5);
    assert.equal(result.length, 5);
  });

  test("strips surrounding whitespace before truncating", () => {
    const result = sanitizeInput("  ab  ", 2);
    assert.equal(result, "ab");
  });
});
