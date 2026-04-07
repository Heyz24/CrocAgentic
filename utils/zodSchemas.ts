/**
 * utils/zodSchemas.ts
 * Shared Zod schemas — Phase 1 + Phase 2.
 */

import { z } from "zod";

// ─── Step Types ────────────────────────────────────────────────────────────────

export const StepTypeSchema = z.enum(["RUN_COMMAND", "READ_FILE", "WRITE_FILE", "HTTP_REQUEST"]);
export type StepType = z.infer<typeof StepTypeSchema>;

// ─── Plan Step ─────────────────────────────────────────────────────────────────

export const PlanStepSchema = z.object({
  stepId: z.number().int().positive(),
  type: StepTypeSchema,
  cmd: z.array(z.string()).min(1),
  cwd: z.string().min(1),
  timeout: z.number().int().positive().max(300_000),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

// ─── Risk Score ────────────────────────────────────────────────────────────────

export const RiskScoreSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskScore = z.infer<typeof RiskScoreSchema>;

// ─── Full Plan ─────────────────────────────────────────────────────────────────

export const PlanSchema = z.object({
  steps: z.array(PlanStepSchema).min(1),
  requestedPermissions: z.array(z.string()),
});
export type Plan = z.infer<typeof PlanSchema>;

// ─── Task Session ──────────────────────────────────────────────────────────────

export const TaskSessionSchema = z.object({
  taskId: z.string().uuid(),
  plan: PlanSchema,
  approval: z.boolean(),
  riskScore: RiskScoreSchema,
  reason: z.string(),
});
export type TaskSession = z.infer<typeof TaskSessionSchema>;

// ─── API Schemas ───────────────────────────────────────────────────────────────

export const GoalRequestSchema = z.object({
  goal: z.string().min(3).max(1000),
});
export type GoalRequest = z.infer<typeof GoalRequestSchema>;

export const ExecuteRequestSchema = z.object({
  goal: z.string().min(3).max(1000),
  autoApproveLowRisk: z.boolean().default(false),
});
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export const AgentResponseSchema = z.object({
  taskId: z.string().uuid(),
  plan: PlanSchema,
  approval: z.boolean(),
  riskScore: RiskScoreSchema,
  reason: z.string(),
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ─── Policy Engine Result ──────────────────────────────────────────────────────

export const PolicyResultSchema = z.object({
  approved: z.boolean(),
  riskScore: RiskScoreSchema,
  violations: z.array(z.string()),
  reason: z.string(),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

// ─── Audit Log Entry ───────────────────────────────────────────────────────────

export const AuditLogEntrySchema = z.object({
  taskId: z.string().uuid(),
  timestamp: z.string().datetime(),
  goal: z.string(),
  planJson: z.string(),
  approval: z.boolean(),
  riskScore: RiskScoreSchema,
  reason: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

// ─── Phase 2: Step Execution Result ───────────────────────────────────────────

export const StepStatusSchema = z.enum(["SUCCESS", "FAILED", "SKIPPED", "TIMEOUT"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepResultSchema = z.object({
  stepId: z.number().int().positive(),
  cmd: z.array(z.string()),
  cwd: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
  status: StepStatusSchema,
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const FinalStatusSchema = z.enum(["COMPLETED", "FAILED", "DENIED", "PARTIAL"]);
export type FinalStatus = z.infer<typeof FinalStatusSchema>;

export const ExecutionResultSchema = z.object({
  taskId: z.string().uuid(),
  goal: z.string(),
  approval: z.boolean(),
  riskScore: RiskScoreSchema,
  reason: z.string(),
  steps: z.array(StepResultSchema),
  finalStatus: FinalStatusSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
