/**
 * backend/setup/connectionTester.ts
 * CrocAgentic Phase 4 — LLM Connection Tester.
 *
 * Tests that an API key + model actually works before saving config.
 * Uses a minimal test prompt to verify connectivity.
 */

import type { LLMProvider } from "../config/configLoader";

export interface TestResult {
  success:    boolean;
  durationMs: number;
  error?:     string;
  model?:     string;
}

const TEST_PROMPT = "Reply with only the word: OK";

export async function testConnection(
  provider: LLMProvider,
  apiKey:   string,
  model:    string,
  ollamaHost = "http://localhost:11434"
): Promise<TestResult> {
  const start = Date.now();

  try {
    switch (provider) {
      case "gemini": {
        const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res  = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ contents: [{ role: "user", parts: [{ text: TEST_PROMPT }] }] }),
          signal:  AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: { message?: string } };
          return { success: false, durationMs: Date.now() - start, error: err.error?.message ?? `HTTP ${res.status}` };
        }
        return { success: true, durationMs: Date.now() - start, model };
      }

      case "openai": {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body:    JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: TEST_PROMPT }] }),
          signal:  AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: { message?: string } };
          return { success: false, durationMs: Date.now() - start, error: err.error?.message ?? `HTTP ${res.status}` };
        }
        return { success: true, durationMs: Date.now() - start, model };
      }

      case "claude": {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method:  "POST",
          headers: {
            "Content-Type":      "application/json",
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: "user", content: TEST_PROMPT }] }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const err = await res.json() as { error?: { message?: string } };
          return { success: false, durationMs: Date.now() - start, error: err.error?.message ?? `HTTP ${res.status}` };
        }
        return { success: true, durationMs: Date.now() - start, model };
      }

      case "ollama": {
        const res = await fetch(`${ollamaHost}/api/generate`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ model, prompt: TEST_PROMPT, stream: false, options: { num_predict: 5 } }),
          signal:  AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          return { success: false, durationMs: Date.now() - start, error: `Ollama error: HTTP ${res.status}` };
        }
        return { success: true, durationMs: Date.now() - start, model };
      }

      default:
        return { success: false, durationMs: 0, error: "Unknown provider" };
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      return { success: false, durationMs: Date.now() - start,
        error: provider === "ollama" ? "Ollama not running. Start with: ollama serve" : `Cannot reach ${provider} API` };
    }
    return { success: false, durationMs: Date.now() - start, error: msg };
  }
}
