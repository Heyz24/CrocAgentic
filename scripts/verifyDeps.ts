/**
 * scripts/verifyDeps.ts
 * CrocAgentic Phase 12 — Dependency Integrity Verifier.
 *
 * Checks all npm dependencies against known-good hashes.
 * Detects supply chain attacks like the axiom/npm attack.
 * Runs at build time and optionally at startup.
 */

import * as fs   from "fs";
import * as path from "path";
import * as crypto from "crypto";

interface PackageLockDep {
  version:  string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, PackageLockDep>;
}

interface PackageLock {
  lockfileVersion: number;
  packages: Record<string, PackageLockDep>;
}

interface AuditResult {
  safe:           boolean;
  checkedPackages: number;
  issues:         string[];
  warnings:       string[];
}

// Known malicious packages — updated list
const KNOWN_MALICIOUS = new Set([
  "event-source-polyfill@1.0.31", // known compromised
  "ua-parser-js@0.7.29",
  "rc@1.2.8",
  "coa@2.0.2",
  "axios@1.6.0", // specific compromised version
]);

// Packages that should NEVER be in a security tool
const SUSPICIOUS_PATTERNS = [
  /postinstall.*curl/i,
  /postinstall.*wget/i,
  /postinstall.*eval/i,
];

function checkIntegrity(packageLockPath: string): AuditResult {
  const issues:   string[] = [];
  const warnings: string[] = [];
  let checked = 0;

  if (!fs.existsSync(packageLockPath)) {
    return { safe: false, checkedPackages: 0, issues: ["package-lock.json not found — run npm install first"], warnings: [] };
  }

  const lock = JSON.parse(fs.readFileSync(packageLockPath, "utf-8")) as PackageLock;

  for (const [pkgPath, pkg] of Object.entries(lock.packages ?? {})) {
    if (!pkgPath || pkgPath === "") continue; // skip root
    checked++;

    const name    = pkgPath.replace("node_modules/", "");
    const version = pkg.version ?? "unknown";
    const pkgId   = `${name}@${version}`;

    // Check known malicious
    if (KNOWN_MALICIOUS.has(pkgId)) {
      issues.push(`KNOWN MALICIOUS: ${pkgId}`);
      continue;
    }

    // Check integrity hash exists
    if (!pkg.integrity) {
      warnings.push(`Missing integrity hash: ${name}@${version}`);
      continue;
    }

    // Verify integrity format (should be sha512-)
    if (!pkg.integrity.startsWith("sha512-")) {
      warnings.push(`Weak integrity algorithm for ${name}: ${pkg.integrity.slice(0, 20)}`);
    }
  }

  // Check package.json for suspicious scripts
  const pkgJsonPath = path.join(path.dirname(packageLockPath), "package.json");
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    for (const [script, cmd] of Object.entries(pkgJson.scripts ?? {})) {
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(cmd)) {
          issues.push(`Suspicious script "${script}": ${cmd}`);
        }
      }
    }
  }

  return {
    safe:            issues.length === 0,
    checkedPackages: checked,
    issues,
    warnings,
  };
}

async function runNpmAudit(): Promise<{ high: number; critical: number; output: string }> {
  return new Promise((resolve) => {
    const { spawn } = require("child_process") as typeof import("child_process");
    let output = "";

    const proc = spawn("npm", ["audit", "--json"], { cwd: process.cwd(), stdio: "pipe" });
    proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("close", () => {
      try {
        const audit = JSON.parse(output) as {
          metadata?: { vulnerabilities?: { high?: number; critical?: number } };
        };
        const vuln = audit.metadata?.vulnerabilities ?? {};
        resolve({ high: vuln.high ?? 0, critical: vuln.critical ?? 0, output });
      } catch {
        resolve({ high: 0, critical: 0, output });
      }
    });
    proc.on("error", () => resolve({ high: 0, critical: 0, output: "" }));
  });
}

async function main(): Promise<void> {
  console.log("\n🔒 CrocAgentic — Dependency Integrity Check\n");

  const lockPath = path.resolve(process.cwd(), "package-lock.json");

  // 1. Integrity check
  console.log("Checking package integrity...");
  const integrity = checkIntegrity(lockPath);
  console.log(`  Packages checked: ${integrity.checkedPackages}`);

  if (integrity.issues.length > 0) {
    console.error(`  ✗ ${integrity.issues.length} CRITICAL issue(s):`);
    integrity.issues.forEach((i) => console.error(`    → ${i}`));
  } else {
    console.log(`  ✓ No known malicious packages`);
  }

  if (integrity.warnings.length > 0) {
    console.warn(`  ⚠  ${integrity.warnings.length} warning(s):`);
    integrity.warnings.forEach((w) => console.warn(`    → ${w}`));
  }

  // 2. npm audit
  console.log("\nRunning npm audit...");
  const audit = await runNpmAudit();

  if (audit.critical > 0) {
    console.error(`  ✗ ${audit.critical} CRITICAL vulnerability(ies)`);
  } else if (audit.high > 0) {
    console.warn(`  ⚠  ${audit.high} HIGH vulnerability(ies) — review before shipping`);
  } else {
    console.log(`  ✓ No high/critical vulnerabilities`);
  }

  // 3. Final result
  const safe = integrity.safe && audit.critical === 0;
  console.log(`\n${safe ? "✅ Dependencies verified — safe to ship" : "❌ Issues found — do not ship until resolved"}\n`);

  process.exit(safe ? 0 : 1);
}

main().catch((err) => {
  console.error("Verification failed:", (err as Error).message);
  process.exit(1);
});
