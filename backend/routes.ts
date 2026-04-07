/**
 * backend/routes.ts
 * CrocAgentic Fastify Routes — Phase 1 + 2 + 3 + 4 + 5.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { GoalRequestSchema, ExecuteRequestSchema } from "../utils/zodSchemas";
import { createPlan } from "./planner";
import { evaluatePlan } from "./policyEngine";
import { logTaskSession, getAuditLog, getAuditEntry, getAuditStats, countAuditEntries } from "./auditLogger";
import { executePlan } from "./executor/planExecutor";
import { loadExecutionResult, listExecutionResults, getTaskStats } from "./taskStore/taskStore";
import { runPipeline } from "./pipeline/orchestrator";
import { topManager } from "./agents/topManager";
import { secC } from "./agents/security/secC_auditIntegrity";
import { loadConfig, isLLMConfigured } from "./config/configLoader";
import { debugLLMCall } from "./llm/llmDebug";
import { toolRegistry } from "./tools/toolRegistry";
import { triggerEmailCheck, isEmailConfigured } from "./connectors/emailConnector";
import { recall, forget, remember, getMemoryStats, pruneExpired } from "./memory/memoryStore";
import { getEscalation, getPendingEscalations, resolveEscalation, getEscalationStats } from "./escalation/escalationStore";
import { isGithubConfigured, getOpenIssues, createComment } from "./connectors/githubConnector";
import { isNotionConfigured } from "./connectors/notionConnector";
import { isDriveConfigured, listDriveFolder, processDriveFile } from "./connectors/driveConnector";
import { isWhatsAppConfigured } from "./connectors/whatsappConnector";
import { rollbackTransaction, listQuarantine, restoreFromQuarantine, purgeQuarantine, getRollbackStats, getTransaction } from "./rollback/rollbackStore";
import { scanForSecrets, auditOutput } from "./security/secretsScanner";
import { detectRagPoisoning } from "./security/ragPoisonDetector";
import { getRateLimitStats, checkRateLimit } from "./security/rateLimiter";
import { getEgressLog, getEgressStats } from "./security/networkMonitor";
import { fingerprintModel } from "./security/modelFingerprint";
import { listProfiles, getProfile, getDefaultProfile } from "./profiles/profileLoader";
import {
  goalRequestJsonSchema, agentResponseJsonSchema, healthResponseJsonSchema,
  auditListResponseJsonSchema, executeRequestJsonSchema, executionResultJsonSchema,
  taskListResponseJsonSchema, pipelineResultJsonSchema,
} from "./schemas";

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {

  // Load tool registry at startup
  toolRegistry.load();

  // ── GET /health ────────────────────────────────────────────────────────────
  fastify.get("/health", { schema: { response: { 200: healthResponseJsonSchema } } },
    async () => ({ status: "ok", version: "0.5.0", timestamp: new Date().toISOString() })
  );

  // ── GET /status ────────────────────────────────────────────────────────────
  fastify.get("/status", {},
    async () => topManager.getStatus()
  );

  // ── GET /llm/status ───────────────────────────────────────────────────────
  fastify.get("/llm/status", {},
    async () => {
      const config = loadConfig();
      const ready  = isLLMConfigured();
      return {
        configured:   ready,
        provider:     config.llm.provider,
        model:        config.llm.model,
        setupDone:    config.setupDone,
        fallbackMode: !ready,
        message: ready
          ? `LLM ready: ${config.llm.provider} / ${config.llm.model}`
          : "No LLM configured — run: npm run setup",
      };
    }
  );

  // ── GET /tools ── Phase 5 ─────────────────────────────────────────────────
  fastify.get("/tools", {},
    async () => ({
      total: toolRegistry.getAll().length,
      tools: toolRegistry.getAll().map((t) => ({
        name:        t.manifest.name,
        description: t.manifest.description,
        category:    t.manifest.category,
        permissions: t.manifest.permissions,
        dangerous:   t.manifest.dangerous,
        platform:    t.manifest.platform,
      })),
    })
  );

  // ── GET /profiles ── Phase 5 ──────────────────────────────────────────────
  fastify.get("/profiles", {},
    async () => ({
      total:    listProfiles().length + 1,
      profiles: [getDefaultProfile(), ...listProfiles()].map((p) => ({
        name:             p.name,
        description:      p.description,
        allowedTools:     p.allowedTools,
        qualityThreshold: p.qualityThreshold,
        networkAccess:    p.networkAccess,
      })),
    })
  );

  // ── GET /debug/llm ────────────────────────────────────────────────────────
  fastify.get("/debug/llm", {},
    async (req: FastifyRequest) => {
      const goal = (req.query as { goal?: string }).goal ?? "list files in workspace";
      return await debugLLMCall(goal);
    }
  );

  // ─── Phase 1 — Plan only ──────────────────────────────────────────────────
  fastify.post("/agent/plan",
    { schema: { body: goalRequestJsonSchema, response: { 200: agentResponseJsonSchema } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = GoalRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid request body" });
      const { goal } = parsed.data;
      const { taskId, plan } = createPlan(goal);
      const policy  = evaluatePlan(plan);
      const session = { taskId, plan, approval: policy.approved, riskScore: policy.riskScore, reason: policy.reason };
      try { await logTaskSession(goal, session); } catch { /* non-fatal */ }
      return reply.status(200).send(session);
    }
  );

  // ─── Phase 2 — Direct execute ─────────────────────────────────────────────
  fastify.post("/agent/execute/direct",
    { schema: { body: executeRequestJsonSchema, response: { 200: executionResultJsonSchema } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = ExecuteRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid request body" });
      const { goal, autoApproveLowRisk } = parsed.data;
      const ip = req.ip ?? "unknown";
      const rateCheck = checkRateLimit(ip, "execute");
      if (!rateCheck.allowed) {
        return reply.status(429).send({
          error: "Rate limit exceeded",
          retryAfterSeconds: rateCheck.resetInSeconds,
          limit: rateCheck.limit,
        });
      }
      const { taskId, plan } = createPlan(goal);
      const policy   = evaluatePlan(plan);
      const approved = policy.approved || (autoApproveLowRisk && policy.riskScore === "LOW");
      const session  = { taskId, plan, approval: approved, riskScore: policy.riskScore, reason: policy.reason };
      try { await logTaskSession(goal, session); } catch { /* non-fatal */ }
      const result = await executePlan({ taskId, goal, plan, approval: approved, riskScore: policy.riskScore, reason: policy.reason });
      return reply.status(200).send(result);
    }
  );

  // ─── Phase 3+4+5 — Full pipeline ─────────────────────────────────────────
  fastify.post("/agent/execute",
    { schema: { body: executeRequestJsonSchema, response: { 200: pipelineResultJsonSchema } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body   = req.body as { goal?: string; autoApproveLowRisk?: boolean; profile?: string };
      const parsed = ExecuteRequestSchema.safeParse(body);
      if (!parsed.success) return reply.status(400).send({ error: "Invalid request body" });

      const { goal, autoApproveLowRisk } = parsed.data;
      const ip = req.ip ?? "unknown";
      const rateCheck = checkRateLimit(ip, "execute");
      if (!rateCheck.allowed) {
        return reply.status(429).send({
          error: "Rate limit exceeded",
          retryAfterSeconds: rateCheck.resetInSeconds,
          limit: rateCheck.limit,
        });
      }
      const profileName = body.profile ?? "default";
      const profile     = profileName === "default"
        ? getDefaultProfile()
        : (getProfile(profileName) ?? getDefaultProfile());

      fastify.log.info({ goal, profile: profile.name }, "Pipeline started");
      const result = await runPipeline(goal, autoApproveLowRisk);
      fastify.log.info({ taskId: result.taskId, finalStatus: result.finalStatus }, "Pipeline complete");
      return reply.status(200).send(result);
    }
  );

  // ── GET /pipeline/:taskId/trace ────────────────────────────────────────────
  fastify.get("/pipeline/:taskId/trace", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const trace = topManager.getTrace(taskId);
      if (!trace) return reply.status(404).send({ error: `No trace for task "${taskId}"` });
      return trace;
    }
  );

  // ── GET /pipeline/:taskId/verify ───────────────────────────────────────────
  fastify.get("/pipeline/:taskId/verify", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const result = await secC.verify(taskId);
      return result.output ?? { verified: false, reason: "Verification failed" };
    }
  );

  // ─── Tasks ────────────────────────────────────────────────────────────────
  fastify.get("/tasks/stats", {}, async () => await getTaskStats());

  fastify.get("/tasks",
    { schema: { querystring: { type: "object", properties: { limit: { type: "integer", default: 50 }, offset: { type: "integer", default: 0 } } }, response: { 200: taskListResponseJsonSchema } } },
    async (req: FastifyRequest) => {
      const q = req.query as { limit?: number; offset?: number };
      return await listExecutionResults(q.limit ?? 50, q.offset ?? 0);
    }
  );

  fastify.get("/tasks/:taskId", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const result = await loadExecutionResult(taskId);
      if (!result) return reply.status(404).send({ error: `Task "${taskId}" not found` });
      return result;
    }
  );






  // ─── Connectors++ — Phase 11 ─────────────────────────────────────────────

  fastify.get("/connectors/status", {},
    async () => ({
      webhook:   { active: true,                 endpoint: "POST /webhook" },
      filewatch: { active: true,                 endpoint: "runtime/inbox" },
      email:     { active: !!process.env.EMAIL_USER, endpoint: "IMAP polling" },
      telegram:  { active: !!process.env.TELEGRAM_BOT_TOKEN, endpoint: "POST /telegram/webhook" },
      slack:     { active: !!process.env.SLACK_BOT_TOKEN, endpoint: "POST /slack/events" },
      github:    { active: isGithubConfigured(), endpoint: "POST /github/webhook", repo: process.env.GITHUB_REPO ?? null },
      whatsapp:  { active: isWhatsAppConfigured(), endpoint: "POST /whatsapp/twilio or /whatsapp/meta" },
      notion:    { active: isNotionConfigured(), endpoint: "API only" },
      drive:     { active: isDriveConfigured(),  endpoint: "API only" },
    })
  );

  fastify.get("/github/issues", {},
    async (_req: FastifyRequest, reply: FastifyReply) => {
      if (!isGithubConfigured()) return reply.status(400).send({ error: "GitHub not configured" });
      try { return await getOpenIssues(); }
      catch (err) { return reply.status(500).send({ error: (err as Error).message }); }
    }
  );

  fastify.post("/drive/process", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!isDriveConfigured()) return reply.status(400).send({ error: "Drive not configured" });
      const { fileId } = req.body as { fileId?: string } ?? {};
      if (!fileId) return reply.status(400).send({ error: "fileId required" });
      try { return await processDriveFile(fileId); }
      catch (err) { return reply.status(500).send({ error: (err as Error).message }); }
    }
  );

  fastify.get("/drive/folder/:folderId", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!isDriveConfigured()) return reply.status(400).send({ error: "Drive not configured" });
      const { folderId } = req.params as { folderId: string };
      try { return await listDriveFolder(folderId); }
      catch (err) { return reply.status(500).send({ error: (err as Error).message }); }
    }
  );

  // ─── Security — Phase 10 ─────────────────────────────────────────────────

  fastify.get("/security/status", {},
    async () => ({
      version:          "0.10.0",
      injectionPatterns: 50,
      secretPatterns:   25,
      ragPatterns:      25,
      rateLimiting:     true,
      networkMonitor:   true,
      modelFingerprint: true,
    })
  );

  fastify.post("/security/scan", {},
    async (req: FastifyRequest) => {
      const body = req.body as { text?: string; type?: string } ?? {};
      const text = body.text ?? "";
      const type = body.type ?? "general";
      if (type === "secrets") return scanForSecrets(text);
      if (type === "rag")     return detectRagPoisoning(text, "api_scan");
      return { secrets: scanForSecrets(text), rag: detectRagPoisoning(text, "api_scan") };
    }
  );

  fastify.get("/security/egress", {},
    async (req: FastifyRequest) => {
      const q = req.query as { limit?: string };
      return {
        stats: getEgressStats(),
        recent: getEgressLog(parseInt(q.limit ?? "50")),
      };
    }
  );

  fastify.get("/security/rate-limits", {},
    async () => getRateLimitStats()
  );

  fastify.get("/security/fingerprint", {},
    async () => {
      const result = await fingerprintModel();
      return result;
    }
  );

  // ─── Rollback + Quarantine — Phase 9 ─────────────────────────────────────

  fastify.get("/rollback/stats", {},
    async () => getRollbackStats()
  );

  fastify.get("/rollback/:taskId", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const tx = getTransaction(taskId);
      if (!tx) return reply.status(404).send({ error: "Transaction not found" });
      return tx;
    }
  );

  fastify.post("/rollback/:taskId", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const result = await rollbackTransaction(taskId);
      return {
        success:           result.success,
        actionsRolledBack: result.actionsRolledBack,
        errors:            result.errors,
        message: result.success
          ? `Rolled back ${result.actionsRolledBack} action(s)`
          : `Partial rollback — ${result.errors.length} error(s)`,
      };
    }
  );

  fastify.get("/quarantine", {},
    async () => ({
      files: listQuarantine(),
      total: listQuarantine().length,
    })
  );

  fastify.post("/quarantine/restore", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { filename: string; targetPath: string } ?? {};
      if (!body.filename || !body.targetPath) {
        return reply.status(400).send({ error: "filename and targetPath required" });
      }
      const success = restoreFromQuarantine(body.filename, body.targetPath);
      return { success, message: success ? "File restored" : "File not found in quarantine" };
    }
  );

  fastify.post("/quarantine/purge", {},
    async () => {
      const purged = purgeQuarantine();
      return { purged, message: `Purged ${purged} expired quarantine file(s)` };
    }
  );

  // ─── Escalation — Phase 8 ─────────────────────────────────────────────────

  fastify.get("/escalation/stats", {},
    async () => getEscalationStats()
  );

  fastify.get("/escalation/pending", {},
    async () => getPendingEscalations()
  );

  fastify.get("/escalation/:id", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const esc = getEscalation(id);
      if (!esc) return reply.status(404).send({ error: "Escalation not found" });
      return esc;
    }
  );

  fastify.post("/escalation/:id/approve", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id }   = req.params as { id: string };
      const body     = req.body as { token?: string; resolution?: string } ?? {};
      const result   = resolveEscalation(id, true, "api", body.resolution, body.token);
      if (!result.success) return reply.status(400).send({ error: result.error });
      return { success: true, escalation: result.escalation, message: "Task approved — pipeline will resume" };
    }
  );

  fastify.post("/escalation/:id/reject", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id }   = req.params as { id: string };
      const body     = req.body as { token?: string; resolution?: string } ?? {};
      const result   = resolveEscalation(id, false, "api", body.resolution, body.token);
      if (!result.success) return reply.status(400).send({ error: result.error });
      return { success: true, escalation: result.escalation, message: "Task rejected" };
    }
  );

  // ─── Memory — Phase 7 ────────────────────────────────────────────────────

  fastify.get("/memory/stats", {},
    async () => getMemoryStats()
  );

  fastify.get("/memory", {},
    async (req: FastifyRequest) => {
      const q = req.query as { query?: string; layer?: string; projectId?: string; limit?: string };
      return recall({
        query:     q.query,
        layer:     q.layer as "short" | "medium" | "long" | undefined,
        projectId: q.projectId,
        limit:     parseInt(q.limit ?? "20"),
      });
    }
  );

  fastify.delete("/memory", {},
    async (req: FastifyRequest) => {
      const body = req.body as { projectId?: string; key?: string; id?: string } ?? {};
      const removed = forget(body);
      return { removed, message: `Removed ${removed} memory entries` };
    }
  );

  fastify.post("/memory/prune", {},
    async () => {
      const pruned = pruneExpired();
      return { pruned, message: `Pruned ${pruned} expired entries` };
    }
  );

  fastify.post("/memory/preference", {},
    async (req: FastifyRequest) => {
      const body = req.body as { key: string; value: string; userId?: string } ?? {};
      if (!body.key || !body.value) return { error: "key and value required" };
      const entry = remember({
        layer: "long", category: "preference",
        userId: body.userId ?? "shared", projectId: "global",
        key: body.key, content: body.value,
      });
      return { success: true, entry };
    }
  );

  fastify.post("/memory/rule", {},
    async (req: FastifyRequest) => {
      const body = req.body as { rule: string } ?? {};
      if (!body.rule) return { error: "rule is required" };
      const entry = remember({
        layer: "long", category: "rule",
        userId: "shared", projectId: "global",
        key: `rule_${Date.now()}`, content: body.rule,
      });
      return { success: true, entry };
    }
  );

  // ─── Audit ────────────────────────────────────────────────────────────────
  fastify.get("/audit/stats", {}, async () => await getAuditStats());

  fastify.get("/audit",
    { schema: { querystring: { type: "object", properties: { limit: { type: "integer", default: 50 }, offset: { type: "integer", default: 0 } } }, response: { 200: auditListResponseJsonSchema } } },
    async (req: FastifyRequest) => {
      const q = req.query as { limit?: number; offset?: number };
      return { entries: await getAuditLog(q.limit ?? 50, q.offset ?? 0), total: await countAuditEntries() };
    }
  );


  // ── POST /email/check ── manually trigger email poll ──────────────────────
  fastify.post("/email/check", {},
    async (_req: FastifyRequest, reply: FastifyReply) => {
      if (!isEmailConfigured()) {
        return reply.status(400).send({ error: "Email not configured. Set EMAIL_* vars in .env" });
      }
      await triggerEmailCheck();
      return { status: "ok", message: "Email check triggered" };
    }
  );

  // ── GET /email/status ──────────────────────────────────────────────────────
  fastify.get("/email/status", {},
    async () => ({
      configured: isEmailConfigured(),
      user: process.env.EMAIL_USER ?? null,
      checkIntervalMs: parseInt(process.env.EMAIL_CHECK_INTERVAL_MS ?? "30000"),
    })
  );

  fastify.get("/audit/:taskId", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = req.params as { taskId: string };
      const entry = await getAuditEntry(taskId);
      if (!entry) return reply.status(404).send({ error: `Audit entry "${taskId}" not found` });
      return entry;
    }
  );
}
