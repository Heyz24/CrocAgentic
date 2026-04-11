/**
 * backend/agents/thinker.ts
 * CrocAgentic Phase 4 — Thinker Agent (LLM-powered).
 *
 * Phase 3: deterministic planner only.
 * Phase 4: tries LLM first, falls back to deterministic if LLM fails.
 * LLM output is always validated by llmOutputValidator before use.
 */

import { BaseAgent, AgentResult } from "./baseAgent";
import { createPlan } from "../planner";
import { routeLLMRequest } from "../llm/llmRouter";
import { routeTaskToModel } from "../llm/routing/modelRouter";
import type { Plan } from "../../utils/zodSchemas";

export interface ThinkerResult {
  taskId:    string;
  plan:      Plan;
  goal:      string;
  usedLLM:   boolean;
  provider:  string;
  model:     string;
  fallback:  boolean;
  warnings:  string[];
}

export class Thinker extends BaseAgent {
  readonly name = "Thinker" as const;

  async think(taskId: string, goal: string): Promise<AgentResult<ThinkerResult>> {
    return this.run(taskId, async () => {
      // Always produce deterministic plan as fallback baseline
      const { plan: deterministicPlan } = createPlan(goal);

      // Route through LLM (may use LLM or fall back to deterministic)
      // Route to correct model based on task type
    const { taskType, modelConfig } = routeTaskToModel(goal);
    const routerResult = await routeLLMRequest(goal, deterministicPlan);

      const { plan, usedLLM, provider, model, fallback, fallbackReason, warnings } = routerResult;

      this.publish("PLAN_CREATED", taskId, {
        stepCount:   plan.steps.length,
        permissions: plan.requestedPermissions,
        goal,
        usedLLM,
        provider,
        model,
        fallback,
        fallbackReason,
      });

      if (usedLLM) {
        this.log(`LLM plan created via ${provider}/${model} — ${plan.steps.length} step(s)`, taskId);
      } else if (fallback) {
        this.log(`LLM fallback to deterministic — ${plan.steps.length} step(s) (reason: ${fallbackReason})`, taskId);
      } else {
        this.log(`Deterministic plan — ${plan.steps.length} step(s)`, taskId);
      }

      if (warnings.length > 0) {
        this.log(`Warnings: ${warnings.join("; ")}`, taskId);
      }

      return { taskId, plan, goal, usedLLM, provider, model, fallback, warnings };
    });
  }
}

export const thinker = new Thinker();
