/**
 * backend/agents/escalationAgent.ts
 * CrocAgentic Phase 8 — Escalation Agent.
 *
 * Decides when to escalate and builds the full evidence package.
 * Triggers:
 *   1. OutputValidator score < threshold
 *   2. Destructive actions detected
 *   3. HIGH risk + no autoApprove
 *   4. Retry limit hit
 *
 * Creates escalation record and notifies human via all channels.
 * Pipeline pauses and waits for resolution.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import { createEscalation, getEscalation, Escalation, EscalationTrigger } from "../escalation/escalationStore";
import { notifyEscalation } from "../escalation/escalationNotifier";
import type { Plan, StepResult, RiskScore } from "../../utils/zodSchemas";

export interface EscalationInput {
  taskId:          string;
  goal:            string;
  plan:            Plan;
  executedSteps:   StepResult[];
  trigger:         EscalationTrigger;
  riskScore:       RiskScore;
  confidenceScore: number;
  reason:          string;
  autoApproveLow:  boolean;
}

export interface EscalationResult {
  escalated:     boolean;
  escalationId?: string;
  approved?:     boolean;
  resolution?:   string;
  waitingFor?:   string;
}

// Detect destructive commands in a plan
function hasDestructiveActions(plan: Plan): boolean {
  const destructive = ["rm", "rmdir", "del", "delete", "drop", "truncate", "format", "overwrite"];
  return plan.steps.some((step) =>
    destructive.some((d) => step.cmd.join(" ").toLowerCase().includes(d))
  );
}

function buildSuggestedActions(trigger: EscalationTrigger, riskScore: RiskScore): string[] {
  const base = [
    "APPROVE — agent will proceed with the planned actions",
    "REJECT — agent will cancel this task and log the reason",
  ];

  if (trigger === "DESTRUCTIVE_ACTION") {
    base.splice(1, 0, "APPROVE WITH BACKUP — request agent to backup files before proceeding");
  }
  if (riskScore === "HIGH") {
    base.push("MODIFY — reply with modified instructions for the agent to re-plan");
  }

  return base;
}

export class EscalationAgent extends BaseAgent {
  readonly name = "EscalationAgent" as const;

  async evaluate(input: EscalationInput): Promise<AgentResult<EscalationResult>> {
    return this.run(input.taskId, async () => {
      const {
        taskId, goal, plan, executedSteps,
        trigger, riskScore, confidenceScore, reason, autoApproveLow,
      } = input;

      // Check if escalation is actually needed
      const shouldEscalate =
        trigger === "LOW_CONFIDENCE" && confidenceScore < 40 ||
        trigger === "DESTRUCTIVE_ACTION" && hasDestructiveActions(plan) ||
        trigger === "HIGH_RISK" && riskScore === "HIGH" && !autoApproveLow ||
        trigger === "RETRY_LIMIT";

      if (!shouldEscalate) {
        return { escalated: false };
      }

      // Build evidence package
      const evidence = {
        goal,
        planSteps:    plan.steps,
        executedSteps,
        whyEscalating: reason,
        whatIsNeeded:  this.buildWhatIsNeeded(trigger, plan),
        confidenceScore,
        riskAssessment: `Risk level: ${riskScore}. Trigger: ${trigger}.`,
        suggestedActions: buildSuggestedActions(trigger, riskScore),
      };

      // Create escalation record
      const escalation = createEscalation({
        taskId,
        trigger,
        risk:     riskScore === "HIGH" ? "HIGH" : "MEDIUM",
        evidence,
      });

      // Notify human via all configured channels
      await notifyEscalation(escalation);

      this.publish("OUTPUT_ESCALATED", taskId, {
        escalationId:    escalation.id,
        trigger,
        risk:            escalation.risk,
        confidenceScore,
        approvalRequired: escalation.risk === "HIGH",
      });

      this.log(
        `Escalated — ID: ${escalation.id} | Risk: ${escalation.risk} | Trigger: ${trigger}`,
        taskId
      );

      return {
        escalated:     true,
        escalationId:  escalation.id,
        approved:      false,
        waitingFor:    `Human approval required. Escalation ID: ${escalation.id}. ` +
                       `Expires: ${escalation.expiresAt}. ` +
                       `POST /escalation/${escalation.id}/approve or /reject`,
      };
    });
  }

  // Wait for human resolution (non-blocking poll)
  async waitForResolution(
    escalationId: string,
    pollIntervalMs = 5000,
    maxWaitMs = 30000 // max 30s in pipeline, then return pending
  ): Promise<EscalationResult> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      const esc = getEscalation(escalationId);
      if (!esc) break;

      if (esc.status === "APPROVED") {
        return { escalated: true, escalationId, approved: true, resolution: esc.resolution };
      }
      if (esc.status === "REJECTED") {
        return { escalated: true, escalationId, approved: false, resolution: esc.resolution };
      }
      if (esc.status === "EXPIRED") {
        return { escalated: true, escalationId, approved: false, resolution: "Auto-rejected: expired" };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    // Still pending — return with waiting message
    return {
      escalated:    true,
      escalationId,
      approved:     false,
      waitingFor:   `Task paused. Approve at POST /escalation/${escalationId}/approve`,
    };
  }

  private buildWhatIsNeeded(trigger: EscalationTrigger, plan: Plan): string {
    switch (trigger) {
      case "LOW_CONFIDENCE":
        return "Review the proposed plan and approve if acceptable, or provide clarification.";
      case "DESTRUCTIVE_ACTION":
        return `Approval to execute potentially destructive command: ${plan.steps.find((s) =>
          ["rm","del","delete","drop"].some((d) => s.cmd[0]?.toLowerCase().includes(d))
        )?.cmd.join(" ") ?? "unknown"}`;
      case "HIGH_RISK":
        return "Explicit approval for HIGH risk task execution.";
      case "RETRY_LIMIT":
        return "Task failed after maximum retries. Human guidance needed to proceed.";
      default:
        return "Human review and approval.";
    }
  }
}

export const escalationAgent = new EscalationAgent();
