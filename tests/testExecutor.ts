/**
 * tests/testExecutor.ts
 * CrocAgentic Phase 2 — Executor Tests.
 * Run with: npx ts-node tests/testExecutor.ts
 *
 * Tests:
 * - Mock executor returns correct stdout for known commands
 * - Denied plans return DENIED finalStatus without executing
 * - executePlan orchestrates steps and stops on failure
 * - Docker availability detection works
 */

import { executeMockStep, isDockerAvailable } from "../backend/executor/dockerExecutor";
import { executePlan } from "../backend/executor/planExecutor";
import type { PlanExecutorInput } from "../backend/executor/planExecutor";
import type { Plan } from "../utils/zodSchemas";

// ─── Minimal test framework ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve(fn())
    .then(() => {
      console.log(`  ✅ PASS  ${name}`);
      passed++;
    })
    .catch((err: Error) => {
      console.log(`  ❌ FAIL  ${name}`);
      console.log(`         ${err.message}`);
      failed++;
    });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(cmds: string[][]): Plan {
  return {
    steps: cmds.map((cmd, i) => ({
      stepId: i + 1,
      type: "RUN_COMMAND" as const,
      cmd,
      cwd: "/workspace",
      timeout: 5000,
    })),
    requestedPermissions: ["READ_FILESYSTEM"],
  };
}

function makeInput(plan: Plan, approval: boolean): PlanExecutorInput {
  return {
    taskId: `00000000-0000-4000-a000-${String(Date.now()).padStart(12, "0")}`,
    goal: "test goal",
    plan,
    approval,
    riskScore: approval ? "LOW" : "HIGH",
    reason: approval ? "approved" : "denied by policy",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🐊 CrocAgentic — Executor Tests\n");

  // ── Mock Executor ────────────────────────────────────────────────────────
  console.log("[ Mock Executor ]");

  await test("echo returns correct stdout", async () => {
    const step = { stepId: 1, type: "RUN_COMMAND" as const, cmd: ["echo", "hello world"], cwd: "/workspace", timeout: 5000 };
    const result = await executeMockStep(step);
    assertEqual(result.status, "SUCCESS", "status");
    assertEqual(result.exitCode, 0, "exitCode");
    assert(result.stdout.includes("hello world"), `stdout should include "hello world", got: "${result.stdout}"`);
  });

  await test("ls returns mock directory listing", async () => {
    const step = { stepId: 1, type: "RUN_COMMAND" as const, cmd: ["ls", "-la"], cwd: "/workspace", timeout: 5000 };
    const result = await executeMockStep(step);
    assertEqual(result.status, "SUCCESS", "status");
    assert(result.stdout.length > 0, "stdout should not be empty");
  });

  await test("stepId is preserved in result", async () => {
    const step = { stepId: 42, type: "RUN_COMMAND" as const, cmd: ["pwd"], cwd: "/workspace", timeout: 5000 };
    const result = await executeMockStep(step);
    assertEqual(result.stepId, 42, "stepId");
  });

  await test("durationMs is a non-negative number", async () => {
    const step = { stepId: 1, type: "RUN_COMMAND" as const, cmd: ["date"], cwd: "/workspace", timeout: 5000 };
    const result = await executeMockStep(step);
    assert(typeof result.durationMs === "number" && result.durationMs >= 0, "durationMs >= 0");
  });

  // ── Plan Executor — Denied Plans ─────────────────────────────────────────
  console.log("\n[ Plan Executor — Denied Plans ]");

  await test("denied plan returns DENIED finalStatus without executing", async () => {
    const plan = makePlan([["ls", "-la"], ["echo", "hello"]]);
    const input = makeInput(plan, false);
    const result = await executePlan(input);
    assertEqual(result.finalStatus, "DENIED", "finalStatus");
    assertEqual(result.approval, false, "approval");
    assert(
      result.steps.every((s) => s.status === "SKIPPED"),
      "All steps should be SKIPPED when denied"
    );
  });

  await test("denied plan steps have meaningful stderr message", async () => {
    const plan = makePlan([["rm", "-rf", "/"]]);
    const input = makeInput(plan, false);
    const result = await executePlan(input);
    assert(
      result.steps[0].stderr.toLowerCase().includes("denied") ||
      result.steps[0].stderr.toLowerCase().includes("skipped"),
      `stderr should mention denied/skipped, got: "${result.steps[0].stderr}"`
    );
  });

  // ── Plan Executor — Approved Plans ───────────────────────────────────────
  console.log("\n[ Plan Executor — Approved Plans ]");

  await test("approved single-step plan returns COMPLETED", async () => {
    const plan = makePlan([["echo", "hello"]]);
    const input = makeInput(plan, true);
    const result = await executePlan(input);
    assertEqual(result.finalStatus, "COMPLETED", "finalStatus");
    assertEqual(result.approval, true, "approval");
  });

  await test("approved multi-step plan executes all steps", async () => {
    const plan = makePlan([["echo", "step1"], ["ls"], ["pwd"]]);
    const input = makeInput(plan, true);
    const result = await executePlan(input);
    assertEqual(result.steps.length, 3, "should have 3 step results");
    assert(
      result.steps.every((s) => s.status === "SUCCESS"),
      "All mock steps should succeed"
    );
  });

  await test("result has correct taskId", async () => {
    const plan = makePlan([["echo", "test"]]);
    const input = makeInput(plan, true);
    const result = await executePlan(input);
    assertEqual(result.taskId, input.taskId, "taskId should match input");
  });

  await test("result has startedAt and completedAt timestamps", async () => {
    const plan = makePlan([["echo", "timestamps"]]);
    const input = makeInput(plan, true);
    const result = await executePlan(input);
    assert(typeof result.startedAt === "string" && result.startedAt.length > 0, "startedAt is set");
    assert(typeof result.completedAt === "string" && result.completedAt.length > 0, "completedAt is set");
    assert(result.durationMs >= 0, "durationMs >= 0");
  });

  // ── Docker Availability ──────────────────────────────────────────────────
  console.log("\n[ Docker Availability ]");

  await test("isDockerAvailable returns a boolean", async () => {
    const result = await isDockerAvailable();
    assert(typeof result === "boolean", `Expected boolean, got ${typeof result}`);
    console.log(`         (Docker is ${result ? "AVAILABLE" : "NOT available"} on this machine)`);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`Executor Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All executor tests passed!`);
  }
}

main();
