/**
 * backend/llm/llmOutputValidator.ts
 * CrocAgentic Phase 4 — LLM Output Validator.
 * Updated with additional injection patterns from real-world leaks.
 */

import { PlanSchema } from "../../utils/zodSchemas";
import type { Plan } from "../../utils/zodSchemas";
import { extractPlanFromResponse } from "./llmPrompts";

const LLM_OUTPUT_DANGER_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  // Classic prompt injection
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,   description: "Prompt injection in LLM output" },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above)/i,                description: "Disregard injection in LLM output" },
  { pattern: /you\s+are\s+now\s+(a\s+)?(different|new|another|evil)/i,      description: "Role override in LLM output" },
  { pattern: /your\s+(new\s+)?instructions?\s+(are|is)\s*:/i,               description: "Instruction injection in LLM output" },
  // LLM control tokens (from system_prompts_leaks research)
  { pattern: /\[INST\]|\[\/INST\]/,                                          description: "LLaMA control token injection" },
  { pattern: /<\|system\|>|<\|user\|>|<\|assistant\|>|<\|im_start\|>/,     description: "Chat template token injection" },
  { pattern: /<<SYS>>|<\/SYS>/,                                              description: "System tag injection" },
  { pattern: /Human:\s|Assistant:\s/,                                        description: "Anthropic format injection" },
  // Shell injections
  { pattern: /;\s*(rm|sudo|chmod|curl|wget|bash|sh|python|node)\b/i,        description: "Shell command injection in LLM output" },
  { pattern: /\$\([^)]*\)/,                                                  description: "Command substitution in LLM output" },
  { pattern: /`[^`]+`/,                                                       description: "Backtick injection in LLM output" },
  { pattern: /\|\s*(bash|sh|python|node|exec)/i,                             description: "Pipe to shell injection" },
  // Sensitive file access
  { pattern: /\/etc\/(passwd|shadow|sudoers)/i,                              description: "Sensitive file access in LLM output" },
  // Destructive commands
  { pattern: /(rm|rmdir)\s+-rf?\s+\//i,                                      description: "Destructive rm in LLM output" },
  { pattern: /eval\s*\(/i,                                                    description: "Eval injection in LLM output" },
  { pattern: /process\.env\.[A-Z_]{3,}/,                                     description: "Env var access in LLM output" },
];

export interface ValidationResult {
  valid:      boolean;
  plan?:      Plan;
  error?:     string;
  warnings:   string[];
  rawOutput:  string;
}

export function validateLLMOutput(rawOutput: string): ValidationResult {
  const warnings: string[] = [];

  // ── Layer 1: Injection scan on raw text ──────────────────────────────────
  for (const { pattern, description } of LLM_OUTPUT_DANGER_PATTERNS) {
    if (pattern.test(rawOutput)) {
      return {
        valid:     false,
        error:     `LLM output failed security scan: ${description}`,
        warnings,
        rawOutput,
      };
    }
  }

  // ── Layer 2: Extract JSON ─────────────────────────────────────────────────
  const extracted = extractPlanFromResponse(rawOutput);
  if (!extracted) {
    return {
      valid:     false,
      error:     "LLM output did not contain valid JSON",
      warnings,
      rawOutput,
    };
  }

  // ── Layer 3: Zod schema validation ───────────────────────────────────────
  const zodResult = PlanSchema.safeParse(extracted);
  if (!zodResult.success) {
    const issues = zodResult.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    return {
      valid:     false,
      error:     `LLM plan failed schema validation: ${issues}`,
      warnings,
      rawOutput,
    };
  }

  // ── Layer 4: Sanity checks ────────────────────────────────────────────────
  const plan = zodResult.data;
  const BLOCKED = ["rm", "rmdir", "sudo", "su", "chmod", "chown", "dd", "mkfs", "shutdown"];

  for (const step of plan.steps) {
    if (BLOCKED.includes(step.cmd[0]?.toLowerCase() ?? "")) {
      return {
        valid:     false,
        error:     `LLM attempted to use blocked command: ${step.cmd[0]}`,
        warnings,
        rawOutput,
      };
    }
    if (!step.cwd.startsWith("/workspace")) {
      warnings.push(`Step ${step.stepId} uses non-workspace cwd: ${step.cwd}`);
    }
  }

  return { valid: true, plan, warnings, rawOutput };
}
