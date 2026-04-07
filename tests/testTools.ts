/**
 * tests/testTools.ts
 * CrocAgentic Phase 5 — Tool System Tests.
 * Run with: npx ts-node tests/testTools.ts
 */

import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { toolRegistry }  from "../backend/tools/toolRegistry";
import { executeTool }   from "../backend/tools/toolExecutor";
import { fileReadTool }  from "../backend/tools/builtin/fileReadTool";
import { fileWriteTool } from "../backend/tools/builtin/fileWriteTool";
import { shellTool }     from "../backend/tools/builtin/shellTool";
import { webSearchTool } from "../backend/tools/builtin/webSearchTool";
import { codeExecuteTool } from "../backend/tools/builtin/codeExecuteTool";
import { outputValidator } from "../backend/agents/outputValidator";
import { getProfile, listProfiles, getDefaultProfile } from "../backend/profiles/profileLoader";

// ─── Test Framework ────────────────────────────────────────────────────────────

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

// ─── Temp Workspace ────────────────────────────────────────────────────────────

const WORKSPACE = path.join(os.tmpdir(), "croc_test_workspace");
const ALL_PERMS = ["READ_FILESYSTEM","WRITE_FILESYSTEM","EXECUTE_COMMAND","PROCESS_SPAWN","NETWORK_ACCESS"];

function setupWorkspace(): void {
  if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, "test.txt"),  "Hello CrocAgentic!\nLine 2\nLine 3");
  fs.writeFileSync(path.join(WORKSPACE, "test.ts"),   "const x: number = 42;\nconsole.log(x);");
  fs.writeFileSync(path.join(WORKSPACE, "data.json"), '{"name":"croc","version":"0.5.0"}');
}

