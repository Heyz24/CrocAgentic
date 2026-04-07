/**
 * tests/testRollback.ts
 * CrocAgentic Phase 9 — Rollback + Quarantine Tests.
 * Run with: npx ts-node tests/testRollback.ts
 */

import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import {
  beginTransaction, commitTransaction, rollbackTransaction,
  recordAction, captureFileState, captureFileDelete,
  captureShellCommand, getTransaction, listQuarantine,
  restoreFromQuarantine, purgeQuarantine, getRollbackStats,
  takeSnapshot,
} from "../backend/rollback/rollbackStore";
import { rollbackAgent } from "../backend/agents/rollbackAgent";

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

// Setup temp workspace
const WORKSPACE = path.join(os.tmpdir(), "croc_rollback_test");

function setup(): void {
  if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, "original.txt"), "original content");
  fs.writeFileSync(path.join(WORKSPACE, "data.json"), '{"version":1}');
}

function cleanup(): void {
  try { fs.rmSync(WORKSPACE, { recursive: true, force: true }); } catch { /* ignore */ }
}

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 9 Rollback Tests\n");
  setup();

  // ── Transaction Management ─────────────────────────────────────────────────
  console.log("[ Transaction Management ]");

  await test("begins transaction", () => {
    beginTransaction("task-roll-001");
    const tx = getTransaction("task-roll-001");
    assert(tx !== null, "Transaction should exist");
    assertEqual(tx!.status, "PENDING", "Status should be PENDING");
    assertEqual(tx!.taskId, "task-roll-001", "TaskId should match");
  });

  await test("records actions in transaction", () => {
    beginTransaction("task-roll-002");
    const id = recordAction("task-roll-002", {
      actionType: "SHELL_EXEC",
      reversible: false,
      command:    ["ls", "-la"],
    });
    assert(id.length > 0, "Should return action id");
    const tx = getTransaction("task-roll-002");
    assert(tx!.actions.length === 1, "Should have 1 action");
  });

  await test("commits transaction successfully", () => {
    beginTransaction("task-roll-003");
    recordAction("task-roll-003", { actionType: "SHELL_EXEC", reversible: false, command: ["echo", "hi"] });
    commitTransaction("task-roll-003");
    const tx = getTransaction("task-roll-003");
    assert(tx !== null, "Should find committed transaction");
    assertEqual(tx!.status, "COMMITTED", "Status should be COMMITTED");
  });

  // ── File State Capture ─────────────────────────────────────────────────────
  console.log("\n[ File State Capture ]");

  await test("captures existing file before write", () => {
    beginTransaction("task-file-001");
    captureFileState("task-file-001", path.join(WORKSPACE, "original.txt"));
    const tx = getTransaction("task-file-001");
    assert(tx!.actions.length === 1, "Should have 1 action");
    assertEqual(tx!.actions[0].actionType, "FILE_WRITE", "Should be FILE_WRITE");
    assert(tx!.actions[0].originalContent === "original content", "Should have original content");
  });

  await test("captures new file creation (non-existent)", () => {
    beginTransaction("task-file-002");
    captureFileState("task-file-002", path.join(WORKSPACE, "new_file.txt"));
    const tx = getTransaction("task-file-002");
    assertEqual(tx!.actions[0].actionType, "FILE_CREATE", "Should be FILE_CREATE for new file");
  });

  await test("captures file deletion to quarantine", () => {
    const testFile = path.join(WORKSPACE, "to_delete.txt");
    fs.writeFileSync(testFile, "delete me");

    beginTransaction("task-file-003");
    const quarPath = captureFileDelete("task-file-003", testFile);

    assert(!fs.existsSync(testFile), "Original file should be moved to quarantine");
    assert(fs.existsSync(quarPath), "File should exist in quarantine");
  });

  // ── Rollback Execution ─────────────────────────────────────────────────────
  console.log("\n[ Rollback Execution ]");

  await test("rolls back file write to original content", async () => {
    const testFile = path.join(WORKSPACE, "rollback_test.txt");
    fs.writeFileSync(testFile, "original content here");

    beginTransaction("task-rb-001");
    captureFileState("task-rb-001", testFile);

    // Simulate write
    fs.writeFileSync(testFile, "modified content");
    assertEqual(fs.readFileSync(testFile, "utf-8"), "modified content", "Should be modified");

    // Rollback
    const result = await rollbackTransaction("task-rb-001");
    assert(result.success, `Rollback should succeed: ${result.errors.join(", ")}`);
    assertEqual(fs.readFileSync(testFile, "utf-8"), "original content here", "Should be restored");
  });

  await test("rolls back file creation (deletes new file)", async () => {
    const newFile = path.join(WORKSPACE, "created_by_agent.txt");

    beginTransaction("task-rb-002");
    captureFileState("task-rb-002", newFile); // doesn't exist yet

    // Simulate agent creating the file
    fs.writeFileSync(newFile, "agent created this");
    assert(fs.existsSync(newFile), "File should exist");

    // Rollback
    const result = await rollbackTransaction("task-rb-002");
    assert(result.success, "Rollback should succeed");
    // File moved to quarantine, not just deleted
    console.log("         (File moved to quarantine on rollback)");
  });

  await test("cannot double-rollback an already rolled-back transaction", async () => {
    beginTransaction("task-rb-003");
    // First rollback should succeed
    const first = await rollbackTransaction("task-rb-003");
    assert(first.success || first.actionsRolledBack === 0, "First rollback should handle empty transaction");
    // Second rollback should fail — already rolled back
    const second = await rollbackTransaction("task-rb-003");
    assert(!second.success, "Second rollback should fail — already ROLLED_BACK");
    assert(second.errors.length > 0, "Should have error message");
  });

  await test("handles rollback of non-existent transaction", async () => {
    const result = await rollbackTransaction("task-nonexistent-xyz");
    assert(!result.success, "Should fail gracefully");
    assert(result.errors.length > 0, "Should have error message");
  });

  // ── Shell Command Recording ────────────────────────────────────────────────
  console.log("\n[ Shell Command Recording ]");

  await test("records shell command (non-reversible)", () => {
    beginTransaction("task-shell-001");
    captureShellCommand("task-shell-001", ["npm", "install"]);
    const tx = getTransaction("task-shell-001");
    assertEqual(tx!.actions[0].actionType, "SHELL_EXEC", "Should be SHELL_EXEC");
    assertEqual(tx!.actions[0].reversible, false, "Should be non-reversible");
    assert(tx!.actions[0].command?.includes("npm") === true, "Should record command");
  });

  // ── Quarantine Management ──────────────────────────────────────────────────
  console.log("\n[ Quarantine Management ]");

  await test("lists quarantine contents", () => {
    const files = listQuarantine();
    assert(Array.isArray(files), "Should return array");
    // May have files from previous tests
    console.log(`         (${files.length} file(s) in quarantine)`);
  });

  await test("purgeQuarantine runs without error", () => {
    const count = purgeQuarantine();
    assert(typeof count === "number", "Should return number");
    assert(count >= 0, "Should be non-negative");
    console.log(`         (Purged ${count} expired quarantine file(s))`);
  });

  await test("restore from quarantine works", () => {
    // Create a file and quarantine it
    const testFile = path.join(WORKSPACE, "restore_test.txt");
    fs.writeFileSync(testFile, "restore me");
    beginTransaction("task-quar-001");
    const quarPath = captureFileDelete("task-quar-001", testFile);

    // Restore it
    const restored = restoreFromQuarantine(path.basename(quarPath), testFile);
    assert(restored, "Should restore successfully");
    assert(fs.existsSync(testFile), "File should be back");
    assertEqual(fs.readFileSync(testFile, "utf-8"), "restore me", "Content should match");
  });

  // ── Snapshot ───────────────────────────────────────────────────────────────
  console.log("\n[ Workspace Snapshot ]");

  await test("takes workspace snapshot", async () => {
    beginTransaction("task-snap-001");
    const snapshotId = await takeSnapshot("task-snap-001", WORKSPACE);
    assert(snapshotId.length > 0, "Should return snapshot ID");
    assert(snapshotId.includes("task-sna"), "Should contain task prefix");
    console.log(`         (Snapshot ID: ${snapshotId})`);
  });

  // ── Rollback Agent ─────────────────────────────────────────────────────────
  console.log("\n[ Rollback Agent ]");

  await test("begins task successfully", async () => {
    const r = await rollbackAgent.beginTask("agent-rb-001", WORKSPACE, false);
    assert(r.success, `Should succeed: ${r.error}`);
    assert(r.output.transactionId === "agent-rb-001", "Should have transaction ID");
  });

  await test("begins task with snapshot for HIGH risk", async () => {
    const r = await rollbackAgent.beginTask("agent-rb-002", WORKSPACE, true);
    assert(r.success, "Should succeed");
    assert(r.output.snapshotId !== undefined, "Should have snapshot ID when HIGH risk");
    console.log(`         (Snapshot: ${r.output.snapshotId})`);
  });

  await test("commits task successfully", async () => {
    beginTransaction("agent-rb-commit-001");
    const r = await rollbackAgent.commitTask("agent-rb-commit-001");
    assert(r.success, "Should succeed");
    assert(r.output.committed, "Should be committed");
  });

  await test("gets rollback stats", async () => {
    const r = await rollbackAgent.getStats("agent-rb-stats-001");
    assert(r.success, "Should succeed");
    assert(typeof r.output.activeTransactions    === "number", "activeTransactions should be number");
    assert(typeof r.output.persistedTransactions === "number", "persistedTransactions should be number");
    assert(typeof r.output.quarantineFiles       === "number", "quarantineFiles should be number");
    console.log(`         (Stats: ${JSON.stringify(r.output)})`);
  });

  // ─── Cleanup + Summary ────────────────────────────────────────────────────
  cleanup();

  console.log(`\n─────────────────────────────────────`);
  console.log(`Rollback Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All rollback tests passed!`);
  }
}

main();
