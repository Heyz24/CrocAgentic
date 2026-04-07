/**
 * backend/agents/security/secA_policyGuard.ts
 * CrocAgentic Phase 3 — Security Agent A: Policy Guard.
 *
 * Runs the full policy engine on the plan.
 * This is the security enforcement layer — non-negotiable.
 * Any violation here = pipeline abort regardless of other agents.
 */

import { BaseAgent, AgentResult } from "../baseAgent";
import { evaluatePlan } from "../../policyEngine";
import type { Plan, PolicyResult } from "../../../utils/zodSchemas";

export class SecA_PolicyGuard extends BaseAgent {
  readonly name = "SecA_PolicyGuard" as const;

  async enforce(taskId: string, plan: Plan): Promise<AgentResult<PolicyResult>> {
    return this.run(taskId, async () => {
      const result = evaluatePlan(plan);

      this.publish("POLICY_CHECKED", taskId, {
        approved:       result.approved,
        riskScore:      result.riskScore,
        violationCount: result.violations.length,
        violations:     result.violations,
        reason:         result.reason,
      });

      this.log(
        `Policy check: ${result.approved ? "APPROVED" : "DENIED"} — risk=${result.riskScore}`,
        taskId
      );

      return result;
    });
  }
}

export const secA = new SecA_PolicyGuard();