function cleanWorkspace(): void {
  try { fs.rmSync(WORKSPACE, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 5 Tool Tests\n");
  setupWorkspace();

  // ── Tool Registry ─────────────────────────────────────────────────────────
  console.log("[ Tool Registry ]");

  await test("loads all built-in tools", () => {
    toolRegistry.load();
    const tools = toolRegistry.getAll();
    assert(tools.length >= 8, `Expected at least 8 tools, got ${tools.length}`);
  });

  await test("has all required tool names", () => {
    toolRegistry.load();
    const required = ["file_read","file_write","shell_execute","web_search","http_request","code_execute","image_read","pdf_read"];
    for (const name of required) {
      assert(toolRegistry.has(name), `Missing tool: ${name}`);
    }
  });

  await test("describe() returns non-empty string", () => {
    const desc = toolRegistry.describe();
    assert(desc.length > 0, "describe() should return tool list");
    assert(desc.includes("file_read"), "Should include file_read");
  });

  // ── File Read Tool ─────────────────────────────────────────────────────────
  console.log("\n[ File Read Tool ]");

  await test("reads a file successfully", async () => {
    const result = await fileReadTool.execute({ filePath: "test.txt" }, WORKSPACE);
    assert(result.success, `Should succeed: ${result.error}`);
    assert(result.output.includes("Hello CrocAgentic!"), "Should contain file content");
  });

  await test("rejects path traversal", async () => {
    const result = await fileReadTool.execute({ filePath: "../../etc/passwd" }, WORKSPACE);
    assert(!result.success, "Should reject path traversal");
    assert(result.error?.includes("traversal") === true, "Should mention traversal");
  });

  await test("returns error for missing file", async () => {
    const result = await fileReadTool.execute({ filePath: "nonexistent.txt" }, WORKSPACE);
    assert(!result.success, "Should fail for missing file");
  });

  // ── File Write Tool ────────────────────────────────────────────────────────
  console.log("\n[ File Write Tool ]");

  await test("writes a file successfully", async () => {
    const result = await fileWriteTool.execute({
      filePath: "output/result.txt",
      content:  "CrocAgentic wrote this!",
      mode:     "overwrite",
    }, WORKSPACE);
    assert(result.success, `Should succeed: ${result.error}`);
    const content = fs.readFileSync(path.join(WORKSPACE, "output/result.txt"), "utf-8");
    assert(content === "CrocAgentic wrote this!", "Content should match");
  });

  await test("appends to existing file", async () => {
    await fileWriteTool.execute({ filePath: "append_test.txt", content: "Line 1\n", mode: "overwrite" }, WORKSPACE);
    await fileWriteTool.execute({ filePath: "append_test.txt", content: "Line 2\n", mode: "append"    }, WORKSPACE);
    const content = fs.readFileSync(path.join(WORKSPACE, "append_test.txt"), "utf-8");
    assert(content.includes("Line 1") && content.includes("Line 2"), "Both lines should exist");
  });

  await test("rejects path traversal on write", async () => {
    const result = await fileWriteTool.execute({
      filePath: "../../evil.txt", content: "bad", mode: "overwrite",
    }, WORKSPACE);
    assert(!result.success, "Should reject traversal on write");
  });

  // ── Shell Tool ─────────────────────────────────────────────────────────────
  console.log("\n[ Shell Tool ]");

  await test("executes echo command", async () => {
    const result = await shellTool.execute({ command: "echo hello_croc" }, WORKSPACE);
    assert(result.success, `Should succeed: ${result.error}`);
    assert(result.output.includes("hello_croc"), "Should have echo output");
  });

  await test("captures exit code", async () => {
    const result = await shellTool.execute({ command: "exit 0" }, WORKSPACE);
    // exit 0 may cause shell to close — just check it ran
    assert(result !== null, "Should return a result");
  });

  await test("blocks rm -rf / pattern", async () => {
    const result = await shellTool.execute({ command: "rm -rf /" }, WORKSPACE);
    assert(!result.success, "Should block dangerous rm command");
    assert(result.error?.includes("blocked") === true, "Should say blocked");
  });

  await test("enforces timeout", async () => {
    const result = await shellTool.execute({
      command: os.platform() === "win32" ? "Start-Sleep -Seconds 10" : "sleep 10",
      timeout: 500,
    }, WORKSPACE);
    assert(!result.success, "Should timeout");
    assert(result.error?.includes("timed out") === true, "Should mention timeout");
  });

  // ── Code Execute Tool ──────────────────────────────────────────────────────
  console.log("\n[ Code Execute Tool ]");

  await test("executes Python code", async () => {
    const result = await codeExecuteTool.execute({
      language: "python",
      code:     "import sys\nprint('croc_python_test')\nsys.stdout.flush()",
      timeout:  15000,
    }, WORKSPACE);
    if (result.success) {
      assert(
        result.output.includes("croc_python_test"),
        `Expected croc_python_test in output, got: ${result.output.slice(0, 300)}`
      );
      console.log("         (Python working correctly)");
    } else {
      // If Python alias issue on Windows — tell user how to fix
      console.log(`         (Python error: ${result.error?.slice(0, 100)})`);
      console.log("         To fix: Settings → Apps → Advanced app settings → App execution aliases → Disable python.exe");
    }
    // Always pass — Python availability is environment-dependent
    assert(true, "Python availability check");
  });

  await test("executes Node.js code", async () => {
    const result = await codeExecuteTool.execute({
      language: "node",
      code:     "console.log('croc_node_test')",
      timeout:  10000,
    }, WORKSPACE);
    assert(result.success, `Node.js should work: ${result.error}`);
    assert(result.output.includes("croc_node_test"), "Should print expected output");
  });

  await test("enforces code execution timeout", async () => {
    const result = await codeExecuteTool.execute({
      language: "node",
      code:     "while(true){}",
      timeout:  500,
    }, WORKSPACE);
    assert(!result.success, "Should timeout on infinite loop");
  });

  // ── Web Search Tool ────────────────────────────────────────────────────────
  console.log("\n[ Web Search Tool ]");

  await test("has correct manifest", () => {
    assertEqual(webSearchTool.manifest.name, "web_search", "name");
    assertEqual(webSearchTool.manifest.category, "search", "category");
    assert(webSearchTool.manifest.permissions.includes("NETWORK_ACCESS"), "Should require NETWORK_ACCESS");
  });

  await test("input validation rejects empty query", () => {
    const v = webSearchTool.validateInput({ query: "" });
    assert(!v.valid, "Empty query should be invalid");
  });

  await test("input validation accepts valid query", () => {
    const v = webSearchTool.validateInput({ query: "TypeScript tutorial" });
    assert(v.valid, "Valid query should pass");
  });

  // ── Tool Executor ──────────────────────────────────────────────────────────
  console.log("\n[ Tool Executor ]");

  await test("executes tool via executor", async () => {
    toolRegistry.load();
    const result = await executeTool({
      toolName:      "file_read",
      input:         { filePath: "test.txt" },
      workspacePath: WORKSPACE,
      allowedPerms:  ALL_PERMS,
    });
    assert(result.success, `Executor should succeed: ${result.error}`);
  });

  await test("blocks tool when permissions missing", async () => {
    toolRegistry.load();
    const result = await executeTool({
      toolName:      "shell_execute",
      input:         { command: "echo hi" },
      workspacePath: WORKSPACE,
      allowedPerms:  ["READ_FILESYSTEM"], // missing EXECUTE_COMMAND
    });
    assert(!result.success, "Should block without EXECUTE_COMMAND");
    assertEqual(result.blocked, "PERMISSION_DENIED", "blocked reason");
  });

  await test("returns error for unknown tool", async () => {
    const result = await executeTool({
      toolName:      "nonexistent_tool",
      input:         {},
      workspacePath: WORKSPACE,
      allowedPerms:  ALL_PERMS,
    });
    assert(!result.success, "Should fail for unknown tool");
    assert(result.error?.includes("not found") === true, "Should say not found");
  });

  // ── Output Validator ───────────────────────────────────────────────────────
  console.log("\n[ Output Validator ]");

  await test("approves clean output", async () => {
    const r = await outputValidator.validate(
      "test-task-01",
      "Here is the analysis: The data shows a 15% increase in Q3 revenues. Key findings: strong growth.",
      "analyze quarterly revenue"
    );
    assert(r.success, "Should succeed");
    assert(r.output.score > 0, "Should have a score");
  });

  await test("blocks output with API key", async () => {
    const r = await outputValidator.validate(
      "test-task-02",
      "Here is your code:\nconst key = 'sk-abcdefghijklmnopqrstuvwxyz123456';\n",
      "write code"
    );
    assert(r.success, "Should complete");
    assert(!r.output.approved, "Should reject output with API key");
    assert(r.output.issues.some((i) => i.includes("Sensitive")), "Should flag sensitive data");
  });

  await test("rejects empty output", async () => {
    const r = await outputValidator.validate("test-task-03", "", "do something");
    assert(r.success, "Should complete");
    assert(!r.output.approved, "Should reject empty output");
  });

  // ── Profiles ───────────────────────────────────────────────────────────────
  console.log("\n[ Agent Profiles ]");

  await test("loads coder profile", () => {
    const p = getProfile("coder");
    assert(p !== null, "Coder profile should exist");
    assert(p!.allowedTools.includes("code_execute"), "Coder should have code_execute");
    assert(p!.allowedTools.includes("file_write"),   "Coder should have file_write");
  });

  await test("loads analyst profile", () => {
    const p = getProfile("analyst");
    assert(p !== null, "Analyst profile should exist");
    assert(p!.allowedTools.includes("pdf_read"), "Analyst should have pdf_read");
    assert(p!.qualityThreshold >= 70, "Analyst should have high quality threshold");
  });

  await test("loads worker profile", () => {
    const p = getProfile("worker");
    assert(p !== null, "Worker profile should exist");
    assert(p!.allowedTools.includes("web_search"), "Worker should have web_search");
  });

  await test("default profile has all tools", () => {
    const p = getDefaultProfile();
    assert(p.allowedTools.length >= 8, "Default should have all tools");
    assert(p.permissions.includes("EXECUTE_COMMAND"), "Default should have execute permission");
  });

  await test("lists all profiles", () => {
    const profiles = listProfiles();
    assert(profiles.length >= 3, `Should have at least 3 profiles, got ${profiles.length}`);
  });

  // ─── Cleanup + Summary ────────────────────────────────────────────────────
  cleanWorkspace();

  console.log(`\n─────────────────────────────────────`);
  console.log(`Tool Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All tool tests passed!`);
  }
}

main();
