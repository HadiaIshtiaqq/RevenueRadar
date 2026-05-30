import { SPEECHMATICS_API_KEY } from "./config.js";

const BASE = "https://asr.api.speechmatics.com/v2";

export function isSpeechmaticsReady(): boolean {
  return !!SPEECHMATICS_API_KEY;
}

// Submit a local audio buffer directly to Speechmatics (no public URL needed).
export async function submitTranscriptionJobFromBuffer(
  buffer: Buffer, filename: string, language = "en"
): Promise<string | null> {
  if (!SPEECHMATICS_API_KEY) return null;
  try {
    const formData = new FormData();
    formData.append("config", JSON.stringify({
      type: "transcription",
      transcription_config: { language, enable_entities: true, diarization: "speaker" },
    }));
    const ext = filename.split(".").pop()?.toLowerCase() ?? "mp3";
    const mime = ext === "wav" ? "audio/wav" : ext === "mp4" || ext === "m4a" ? "audio/mp4" : "audio/mpeg";
    formData.append("data_file", new Blob([buffer], { type: mime }), filename);
    const resp = await fetch(`${BASE}/jobs/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SPEECHMATICS_API_KEY}` },
      body: formData,
    });
    if (!resp.ok) { console.error(`[Speechmatics] Upload failed: ${resp.status}`); return null; }
    const data = await resp.json() as { id: string };
    return data.id ?? null;
  } catch (e) { console.error("[Speechmatics] Upload error:", e); return null; }
}

// Submit an audio URL for batch transcription. Returns the Speechmatics job ID.
export async function submitTranscriptionJob(audioUrl: string, language = "en"): Promise<string | null> {
  if (!SPEECHMATICS_API_KEY) return null;
  try {
    const formData = new FormData();
    formData.append("config", JSON.stringify({
      type: "transcription",
      transcription_config: { language, enable_entities: true, diarization: "speaker" },
      fetch_data: { url: audioUrl },
    }));
    const resp = await fetch(`${BASE}/jobs/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SPEECHMATICS_API_KEY}` },
      body: formData,
    });
    if (!resp.ok) {
      console.error(`[Speechmatics] Submit failed: ${resp.status}`);
      return null;
    }
    const data = await resp.json() as { id: string };
    return data.id ?? null;
  } catch (e) {
    console.error("[Speechmatics] Submit error:", e);
    return null;
  }
}

// Check job status: "running" | "done" | "rejected" | "deleted" | "expired"
export async function getJobStatus(jobId: string): Promise<{ status: string; created_at?: string } | null> {
  if (!SPEECHMATICS_API_KEY) return null;
  try {
    const resp = await fetch(`${BASE}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${SPEECHMATICS_API_KEY}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { job: { status: string; created_at?: string } };
    return data.job ?? null;
  } catch { return null; }
}

// Fetch the plain-text transcript for a completed job.
export async function getTranscript(jobId: string): Promise<string> {
  if (!SPEECHMATICS_API_KEY) return "";
  try {
    const resp = await fetch(`${BASE}/jobs/${jobId}/transcript?format=txt`, {
      headers: { Authorization: `Bearer ${SPEECHMATICS_API_KEY}` },
    });
    if (!resp.ok) return "";
    return resp.text();
  } catch { return ""; }
}

// Convenience: submit → poll (up to maxWaitMs) → return transcript.
// Use only for short audio (<2 min). For longer audio use submitTranscriptionJob + poll via endpoints.
export async function transcribeAudioSync(audioUrl: string, language = "en", maxWaitMs = 120_000): Promise<string> {
  const jobId = await submitTranscriptionJob(audioUrl, language);
  if (!jobId) return "";
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 5_000));
    const s = await getJobStatus(jobId);
    if (!s) break;
    if (s.status === "done")     return getTranscript(jobId);
    if (s.status === "rejected") return "";
  }
  return "";
}
