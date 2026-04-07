/**
 * backend/llm/providers/openaiProvider.ts
 * CrocAgentic Phase 4 — OpenAI Provider.
 */

import { LLMResponse, LLMRequest } from "../llmRouter";

export async function callOpenAI(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const startTime = Date.now();
  try {
    const body = {
      model:       req.model || "gpt-4o-mini",
      max_tokens:  req.maxTokens || 1024,
      temperature: req.temperature ?? 0.2,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user",   content: req.userPrompt   },
      ],
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(req.timeout || 30000),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `OpenAI API error ${response.status}: ${err}`, durationMs: Date.now() - startTime };
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content ?? "";

    return { success: true, rawText: text, durationMs: Date.now() - startTime };
  } catch (err) {
    return { success: false, error: (err as Error).message, durationMs: Date.now() - startTime };
  }
}
