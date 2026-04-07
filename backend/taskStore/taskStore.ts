/**
 * backend/taskStore/taskStore.ts
 * CrocAgentic Phase 2 — Task Store.
 *
 * Persists full execution results to:
 *   runtime/audit/<taskId>.json
 *
 * Provides lookup by taskId and listing of all stored tasks.
 */

import * as fs from "fs";
import * as path from "path";
import type { ExecutionResult } from "../../utils/zodSchemas";

const AUDIT_DIR = path.resolve(process.cwd(), "runtime", "audit");

function ensureAuditDir(): void {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

function auditFilePath(taskId: string): string {
  // Sanitize taskId — only allow UUID characters to prevent path traversal
  const safe = taskId.replace(/[^a-zA-Z0-9\-]/g, "");
  return path.join(AUDIT_DIR, `${safe}.json`);
}

// ─── Save ──────────────────────────────────────────────────────────────────────

export async function saveExecutionResult(result: ExecutionResult): Promise<void> {
  ensureAuditDir();
  const filePath = auditFilePath(result.taskId);
  const json = JSON.stringify(result, null, 2);
  fs.writeFileSync(filePath, json, "utf-8");
}

// ─── Load ──────────────────────────────────────────────────────────────────────

export async function loadExecutionResult(taskId: string): Promise<ExecutionResult | null> {
  const filePath = auditFilePath(taskId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ExecutionResult;
  } catch {
    return null;
  }
}

// ─── List All ──────────────────────────────────────────────────────────────────

export async function listExecutionResults(
  limit = 50,
  offset = 0
): Promise<{ total: number; results: ExecutionResult[] }> {
  ensureAuditDir();

  const files = fs
    .readdirSync(AUDIT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse(); // newest first by filename (UUID sort = creation order)

  const total = files.length;
  const sliced = files.slice(offset, offset + limit);

  const results: ExecutionResult[] = [];
  for (const file of sliced) {
    try {
      const raw = fs.readFileSync(path.join(AUDIT_DIR, file), "utf-8");
      results.push(JSON.parse(raw) as ExecutionResult);
    } catch {
      // skip corrupted files
    }
  }

  return { total, results };
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

export async function getTaskStats(): Promise<{
  total: number;
  completed: number;
  failed: number;
  denied: number;
  byRisk: Record<string, number>;
}> {
  const { results } = await listExecutionResults(10_000, 0);
  const stats = {
    total: results.length,
    completed: 0,
    failed: 0,
    denied: 0,
    byRisk: { LOW: 0, MEDIUM: 0, HIGH: 0 } as Record<string, number>,
  };

  for (const r of results) {
    if (r.finalStatus === "COMPLETED") stats.completed++;
    else if (r.finalStatus === "FAILED") stats.failed++;
    else if (r.finalStatus === "DENIED") stats.denied++;
    stats.byRisk[r.riskScore] = (stats.byRisk[r.riskScore] ?? 0) + 1;
  }

  return stats;
}
