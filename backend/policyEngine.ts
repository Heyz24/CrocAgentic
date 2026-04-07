/**
 * backend/policyEngine.ts
 * CrocAgentic Policy Engine — Phase 1 + Phase 2.
 */

import * as fs from "fs";
import * as path from "path";
import type { Plan, PolicyResult, RiskScore } from "../utils/zodSchemas";

// ─── Policy File Types ─────────────────────────────────────────────────────────

interface CommandAllowlist  { commands: string[]; }
interface CommandDenylist   { commands: string[]; dangerousPatterns: string[]; }
interface FolderScope       { allowedPaths: string[]; deniedPaths: string[]; policy: string; }
interface NetworkAllowlist  { allowedDomains: string[]; deniedDomains: string[]; allowedProtocols: string[]; deniedProtocols: string[]; }

// ─── Policy Loading ────────────────────────────────────────────────────────────

const POLICIES_DIR = path.resolve(__dirname, "../policies");

function loadPolicy<T>(filename: string): T {
  const filePath = path.join(POLICIES_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Failed to load policy file "${filename}": ${(err as Error).message}`);
  }
}

let _allowlist:        CommandAllowlist  | null = null;
let _denylist:         CommandDenylist   | null = null;
let _folderScope:      FolderScope       | null = null;
let _networkAllowlist: NetworkAllowlist  | null = null;

function getAllowlist(): CommandAllowlist {
  if (!_allowlist) {
    _allowlist = loadPolicy<CommandAllowlist>("commandAllowlist.json");
  }
  return _allowlist as CommandAllowlist;
}

function getDenylist(): CommandDenylist {
  if (!_denylist) {
    _denylist = loadPolicy<CommandDenylist>("commandDenylist.json");
  }
  return _denylist as CommandDenylist;
}

function getFolderScope(): FolderScope {
  if (!_folderScope) {
    _folderScope = loadPolicy<FolderScope>("folderScope.json");
  }
  return _folderScope as FolderScope;
}

function getNetworkAllowlist(): NetworkAllowlist {
  if (!_networkAllowlist) {
    _networkAllowlist = loadPolicy<NetworkAllowlist>("networkAllowlist.json");
  }
  return _networkAllowlist as NetworkAllowlist;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function cmdString(cmd: string[]): string {
  return cmd.join(" ").toLowerCase();
}

function isCommandDenied(cmd: string[]): boolean {
  const root = cmd[0]?.toLowerCase() ?? "";
  return getDenylist().commands.map((c) => c.toLowerCase()).includes(root);
}

function isCommandAllowed(cmd: string[]): boolean {
  const root = cmd[0]?.toLowerCase() ?? "";
  return getAllowlist().commands.map((c) => c.toLowerCase()).includes(root);
}

function hasDangerousPattern(cmd: string[]): string | null {
  const full = cmdString(cmd);
  for (const pattern of getDenylist().dangerousPatterns) {
    try {
      const re = new RegExp(pattern, "i");
      if (re.test(full)) return pattern;
    } catch {
      if (full.includes(pattern)) return pattern;
    }
  }
  return null;
}

function isCwdAllowed(cwd: string): boolean {
  const scope = getFolderScope();
  for (const denied of scope.deniedPaths) {
    if (cwd === denied || cwd.startsWith(denied + "/") || cwd.startsWith(denied + "\\")) {
      return false;
    }
  }
  for (const allowed of scope.allowedPaths) {
    if (cwd === allowed || cwd.startsWith(allowed + "/") || cwd.startsWith(allowed + "\\")) {
      return true;
    }
  }
  return false;
}

function validateNetworkUsage(cmd: string[]): string | null {
  const full = cmdString(cmd);
  const urlRegex = /https?:\/\/([a-z0-9.\-]+)/gi;
  let match: RegExpExecArray | null;
  const net = getNetworkAllowlist();

  while ((match = urlRegex.exec(full)) !== null) {
    const domain = match[1].toLowerCase();

    if (full.includes("http://")) {
      return `HTTP (non-HTTPS) traffic is not permitted.`;
    }

    for (const denied of net.deniedDomains) {
      const clean = denied.replace(/^\*\./, "");
      if (domain === clean || domain.endsWith("." + clean)) {
        return `Domain "${domain}" is on the network denylist.`;
      }
    }

    let ok = false;
    for (const allowed of net.allowedDomains) {
      const clean = allowed.replace(/^\*\./, "");
      if (domain === clean || domain.endsWith("." + clean)) {
        ok = true;
        break;
      }
    }
    if (!ok) return `Domain "${domain}" is not on the network allowlist.`;
  }

  return null;
}

// ─── Permission Validator ──────────────────────────────────────────────────────

const KNOWN_PERMISSIONS = new Set([
  "READ_FILESYSTEM",
  "WRITE_FILESYSTEM",
  "EXECUTE_COMMAND",
  "NETWORK_ACCESS",
  "ENV_ACCESS",
  "PROCESS_SPAWN",
]);

const HIGH_RISK_PERMISSIONS   = new Set(["WRITE_FILESYSTEM", "EXECUTE_COMMAND", "PROCESS_SPAWN"]);
const MEDIUM_RISK_PERMISSIONS = new Set(["NETWORK_ACCESS", "ENV_ACCESS"]);

function validatePermissions(permissions: string[]): {
  violations: string[];
  riskFromPermissions: RiskScore;
} {
  const violations: string[] = [];
  let highRisk   = false;
  let mediumRisk = false;

  for (const perm of permissions) {
    if (!KNOWN_PERMISSIONS.has(perm)) {
      violations.push(`Unknown permission requested: "${perm}"`);
      highRisk = true;
      continue;
    }
    if (HIGH_RISK_PERMISSIONS.has(perm))   highRisk   = true;
    if (MEDIUM_RISK_PERMISSIONS.has(perm)) mediumRisk = true;
  }

  return {
    violations,
    riskFromPermissions: highRisk ? "HIGH" : mediumRisk ? "MEDIUM" : "LOW",
  };
}

// ─── Main Policy Evaluation ────────────────────────────────────────────────────

export function evaluatePlan(plan: Plan): PolicyResult {
  const violations: string[] = [];
  let maxRisk: RiskScore = "LOW";

  const escalate = (level: RiskScore): void => {
    const order: RiskScore[] = ["LOW", "MEDIUM", "HIGH"];
    if (order.indexOf(level) > order.indexOf(maxRisk)) maxRisk = level;
  };

  for (const step of plan.steps) {
    const label = `Step ${step.stepId} (${step.type})`;

    // 1. Denylist — highest priority
    if (isCommandDenied(step.cmd)) {
      violations.push(`${label}: Command "${step.cmd[0]}" is on the denylist.`);
      escalate("HIGH");
      continue;
    }

    // 2. Dangerous pattern
    const dangerous = hasDangerousPattern(step.cmd);
    if (dangerous) {
      violations.push(`${label}: Command matches dangerous pattern "${dangerous}".`);
      escalate("HIGH");
      continue;
    }

    // 3. Folder scope — before allowlist so correct violation is reported
    if (!isCwdAllowed(step.cwd)) {
      violations.push(`${label}: Working directory "${step.cwd}" is outside allowed scope.`);
      escalate("HIGH");
    }

    // 4. Allowlist
    if (!isCommandAllowed(step.cmd)) {
      violations.push(`${label}: Command "${step.cmd[0]}" is not on the allowlist.`);
      escalate("MEDIUM");
    }

    // 5. Network
    const netViolation = validateNetworkUsage(step.cmd);
    if (netViolation) {
      violations.push(`${label}: ${netViolation}`);
      escalate("HIGH");
    }

    // 6. Timeout sanity
    if (step.timeout > 60_000) {
      violations.push(`${label}: Timeout ${step.timeout}ms is unusually high (>60s).`);
      escalate("MEDIUM");
    }
  }

  // Permissions
  const { violations: permViolations, riskFromPermissions } = validatePermissions(
    plan.requestedPermissions
  );
  violations.push(...permViolations);
  escalate(riskFromPermissions);

  const approved = violations.length === 0;
  const reason   = approved
    ? `All ${plan.steps.length} step(s) passed policy checks. Risk level: ${maxRisk}.`
    : `Policy violations found: ${violations.length} issue(s). ${violations[0]}`;

  return { approved, riskScore: maxRisk, violations, reason };
}

export function reloadPolicies(): void {
  _allowlist        = null;
  _denylist         = null;
  _folderScope      = null;
  _networkAllowlist = null;
}
