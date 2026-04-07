/**
 * backend/schemas.ts
 * Fastify JSON Schema definitions — Phase 1 + Phase 2.
 */

// ─── Phase 1 Schemas ───────────────────────────────────────────────────────────

export const goalRequestJsonSchema = {
  type: "object",
  required: ["goal"],
  properties: {
    goal: { type: "string", minLength: 3, maxLength: 1000 },
  },
  additionalProperties: false,
} as const;

export const planStepJsonSchema = {
  type: "object",
  required: ["stepId", "type", "cmd", "cwd", "timeout"],
  properties: {
    stepId:   { type: "integer", minimum: 1 },
    type:     { type: "string", enum: ["RUN_COMMAND", "READ_FILE", "WRITE_FILE", "HTTP_REQUEST"] },
    cmd:      { type: "array", items: { type: "string" }, minItems: 1 },
    cwd:      { type: "string", minLength: 1 },
    timeout:  { type: "integer", minimum: 1, maximum: 300000 },
  },
} as const;

export const planJsonSchema = {
  type: "object",
  required: ["steps", "requestedPermissions"],
  properties: {
    steps:                { type: "array", items: planStepJsonSchema, minItems: 1 },
    requestedPermissions: { type: "array", items: { type: "string" } },
  },
} as const;

export const agentResponseJsonSchema = {
  type: "object",
  required: ["taskId", "plan", "approval", "riskScore", "reason"],
  properties: {
    taskId:    { type: "string" },
    plan:      planJsonSchema,
    approval:  { type: "boolean" },
    riskScore: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    reason:    { type: "string" },
  },
} as const;

export const healthResponseJsonSchema = {
  type: "object",
  required: ["status", "version", "timestamp"],
  properties: {
    status:    { type: "string" },
    version:   { type: "string" },
    timestamp: { type: "string" },
  },
} as const;

export const auditListResponseJsonSchema = {
  type: "object",
  required: ["entries", "total"],
  properties: {
    total:   { type: "integer" },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskId:    { type: "string" },
          timestamp: { type: "string" },
          goal:      { type: "string" },
          planJson:  { type: "string" },
          approval:  { type: "boolean" },
          riskScore: { type: "string" },
          reason:    { type: "string" },
        },
      },
    },
  },
} as const;

// ─── Phase 2 Schemas ───────────────────────────────────────────────────────────

export const executeRequestJsonSchema = {
  type: "object",
  required: ["goal"],
  properties: {
    goal:               { type: "string", minLength: 3, maxLength: 1000 },
    autoApproveLowRisk: { type: "boolean", default: false },
  },
  additionalProperties: false,
} as const;

export const stepResultJsonSchema = {
  type: "object",
  required: ["stepId", "cmd", "cwd", "exitCode", "stdout", "stderr", "durationMs", "status"],
  properties: {
    stepId:     { type: "integer" },
    cmd:        { type: "array", items: { type: "string" } },
    cwd:        { type: "string" },
    exitCode:   { type: "integer" },
    stdout:     { type: "string" },
    stderr:     { type: "string" },
    durationMs: { type: "integer" },
    status:     { type: "string", enum: ["SUCCESS", "FAILED", "SKIPPED", "TIMEOUT"] },
  },
} as const;

export const executionResultJsonSchema = {
  type: "object",
  required: ["taskId", "goal", "approval", "riskScore", "reason", "steps", "finalStatus", "startedAt", "completedAt", "durationMs"],
  properties: {
    taskId:      { type: "string" },
    goal:        { type: "string" },
    approval:    { type: "boolean" },
    riskScore:   { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    reason:      { type: "string" },
    steps:       { type: "array", items: stepResultJsonSchema },
    finalStatus: { type: "string", enum: ["COMPLETED", "FAILED", "DENIED", "PARTIAL"] },
    startedAt:   { type: "string" },
    completedAt: { type: "string" },
    durationMs:  { type: "integer" },
  },
} as const;

export const taskListResponseJsonSchema = {
  type: "object",
  required: ["total", "results"],
  properties: {
    total:   { type: "integer" },
    results: { type: "array", items: executionResultJsonSchema },
  },
} as const;

// ─── Phase 3 Schemas ───────────────────────────────────────────────────────────

export const agentSummaryJsonSchema = {
  type: "object",
  properties: {
    agent:      { type: "string" },
    success:    { type: "boolean" },
    durationMs: { type: "integer" },
    decision:   { type: "string" },
    error:      { type: "string" },
  },
} as const;

export const pipelineResultJsonSchema = {
  type: "object",
  required: ["taskId", "goal", "approved", "riskScore", "reason", "finalStatus", "agentTrace", "startedAt", "completedAt", "durationMs"],
  properties: {
    taskId:      { type: "string" },
    goal:        { type: "string" },
    approved:    { type: "boolean" },
    riskScore:   { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    reason:      { type: "string" },
    finalStatus: { type: "string", enum: ["COMPLETED", "FAILED", "DENIED", "ABORTED"] },
    agentTrace:  { type: "array", items: agentSummaryJsonSchema },
    execution:   executionResultJsonSchema,
    startedAt:   { type: "string" },
    completedAt: { type: "string" },
    durationMs:  { type: "integer" },
  },
} as const;

export const pipelineTraceJsonSchema = {
  type: "object",
  properties: {
    taskId:     { type: "string" },
    events:     { type: "array", items: { type: "object" } },
    agentStats: { type: "object" },
    startedAt:  { type: "string" },
    endedAt:    { type: "string" },
    outcome:    { type: "string" },
  },
} as const;
