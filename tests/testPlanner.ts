/**
 * tests/testPlanner.ts
 * CrocAgentic — Planner Tests
 * Run with: ts-node tests/testPlanner.ts
 */

import { createPlan, buildTaskSession } from "../backend/planner";
import { TaskSessionSchema, PlanSchema } from "../utils/zodSchemas";

// ─── Minimal Test Framework ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         ${(err as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

function assertMatches(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new Error(`${label}: "${value}" does not match pattern ${pattern}`);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n🐊 CrocAgentic — Planner Tests\n");

// ── Output structure ────────────────────────────────────────────────────────
console.log("[ Output Structure ]");

test("createPlan returns an object with taskId and plan", () => {
  const result = createPlan("list files in workspace");
  assert(typeof result === "object" && result !== null, "Result is an object");
  assert("taskId" in result, "Result has taskId");
  assert("plan" in result, "Result has plan");
});

test("taskId is a valid UUID v4", () => {
  const { taskId } = createPlan("list files");
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assertMatches(taskId, uuidRegex, "taskId");
});

test("each call produces a unique taskId", () => {
  const a = createPlan("list files");
  const b = createPlan("list files");
  assert(a.taskId !== b.taskId, "Two calls should produce different task IDs");
});

test("plan conforms to PlanSchema (Zod validation)", () => {
  const { plan } = createPlan("show me all TypeScript files");
  const result = PlanSchema.safeParse(plan);
  if (!result.success) {
    throw new Error(
      "Plan failed Zod validation: " +
        result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
    );
  }
});

test("plan has at least one step", () => {
  const { plan } = createPlan("build the project");
  assert(plan.steps.length >= 1, "Plan must have at least one step");
});

test("all steps have required fields", () => {
  const { plan } = createPlan("run tests");
  for (const step of plan.steps) {
    assert(typeof step.stepId === "number", `stepId is a number`);
    assert(step.stepId >= 1, "stepId is >= 1");
    assert(["RUN_COMMAND", "READ_FILE", "WRITE_FILE", "HTTP_REQUEST"].includes(step.type),
      `step.type is valid: ${step.type}`);
    assert(Array.isArray(step.cmd) && step.cmd.length >= 1, "cmd is a non-empty array");
    assert(typeof step.cwd === "string" && step.cwd.length > 0, "cwd is a non-empty string");
    assert(typeof step.timeout === "number" && step.timeout > 0, "timeout is a positive number");
  }
});

test("step IDs are sequential starting from 1", () => {
  const { plan } = createPlan("install dependencies");
  plan.steps.forEach((step, i) => {
    assertEqual(step.stepId, i + 1, `stepId at index ${i}`);
  });
});

test("requestedPermissions is an array of strings", () => {
  const { plan } = createPlan("list files");
  assert(Array.isArray(plan.requestedPermissions), "requestedPermissions is an array");
  for (const perm of plan.requestedPermissions) {
    assert(typeof perm === "string", `Permission "${perm}" is a string`);
  }
});

// ── Goal classification ─────────────────────────────────────────────────────
console.log("\n[ Goal Classification ]");

test("'list files' goal produces ls command", () => {
  const { plan } = createPlan("list all files in the directory");
  const hasLs = plan.steps.some((s) => s.cmd[0] === "ls");
  assert(hasLs, "Expected ls command for list-files goal");
});

test("'run tests' goal produces npm test command", () => {
  const { plan } = createPlan("run the test suite");
  const hasNpmTest = plan.steps.some(
    (s) => s.cmd.includes("npm") && s.cmd.includes("test")
  );
  assert(hasNpmTest, "Expected npm test command for run-tests goal");
});

test("'build project' goal produces npm run build command", () => {
  const { plan } = createPlan("build the TypeScript project");
  const hasBuild = plan.steps.some(
    (s) => s.cmd.includes("npm") && s.cmd.includes("build")
  );
  assert(hasBuild, "Expected npm run build command for build goal");
});

test("'git status' goal produces git command", () => {
  const { plan } = createPlan("show me git status");
  const hasGit = plan.steps.some((s) => s.cmd[0] === "git");
  assert(hasGit, "Expected git command for git-status goal");
});

test("'install dependencies' goal produces npm install command", () => {
  const { plan } = createPlan("install npm dependencies");
  const hasInstall = plan.steps.some(
    (s) => s.cmd.includes("npm") && s.cmd.includes("install")
  );
  assert(hasInstall, "Expected npm install command");
});

test("unknown goal falls back to GENERIC plan with echo + ls", () => {
  const { plan } = createPlan("do something completely unrecognised xyz");
  assert(plan.steps.length >= 1, "GENERIC plan should have at least one step");
});

// ── buildTaskSession ────────────────────────────────────────────────────────
console.log("\n[ buildTaskSession Integration ]");

test("buildTaskSession returns a valid TaskSession", () => {
  const mockPolicy = { approved: true, riskScore: "LOW" as const, reason: "All clear" };
  const session = buildTaskSession("list files", mockPolicy);
  const result = TaskSessionSchema.safeParse(session);
  if (!result.success) {
    throw new Error(
      "TaskSession failed Zod validation: " +
        result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
    );
  }
});

test("buildTaskSession propagates policy result fields", () => {
  const mockPolicy = {
    approved: false,
    riskScore: "HIGH" as const,
    reason: "Command on denylist",
  };
  const session = buildTaskSession("rm -rf everything", mockPolicy);
  assertEqual(session.approval, false, "approval");
  assertEqual(session.riskScore, "HIGH", "riskScore");
  assertEqual(session.reason, "Command on denylist", "reason");
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────────`);
console.log(`Planner Tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n⚠️  Some tests failed.`);
  process.exit(1);
} else {
  console.log(`\n🎉 All planner tests passed!`);
}
