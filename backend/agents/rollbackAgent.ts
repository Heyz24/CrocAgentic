/**
 * backend/agents/rollbackAgent.ts
 * CrocAgentic Phase 9 — Rollback Agent.
 *
 * Manages the undo stack for every pipeline run.
 * Begins transaction before Executor, commits after success,
 * rolls back on failure.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import {
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  takeSnapshot,
  captureShellCommand,
  getRollbackStats,
  purgeQuarantine,
} from "../rollback/rollbackStore";
import type { StepResult } from "../../utils/zodSchemas";

export interface RollbackSummary {
  taskId:            string;
  transactionStarted: boolean;
  snapshotId?:       string;
  committed:         boolean;
  rolledBack:        boolean;
  actionsRecorded:   number;
  errors:            string[];
}

export class RollbackAgent extends BaseAgent {
  readonly name = "RollbackAgent" as const;

  // Called before Executor — start transaction and take snapshot
  async beginTask(
    taskId:        string,
    workspacePath: string,
    takeSnap       = false
  ): Promise<AgentResult<{ transactionId: string; snapshotId?: string }>> {
    return this.run(taskId, async () => {
      beginTransaction(taskId);

      let snapshotId: string | undefined;
      if (takeSnap) {
        snapshotId = await takeSnapshot(taskId, workspacePath);
        this.log(`Snapshot taken: ${snapshotId}`, taskId);
      }

      this.log(`Transaction started`, taskId);
      return { transactionId: taskId, snapshotId };
    });
  }

  // Called after successful Executor — commit all actions
  async commitTask(taskId: string): Promise<AgentResult<{ committed: boolean }>> {
    return this.run(taskId, async () => {
      commitTransaction(taskId);
      this.log(`Transaction committed`, taskId);
      return { committed: true };
    });
  }

  // Called on pipeline failure — undo everything
  async rollbackTask(taskId: string): Promise<AgentResult<{
    rolledBack: boolean;
    actionsRolledBack: number;
    errors: string[];
  }>> {
    return this.run(taskId, async () => {
      this.log(`Rolling back transaction...`, taskId);
      const result = await rollbackTransaction(taskId);

      if (result.success) {
        this.log(`Rollback complete — ${result.actionsRolledBack} actions undone`, taskId);
      } else {
        this.logError(`Rollback partial — ${result.errors.join("; ")}`, taskId);
      }

      this.publish("EXECUTION_DONE", taskId, {
        rolledBack: true,
        actionsRolledBack: result.actionsRolledBack,
        errors: result.errors,
      });

      return {
        rolledBack:        result.success,
        actionsRolledBack: result.actionsRolledBack,
        errors:            result.errors,
      };
    });
  }

  // Record shell commands for audit (non-reversible but logged)
  recordShellStep(taskId: string, step: StepResult): void {
    captureShellCommand(taskId, step.cmd);
  }

  // Purge old quarantine files (called by cleanup daemon)
  async purgeOldFiles(taskId: string): Promise<AgentResult<{ purged: number }>> {
    return this.run(taskId, async () => {
      const purged = purgeQuarantine();
      return { purged };
    });
  }

  async getStats(taskId: string): Promise<AgentResult<ReturnType<typeof getRollbackStats>>> {
    return this.run(taskId, async () => getRollbackStats());
  }
}

export const rollbackAgent = new RollbackAgent();
