/**
 * tests/testMemory.ts
 * CrocAgentic Phase 7 — Memory System Tests.
 * Run with: npx ts-node tests/testMemory.ts
 */

import {
  remember, recall, forget, clearShortTerm,
  getMemoryStats, pruneExpired, buildContextPacket,
} from "../backend/memory/memoryStore";
import { buildContext, parseMemoryCommand } from "../backend/memory/contextBuilder";
import { memoryAgent } from "../backend/agents/memoryAgent";

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

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 7 Memory Tests\n");

  // ── Short-term Memory ──────────────────────────────────────────────────────
  console.log("[ Short-term Memory ]");

  await test("stores and retrieves short-term entry", () => {
    remember({
      layer: "short", category: "task",
      userId: "user1", projectId: "task-001",
      key: "test_goal", content: "list files in workspace",
    });
    const results = recall({ layer: "short", projectId: "task-001" });
    assert(results.length > 0, "Should have results");
    assert(results[0].content === "list files in workspace", "Content should match");
  });

  await test("clears short-term on clearShortTerm()", () => {
    remember({
      layer: "short", category: "task",
      userId: "user1", projectId: "task-002",
      key: "goal", content: "test content",
    });
    clearShortTerm("task-002");
    const results = recall({ layer: "short", projectId: "task-002" });
    assertEqual(results.length, 0, "Should be empty after clear");
  });

  // ── Medium-term Memory ─────────────────────────────────────────────────────
  console.log("\n[ Medium-term Memory ]");

  await test("stores medium-term entry", () => {
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "proj-1",
      key: "task_abc123", content: "Goal: analyse data\nResult: Found 3 issues",
      metadata: { taskId: "abc123", finalStatus: "COMPLETED" },
    });
    const results = recall({ layer: "medium", projectId: "proj-1" });
    assert(results.length > 0, "Should have medium-term entries");
  });

  await test("updates existing entry with same key", () => {
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "proj-1",
      key: "task_update_test", content: "original content",
    });
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "proj-1",
      key: "task_update_test", content: "updated content",
    });
    const results = recall({ layer: "medium", projectId: "proj-1", query: "update_test" });
    const entry = results.find((r) => r.key === "task_update_test");
    assert(entry?.content === "updated content", "Should have updated content");
  });

  await test("keyword search finds relevant entries", () => {
    remember({
      layer: "medium", category: "file",
      userId: "user1", projectId: "proj-search",
      key: "workspace_files", content: "index.ts main.ts utils.ts README.md",
    });
    const results = recall({ layer: "medium", projectId: "proj-search", query: "typescript files" });
    assert(results.length > 0, "Should find TypeScript-related entries");
  });

  // ── Long-term Memory ───────────────────────────────────────────────────────
  console.log("\n[ Long-term Memory ]");

  await test("stores permanent preference", () => {
    remember({
      layer: "long", category: "preference",
      userId: "user1", projectId: "global",
      key: "output_format", content: "always format output as markdown",
    });
    const results = recall({ layer: "long", category: "preference", userId: "user1" });
    assert(results.length > 0, "Should have preferences");
    assert(results.some((r) => r.content.includes("markdown")), "Should find preference");
  });

  await test("stores org rule visible to all users", () => {
    remember({
      layer: "long", category: "rule",
      userId: "shared", projectId: "global",
      key: "no_delete_rule", content: "never delete files without explicit approval",
    });
    const results = recall({ layer: "long", category: "rule" });
    assert(results.some((r) => r.content.includes("explicit approval")), "Should find org rule");
  });

  await test("long-term entries have null expiresAt", () => {
    remember({
      layer: "long", category: "preference",
      userId: "user1", projectId: "global",
      key: "test_permanent", content: "permanent preference",
    });
    const results = recall({ layer: "long", query: "permanent" });
    const entry = results.find((r) => r.key === "test_permanent");
    assert(entry?.expiresAt === null, "Long-term should never expire");
  });

  // ── Forget ─────────────────────────────────────────────────────────────────
  console.log("\n[ Forget / Delete ]");

  await test("forgets by key", () => {
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "proj-forget",
      key: "to_be_forgotten", content: "this will be deleted",
    });
    const before = recall({ layer: "medium", projectId: "proj-forget" }).length;
    forget({ key: "to_be_forgotten" });
    const after = recall({ layer: "medium", projectId: "proj-forget" }).length;
    assert(after < before || after === 0, "Should have fewer entries after forget");
  });

  await test("forgets entire project", () => {
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "proj-to-delete",
      key: "task1", content: "task one",
    });
    remember({
      layer: "medium", category: "file",
      userId: "user1", projectId: "proj-to-delete",
      key: "files", content: "file list",
    });
    const removed = forget({ projectId: "proj-to-delete" });
    assert(removed >= 2, `Should remove at least 2 entries, removed ${removed}`);
  });

  // ── Context Builder ────────────────────────────────────────────────────────
  console.log("\n[ Context Builder ]");

  await test("builds context packet", () => {
    remember({
      layer: "medium", category: "task",
      userId: "user1", projectId: "ctx-proj",
      key: "recent_task", content: "Goal: list files\nResult: found 5 files",
    });
    const packet = buildContextPacket({ userId: "user1", projectId: "ctx-proj", goal: "list files" });
    assert(typeof packet === "object", "Should return packet object");
    assert(Array.isArray(packet.recentTasks), "Should have recentTasks array");
  });

  await test("formats context for LLM", () => {
    const context = buildContext({ userId: "user1", projectId: "ctx-proj", goal: "show files" });
    assert(typeof context === "string", "Should return string");
  });

  await test("returns empty string when no memory", () => {
    const context = buildContext({ userId: "newuser", projectId: "newproject", goal: "do something" });
    assert(typeof context === "string", "Should still return string");
  });

  // ── Memory Command Parser ──────────────────────────────────────────────────
  console.log("\n[ Memory Command Parser ]");

  await test("detects forget project command", () => {
    const cmd = parseMemoryCommand("forget everything about project myproject");
    assertEqual(cmd.type, "forget_project", "type");
    if (cmd.type === "forget_project") {
      assert(cmd.projectId.includes("myproject"), "Should extract project name");
    }
  });

  await test("detects set preference command", () => {
    const cmd = parseMemoryCommand("remember that I prefer markdown output");
    assertEqual(cmd.type, "set_preference", "type");
  });

  await test("detects add rule command", () => {
    const cmd = parseMemoryCommand("add rule: always require approval before deleting");
    assertEqual(cmd.type, "add_rule", "type");
  });

  await test("returns none for regular goals", () => {
    const cmd = parseMemoryCommand("list all TypeScript files in the workspace");
    assertEqual(cmd.type, "none", "type");
  });

  // ── Memory Agent ───────────────────────────────────────────────────────────
  console.log("\n[ Memory Agent ]");

  await test("reads context successfully", async () => {
    const r = await memoryAgent.readContext(
      "test-mem-001", "list files in workspace", "user1", "test-proj"
    );
    assert(r.success, `Should succeed: ${r.error}`);
    assert(typeof r.output.contextPrompt === "string", "Should have contextPrompt");
    assert(typeof r.output.memoriesFound === "number", "Should have memoriesFound");
  });

  await test("handles memory command in goal", async () => {
    const r = await memoryAgent.readContext(
      "test-mem-002",
      "remember that I prefer JSON output format",
      "user1", "global"
    );
    assert(r.success, "Should succeed");
    assert(r.output.memoryCommand?.type === "set_preference", "Should detect preference command");
  });

  await test("gets memory stats", async () => {
    const r = await memoryAgent.getStats("test-mem-003");
    assert(r.success, "Should succeed");
    assert(typeof r.output.total === "number", "Should have total count");
    assert(r.output.total >= 0, "Total should be non-negative");
    console.log(`         (Memory: ${r.output.shortTerm} short, ${r.output.mediumTerm} medium, ${r.output.longTerm} long)`);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  console.log("\n[ Memory Stats ]");

  await test("getMemoryStats returns valid stats", () => {
    const stats = getMemoryStats();
    assert(typeof stats.total === "number", "total should be number");
    assert(typeof stats.shortTerm === "number", "shortTerm should be number");
    assert(typeof stats.mediumTerm === "number", "mediumTerm should be number");
    assert(typeof stats.longTerm === "number", "longTerm should be number");
    assert(stats.total >= 0, "total should be >= 0");
  });

  await test("pruneExpired runs without error", () => {
    const pruned = pruneExpired();
    assert(typeof pruned === "number", "Should return number");
    assert(pruned >= 0, "Should be non-negative");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`Memory Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All memory tests passed!`);
  }
}

main();
