/**
 * backend/llm/providers/claudeProvider.ts
 * CrocAgentic Phase 4 — Anthropic Claude Provider.
 */

import { LLMResponse, LLMRequest } from "../llmRouter";

export async function callClaude(req: LLMRequest, apiKey: string): Promise<LLMResponse> {
  const startTime = Date.now();
  try {
    const body = {
      model:      req.model || "claude-haiku-4-5-20251001",
      max_tokens: req.maxTokens || 1024,
      system:     req.systemPrompt,
      messages:   [{ role: "user", content: req.userPrompt }],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeout || 30000),
    });

    if (!response.ok) {
      const err = await response.text();
      return { success: false, error: `Claude API error ${response.status}: ${err}`, durationMs: Date.now() - startTime };
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";

    return { success: true, rawText: text, durationMs: Date.now() - startTime };
  } catch (err) {
    return { success: false, error: (err as Error).message, durationMs: Date.now() - startTime };
  }
}
