/**
 * backend/agents/memoryAgent.ts
 * CrocAgentic Phase 7 — Memory Agent.
 *
 * Runs BEFORE Thinker: reads memory, builds context packet.
 * Runs AFTER Executor: writes results to memory, updates project knowledge.
 *
 * Also handles natural language memory commands:
 * "forget project X", "always format reports as PDF", etc.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import {
  remember,
  recall,
  forget,
  clearShortTerm,
  getMemoryStats,
  MemoryEntry,
} from "../memory/memoryStore";
import {
  buildContext,
  parseMemoryCommand,
  MemoryCommand,
} from "../memory/contextBuilder";
import type { ExecutionResult } from "../../utils/zodSchemas";

export interface MemoryReadResult {
  contextPrompt:  string;
  memoriesFound:  number;
  memoryCommand?: MemoryCommand;
}

export interface MemoryWriteResult {
  entriesWritten: number;
  projectUpdated: boolean;
}

export class MemoryAgent extends BaseAgent {
  readonly name = "MemoryAgent" as const;

  // ── READ: before Thinker ────────────────────────────────────────────────────
  async readContext(
    taskId:    string,
    goal:      string,
    userId     = "shared",
    projectId  = "global"
  ): Promise<AgentResult<MemoryReadResult>> {
    return this.run(taskId, async () => {

      // Check for natural language memory commands first
      const memoryCommand = parseMemoryCommand(goal);

      if (memoryCommand.type !== "none") {
        this.log(`Memory command detected: ${memoryCommand.type}`, taskId);
        await this.executeMemoryCommand(memoryCommand, userId, projectId);
      }

      // Build context from memory
      const contextPrompt = buildContext({ userId, projectId, goal });
      const memoriesFound = contextPrompt.length > 50 ? 1 : 0;

      // Store this task in short-term memory
      remember({
        layer:     "short",
        category:  "task",
        userId,
        projectId: taskId,
        key:       `task_goal_${taskId.slice(0, 8)}`,
        content:   goal,
        metadata:  { taskId, timestamp: new Date().toISOString() },
      });

      this.publish("PLAN_CREATED", taskId, {
        memoriesFound,
        hasContext: contextPrompt.length > 50,
        memoryCommand: memoryCommand.type,
      });

      this.log(
        `Context built — ${memoriesFound} memory hits, command: ${memoryCommand.type}`,
        taskId
      );

      return { contextPrompt, memoriesFound, memoryCommand };
    });
  }

  // ── WRITE: after Executor ───────────────────────────────────────────────────
  async writeResults(
    taskId:     string,
    goal:       string,
    result:     ExecutionResult,
    userId      = "shared",
    projectId   = "global"
  ): Promise<AgentResult<MemoryWriteResult>> {
    return this.run(taskId, async () => {
      let entriesWritten = 0;

      // 1. Store task result in medium-term memory
      if (result.finalStatus === "COMPLETED") {
        const outputText = result.steps
          .map((s) => s.stdout)
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000);

        remember({
          layer:     "medium",
          category:  "task",
          userId,
          projectId,
          key:       `task_${taskId.slice(0, 8)}`,
          content:   `Goal: ${goal}\nResult: ${outputText || "Completed successfully"}`,
          metadata:  {
            taskId,
            finalStatus: result.finalStatus,
            riskScore:   result.riskScore,
            durationMs:  result.durationMs,
          },
        });
        entriesWritten++;
      }

      // 2. Extract and store file knowledge from results
      for (const step of result.steps) {
        if (step.cmd.includes("ls") || step.cmd.includes("find")) {
          if (step.stdout && step.stdout.length > 5) {
            remember({
              layer:     "medium",
              category:  "file",
              userId,
              projectId,
              key:       `workspace_files_${projectId}`,
              content:   `Workspace files as of ${new Date().toISOString()}:\n${step.stdout.slice(0, 1000)}`,
              metadata:  { taskId, command: step.cmd.join(" ") },
            });
            entriesWritten++;
          }
        }
      }

      // 3. Update project summary
      const recentTasks = recall({
        layer: "medium", category: "task",
        userId, projectId, limit: 5,
      });

      if (recentTasks.length >= 2) {
        const summary = [
          `Project: ${projectId}`,
          `Last updated: ${new Date().toISOString()}`,
          `Recent tasks: ${recentTasks.map((t) => t.key).join(", ")}`,
          `Total tasks in memory: ${recentTasks.length}`,
        ].join("\n");

        remember({
          layer:     "medium",
          category:  "project",
          userId,
          projectId,
          key:       `project_summary_${projectId}`,
          content:   summary,
          metadata:  { taskCount: recentTasks.length },
        });
        entriesWritten++;
      }

      // 4. Clear short-term memory for this task
      clearShortTerm(taskId);

      this.log(`Memory written — ${entriesWritten} entries`, taskId);

      return { entriesWritten, projectUpdated: entriesWritten > 0 };
    });
  }

  // ── Execute memory commands ─────────────────────────────────────────────────
  private async executeMemoryCommand(
    cmd:       MemoryCommand,
    userId:    string,
    projectId: string
  ): Promise<void> {
    switch (cmd.type) {
      case "forget_project": {
        const removed = forget({ projectId: cmd.projectId });
        this.log(`Forgot project "${cmd.projectId}" — removed ${removed} entries`);
        break;
      }
      case "set_preference": {
        remember({
          layer: "long", category: "preference",
          userId, projectId: "global",
          key:     cmd.key,
          content: cmd.value,
        });
        this.log(`Set preference: ${cmd.value}`);
        break;
      }
      case "add_rule": {
        remember({
          layer: "long", category: "rule",
          userId: "shared", projectId: "global",
          key:     `rule_${Date.now()}`,
          content: cmd.rule,
        });
        this.log(`Added org rule: ${cmd.rule}`);
        break;
      }
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  async getStats(taskId: string): Promise<AgentResult<ReturnType<typeof getMemoryStats>>> {
    return this.run(taskId, async () => getMemoryStats());
  }
}

export const memoryAgent = new MemoryAgent();
