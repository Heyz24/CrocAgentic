/**
 * backend/llm/llmPrompts.ts
 * CrocAgentic Phase 12 — Hardened LLM Prompts with Conversational Path.
 */

import type { Plan } from "../../utils/zodSchemas";

// Detect if goal is conversational (should answer directly, not plan a command)
export function isConversationalGoal(goal: string): boolean {
  const patterns = [
    /^(what|who|where|when|why|how|is|are|can|could|would|should|do|does|did)\s/i,
    /^(tell me|explain|describe|define|what is|what are|who is|who are)/i,
    /your (name|version|purpose|goal|role|identity|creator|made by)/i,
    /^(hi|hello|hey|greet|good\s*(morning|evening|afternoon|night))/i,
    /^(thanks|thank you|great|awesome|nice|good job)/i,
  ];
  return patterns.some((p) => p.test(goal.trim()));
}

export const THINKER_SYSTEM_PROMPT = `You are a task planning agent. Your ONLY job is to output a valid JSON execution plan.

CRITICAL: Output ONLY raw JSON. No markdown. No explanation. No text before or after. Just JSON.

EXACT FORMAT TO OUTPUT:
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["echo","your response here"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

RULES:
- Output ONLY the JSON object, nothing else
- For conversational questions (what is your name, explain X, etc): use cmd ["echo","your answer here"]  
- For file tasks: use cmd ["ls","-la"] or ["find",".","name","*.ext"]
- For date/time: use cmd ["date"]
- cwd must be "/workspace"
- requestedPermissions must have at least one entry
- NEVER use rm, sudo, chmod, or destructive commands
- Maximum 3 steps`;

export function buildThinkerPrompt(goal: string): string {
  const isConversational = isConversationalGoal(goal);

  if (isConversational) {
    return `Task: ${goal}

This is a conversational question. Answer it using an echo command.
Output ONLY this JSON (replace YOUR_ANSWER with your actual answer):
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["echo","YOUR_ANSWER"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

Example for "what is your name":
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["echo","I am CrocAgentic, a secure AI agent framework. My purpose is to execute tasks safely using any LLM you provide."],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

Output JSON now (no other text):`;
  }

  return `Task: ${goal}

Output ONLY valid JSON, no other text:
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["COMMAND","ARG"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

Choose the appropriate command for this task. Output JSON only:`;
}

export function buildRetryPrompt(goal: string, error: string): string {
  return `Task: ${goal}
Previous error: ${error}

Output ONLY this exact JSON format (replace values as needed):
{"steps":[{"stepId":1,"type":"RUN_COMMAND","cmd":["echo","response or ls -la for files"],"cwd":"/workspace","timeout":5000}],"requestedPermissions":["READ_FILESYSTEM"]}

JSON output only:`;
}

export function extractPlanFromResponse(raw: string): Plan | null {
  if (!raw?.trim()) return null;

  let text = raw.trim();

  // Strip markdown
  text = text.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/im, "").trim();

  // Strategy 1: Find outermost {}
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      return autoFixPlan(parsed);
    } catch { /* next */ }
  }

  // Strategy 2: Find "steps" array
  const stepsMatch = text.match(/"steps"\s*:\s*(\[[\s\S]*?\])/);
  if (stepsMatch) {
    try {
      const steps = JSON.parse(stepsMatch[1]) as Array<Record<string, unknown>>;
      return autoFixPlan({ steps, requestedPermissions: ["READ_FILESYSTEM"] });
    } catch { /* next */ }
  }

  // Strategy 3: Extract any echo/ls command
  const echoMatch = text.match(/["']echo["']\s*,\s*["']([^"']+)["']/);
  if (echoMatch) {
    return {
      steps: [{ stepId: 1, type: "RUN_COMMAND", cmd: ["echo", echoMatch[1]], cwd: "/workspace", timeout: 5000 }],
      requestedPermissions: ["READ_FILESYSTEM"],
    };
  }

  return null;
}

function autoFixPlan(parsed: Record<string, unknown>): Plan {
  if (!parsed.requestedPermissions || !Array.isArray(parsed.requestedPermissions) ||
      (parsed.requestedPermissions as unknown[]).length === 0) {
    parsed.requestedPermissions = ["READ_FILESYSTEM"];
  }

  if (!Array.isArray(parsed.steps) || (parsed.steps as unknown[]).length === 0) {
    parsed.steps = [{ stepId: 1, type: "RUN_COMMAND", cmd: ["ls", "-la"], cwd: "/workspace", timeout: 5000 }];
  }

  parsed.steps = (parsed.steps as Array<Record<string, unknown>>).map((step, i) => ({
    stepId:  step.stepId  ?? i + 1,
    type:    step.type    ?? "RUN_COMMAND",
    cmd:     Array.isArray(step.cmd) && step.cmd.length > 0 ? step.cmd : ["ls", "-la"],
    cwd:     typeof step.cwd === "string" ? step.cwd : "/workspace",
    timeout: typeof step.timeout === "number" ? step.timeout : 5000,
  }));

  return parsed as unknown as Plan;
}
