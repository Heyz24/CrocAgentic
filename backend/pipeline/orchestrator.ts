/**
 * backend/pipeline/orchestrator.ts
 * CrocAgentic Phase 7 — Pipeline Orchestrator with Memory.
 *
 * Pipeline order:
 * MemoryAgent(read) → SecB → Thinker → Tester → SecA → SecC →
 * Decider → Allocator → Executor → Monitor → MemoryAgent(write) → Manager → TopManager
 */

import { v4 as uuidv4 }   from "uuid";
import { topManager }     from "../agents/topManager";
import { secB }           from "../agents/security/secB_injectionDetector";
import { thinker }        from "../agents/thinker";
import { tester }         from "../agents/tester";
import { secA }           from "../agents/security/secA_policyGuard";
import { secC }           from "../agents/security/secC_auditIntegrity";
import { decider }        from "../agents/decider";
import { allocator }      from "../agents/allocator";
import { monitor }        from "../agents/monitor";
import { manager }        from "../agents/manager";
import { memoryAgent }    from "../agents/memoryAgent";
import { escalationAgent } from "../agents/escalationAgent";
import { rollbackAgent }   from "../agents/rollbackAgent";
import { outputValidator } from "../agents/outputValidator";
import { executePlan }    from "../executor/planExecutor";
import { logTaskSession } from "../auditLogger";
import { pruneExpired }   from "../memory/memoryStore";
import type { ExecutionResult, RiskScore } from "../../utils/zodSchemas";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentSummary {
  agent:      string;
  success:    boolean;
  durationMs: number;
  decision?:  string;
  error?:     string;
}

export interface PipelineResult {
  taskId:      string;
  goal:        string;
  approved:    boolean;
  riskScore:   RiskScore;
  reason:      string;
  finalStatus: "COMPLETED" | "FAILED" | "DENIED" | "ABORTED";
  agentTrace:  AgentSummary[];
  execution?:  ExecutionResult;
  memory?: {
    contextUsed:    boolean;
    memoriesFound:  number;
    entriesWritten: number;
  };
  startedAt:   string;
  completedAt: string;
  durationMs:  number;
}

