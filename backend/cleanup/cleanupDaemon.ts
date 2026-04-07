/**
 * backend/cleanup/cleanupDaemon.ts
 * CrocAgentic Phase 2 — Cleanup Daemon.
 *
 * Cleanup policy:
 *   runtime/tasks/*   — deleted after 3 days  (temp workspace files)
 *   runtime/audit/*   — deleted after 30 days (execution audit records)
 *
 * Runs:
 *   - Once at server startup
 *   - Every 6 hours thereafter
 */

import * as fs from "fs";
import * as path from "path";

const RUNTIME_DIR     = path.resolve(process.cwd(), "runtime");
const TASKS_DIR       = path.join(RUNTIME_DIR, "tasks");
const AUDIT_DIR       = path.join(RUNTIME_DIR, "audit");

const TASK_TTL_MS     = 3  * 24 * 60 * 60 * 1000; // 3 days
const AUDIT_TTL_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days
const INTERVAL_MS     = 6  * 60 * 60 * 1000;       // 6 hours

// ─── Core cleanup function ─────────────────────────────────────────────────────

function cleanDirectory(dirPath: string, ttlMs: number, label: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  const now = Date.now();
  let removed = 0;

  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    try {
      const stat = fs.statSync(fullPath);
      const ageMs = now - stat.mtimeMs;

      if (ageMs > ttlMs) {
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
        removed++;
      }
    } catch {
      // skip files we can't stat/remove
    }
  }

  if (removed > 0) {
    console.log(`[CleanupDaemon] ${label}: removed ${removed} expired entries`);
  }

  return removed;
}

// ─── Run one cleanup pass ──────────────────────────────────────────────────────

export function runCleanup(): void {
  const tasksRemoved = cleanDirectory(TASKS_DIR, TASK_TTL_MS, "tasks (3d TTL)");
  const auditRemoved = cleanDirectory(AUDIT_DIR, AUDIT_TTL_MS, "audit (30d TTL)");

  if (tasksRemoved === 0 && auditRemoved === 0) {
    console.log("[CleanupDaemon] No expired entries found.");
  }
}

// ─── Start daemon ──────────────────────────────────────────────────────────────

let _cleanupInterval: NodeJS.Timeout | null = null;

export function startCleanupDaemon(): void {
  console.log("[CleanupDaemon] Starting — running initial cleanup...");
  runCleanup();

  _cleanupInterval = setInterval(() => {
    console.log("[CleanupDaemon] Running scheduled cleanup...");
    runCleanup();
  }, INTERVAL_MS);

  // Don't let the interval keep the process alive
  if (_cleanupInterval.unref) {
    _cleanupInterval.unref();
  }

  console.log(`[CleanupDaemon] Scheduled every ${INTERVAL_MS / 3_600_000}h`);
}

export function stopCleanupDaemon(): void {
  if (_cleanupInterval) {
    clearInterval(_cleanupInterval);
    _cleanupInterval = null;
    console.log("[CleanupDaemon] Stopped.");
  }
}
