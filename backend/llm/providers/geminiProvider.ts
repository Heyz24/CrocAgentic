/**
 * backend/llm/providers/geminiProvider.ts
 * CrocAgentic Phase 4 — Google Gemini Provider.
 * Free tier: 15 RPM, 1M tokens/day — perfect for dev/testing.
 */

import { LLMResponse, LLMRequest } from "../llmRouter";

export async function callGemini(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const startTime = Date.now();
  try {
    const model = req.model || "gemini-2.0-flash";
    const url   = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      system_instruction: { parts: [{ text: req.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: req.userPrompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens  || 1024,
        temperature:     req.temperature ?? 0.2,
      },
    };

    const response = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(req.timeout || 30000),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Gemini API error ${response.status}: ${err}`, durationMs: Date.now() - startTime };
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return { success: true, rawText: text, durationMs: Date.now() - startTime };
  } catch (err) {
    return { success: false, error: (err as Error).message, durationMs: Date.now() - startTime };
  }
}