export interface PipelineOptions {
  autoApproveLowRisk?: boolean;
  userId?:             string;
  projectId?:          string;
  profile?:            string;
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

export async function runPipeline(
  goal:    string,
  autoApproveLowRiskOrOptions: boolean | PipelineOptions = false
): Promise<PipelineResult> {
  // Handle both old boolean signature and new options object
  const options: PipelineOptions = typeof autoApproveLowRiskOrOptions === "boolean"
    ? { autoApproveLowRisk: autoApproveLowRiskOrOptions }
    : autoApproveLowRiskOrOptions;

  const {
    autoApproveLowRisk = false,
    userId    = "shared",
    projectId = "global",
  } = options;

  const taskId    = uuidv4();
  const startedAt = new Date().toISOString();
  const trace:    AgentSummary[] = [];

  // Prune expired memories on each pipeline run
  pruneExpired();

  // TopManager starts supervising
  await topManager.supervise(taskId);

  function record(summary: AgentSummary): void { trace.push(summary); }

  function abort(reason: string, riskScore: RiskScore = "HIGH"): PipelineResult {
    topManager.completeTask(taskId, true);
    manager.clearRetries(taskId);
    const completedAt = new Date().toISOString();
    return {
      taskId, goal, approved: false, riskScore, reason,
      finalStatus: "ABORTED", agentTrace: trace,
      startedAt, completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    };
  }

  // ── STEP 0: MemoryAgent — Read context ──────────────────────────────────────
  const memReadResult = await memoryAgent.readContext(taskId, goal, userId, projectId);
  record({
    agent:      "MemoryAgent",
    success:    memReadResult.success,
    durationMs: memReadResult.durationMs,
    decision:   `${memReadResult.output?.memoriesFound ?? 0} memories loaded`,
    error:      memReadResult.error,
  });

  const contextPrompt     = memReadResult.output?.contextPrompt ?? "";
  const memoriesFound     = memReadResult.output?.memoriesFound ?? 0;
  const memoryCommand     = memReadResult.output?.memoryCommand;

  // If this was a memory management command, return early
  if (memoryCommand && memoryCommand.type !== "none") {
    topManager.completeTask(taskId, false);
    const completedAt = new Date().toISOString();
    return {
      taskId, goal, approved: true,
      riskScore: "LOW",
      reason:    `Memory command executed: ${memoryCommand.type}`,
      finalStatus: "COMPLETED",
      agentTrace:  trace,
      memory: { contextUsed: false, memoriesFound: 0, entriesWritten: 1 },
      startedAt, completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    };
  }

  // ── STEP 1: SecB — Injection scan ────────────────────────────────────────────
  const injResult = await secB.scan(taskId, goal);
  record({
    agent:      "SecB_InjectionDetector",
    success:    injResult.success,
    durationMs: injResult.durationMs,
    decision:   injResult.output?.clean ? "CLEAN" : `INJECTION: ${injResult.output?.violations[0]}`,
    error:      injResult.error,
  });

  if (!injResult.success || !injResult.output.clean) {
    const mgr = await manager.handleFailure(taskId, "SECURITY", injResult.error ?? "Injection detected");
    return abort(mgr.output?.reason ?? "Prompt injection detected");
  }

  const sanitizedGoal = injResult.output.sanitized;

  // ── STEP 2: Thinker — Plan (with memory context) ─────────────────────────────
  // Inject memory context into goal if available
  const enrichedGoal = contextPrompt
    ? `${contextPrompt}\n\nCurrent request: ${sanitizedGoal}`
    : sanitizedGoal;

  const thinkResult = await thinker.think(taskId, enrichedGoal);
  record({
    agent:      "Thinker",
    success:    thinkResult.success,
    durationMs: thinkResult.durationMs,
    decision:   thinkResult.success
      ? `${thinkResult.output.usedLLM
          ? `LLM:${thinkResult.output.provider}/${thinkResult.output.model}`
          : "deterministic"} — ${thinkResult.output.plan.steps.length} step(s)${thinkResult.output.fallback ? " [FALLBACK]" : ""}`
      : undefined,
    error:      thinkResult.error,
  });

  if (!thinkResult.success) {
    const mgr = await manager.handleFailure(taskId, "PLANNER", thinkResult.error ?? "Thinker failed");
    return abort(mgr.output?.reason ?? "Thinker failed");
  }

  const plan = thinkResult.output.plan;

  // ── STEP 3: Tester ─────────────────────────────────────────────────────────
  const testResult = await tester.test(taskId, plan);
  record({
    agent:      "Tester",
    success:    testResult.success,
    durationMs: testResult.durationMs,
    decision:   testResult.output?.valid ? "VALID" : `INVALID: ${testResult.output?.issues[0]}`,
    error:      testResult.error,
  });

  if (!testResult.success || !testResult.output.valid) {
    const mgr = await manager.handleFailure(taskId, "PLANNER", testResult.error ?? "Plan invalid");
    return abort(mgr.output?.reason ?? `Plan failed: ${testResult.output?.issues[0] ?? "unknown"}`);
  }

  // ── STEP 4: SecA — Policy ──────────────────────────────────────────────────
  const policyResult = await secA.enforce(taskId, plan);
  record({
    agent:      "SecA_PolicyGuard",
    success:    policyResult.success,
    durationMs: policyResult.durationMs,
    decision:   policyResult.output?.approved
      ? `APPROVED (${policyResult.output.riskScore})`
      : `DENIED: ${policyResult.output?.violations[0]}`,
    error:      policyResult.error,
  });

  if (!policyResult.success) {
    const mgr = await manager.handleFailure(taskId, "SECURITY", policyResult.error ?? "Policy error");
    return abort(mgr.output?.reason ?? "Policy engine error");
  }

  // ── STEP 5: SecC — Audit integrity ────────────────────────────────────────
  const auditPayload = { taskId, goal: sanitizedGoal, plan, policy: policyResult.output };
  const integrityResult = await secC.sign(taskId, auditPayload as Record<string, unknown>);
  record({
    agent:      "SecC_AuditIntegrity",
    success:    integrityResult.success,
    durationMs: integrityResult.durationMs,
    decision:   integrityResult.output ? `Signed: ${integrityResult.output.checksum.slice(0, 16)}...` : undefined,
    error:      integrityResult.error,
  });

  // ── STEP 6: Decider ────────────────────────────────────────────────────────
  const decideResult = await decider.decide(taskId, {
    injectionClean: injResult.output.clean,
    planValid:      testResult.output.valid,
    policyApproved: policyResult.output.approved,
    riskScore:      policyResult.output.riskScore,
    autoApproveLow: autoApproveLowRisk,
    violations:     policyResult.output.violations,
    testIssues:     testResult.output.issues,
  });
  record({
    agent:      "Decider",
    success:    decideResult.success,
    durationMs: decideResult.durationMs,
    decision:   decideResult.output?.approved ? "APPROVED" : "DENIED",
    error:      decideResult.error,
  });

  const approved  = decideResult.output?.approved ?? false;
  const riskScore = decideResult.output?.riskScore ?? policyResult.output.riskScore;
  const reason    = decideResult.output?.reason    ?? "Unknown decision";

  try {
    await logTaskSession(sanitizedGoal, { taskId, plan, approval: approved, riskScore, reason });
  } catch { /* non-fatal */ }

  // ── STEP 7: Allocator ─────────────────────────────────────────────────────
  const allocResult = await allocator.allocate(taskId, plan);
  record({
    agent:      "Allocator",
    success:    allocResult.success,
    durationMs: allocResult.durationMs,
    decision:   allocResult.output ? `${allocResult.output.totalSteps} steps allocated` : undefined,
    error:      allocResult.error,
  });

  // ── STEP 7b: RollbackAgent — Begin transaction ───────────────────────────────
  const workspacePath = require("path").resolve(process.cwd(), "runtime", "tasks", taskId, "workspace");
  const rollbackBegin = await rollbackAgent.beginTask(taskId, workspacePath, riskScore === "HIGH");
  record({
    agent:      "RollbackAgent",
    success:    rollbackBegin.success,
    durationMs: rollbackBegin.durationMs,
    decision:   rollbackBegin.output?.snapshotId
      ? `Transaction + snapshot: ${rollbackBegin.output.snapshotId}`
      : "Transaction started",
  });

  // ── STEP 8: Executor ──────────────────────────────────────────────────────
  record({ agent: "Executor", success: true, durationMs: 0, decision: "Starting..." });

  const execution = await executePlan({ taskId, goal: sanitizedGoal, plan, approval: approved, riskScore, reason });

  const execEntry = trace.find((t) => t.agent === "Executor");
  if (execEntry) {
    execEntry.durationMs = execution.durationMs;
    execEntry.decision   = execution.finalStatus;
    execEntry.success    = ["COMPLETED", "DENIED"].includes(execution.finalStatus);
  }

  // ── STEP 9: Monitor ───────────────────────────────────────────────────────
  const monitorResult = await monitor.watch(taskId, execution.steps);
  record({
    agent:      "Monitor",
    success:    monitorResult.success,
    durationMs: monitorResult.durationMs,
    decision:   monitorResult.output?.verdict,
    error:      monitorResult.error,
  });

  // ── STEP 8b: RollbackAgent — Commit or Rollback ─────────────────────────────
  if (execution.finalStatus === "COMPLETED") {
    await rollbackAgent.commitTask(taskId);
    // Record all shell steps for audit
    for (const step of execution.steps) {
      rollbackAgent.recordShellStep(taskId, step);
    }
  } else if (execution.finalStatus === "FAILED") {
    const rollbackResult = await rollbackAgent.rollbackTask(taskId);
    record({
      agent:      "RollbackAgent",
      success:    rollbackResult.success,
      durationMs: rollbackResult.durationMs,
      decision:   `Rolled back ${rollbackResult.output?.actionsRolledBack ?? 0} actions`,
    });
  }

  // ── STEP 9b: OutputValidator + EscalationAgent ─────────────────────────────
  // Only run output validation if task completed
  if (execution.finalStatus === "COMPLETED" && execution.steps.length > 0) {
    const outputText = execution.steps.map((s) => s.stdout).filter(Boolean).join("\n");
    const validationResult = await outputValidator.validate(taskId, outputText, sanitizedGoal);

    if (validationResult.output && !validationResult.output.approved &&
        validationResult.output.score < 40) {
      // Low confidence — escalate
      const escalResult = await escalationAgent.evaluate({
        taskId,
        goal:            sanitizedGoal,
        plan,
        executedSteps:   execution.steps,
        trigger:         "LOW_CONFIDENCE",
        riskScore,
        confidenceScore: validationResult.output.score,
        reason:          `Output quality score ${validationResult.output.score}/100 is below threshold. Issues: ${validationResult.output.issues.join(", ")}`,
        autoApproveLow:  autoApproveLowRisk ?? false,
      });

      if (escalResult.output?.escalated) {
        record({
          agent:      "EscalationAgent",
          success:    true,
          durationMs: escalResult.durationMs,
          decision:   `Escalated — ${escalResult.output.waitingFor?.slice(0, 80)}`,
        });
      }
    }
  }

  // ── STEP 10: MemoryAgent — Write results ──────────────────────────────────
  const memWriteResult = await memoryAgent.writeResults(
    taskId, sanitizedGoal, execution, userId, projectId
  );
  record({
    agent:      "MemoryAgent",
    success:    memWriteResult.success,
    durationMs: memWriteResult.durationMs,
    decision:   `${memWriteResult.output?.entriesWritten ?? 0} memories saved`,
    error:      memWriteResult.error,
  });

  // ── STEP 11: Manager ──────────────────────────────────────────────────────
  const healthResult = await manager.healthCheck(taskId);
  record({
    agent:      "Manager",
    success:    healthResult.success,
    durationMs: healthResult.durationMs,
    decision:   healthResult.output?.issues.length === 0 ? "HEALTHY" : `Issues: ${healthResult.output?.issues.join(", ")}`,
    error:      healthResult.error,
  });

  manager.clearRetries(taskId);
  topManager.completeTask(taskId, false);

  const completedAt  = new Date().toISOString();
  const finalStatus  = execution.finalStatus === "COMPLETED" ? "COMPLETED"
    : execution.finalStatus === "DENIED" ? "DENIED" : "FAILED";

  return {
    taskId,
    goal:        sanitizedGoal,
    approved,
    riskScore,
    reason,
    finalStatus,
    agentTrace:  trace,
    execution,
    memory: {
      contextUsed:    memoriesFound > 0,
      memoriesFound,
      entriesWritten: memWriteResult.output?.entriesWritten ?? 0,
    },
    startedAt,
    completedAt,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  };
}
