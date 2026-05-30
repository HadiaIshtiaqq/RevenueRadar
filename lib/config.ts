import dotenv from "dotenv";
dotenv.config();

// Mutable: can be overridden at runtime via /api/config/keys without server restart
export let AIML_API_KEY          = process.env.AIML_API_KEY            ?? "";
export let BD_API_KEY            = process.env.BRIGHTDATA_API_KEY       ?? "";
export let SPEECHMATICS_API_KEY  = process.env.SPEECHMATICS_API_KEY     ?? "";
export let TRIGGERWARE_API_KEY   = process.env.TRIGGERWARE_API_KEY       ?? "";

// Fixed at startup
export const AIML_MODEL       = process.env.AIML_MODEL       || "gpt-4o-mini";
export const AIML_BASE_URL    = "https://api.aimlapi.com/v1";
export const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;  // forwarded to Cognee Python sidecar
export const BD_SERP_ZONE     = process.env.BRIGHTDATA_SERP_ZONE    || "serp_api1";
export const BD_UNLOCKER_ZONE = process.env.BRIGHTDATA_UNLOCKER_ZONE || "mcp_unlocker";
export const BD_BROWSER_ZONE  = process.env.BRIGHTDATA_BROWSER_ZONE  || "";
export const BD_MCP_URL       = process.env.BRIGHTDATA_MCP_URL;
export const SLACK_WEBHOOK    = process.env.SLACK_WEBHOOK_URL;
export const SERPAPI_KEY      = process.env.SERPAPI_KEY;
export const MAPS_GEO_KEY     = process.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
export const PORT             = Number(process.env.PORT) || 3000;

export function updateRuntimeConfig(overrides: {
  AIML_API_KEY?: string;
  BD_API_KEY?: string;
  SPEECHMATICS_API_KEY?: string;
  TRIGGERWARE_API_KEY?: string;
}) {
  if (overrides.AIML_API_KEY)         AIML_API_KEY         = overrides.AIML_API_KEY;
  if (overrides.BD_API_KEY)           BD_API_KEY           = overrides.BD_API_KEY;
  if (overrides.SPEECHMATICS_API_KEY) SPEECHMATICS_API_KEY = overrides.SPEECHMATICS_API_KEY;
  if (overrides.TRIGGERWARE_API_KEY)  TRIGGERWARE_API_KEY  = overrides.TRIGGERWARE_API_KEY;
}
