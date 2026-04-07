/**
 * backend/executor/planExecutor.ts
 * CrocAgentic Phase 2 — Plan Execution Orchestrator.
 *
 * Runs all steps in a plan sequentially inside Docker.
 * Stops immediately on any step failure.
 * Records full execution result per step.
 */

import * as path from "path";
import type { Plan, ExecutionResult, StepResult, FinalStatus } from "../../utils/zodSchemas";
import {
  createTaskWorkspace,
  executeStep,
  executeMockStep,
  isDockerAvailable,
  DockerExecutorOptions,
} from "./dockerExecutor";
import { saveExecutionResult } from "../taskStore/taskStore";

export interface PlanExecutorInput {
  taskId: string;
  goal: string;
  plan: Plan;
  approval: boolean;
  riskScore: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
}

// ─── Main Executor ─────────────────────────────────────────────────────────────

export async function executePlan(input: PlanExecutorInput): Promise<ExecutionResult> {
  const { taskId, goal, plan, approval, riskScore, reason } = input;
  const startedAt = new Date().toISOString();

  // If policy denied, return immediately without executing
  if (!approval) {
    const result: ExecutionResult = {
      taskId,
      goal,
      approval: false,
      riskScore,
      reason,
      steps: plan.steps.map((s) => ({
        stepId: s.stepId,
        cmd: s.cmd,
        cwd: s.cwd,
        exitCode: -1,
        stdout: "",
        stderr: "Execution skipped: plan was denied by policy engine.",
        durationMs: 0,
        status: "SKIPPED",
      })),
      finalStatus: "DENIED",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    await saveExecutionResult(result);
    return result;
  }

  // Detect docker availability
  const dockerAvailable = await isDockerAvailable();

  // Build docker options from plan permissions
  const dockerOptions: DockerExecutorOptions = {
    networkAccess: plan.requestedPermissions.includes("NETWORK_ACCESS"),
    cpus: "1",
    memory: "512m",
    pidsLimit: 256,
  };

  // Create isolated workspace for this task
  let hostWorkspacePath: string;
  try {
    hostWorkspacePath = createTaskWorkspace(taskId);
  } catch (err) {
    const errMsg = `Failed to create task workspace: ${(err as Error).message}`;
    const result: ExecutionResult = {
      taskId,
      goal,
      approval,
      riskScore,
      reason: errMsg,
      steps: [],
      finalStatus: "FAILED",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: 0,
    };
    await saveExecutionResult(result);
    return result;
  }

  // Execute steps sequentially
  const stepResults: StepResult[] = [];
  let finalStatus: FinalStatus = "COMPLETED";

  for (const step of plan.steps) {
    let stepResult: StepResult;

    if (dockerAvailable) {
      stepResult = await executeStep(step, hostWorkspacePath, dockerOptions);
    } else {
      // Fallback to mock executor (dev mode / no docker)
      stepResult = await executeMockStep(step);
    }

    stepResults.push(stepResult);

    // Stop on first failure
    if (stepResult.status === "FAILED" || stepResult.status === "TIMEOUT") {
      finalStatus = "FAILED";

      // Mark remaining steps as SKIPPED
      const remaining = plan.steps.slice(plan.steps.indexOf(step) + 1);
      for (const skippedStep of remaining) {
        stepResults.push({
          stepId: skippedStep.stepId,
          cmd: skippedStep.cmd,
          cwd: skippedStep.cwd,
          exitCode: -1,
          stdout: "",
          stderr: `Skipped because step ${step.stepId} ${stepResult.status}.`,
          durationMs: 0,
          status: "SKIPPED",
        });
      }
      break;
    }
  }

  const completedAt = new Date().toISOString();
  const durationMs =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();

  const result: ExecutionResult = {
    taskId,
    goal,
    approval,
    riskScore,
    reason,
    steps: stepResults,
    finalStatus,
    startedAt,
    completedAt,
    durationMs,
  };

  await saveExecutionResult(result);
  return result;
}
