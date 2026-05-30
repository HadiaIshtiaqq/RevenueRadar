import { HQ_COORDS } from "./hq-coords.js";
import { bdSerp } from "./brightdata.js";
import { BD_API_KEY, MAPS_GEO_KEY } from "./config.js";
import { geocodeCache } from "./cache.js";

export { HQ_COORDS };

// ─── Domain helpers ───────────────────────────────────────────────────────────

export function extractHost(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    if (parts.length > 2) {
      const sub = parts[0].toLowerCase();
      if (/^(www\d?|en|fr|de|es|us|uk|ca|au|in|get|open|finance|music|blog|news|shop|store|api|m|app|mail|support|go|static|cdn|media)$/.test(sub)) {
        return parts.slice(1).join(".");
      }
    }
    return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch { return ""; }
}

// Common words used in company name domains — used for word-boundary detection
const WORD_DICT = new Set([
  "health","science","sciences","nutrition","nutritional","nutraceutical","nutraceuticals",
  "process","standard","premium","premier","powder","world","food","foods","digital",
  "global","natural","naturals","organic","life","care","med","medical","bio","tech",
  "technology","technologies","pharma","pharmaceutical","pharmaceuticals","wellness",
  "fitness","sport","sports","supplement","supplements","vitamin","vitamins","mineral",
  "minerals","protein","energy","diet","weight","management","solutions","solution",
  "group","corp","international","national","american","brand","brands","company",
  "market","markets","product","products","shop","store","direct","plus","pro","max",
  "industries","industry","labs","lab","research","institute","center","services",
  "service","manufacturing","distribution","supply","advanced","systems","system",
  "network","networks","media","consulting","analytics","platform","platforms",
  "software","cloud","data","smart","next","true","pure","green","prime","first",
  "fast","clear","bright","strong","modern","active","dynamic","power","super","ultra",
  "mega","net","web","app","hub","pay","one","blue","red","black","white","gold",
  "silver","elite","formula","formulas","encapsulation","encapsulations","garden",
  "nordic","source","now","mega","thorne","klaire","jarrow","solgar","integrative",
  "functional","clinical","professional","therapeutic","scientific","innovation",
  "innovations","collective","community","alliance","association","foundation",
  "enterprise","enterprises","ventures","capital","holdings","partners","partnership",
  "retail","wholesale","commerce","trading","import","export","pacific","atlantic",
  "central","east","west","north","south","asia","europe","africa","america","united",
]);

function _splitAllDict(s: string): string[] | null {
  const n = s.length;
  const dp: (string[] | null)[] = new Array(n + 1).fill(null);
  dp[0] = [];
  for (let i = 0; i < n; i++) {
    if (!dp[i]) continue;
    for (let len = 2; len <= n - i; len++) {
      const word = s.slice(i, i + len);
      if (WORD_DICT.has(word) && !dp[i + len]) dp[i + len] = [...dp[i]!, word];
    }
  }
  return dp[n];
}

function _segmentCompanyName(sld: string): string[] {
  const s = sld.toLowerCase();
  // Try full coverage first
  const full = _splitAllDict(s);
  if (full && full.length > 1) return full;
  // Try: prefix (brand) + dictionary suffix
  for (let start = 2; start < s.length - 1; start++) {
    const suffix = _splitAllDict(s.slice(start));
    if (suffix && suffix.length >= 1 && suffix.every(w => w.length >= 3)) {
      return [s.slice(0, start), ...suffix];
    }
  }
  return [sld];
}

export function domainToName(domain: string): string {
  const parts = domain.split(".");
  const COMPOUND = new Set(["co.uk","com.au","co.nz","co.in","com.br","co.jp","co.za","org.uk"]);
  const last2 = parts.slice(-2).join(".");
  const sld = COMPOUND.has(last2)
    ? (parts[parts.length - 3] ?? parts[0])
    : (parts[parts.length - 2] ?? parts[0]);

  // Has explicit separators — just title-case
  if (/[-_]/.test(sld)) return sld.replace(/[-_]+/g, " ").replace(/\b\w/g, l => l.toUpperCase()).trim();

  // Try smart word segmentation
  const segments = _segmentCompanyName(sld);
  if (segments.length > 1) return segments.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  // Fallback: split on camelCase boundaries then title-case
  return sld.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, l => l.toUpperCase()).trim();
}

export function isListSiteDomain(d: string): boolean {
  return /review|comparison|best|top|alternative|guide|list|rank|software|platform|solution|recommend/i.test(d.split(".")[0]);
}

export function isDevAgencyDomain(d: string): boolean {
  return /technologies\.|techcorp|infotech|devs?\.|development\.|webdev|mobilesolutions|appstudio|softlab/i.test(d) ||
    /^(ahex|eoxysit|virvainfotech|flutterflowdevs|maxtratechnologies|techahead)\./i.test(d);
}

export function isResearchSiteDomain(d: string): boolean {
  return /research|insight|intelligence|analytics|measurement|metrics|mordor|technavio|alliedmarket|marketsand|statista|similarweb|semrush/i.test(d);
}

export const SKIP_DISCOVERY_DOMAINS = new Set([
  "g2.com","capterra.com","trustradius.com","getapp.com","techcrunch.com","forbes.com","reddit.com",
  "linkedin.com","twitter.com","x.com","facebook.com","youtube.com","medium.com","quora.com",
  "wikipedia.org","crunchbase.com","bloomberg.com","businessinsider.com","producthunt.com",
  "alternativeto.net","venturebeat.com","gartner.com","infoworld.com","zdnet.com","pcmag.com",
  "cnet.com","wired.com","techradar.com","clutch.co","goodfirms.co","sortlist.com",
  "github.com","stackoverflow.com","npmjs.com","pypi.org","docker.com",
  "yahoo.com","spotify.com","apple.com","microsoft.com","amazon.com","google.com",
  "investopedia.com","statista.com","similarweb.com","semrush.com","ahrefs.com","moz.com",
]);

