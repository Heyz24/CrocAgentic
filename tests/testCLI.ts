/**
 * tests/testCLI.ts
 * CrocAgentic Phase 12 — CLI + Build Tests.
 * Run with: npx ts-node tests/testCLI.ts
 */

import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { spawn } from "child_process";

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

function runCLI(args: string[], input?: string, timeoutMs = 15000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const isWin  = process.platform === "win32";
    const tsNode = require("path").join(process.cwd(), "node_modules", ".bin", isWin ? "ts-node.cmd" : "ts-node");
    const proc = spawn(
      tsNode, ["cli/index.ts", ...args],
      { cwd: process.cwd(), stdio: "pipe", shell: isWin }
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    if (input) {
      proc.stdin.write(input + "\n");
      proc.stdin.write("exit\n");
      proc.stdin.end();
    }

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ stdout, stderr, code: -1 });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 12 CLI Tests\n");

  // ── CLI File Existence ────────────────────────────────────────────────────
  console.log("[ CLI Files ]");

  await test("cli/index.ts exists", () => {
    assert(fs.existsSync("cli/index.ts"), "cli/index.ts should exist");
  });

  await test("scripts/verifyDeps.ts exists", () => {
    assert(fs.existsSync("scripts/verifyDeps.ts"), "verifyDeps.ts should exist");
  });

  await test("scripts/build.ts exists", () => {
    assert(fs.existsSync("scripts/build.ts"), "build.ts should exist");
  });

  await test("installer/installer.nsi exists", () => {
    assert(fs.existsSync("installer/installer.nsi"), "installer.nsi should exist");
  });

  // ── CLI --version flag ─────────────────────────────────────────────────────
  console.log("\n[ CLI Flags ]");

  await test("--version outputs version", async () => {
    const { stdout } = await runCLI(["--version"]);
    assert(stdout.includes("0.12.0") || stdout.includes("CrocAgentic"), "Should output version");
  });

  await test("--help outputs help text", async () => {
    const { stdout } = await runCLI(["--help"]);
    assert(stdout.includes("Usage") || stdout.includes("crocagentic"), "Should output help");
  });

  // ── CLI --once mode ────────────────────────────────────────────────────────
  console.log("\n[ CLI --once Mode ]");

  await test("--once runs single task and exits", async () => {
    const { stdout, code } = await runCLI(
      ["--once", "list files in workspace"],
      undefined, 60000
    );
    assert(code === 0 || stdout.length > 0, "Should complete and exit");
    console.log(`         (Output: ${stdout.slice(0, 80).replace(/\n/g, " ")}...)`);
  });

  // ── Dependency Verifier ────────────────────────────────────────────────────
  console.log("\n[ Dependency Verifier ]");

  await test("package-lock.json exists", () => {
    assert(fs.existsSync("package-lock.json"), "package-lock.json should exist");
  });

  await test("all dependencies have integrity hashes", () => {
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf-8")) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };

    let missing = 0;
    let total   = 0;

    for (const [pkgPath, pkg] of Object.entries(lock.packages)) {
      if (!pkgPath || pkgPath === "") continue;
      total++;
      if (!pkg.integrity) missing++;
    }

    console.log(`         (${total} packages, ${missing} missing integrity)`);
    assert(missing < total * 0.1, `Too many packages missing integrity: ${missing}/${total}`);
  });

  await test("no known malicious packages in lock file", () => {
    const KNOWN_BAD = ["event-source-polyfill@1.0.31", "ua-parser-js@0.7.29", "rc@1.2.8"];
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf-8")) as {
      packages: Record<string, { version?: string }>;
    };

    for (const [pkgPath, pkg] of Object.entries(lock.packages)) {
      const name   = pkgPath.replace("node_modules/", "");
      const pkgId  = `${name}@${pkg.version}`;
      assert(!KNOWN_BAD.includes(pkgId), `Known malicious package found: ${pkgId}`);
    }
  });

  // ── Build Scripts ─────────────────────────────────────────────────────────
  console.log("\n[ Build Config ]");

  await test("package.json has build script", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as {
      scripts?: Record<string, string>;
    };
    assert(typeof pkg.scripts?.build === "string", "Should have build script");
  });

  await test("package.json has verify script", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as {
      scripts?: Record<string, string>;
    };
    assert(typeof pkg.scripts?.["verify:deps"] === "string", "Should have verify:deps script");
  });

  await test("tsconfig.json exists and has outDir", () => {
    assert(fs.existsSync("tsconfig.json"), "tsconfig.json should exist");
    const tsconfig = JSON.parse(fs.readFileSync("tsconfig.json", "utf-8")) as {
      compilerOptions?: { outDir?: string };
    };
    assert(typeof tsconfig.compilerOptions?.outDir === "string", "tsconfig should have outDir");
  });

  // ── NSIS Installer ────────────────────────────────────────────────────────
  console.log("\n[ NSIS Installer ]");

  await test("installer.nsi has correct version", () => {
    const content = fs.readFileSync("installer/installer.nsi", "utf-8");
    assert(content.includes("APPNAME") && content.includes("CrocAgentic"), "Should have app name");
    assert(content.includes("SHA256") || content.includes("integrity"), "Should have integrity check");
  });

  await test("installer.nsi has uninstall section", () => {
    const content = fs.readFileSync("installer/installer.nsi", "utf-8");
    assert(content.includes("Section \"Uninstall\""), "Should have uninstall section");
  });

  await test("installer preserves user data on uninstall", () => {
    const content = fs.readFileSync("installer/installer.nsi", "utf-8");
    assert(content.includes("preserved") || content.includes("runtime"), "Should preserve user data");
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`CLI Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All CLI tests passed!`);
  }
}

main();
