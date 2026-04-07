/**
 * backend/agents/decider.ts
 * CrocAgentic Phase 3 — Decider Agent.
 *
 * Final approve/deny gate. Receives all upstream agent results
 * and makes the definitive go/no-go decision.
 *
 * Rules (in priority order — all must pass):
 * 1. Injection scan must be clean
 * 2. Plan must be structurally valid (Tester)
 * 3. Policy must approve (SecA)
 * 4. autoApproveLowRisk flag can override for LOW risk only
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import type { RiskScore } from "../../utils/zodSchemas";

export interface DeciderInput {
  injectionClean:  boolean;
  planValid:       boolean;
  policyApproved:  boolean;
  riskScore:       RiskScore;
  autoApproveLow:  boolean;
  violations:      string[];
  testIssues:      string[];
}

export interface DeciderResult {
  approved: boolean;
  reason:   string;
  riskScore: RiskScore;
}

export class Decider extends BaseAgent {
  readonly name = "Decider" as const;

  async decide(taskId: string, input: DeciderInput): Promise<AgentResult<DeciderResult>> {
    return this.run(taskId, async () => {
      let approved = false;
      let reason   = "";

      // Rule 1 — injection clean is non-negotiable
      if (!input.injectionClean) {
        reason = "DENIED: Prompt injection detected in goal. Task rejected at security boundary.";
      }
      // Rule 2 — plan must be structurally valid
      else if (!input.planValid) {
        reason = `DENIED: Plan failed structural validation. Issues: ${input.testIssues[0] ?? "unknown"}`;
      }
      // Rule 3 — policy approved, or autoApproveLow override
      else if (input.policyApproved) {
        approved = true;
        reason   = `APPROVED: All checks passed. Risk level: ${input.riskScore}.`;
      }
      else if (input.autoApproveLow && input.riskScore === "LOW") {
        approved = true;
        reason   = "APPROVED: Auto-approved (LOW risk + autoApproveLowRisk=true).";
      }
      else {
        reason = `DENIED: Policy violations detected. ${input.violations[0] ?? "See audit log for details."}`;
      }

      this.publish("TASK_DECIDED", taskId, { approved, reason, riskScore: input.riskScore });
      this.log(`Decision: ${approved ? "APPROVED" : "DENIED"}`, taskId);

      return { approved, reason, riskScore: input.riskScore };
    });
  }
}

export const decider = new Decider();
