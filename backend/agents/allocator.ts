/**
 * backend/agents/allocator.ts
 * CrocAgentic Phase 3 — Allocator Agent.
 *
 * Receives approved plan from Decider.
 * Assigns each step to the Executor with resource allocation metadata.
 * Phase 3: single Executor. Phase 6: can route steps to specialized executors.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import type { Plan, PlanStep } from "../../utils/zodSchemas";

export interface AllocatedStep {
  step:          PlanStep;
  executorId:    string;
  priority:      number;
  networkAccess: boolean;
  memoryMb:      number;
  cpus:          string;
}

export interface AllocatorResult {
  allocatedSteps: AllocatedStep[];
  totalSteps:     number;
  networkAccess:  boolean;
}

export class Allocator extends BaseAgent {
  readonly name = "Allocator" as const;

  async allocate(taskId: string, plan: Plan): Promise<AgentResult<AllocatorResult>> {
    return this.run(taskId, async () => {
      const networkAccess = plan.requestedPermissions.includes("NETWORK_ACCESS");

      const allocatedSteps: AllocatedStep[] = plan.steps.map((step, i) => ({
        step,
        executorId:    "executor-primary",
        priority:      i + 1,
        networkAccess,
        memoryMb:      512,
        cpus:          "1",
      }));

      this.publish("TASK_ALLOCATED", taskId, {
        stepCount:    allocatedSteps.length,
        networkAccess,
        executorId:   "executor-primary",
      });

      this.log(`Allocated ${allocatedSteps.length} step(s) to executor-primary`, taskId);

      return { allocatedSteps, totalSteps: allocatedSteps.length, networkAccess };
    });
  }
}

export const allocator = new Allocator();
