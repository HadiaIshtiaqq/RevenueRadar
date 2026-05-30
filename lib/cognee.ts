import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { GEMINI_API_KEY } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COGNEE_PORT = 8001;
const COGNEE_BASE = `http://localhost:${COGNEE_PORT}`;

let _ready = false;

export function isCogneeReady(): boolean { return _ready; }

export function startCogneeServer(): void {
  const script = path.join(__dirname, "..", "cognee_server.py");
  const env = { ...process.env, GEMINI_API_KEY: GEMINI_API_KEY ?? "", COGNEE_PORT: String(COGNEE_PORT) };
  // Windows: try "python" first, fall back to "py" (Windows launcher)
  const pythonCmd = process.platform === "win32" ? "python" : "python3";
  const proc = spawn(pythonCmd, [script], { env, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });

  proc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[Cognee] ${d}`));
  proc.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString();
    if (!msg.includes("INFO") && !msg.includes("WARNING")) process.stderr.write(`[Cognee] ${msg}`);
  });
  proc.on("exit", (code) => {
    _ready = false;
    if (code !== 0) {
      console.warn(`[Cognee] Process exited (${code}). Memory layer offline. Ensure Python + cognee are installed: pip install cognee fastapi uvicorn`);
    }
  });
  proc.on("error", (e) => {
    console.warn(`[Cognee] Failed to start: ${e.message}. Install with: pip install cognee fastapi uvicorn`);
  });

  let attempts = 0;
  const poll = setInterval(async () => {
    try {
      const r = await fetch(`${COGNEE_BASE}/health`);
      if (r.ok) {
        _ready = true;
        clearInterval(poll);
        console.log("[Cognee] Memory layer ready ✓");
      }
    } catch { /* still starting */ }
    if (++attempts > 60) {
      clearInterval(poll);
      console.warn("[Cognee] Did not start within 30 s — running without memory layer");
    }
  }, 500);
}

export async function cogneeAdd(text: string): Promise<void> {
  if (!_ready) return;
  try {
    await fetch(`${COGNEE_BASE}/add`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch { /* silent — non-fatal */ }
}

export async function cogneeSearch(query: string): Promise<string> {
  if (!_ready) return "";
  try {
    const res = await fetch(`${COGNEE_BASE}/search`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, search_type: "GRAPH_COMPLETION" }),
    });
    if (!res.ok) return "";
    const data = await res.json() as { results?: string[] };
    return (data.results ?? []).filter(Boolean).join("\n\n").slice(0, 2000);
  } catch { return ""; }
}
