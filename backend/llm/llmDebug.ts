/**
 * backend/llm/llmDebug.ts
 * Temporary debug helper — calls LLM and returns raw response.
 * Remove after debugging is done.
 */

import { loadConfig, getApiKey } from "../config/configLoader";
import { THINKER_SYSTEM_PROMPT, buildThinkerPrompt, extractPlanFromResponse } from "./llmPrompts";
import { validateLLMOutput } from "./llmOutputValidator";

export async function debugLLMCall(goal: string): Promise<{
  provider:    string;
  model:       string;
  rawResponse: string;
  extracted:   unknown;
  validated:   unknown;
  error?:      string;
}> {
  const config = loadConfig();
  const { provider, model, ollamaHost, timeout } = config.llm;

  let rawResponse = "";
  let error: string | undefined;

  try {
    if (provider === "gemini") {
      const key = getApiKey("gemini");
      if (!key) throw new Error("GEMINI_API_KEY not set");

      const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const body = {
        system_instruction: { parts: [{ text: THINKER_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildThinkerPrompt(goal) }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
      };

      const res  = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(timeout || 30000),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini API ${res.status}: ${err}`);
      }

      const data = await res.json() as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      };
      rawResponse = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else if (provider === "ollama") {
      const res = await fetch(`${ollamaHost}/api/generate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          model,
          prompt: `${THINKER_SYSTEM_PROMPT}\n\n${buildThinkerPrompt(goal)}`,
          stream: false,
          options: { temperature: 0.2, num_predict: 1024 },
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json() as { response: string };
      rawResponse = data.response ?? "";
    } else {
      throw new Error(`Provider ${provider} debug not implemented`);
    }
  } catch (err) {
    error = (err as Error).message;
  }

  const extracted  = rawResponse ? extractPlanFromResponse(rawResponse) : null;
  const validation = rawResponse ? validateLLMOutput(rawResponse) : null;

  return { provider, model, rawResponse, extracted, validated: validation, error };
}