// ─── TLD inference (ultimate fallback) ───────────────────────────────────────

export function inferHqFromDomain(domain: string): { lat: number; lng: number; city: string } {
  const tld = domain.split(".").pop() ?? "";
  const map: Record<string, { lat: number; lng: number; city: string }> = {
    uk: { lat: 51.5074, lng:   -0.1278, city: "London" },
    de: { lat: 52.5200, lng:   13.4050, city: "Berlin" },
    fr: { lat: 48.8566, lng:    2.3522, city: "Paris" },
    in: { lat: 28.6139, lng:   77.2090, city: "New Delhi" },
    cn: { lat: 31.2304, lng:  121.4737, city: "Shanghai" },
    au: { lat: -33.8688,lng:  151.2093, city: "Sydney" },
    sg: { lat:  1.3521, lng:  103.8198, city: "Singapore" },
    ca: { lat: 43.6532, lng:  -79.3832, city: "Toronto" },
    il: { lat: 32.0853, lng:   34.7818, city: "Tel Aviv" },
    se: { lat: 59.3293, lng:   18.0686, city: "Stockholm" },
    nl: { lat: 52.3676, lng:    4.9041, city: "Amsterdam" },
    jp: { lat: 35.6762, lng:  139.6503, city: "Tokyo" },
    br: { lat: -23.5505,lng:  -46.6333, city: "São Paulo" },
    io: { lat: 37.7749, lng: -122.4194, city: "San Francisco" },
    ai: { lat: 37.7749, lng: -122.4194, city: "San Francisco" },
  };
  return map[tld] ?? { lat: 37.7749, lng: -122.4194, city: "San Francisco" };
}

export function resolveHq(domain: string): { lat: number; lng: number; city: string } {
  if (HQ_COORDS[domain]) return HQ_COORDS[domain];
  const parts = domain.split(".");
  if (parts.length > 2) {
    const parent = parts.slice(-2).join(".");
    if (HQ_COORDS[parent]) return HQ_COORDS[parent];
  }
  return inferHqFromDomain(domain);
}

// ─── City extraction from text ────────────────────────────────────────────────

export function extractCityFromText(text: string): string | null {
  const patterns = [
    /headquartered?\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /headquarters?\s+(?:in|at)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /\bbased\s+(?:out\s+of\s+|in\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /\boffice[s]?\s+in\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1] && m[1].length > 2 && m[1].length < 30) return m[1];
  }
  return null;
}

// ─── Photon free geocoder (city names only) ───────────────────────────────────

export async function photonGeocodeCity(cityName: string): Promise<{ lat: number; lng: number } | null> {
  const cacheKey = `photon:${cityName}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return { lat: cached.lat, lng: cached.lng };

  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cityName)}&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "RevenueRadarAI/1.0" } });
    if (!res.ok) return null;
    const data = await res.json() as { features: Array<{ geometry: { coordinates: [number, number] } }> };
    if (!data.features?.length) return null;
    const [lng, lat] = data.features[0].geometry.coordinates;
    geocodeCache.set(cacheKey, { lat, lng, city: cityName });
    return { lat, lng };
  } catch { return null; }
}

// ─── Full company HQ geocoding pipeline ──────────────────────────────────────

export async function geocodeCompanyHQ(name: string, domain: string): Promise<{ lat: number; lng: number; city: string }> {
  const cacheKey = `hq:${domain}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  // 1. Static dict (instantaneous)
  const hit = resolveHq(domain);
  const isSF = Math.abs(hit.lat - 37.7749) < 0.001 && Math.abs(hit.lng + 122.4194) < 0.001 && hit.city === "San Francisco";
  if (!isSF || HQ_COORDS[domain]) {
    geocodeCache.set(cacheKey, hit);
    return hit;
  }

  // 2. Google Maps Geocoding API (if enabled)
  if (MAPS_GEO_KEY) {
    try {
      const q = encodeURIComponent(`${name} company headquarters`);
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${MAPS_GEO_KEY}`;
      const res = await fetch(url);
      const data = await res.json() as { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } }; formatted_address: string; address_components: Array<{ long_name: string; types: string[] }> }> };
      if (data.status === "OK" && data.results.length > 0) {
        const r = data.results[0];
        const { lat, lng } = r.geometry.location;
        const cityComp = r.address_components.find(c => c.types.includes("locality")) ?? r.address_components.find(c => c.types.includes("administrative_area_level_1"));
        const city = cityComp?.long_name ?? r.formatted_address.split(",")[0].trim();
        const result = { lat, lng, city };
        geocodeCache.set(cacheKey, result);
        return result;
      }
    } catch { /* fall through */ }
  }

  // 3. Bright Data SERP → extract city → Photon
  if (BD_API_KEY) {
    try {
      const results = await bdSerp(`${name} company headquarters city`);
      const allText = results.slice(0, 5).map(r => `${r.title} ${r.snippet}`).join(" ");
      const cityName = extractCityFromText(allText);
      if (cityName) {
        const coords = await photonGeocodeCity(cityName);
        if (coords) {
          const result = { lat: coords.lat, lng: coords.lng, city: cityName };
          geocodeCache.set(cacheKey, result);
          return result;
        }
      }
    } catch { /* fall through */ }
  }

  const fallback = inferHqFromDomain(domain);
  geocodeCache.set(cacheKey, fallback);
  return fallback;
}
