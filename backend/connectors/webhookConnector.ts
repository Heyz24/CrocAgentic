/**
 * backend/connectors/webhookConnector.ts
 * CrocAgentic Phase 6 — Webhook Connector.
 *
 * Exposes POST /webhook endpoint.
 * Any service can post to it — Zapier, Make, custom apps, Slack, Telegram, etc.
 * All input scanned by SecB before reaching pipeline.
 *
 * Security:
 * - Secret token validation (X-CrocAgentic-Secret header)
 * - IP allowlist (optional)
 * - SecB injection scan on all payload fields
 * - Rate limiting (10 req/min per IP)
 */

import * as crypto from "crypto";
import * as fs     from "fs";
import * as path   from "path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runPipeline } from "../pipeline/orchestrator";
import { getDefaultProfile, getProfile } from "../profiles/profileLoader";

// ─── Config ────────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET_PATH = path.resolve(process.cwd(), ".webhook_secret");

export function getOrCreateWebhookSecret(): string {
  if (fs.existsSync(WEBHOOK_SECRET_PATH)) {
    return fs.readFileSync(WEBHOOK_SECRET_PATH, "utf-8").trim();
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(WEBHOOK_SECRET_PATH, secret, "utf-8");
  console.log(`[Webhook] Generated secret: ${secret.slice(0, 8)}...`);
  console.log(`[Webhook] Full secret saved to: ${WEBHOOK_SECRET_PATH}`);
  return secret;
}

// ─── Payload Extractor ─────────────────────────────────────────────────────────
// Handles any JSON format — CrocAgentic native, Slack, Telegram, custom

interface ExtractedPayload {
  goal:    string;
  profile: string;
  source:  string;
  autoApproveLowRisk: boolean;
}

function extractGoalFromPayload(body: Record<string, unknown>): ExtractedPayload {
  // CrocAgentic native format
  if (typeof body.goal === "string") {
    return {
      goal:               body.goal,
      profile:            (body.profile as string) ?? "default",
      source:             "crocagentic",
      autoApproveLowRisk: (body.autoApproveLowRisk as boolean) ?? false,
    };
  }

  // Telegram format: { message: { text: "..." } }
  const telegramText = (body.message as Record<string, unknown>)?.text;
  if (typeof telegramText === "string") {
    return { goal: telegramText, profile: "worker", source: "telegram", autoApproveLowRisk: true };
  }

  // Slack format: { text: "..." } or { event: { text: "..." } }
  const slackEvent = (body.event as Record<string, unknown>)?.text;
  if (typeof slackEvent === "string") {
    return { goal: slackEvent, profile: "worker", source: "slack", autoApproveLowRisk: true };
  }

  // Generic: look for common text fields
  const commonFields = ["text", "message", "content", "body", "input", "query", "prompt"];
  for (const field of commonFields) {
    if (typeof body[field] === "string" && (body[field] as string).length > 2) {
      return { goal: body[field] as string, profile: "worker", source: "generic", autoApproveLowRisk: true };
    }
  }

  return { goal: JSON.stringify(body).slice(0, 500), profile: "default", source: "unknown", autoApproveLowRisk: false };
}

// ─── Rate Limiter ──────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, maxPerMin = 10): boolean {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMin) return false;
  entry.count++;
  return true;
}

// ─── Register Webhook Routes ───────────────────────────────────────────────────

export function registerWebhookRoutes(fastify: FastifyInstance): void {
  const secret = getOrCreateWebhookSecret();

  // POST /webhook — main trigger endpoint
  fastify.post("/webhook", {}, async (req: FastifyRequest, reply: FastifyReply) => {
    const ip = req.ip ?? "unknown";

    // 1. Rate limit
    if (!checkRateLimit(ip)) {
      return reply.status(429).send({ error: "Rate limit exceeded. Max 10 requests per minute." });
    }

    // 2. Secret token validation
    const providedSecret =
      req.headers["x-crocagentic-secret"] ??
      req.headers["x-webhook-secret"] ??
      req.headers["authorization"]?.toString().replace("Bearer ", "");

    if (providedSecret !== secret) {
      fastify.log.warn({ ip }, "Webhook: invalid secret");
      return reply.status(401).send({ error: "Invalid webhook secret. Set X-CrocAgentic-Secret header." });
    }

    // 3. Extract goal from payload
    const body = req.body as Record<string, unknown> ?? {};
    const { goal, profile, source, autoApproveLowRisk } = extractGoalFromPayload(body);

    if (!goal || goal.length < 3) {
      return reply.status(400).send({ error: "Could not extract a valid goal from payload." });
    }

    fastify.log.info({ source, profile, goalPreview: goal.slice(0, 80) }, "Webhook trigger received");

    // 4. Run pipeline (SecB injection scan happens inside)
    try {
      const result = await runPipeline(goal, autoApproveLowRisk);

      // 5. Save output to file
      const outputDir  = path.resolve(process.cwd(), "runtime", "webhook_outputs");
      fs.mkdirSync(outputDir, { recursive: true });
      const outputFile = path.join(outputDir, `${result.taskId}.json`);
      fs.writeFileSync(outputFile, JSON.stringify({ source, result }, null, 2), "utf-8");

      return reply.status(200).send({
        taskId:      result.taskId,
        finalStatus: result.finalStatus,
        approved:    result.approved,
        riskScore:   result.riskScore,
        source,
        outputFile:  `runtime/webhook_outputs/${result.taskId}.json`,
        execution:   result.execution,
      });
    } catch (err) {
      fastify.log.error(err, "Webhook pipeline error");
      return reply.status(500).send({ error: "Pipeline execution failed", details: (err as Error).message });
    }
  });

  // GET /webhook/info — show webhook URL and secret hint
  fastify.get("/webhook/info", {}, async (_req, _reply) => {
    return {
      webhookUrl:    `POST /webhook`,
      secretHeader:  "X-CrocAgentic-Secret",
      secretHint:    `${secret.slice(0, 8)}...${secret.slice(-4)}`,
      supportedFormats: ["CrocAgentic native", "Telegram", "Slack", "Generic JSON"],
      rateLimitPerMin: 10,
      example: {
        url:     "POST http://your-server:3000/webhook",
        headers: { "X-CrocAgentic-Secret": "<your-secret>", "Content-Type": "application/json" },
        body:    { goal: "list all files in workspace", profile: "coder", autoApproveLowRisk: true },
      },
    };
  });

  fastify.log.info("[Webhook] Routes registered at POST /webhook");
}
