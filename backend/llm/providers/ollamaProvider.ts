/**
 * backend/llm/providers/ollamaProvider.ts
 * CrocAgentic Phase 4 — Ollama Local Provider.
 * Free, no API key needed. Needs Ollama installed and model pulled.
 * Recommended for Ryzen 5700U 16GB: phi3:mini (~2.5GB RAM)
 */

import { LLMResponse, LLMRequest } from "../llmRouter";

export async function callOllama(req: LLMRequest, host = "http://localhost:11434"): Promise<LLMResponse> {
  const startTime = Date.now();
  try {
    const model = req.model || "phi3:mini";

    // Use /api/generate with system + prompt combined
    const body = {
      model,
      prompt: `${req.systemPrompt}\n\n${req.userPrompt}`,
      stream: false,
      options: {
        temperature: req.temperature ?? 0.2,
        num_predict: req.maxTokens  || 1024,
      },
    };

    const response = await fetch(`${host}/api/generate`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(req.timeout || 60000), // local can be slower
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Ollama error ${response.status}: ${err}`, durationMs: Date.now() - startTime };
    }

    const data = await response.json() as { response: string };
    const text = data.response ?? "";

    return { success: true, rawText: text, durationMs: Date.now() - startTime };
  } catch (err) {
    const msg = (err as Error).message;
    // Give a helpful message if Ollama isn't running
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      return {
        success: false,
        error:   "Ollama is not running. Start it with: ollama serve",
        durationMs: Date.now() - startTime,
      };
    }
    return { success: false, error: msg, durationMs: Date.now() - startTime };
  }
}

export async function isOllamaRunning(host = "http://localhost:11434"): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(host = "http://localhost:11434"): Promise<string[]> {
  try {
    const res  = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models?.map((m) => m.name) ?? [];
  } catch {
    return [];
  }
}
