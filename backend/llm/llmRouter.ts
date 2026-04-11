/**
 * backend/llm/llmRouter.ts
 * CrocAgentic Phase 4 — LLM Router.
 *
 * Central router that picks the right provider based on config.
 * Handles retry logic (Q4: retry once → fallback to deterministic).
 * All providers go through here.
 */

import { loadConfig, getApiKey, LLMProvider } from "../config/configLoader";
import { callClaude }  from "./providers/claudeProvider";
import { callOpenAI }  from "./providers/openaiProvider";
import { callGemini }  from "./providers/geminiProvider";
import { callOllama }  from "./providers/ollamaProvider";
import { routeTaskToModel, reloadModelConfig } from "./routing/modelRouter";
import { validateLLMOutput, ValidationResult } from "./llmOutputValidator";
import {
  THINKER_SYSTEM_PROMPT,
  buildThinkerPrompt,
  buildRetryPrompt,
} from "./llmPrompts";
import type { Plan } from "../../utils/zodSchemas";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LLMRequest {
  systemPrompt: string;
  userPrompt:   string;
  model?:       string;
  maxTokens?:   number;
  temperature?: number;
  timeout?:     number;
}

export interface LLMResponse {
  success:    boolean;
  rawText?:   string;
  error?:     string;
  durationMs: number;
}

export interface RouterResult {
  plan:         Plan;
  usedLLM:      boolean;
  provider:     LLMProvider | "deterministic";
  model:        string;
  durationMs:   number;
  fallback:     boolean;
  fallbackReason?: string;
  warnings:     string[];
}

// ─── Raw LLM Call ──────────────────────────────────────────────────────────────

async function callProvider(req: LLMRequest): Promise<LLMResponse> {
  const config = loadConfig();
  const { provider, ollamaHost } = config.llm;

  switch (provider) {
    case "claude": {
      const key = getApiKey("claude");
      if (!key) return { success: false, error: "ANTHROPIC_API_KEY not set", durationMs: 0 };
      return callClaude(req, key);
    }
    case "openai": {
      const key = getApiKey("openai");
      if (!key) return { success: false, error: "OPENAI_API_KEY not set", durationMs: 0 };
      return callOpenAI(req, key);
    }
    case "gemini": {
      const key = getApiKey("gemini");
      if (!key) return { success: false, error: "GEMINI_API_KEY not set", durationMs: 0 };
      return callGemini(req, key);
    }
    case "ollama": {
      return callOllama(req, ollamaHost || "http://localhost:11434");
    }
    default:
      return { success: false, error: "No LLM provider configured", durationMs: 0 };
  }
}

// ─── Main Router ───────────────────────────────────────────────────────────────

// Re-export for convenience
export { reloadModelConfig } from "./routing/modelRouter";

export async function routeLLMRequest(
  goal:              string,
  deterministicPlan: Plan  // fallback plan from existing planner
): Promise<RouterResult> {
  const config   = loadConfig();
  const start    = Date.now();
  const warnings: string[] = [];

  // If no LLM configured — use deterministic immediately
  if (!config.setupDone || config.llm.provider === "none") {
    return {
      plan:      deterministicPlan,
      usedLLM:   false,
      provider:  "deterministic",
      model:     "deterministic-planner",
      durationMs: Date.now() - start,
      fallback:  false,
      warnings,
    };
  }

  const req: LLMRequest = {
    systemPrompt: THINKER_SYSTEM_PROMPT,
    userPrompt:   buildThinkerPrompt(goal),
    model:        config.llm.model,
    maxTokens:    config.llm.maxTokens,
    temperature:  config.llm.temperature,
    timeout:      config.llm.timeout,
  };

  // ── Attempt 1 ───────────────────────────────────────────────────────────────
  const attempt1 = await callProvider(req);

  if (attempt1.success && attempt1.rawText) {
    const validated = validateLLMOutput(attempt1.rawText);
    if (validated.valid && validated.plan) {
      warnings.push(...validated.warnings);
      return {
        plan:      validated.plan,
        usedLLM:   true,
        provider:  config.llm.provider,
        model:     config.llm.model,
        durationMs: Date.now() - start,
        fallback:  false,
        warnings,
      };
    }

    // ── Attempt 2 — retry with stricter prompt ─────────────────────────────
    console.warn(`[LLMRouter] Attempt 1 failed validation: ${validated.error}. Retrying...`);
    warnings.push(`First LLM attempt invalid: ${validated.error}`);

    const retryReq: LLMRequest = {
      ...req,
      userPrompt: buildRetryPrompt(goal, validated.error ?? "Invalid JSON"),
    };

    const attempt2 = await callProvider(retryReq);

    if (attempt2.success && attempt2.rawText) {
      const validated2 = validateLLMOutput(attempt2.rawText);
      if (validated2.valid && validated2.plan) {
        warnings.push(...validated2.warnings);
        return {
          plan:      validated2.plan,
          usedLLM:   true,
          provider:  config.llm.provider,
          model:     config.llm.model,
          durationMs: Date.now() - start,
          fallback:  false,
          warnings,
        };
      }
      warnings.push(`Second LLM attempt also invalid: ${validated2.error}`);
    } else {
      warnings.push(`Second LLM attempt failed: ${attempt2.error}`);
    }
  } else {
    warnings.push(`LLM call failed: ${attempt1.error}`);
  }

  // ── Fallback to deterministic planner ─────────────────────────────────────
  const fallbackReason = warnings[warnings.length - 1] ?? "LLM unavailable";
  console.warn(`[LLMRouter] Falling back to deterministic planner. Reason: ${fallbackReason}`);

  return {
    plan:           deterministicPlan,
    usedLLM:        false,
    provider:       "deterministic",
    model:          "deterministic-planner",
    durationMs:     Date.now() - start,
    fallback:       true,
    fallbackReason,
    warnings,
  };
}
