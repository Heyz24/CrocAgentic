/**
 * backend/agents/manager.ts
 * CrocAgentic Phase 3 — Manager Agent.
 *
 * Handles failures, retries, file corruption, and crash recovery.
 * Supervised by TopManager.
 *
 * Retry policy (Q3 answer):
 * - Security agent failure  → ALWAYS abort, no retry
 * - Executor step failure   → retry once, then abort
 * - Thinker/Tester failure  → retry once with backoff
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import * as fs from "fs";
import * as path from "path";

export type FailureType = "SECURITY" | "EXECUTOR" | "PLANNER" | "UNKNOWN";

export interface ManagerDecision {
  action:   "RETRY" | "ABORT" | "CONTINUE";
  reason:   string;
  retryCount: number;
}

export interface HealthCheckResult {
  workspaceOk:   boolean;
  auditDirOk:    boolean;
  integrityDirOk: boolean;
  issues:        string[];
}

const RUNTIME_DIR   = path.resolve(process.cwd(), "runtime");
const AUDIT_DIR     = path.join(RUNTIME_DIR, "audit");
const INTEGRITY_DIR = path.join(RUNTIME_DIR, "integrity");
const TASKS_DIR     = path.join(RUNTIME_DIR, "tasks");

export class Manager extends BaseAgent {
  readonly name = "Manager" as const;

  private retryCounts: Map<string, number> = new Map();

  async handleFailure(
    taskId:      string,
    failureType: FailureType,
    error:       string
  ): Promise<AgentResult<ManagerDecision>> {
    return this.run(taskId, async () => {
      const key       = `${taskId}:${failureType}`;
      const retries   = this.retryCounts.get(key) ?? 0;

      let decision: ManagerDecision;

      if (failureType === "SECURITY") {
        // Security failures are non-negotiable — never retry
        decision = {
          action:     "ABORT",
          reason:     `Security agent failure — aborting immediately. Error: ${error}`,
          retryCount: retries,
        };
        this.logError(`Security failure — ABORT (no retry): ${error}`, taskId);
      } else if (retries >= 1) {
        // Already retried once — abort
        decision = {
          action:     "ABORT",
          reason:     `Max retries (1) exceeded for ${failureType} failure. Error: ${error}`,
          retryCount: retries,
        };
        this.logError(`Max retries exceeded — ABORT`, taskId);
      } else {
        // First failure for non-security agent — retry with backoff
        this.retryCounts.set(key, retries + 1);
        await new Promise((r) => setTimeout(r, 500 * (retries + 1))); // 500ms backoff

        decision = {
          action:     "RETRY",
          reason:     `Retrying ${failureType} failure (attempt ${retries + 1}). Error: ${error}`,
          retryCount: retries + 1,
        };
        this.log(`Scheduling retry ${retries + 1} for ${failureType} failure`, taskId);
      }

      this.publish("AGENT_CRASHED", taskId, {
        failureType,
        action:     decision.action,
        retryCount: decision.retryCount,
        error,
      });

      return decision;
    });
  }

  async healthCheck(taskId: string): Promise<AgentResult<HealthCheckResult>> {
    return this.run(taskId, async () => {
      const issues: string[] = [];

      const workspaceOk    = fs.existsSync(TASKS_DIR);
      const auditDirOk     = fs.existsSync(AUDIT_DIR);
      const integrityDirOk = fs.existsSync(INTEGRITY_DIR);

      if (!workspaceOk)    issues.push("runtime/tasks directory missing");
      if (!auditDirOk)     issues.push("runtime/audit directory missing");
      if (!integrityDirOk) issues.push("runtime/integrity directory missing");

      // Check for corrupted JSON in audit dir
      if (auditDirOk) {
        const files = fs.readdirSync(AUDIT_DIR).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          try {
            const raw = fs.readFileSync(path.join(AUDIT_DIR, file), "utf-8");
            JSON.parse(raw);
          } catch {
            issues.push(`Corrupted audit file: ${file}`);
          }
        }
      }

      if (issues.length > 0) {
        this.logError(`Health check issues: ${issues.join(", ")}`, taskId);
      } else {
        this.log("Health check passed", taskId);
      }

      return { workspaceOk, auditDirOk, integrityDirOk, issues };
    });
  }

  clearRetries(taskId: string): void {
    // Clean up retry state after task completes
    for (const key of this.retryCounts.keys()) {
      if (key.startsWith(taskId)) this.retryCounts.delete(key);
    }
  }
}

export const manager = new Manager();
