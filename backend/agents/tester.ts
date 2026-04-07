/**
 * backend/agents/tester.ts
 * CrocAgentic Phase 3 — Tester Agent.
 *
 * Validates the plan produced by Thinker.
 * Rule-based structural and logical checks — no LLM needed.
 * Catches malformed plans, impossible steps, and logical contradictions
 * before they reach the security layer.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import { PlanSchema } from "../../utils/zodSchemas";
import type { Plan } from "../../utils/zodSchemas";

export interface TesterResult {
  valid:    boolean;
  issues:   string[];
  warnings: string[];
}

export class Tester extends BaseAgent {
  readonly name = "Tester" as const;

  async test(taskId: string, plan: Plan): Promise<AgentResult<TesterResult>> {
    return this.run(taskId, async () => {
      const issues:   string[] = [];
      const warnings: string[] = [];

      // 1. Zod schema validation — structural correctness
      const zodResult = PlanSchema.safeParse(plan);
      if (!zodResult.success) {
        zodResult.error.errors.forEach((e) =>
          issues.push(`Schema error at ${e.path.join(".")}: ${e.message}`)
        );
      }

      // 2. Step ID continuity check
      const ids = plan.steps.map((s) => s.stepId);
      ids.forEach((id, i) => {
        if (id !== i + 1) issues.push(`stepId ${id} out of sequence at index ${i}`);
      });

      // 3. Duplicate step IDs
      const seen = new Set<number>();
      for (const id of ids) {
        if (seen.has(id)) issues.push(`Duplicate stepId: ${id}`);
        seen.add(id);
      }

      // 4. Empty command check
      for (const step of plan.steps) {
        if (!step.cmd[0] || step.cmd[0].trim() === "") {
          issues.push(`Step ${step.stepId}: empty command`);
        }
      }

      // 5. CWD consistency — all steps should share the same base workspace
      const cwds = plan.steps.map((s) => s.cwd);
      const uniqueCwds = new Set(cwds);
      if (uniqueCwds.size > 3) {
        warnings.push(`Plan uses ${uniqueCwds.size} different working directories — review carefully`);
      }

      // 6. Permission vs step type consistency
      const hasWriteSteps = plan.steps.some((s) =>
        s.type === "WRITE_FILE" || s.cmd.some((c) => ["mkdir", "touch", "cp", "mv"].includes(c))
      );
      if (hasWriteSteps && !plan.requestedPermissions.includes("WRITE_FILESYSTEM")) {
        warnings.push("Plan has write operations but did not request WRITE_FILESYSTEM permission");
      }

      // 7. Network steps without NETWORK_ACCESS permission
      const hasNetworkSteps = plan.steps.some((s) =>
        s.type === "HTTP_REQUEST" || s.cmd.some((c) => ["curl", "wget", "fetch"].includes(c))
      );
      if (hasNetworkSteps && !plan.requestedPermissions.includes("NETWORK_ACCESS")) {
        issues.push("Plan has network operations but did not request NETWORK_ACCESS permission");
      }

      // 8. Timeout sanity
      for (const step of plan.steps) {
        if (step.timeout < 500) {
          warnings.push(`Step ${step.stepId}: timeout of ${step.timeout}ms may be too short`);
        }
      }

      const valid = issues.length === 0;

      this.publish("PLAN_TESTED", taskId, {
        valid,
        issueCount:   issues.length,
        warningCount: warnings.length,
        issues,
        warnings,
      });

      this.log(
        `Plan test: ${valid ? "VALID" : "INVALID"} — ${issues.length} issues, ${warnings.length} warnings`,
        taskId
      );

      return { valid, issues, warnings };
    });
  }
}

export const tester = new Tester();
