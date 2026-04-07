/**
 * backend/planner.ts
 * CrocAgentic Dummy Planner — Phase 1 + Phase 2.
 * Maps a natural-language goal to a structured JSON plan.
 */

import { v4 as uuidv4 } from "uuid";
import type { TaskSession, Plan, PlanStep } from "../utils/zodSchemas";

// ─── Goal Classification ───────────────────────────────────────────────────────

type GoalCategory =
  | "LIST_FILES"
  | "READ_FILE"
  | "CREATE_FILE"
  | "SEARCH"
  | "RUN_TESTS"
  | "BUILD_PROJECT"
  | "GIT_STATUS"
  | "INSTALL_DEPS"
  | "GENERIC";

const GOAL_PATTERNS: Array<{ pattern: RegExp; category: GoalCategory }> = [
  { pattern: /\b(list|show|display)\b.*\bfiles?\b/i,                              category: "LIST_FILES"    },
  { pattern: /\b(read|open|show|cat|print)\b.*\bfile\b/i,                         category: "READ_FILE"     },
  { pattern: /\b(create|make|write|generate)\b.*\bfile\b/i,                       category: "CREATE_FILE"   },
  { pattern: /\b(search|find|grep|look\s+for)\b/i,                                category: "SEARCH"        },
  { pattern: /\b(run|execute|launch)\b.*\btest[s]?\b/i,                            category: "RUN_TESTS"     },
  { pattern: /\b(build|compile|transpile)\b/i,                                     category: "BUILD_PROJECT" },
  { pattern: /\b(git|status|diff|commit|branch)\b/i,                              category: "GIT_STATUS"    },
  // Broader install pattern — matches "install npm deps", "install packages", "add dependencies", etc.
  { pattern: /\b(install|add|download)\b.*\b(npm|dep[s]?|package[s]?|module[s]?|dependencies|lib[s]?)\b/i, category: "INSTALL_DEPS" },
  { pattern: /\bnpm\s+install\b/i,                                                 category: "INSTALL_DEPS"  },
];

function classifyGoal(goal: string): GoalCategory {
  for (const { pattern, category } of GOAL_PATTERNS) {
    if (pattern.test(goal)) return category;
  }
  return "GENERIC";
}

// ─── Step Templates ────────────────────────────────────────────────────────────

const PLAN_TEMPLATES: Record<
  GoalCategory,
  { steps: Array<Omit<PlanStep, "stepId">>; permissions: string[] }
> = {
  LIST_FILES: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["ls", "-la"], cwd: "/workspace", timeout: 5000 },
    ],
    permissions: ["READ_FILESYSTEM"],
  },

  READ_FILE: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["find", "/workspace", "-type", "f", "-name", "*.ts"], cwd: "/workspace", timeout: 5000 },
      { type: "RUN_COMMAND", cmd: ["cat", "/workspace/src/index.ts"], cwd: "/workspace", timeout: 5000 },
    ],
    permissions: ["READ_FILESYSTEM"],
  },

  CREATE_FILE: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["mkdir", "-p", "/workspace/output"], cwd: "/workspace", timeout: 5000 },
      { type: "RUN_COMMAND", cmd: ["touch", "/workspace/output/result.txt"], cwd: "/workspace/output", timeout: 5000 },
    ],
    permissions: ["READ_FILESYSTEM", "WRITE_FILESYSTEM"],
  },

  SEARCH: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["grep", "-r", "--include=*.ts", "TODO", "/workspace/src"], cwd: "/workspace", timeout: 10000 },
    ],
    permissions: ["READ_FILESYSTEM"],
  },

  RUN_TESTS: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["npm", "test", "--", "--passWithNoTests"], cwd: "/workspace", timeout: 60000 },
    ],
    permissions: ["READ_FILESYSTEM", "EXECUTE_COMMAND", "PROCESS_SPAWN"],
  },

  BUILD_PROJECT: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["npm", "run", "build"], cwd: "/workspace", timeout: 60000 },
    ],
    permissions: ["READ_FILESYSTEM", "WRITE_FILESYSTEM", "EXECUTE_COMMAND", "PROCESS_SPAWN"],
  },

  GIT_STATUS: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["git", "status", "--short"], cwd: "/workspace", timeout: 5000 },
      { type: "RUN_COMMAND", cmd: ["git", "log", "--oneline", "-10"], cwd: "/workspace", timeout: 5000 },
    ],
    permissions: ["READ_FILESYSTEM"],
  },

  INSTALL_DEPS: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["npm", "install", "--prefer-offline"], cwd: "/workspace", timeout: 120000 },
    ],
    permissions: ["READ_FILESYSTEM", "WRITE_FILESYSTEM", "EXECUTE_COMMAND", "PROCESS_SPAWN", "NETWORK_ACCESS"],
  },

  GENERIC: {
    steps: [
      { type: "RUN_COMMAND", cmd: ["echo", "Goal registered. No specific plan template matched."], cwd: "/workspace", timeout: 5000 },
      { type: "RUN_COMMAND", cmd: ["ls", "-la", "/workspace"], cwd: "/workspace", timeout: 5000 },
    ],
    permissions: ["READ_FILESYSTEM"],
  },
};

// ─── Main Planner Function ─────────────────────────────────────────────────────

export function createPlan(goal: string): { taskId: string; plan: Plan } {
  const category = classifyGoal(goal);
  const template  = PLAN_TEMPLATES[category];

  const steps: PlanStep[] = template.steps.map((s, i) => ({ ...s, stepId: i + 1 }));
  const plan: Plan = { steps, requestedPermissions: template.permissions };

  return { taskId: uuidv4(), plan };
}

export function buildTaskSession(
  goal: string,
  policyResult: { approved: boolean; riskScore: "LOW" | "MEDIUM" | "HIGH"; reason: string }
): TaskSession {
  const { taskId, plan } = createPlan(goal);
  return {
    taskId,
    plan,
    approval:  policyResult.approved,
    riskScore: policyResult.riskScore,
    reason:    policyResult.reason,
  };
}
