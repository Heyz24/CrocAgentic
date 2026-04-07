/**
 * scripts/build.ts
 * CrocAgentic Phase 12 — Build Script.
 *
 * Runs full build pipeline:
 * 1. Verify dependencies (supply chain check)
 * 2. TypeScript compile
 * 3. Run all tests
 * 4. Package for distribution
 */

import { execSync } from "child_process";
import * as fs      from "fs";
import * as path    from "path";
import * as crypto  from "crypto";

const ROOT = process.cwd();

function run(cmd: string, label: string): void {
  console.log(`\n▶  ${label}...`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: ROOT });
    console.log(`✓  ${label} done`);
  } catch {
    console.error(`✗  ${label} FAILED`);
    process.exit(1);
  }
}

function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function generateManifest(distDir: string): void {
  const manifest: Record<string, string> = {};
  const files = fs.readdirSync(distDir, { recursive: true }) as string[];

  for (const file of files) {
    const fullPath = path.join(distDir, file);
    if (fs.statSync(fullPath).isFile()) {
      manifest[file] = hashFile(fullPath);
    }
  }

  fs.writeFileSync(
    path.join(distDir, "manifest.sha256.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  console.log(`✓  Integrity manifest generated (${Object.keys(manifest).length} files)`);
}

async function main(): Promise<void> {
  console.log("\n🐊 CrocAgentic Build Pipeline v0.12.0");
  console.log("═══════════════════════════════════════\n");

  // 1. Verify dependencies
  run("npx ts-node scripts/verifyDeps.ts", "Dependency integrity check");

  // 2. TypeScript compile
  run("npx tsc --noEmit", "TypeScript type check");

  // 3. Run all tests
  run("npm test", "Full test suite");

  // 4. Compile to JS
  run("npx tsc", "TypeScript compilation");

  // 5. Generate integrity manifest
  const distDir = path.join(ROOT, "dist");
  if (fs.existsSync(distDir)) {
    generateManifest(distDir);
  }

  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  ✅ Build complete — safe to ship     ║");
  console.log("╚══════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error(`Build failed: ${(err as Error).message}`);
  process.exit(1);
});
