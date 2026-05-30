"""
Cognee memory server for RevenueRadarAI.
Runs on port 8001. Exposes /add, /search, /health endpoints.
LLM backend: Google Gemini (reuses GEMINI_API_KEY).
"""
import os, asyncio, json
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ── Configure cognee to use Gemini before importing cognee ──────────────────
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

os.environ.setdefault("LLM_API_KEY",          GEMINI_KEY)
os.environ.setdefault("LLM_PROVIDER",          "google")
os.environ.setdefault("LLM_MODEL",             "gemini/gemini-2.0-flash")
os.environ.setdefault("EMBEDDING_PROVIDER",    "google")
os.environ.setdefault("EMBEDDING_MODEL",       "models/text-embedding-004")
os.environ.setdefault("EMBEDDING_API_KEY",     GEMINI_KEY)
os.environ.setdefault("DB_PATH",               os.path.join(os.path.dirname(__file__), ".cognee_db"))

import cognee
from cognee.api.v1.search.search import search as cognee_search_fn

DATASET = "revenueradar"

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[Cognee] Server starting up...")
    try:
        await cognee.prune.prune_system(metadata=False)  # clear stale graph state
    except Exception:
        pass
    yield
    print("[Cognee] Server shutting down.")

app = FastAPI(title="Cognee Memory Server", lifespan=lifespan)

class AddRequest(BaseModel):
    text: str
    dataset: str = DATASET

class SearchRequest(BaseModel):
    query: str
    search_type: str = "GRAPH_COMPLETION"

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.1.0", "dataset": DATASET}

@app.post("/add")
async def add_memory(req: AddRequest):
    try:
        await cognee.add(req.text, req.dataset)
        await cognee.cognify()
        return {"status": "added"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search")
async def search_memory(req: SearchRequest):
    try:
        from cognee.api.v1.search.search import SearchType
        stype = getattr(SearchType, req.search_type, SearchType.GRAPH_COMPLETION)
        results = await cognee_search_fn(stype, {"query": req.query})
        texts = []
        for r in (results or []):
            if hasattr(r, "text"):
                texts.append(r.text)
            elif hasattr(r, "verbatim_text"):
                texts.append(r.verbatim_text)
            elif isinstance(r, dict):
                texts.append(r.get("text") or r.get("verbatim_text") or "")
            else:
                texts.append(str(r))
        return {"results": [t for t in texts if t]}
    except Exception as e:
        return {"results": [], "error": str(e)}

if __name__ == "__main__":
    port = int(os.environ.get("COGNEE_PORT", "8001"))
    print(f"[Cognee] Starting on port {port}  LLM={os.environ['LLM_MODEL']}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
