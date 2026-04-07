/**
 * backend/llm/llmPrompts.ts
 * CrocAgentic Phase 12 — Hardened LLM Prompts.
 *
 * Enforces strict JSON output from any LLM.
 * Multiple extraction strategies for robustness.
 */

import type { Plan } from "../../utils/zodSchemas";

export const THINKER_SYSTEM_PROMPT = `You are a task planning agent. You MUST respond with ONLY a valid JSON object. No text before or after. No markdown. No explanation. No code fences. Just raw JSON.

REQUIRED FORMAT (copy this exactly, replace cmd values):
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["echo","task done"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

RULES:
- Output ONLY the JSON object above, nothing else
- cmd must use safe commands: echo, ls, find, cat, pwd, mkdir, touch, cp, mv, grep, head, tail, date, node, python
- cwd must be exactly "/workspace"
- requestedPermissions must contain at least one entry
- NEVER use rm, sudo, chmod, curl | bash, or any destructive commands
- Keep it to 1-3 steps maximum`;

export function buildThinkerPrompt(goal: string): string {
  return `Task: ${goal}

Respond with ONLY this JSON (no other text, no markdown, no explanation):
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["REPLACE_WITH_COMMAND","ARG"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

Choose appropriate cmd for the task. Output only JSON.`;
}

export function buildRetryPrompt(goal: string, error: string): string {
  return `Task: ${goal}
Error from last attempt: ${error}

You MUST output ONLY valid JSON. Nothing else. Example:
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["ls","-la"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

Output JSON now:`;
}

export function extractPlanFromResponse(raw: string): Plan | null {
  if (!raw || raw.trim().length === 0) return null;

  let text = raw.trim();

  // Strategy 1: Strip all markdown fences
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();

  // Strategy 2: Find outermost { }
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const slice  = text.slice(start, end + 1);
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      return autoFixPlan(parsed);
    } catch { /* try next */ }
  }

  // Strategy 3: Find any JSON-like structure with "steps" key
  const stepsMatch = text.match(/"steps"\s*:\s*(\[[\s\S]*?\])/);
  if (stepsMatch) {
    try {
      const steps = JSON.parse(stepsMatch[1]) as Array<Record<string, unknown>>;
      return autoFixPlan({ steps, requestedPermissions: ["READ_FILESYSTEM"] });
    } catch { /* try next */ }
  }

  // Strategy 4: Build a minimal plan from any command-like content
  const cmdMatch = text.match(/"cmd"\s*:\s*(\[[\s\S]*?\])/);
  if (cmdMatch) {
    try {
      const cmd = JSON.parse(cmdMatch[1]) as string[];
      return {
        steps: [{ stepId: 1, type: "RUN_COMMAND", cmd, cwd: "/workspace", timeout: 5000 }],
        requestedPermissions: ["READ_FILESYSTEM"],
      };
    } catch { /* give up */ }
  }

  return null;
}

// Auto-fix common LLM output issues
function autoFixPlan(parsed: Record<string, unknown>): Plan {
  // Fix missing requestedPermissions
  if (!parsed.requestedPermissions || !Array.isArray(parsed.requestedPermissions) ||
      (parsed.requestedPermissions as unknown[]).length === 0) {
    parsed.requestedPermissions = ["READ_FILESYSTEM"];
  }

  // Fix steps array
  if (!Array.isArray(parsed.steps) || (parsed.steps as unknown[]).length === 0) {
    parsed.steps = [{ stepId: 1, type: "RUN_COMMAND", cmd: ["ls", "-la"], cwd: "/workspace", timeout: 5000 }];
  }

  // Fix each step
  parsed.steps = (parsed.steps as Array<Record<string, unknown>>).map((step, i) => ({
    stepId:  step.stepId  ?? i + 1,
    type:    step.type    ?? "RUN_COMMAND",
    cmd:     Array.isArray(step.cmd) && step.cmd.length > 0 ? step.cmd : ["ls", "-la"],
    cwd:     typeof step.cwd === "string" ? step.cwd : "/workspace",
    timeout: typeof step.timeout === "number" ? step.timeout : 5000,
  }));

  return parsed as unknown as Plan;
}
