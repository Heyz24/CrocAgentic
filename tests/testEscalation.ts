/**
 * tests/testEscalation.ts
 * CrocAgentic Phase 8 — Escalation System Tests.
 * Run with: npx ts-node tests/testEscalation.ts
 */

import {
  createEscalation, getEscalation, getPendingEscalations,
  resolveEscalation, expireOldEscalations, getEscalationStats,
} from "../backend/escalation/escalationStore";
import { escalationAgent } from "../backend/agents/escalationAgent";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         ${(err as Error).message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a !== b) throw new Error(`${label}: expected "${String(b)}", got "${String(a)}"`);
}

const SAMPLE_EVIDENCE = {
  goal:             "delete all temporary files",
  planSteps:        [{ stepId: 1, cmd: ["rm", "-rf", "/workspace/tmp"], cwd: "/workspace", type: "RUN_COMMAND", timeout: 5000 }],
  executedSteps:    [],
  whyEscalating:   "Destructive action detected — rm command requires approval",
  whatIsNeeded:    "Approval to delete /workspace/tmp directory",
  confidenceScore: 85,
  riskAssessment:  "HIGH risk — irreversible file deletion",
  suggestedActions: ["APPROVE — proceed with deletion", "REJECT — cancel task"],
};

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 8 Escalation Tests\n");

  // ── Escalation Store ───────────────────────────────────────────────────────
  console.log("[ Escalation Store ]");

  await test("creates escalation with correct fields", () => {
    const esc = createEscalation({
      taskId:   "task-test-001",
      trigger:  "DESTRUCTIVE_ACTION",
      risk:     "HIGH",
      evidence: SAMPLE_EVIDENCE,
    });
    assert(esc.id.length > 0,               "Should have id");
    assert(esc.status === "PENDING",         "Should be PENDING");
    assert(esc.taskId === "task-test-001",   "Should have taskId");
    assert(esc.approvalToken !== undefined,  "HIGH risk should have token");
    assert(esc.approvalToken!.length >= 32,  "Token should be at least 32 chars");
    assert(esc.expiresAt > esc.createdAt,   "Should expire after creation");
  });

  await test("MEDIUM risk escalation has no token", () => {
    const esc = createEscalation({
      taskId:   "task-test-002",
      trigger:  "LOW_CONFIDENCE",
      risk:     "MEDIUM",
      evidence: { ...SAMPLE_EVIDENCE, riskAssessment: "MEDIUM risk" },
    });
    assert(esc.approvalToken === undefined, "MEDIUM risk should NOT have token");
  });

  await test("retrieves escalation by id", () => {
    const esc  = createEscalation({ taskId: "task-test-003", trigger: "HIGH_RISK", risk: "HIGH", evidence: SAMPLE_EVIDENCE });
    const found = getEscalation(esc.id);
    assert(found !== null, "Should find escalation");
    assertEqual(found!.id, esc.id, "ID should match");
  });

  await test("returns null for non-existent escalation", () => {
    const found = getEscalation("nonexistent-id-xyz");
    assert(found === null, "Should return null");
  });

  await test("lists pending escalations", () => {
    const pending = getPendingEscalations();
    assert(Array.isArray(pending), "Should return array");
    assert(pending.every((e) => e.status === "PENDING"), "All should be PENDING");
  });

  // ── Escalation Resolution ──────────────────────────────────────────────────
  console.log("\n[ Escalation Resolution ]");

  await test("approves MEDIUM risk escalation without token", () => {
    const esc    = createEscalation({ taskId: "task-approve-001", trigger: "LOW_CONFIDENCE", risk: "MEDIUM", evidence: SAMPLE_EVIDENCE });
    const result = resolveEscalation(esc.id, true, "api", "looks good");
    assert(result.success,                           "Should succeed");
    assertEqual(result.escalation!.status, "APPROVED", "Status should be APPROVED");
    assertEqual(result.escalation!.resolvedBy, "api", "Should record resolver");
  });

  await test("rejects escalation successfully", () => {
    const esc    = createEscalation({ taskId: "task-reject-001", trigger: "HIGH_RISK", risk: "MEDIUM", evidence: SAMPLE_EVIDENCE });
    const result = resolveEscalation(esc.id, false, "api", "too risky");
    assert(result.success,                           "Should succeed");
    assertEqual(result.escalation!.status, "REJECTED", "Status should be REJECTED");
  });

  await test("blocks HIGH risk approval without token", () => {
    const esc    = createEscalation({ taskId: "task-token-001", trigger: "DESTRUCTIVE_ACTION", risk: "HIGH", evidence: SAMPLE_EVIDENCE });
    const result = resolveEscalation(esc.id, true, "api", "approved", undefined);
    assert(!result.success,                          "Should fail without token");
    assert(result.error?.includes("token") === true, "Should mention token");
  });

  await test("approves HIGH risk with correct token", () => {
    const esc    = createEscalation({ taskId: "task-token-002", trigger: "DESTRUCTIVE_ACTION", risk: "HIGH", evidence: SAMPLE_EVIDENCE });
    const result = resolveEscalation(esc.id, true, "api", "approved with token", esc.approvalToken);
    assert(result.success,                            "Should succeed with token");
    assertEqual(result.escalation!.status, "APPROVED", "Should be approved");
  });

  await test("cannot resolve already resolved escalation", () => {
    const esc = createEscalation({ taskId: "task-double-001", trigger: "HIGH_RISK", risk: "MEDIUM", evidence: SAMPLE_EVIDENCE });
    resolveEscalation(esc.id, true, "api", "first approval");
    const second = resolveEscalation(esc.id, true, "api", "second approval");
    assert(!second.success, "Should fail on double resolution");
  });

  // ── Expiry ─────────────────────────────────────────────────────────────────
  console.log("\n[ Escalation Expiry ]");

  await test("expireOldEscalations returns number", () => {
    const count = expireOldEscalations();
    assert(typeof count === "number", "Should return number");
    assert(count >= 0, "Should be non-negative");
  });

  await test("stats are accurate", () => {
    const stats = getEscalationStats();
    assert(typeof stats.total    === "number", "total should be number");
    assert(typeof stats.pending  === "number", "pending should be number");
    assert(typeof stats.approved === "number", "approved should be number");
    assert(typeof stats.rejected === "number", "rejected should be number");
    assert(stats.total >= stats.pending + stats.approved + stats.rejected,
      "total should be >= sum of statuses");
    console.log(`         (Stats: ${JSON.stringify(stats)})`);
  });

  // ── Escalation Agent ───────────────────────────────────────────────────────
  console.log("\n[ Escalation Agent ]");

  await test("does not escalate when confidence is high", async () => {
    const r = await escalationAgent.evaluate({
      taskId: "agent-test-001", goal: "list files",
      plan: { steps: [{ stepId: 1, type: "RUN_COMMAND", cmd: ["ls"], cwd: "/workspace", timeout: 5000 }], requestedPermissions: ["READ_FILESYSTEM"] },
      executedSteps: [], trigger: "LOW_CONFIDENCE",
      riskScore: "LOW", confidenceScore: 85,
      reason: "High confidence", autoApproveLow: false,
    });
    assert(r.success, "Should succeed");
    assert(!r.output.escalated, "Should NOT escalate when confidence is high");
  });

  await test("escalates when confidence is low", async () => {
    const r = await escalationAgent.evaluate({
      taskId: "agent-test-002", goal: "analyse complex data",
      plan: { steps: [{ stepId: 1, type: "RUN_COMMAND", cmd: ["ls"], cwd: "/workspace", timeout: 5000 }], requestedPermissions: ["READ_FILESYSTEM"] },
      executedSteps: [], trigger: "LOW_CONFIDENCE",
      riskScore: "MEDIUM", confidenceScore: 25,
      reason: "Output quality too low", autoApproveLow: false,
    });
    assert(r.success, "Should succeed");
    assert(r.output.escalated, "Should escalate when confidence < 40");
    assert(r.output.escalationId !== undefined, "Should have escalation ID");
    console.log(`         (Escalation ID: ${r.output.escalationId})`);
  });

  await test("escalates on retry limit", async () => {
    const r = await escalationAgent.evaluate({
      taskId: "agent-test-003", goal: "build complex app",
      plan: { steps: [{ stepId: 1, type: "RUN_COMMAND", cmd: ["npm", "build"], cwd: "/workspace", timeout: 60000 }], requestedPermissions: ["EXECUTE_COMMAND"] },
      executedSteps: [], trigger: "RETRY_LIMIT",
      riskScore: "HIGH", confidenceScore: 50,
      reason: "Failed 3 times", autoApproveLow: false,
    });
    assert(r.success, "Should succeed");
    assert(r.output.escalated, "Should escalate on retry limit");
  });

  await test("does NOT escalate HIGH risk when autoApproveLow is for LOW", async () => {
    const r = await escalationAgent.evaluate({
      taskId: "agent-test-004", goal: "do something risky",
      plan: { steps: [{ stepId: 1, type: "RUN_COMMAND", cmd: ["ls"], cwd: "/workspace", timeout: 5000 }], requestedPermissions: ["READ_FILESYSTEM"] },
      executedSteps: [], trigger: "HIGH_RISK",
      riskScore: "HIGH", confidenceScore: 90,
      reason: "HIGH risk", autoApproveLow: false,
    });
    assert(r.success, "Should succeed");
    assert(r.output.escalated, "Should escalate HIGH risk without autoApprove");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`Escalation Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All escalation tests passed!`);
  }
}

main();
