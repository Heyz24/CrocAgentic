/**
 * backend/server.ts
 * CrocAgentic v0.12.0 — Phase 6 Server.
 * Connectors: Webhook, FileWatcher, Telegram, Slack, Email.
 * Multi-model routing integrated.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import * as path from "path";
import { registerRoutes }          from "./routes";
import { closeDb }                 from "./auditLogger";
import { startCleanupDaemon, stopCleanupDaemon } from "./cleanup/cleanupDaemon";
import { loadConfig, isLLMConfigured }           from "./config/configLoader";
import { loadModelConfig }         from "./llm/routing/modelRouter";
import { registerWebhookRoutes, getOrCreateWebhookSecret } from "./connectors/webhookConnector";
import { startFileWatcher, stopFileWatcher }     from "./connectors/fileWatcherConnector";
import { registerTelegramRoutes }  from "./connectors/telegramConnector";
import { registerSlackRoutes }     from "./connectors/slackConnector";
import { registerGithubRoutes }    from "./connectors/githubConnector";
import { registerWhatsAppRoutes }  from "./connectors/whatsappConnector";
import { isNotionConfigured }      from "./connectors/notionConnector";
import { isDriveConfigured }       from "./connectors/driveConnector";
import { isGithubConfigured }      from "./connectors/githubConnector";
import { isWhatsAppConfigured }    from "./connectors/whatsappConnector";
import { isEmailConfigured, startEmailConnector, stopEmailConnector } from "./connectors/emailConnector";
import { startEscalationDaemon, stopEscalationDaemon } from "./escalation/escalationDaemon";

const PORT      = parseInt(process.env.PORT ?? "3000", 10);
const HOST      = process.env.HOST ?? "0.0.0.0";
const LOG_LEVEL = (process.env.LOG_LEVEL as string) ?? "info";

// File watcher config
const WATCH_DIR  = path.resolve(process.cwd(), process.env.WATCH_DIR  ?? "runtime/inbox");
const OUTPUT_DIR = path.resolve(process.cwd(), process.env.OUTPUT_DIR ?? "runtime/inbox_output");

export async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: LOG_LEVEL,
      transport: process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } }
        : undefined,
    },
    ajv: { customOptions: { strict: false, coerceTypes: true } },
  });

  await fastify.register(cors, {
    origin:  process.env.CORS_ORIGIN ?? "*",
    methods: ["GET", "POST", "OPTIONS"],
  });

  // Core routes
  await registerRoutes(fastify);

  // Connector routes
  registerWebhookRoutes(fastify);
  registerTelegramRoutes(fastify);
  registerSlackRoutes(fastify);
  registerGithubRoutes(fastify);
  registerWhatsAppRoutes(fastify);

  fastify.setErrorHandler((error, _req, reply) => {
    fastify.log.error(error);
    const err = error as { statusCode?: number; message?: string; code?: string };
    reply.status(err.statusCode ?? 500).send({
      error: err.message ?? "Internal server error",
      code:  err.code    ?? "INTERNAL_ERROR",
    });
  });

  fastify.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: "Route not found" });
  });

  return fastify;
}

async function main() {
  const config      = loadConfig();
  const llmReady    = isLLMConfigured();
  const multiModels = loadModelConfig();

  const fastify = await buildServer();
  startCleanupDaemon();

  // Start email connector
  await startEmailConnector();

  // Start escalation daemon
  await startEscalationDaemon();

  // Start file watcher
  if (process.env.FILE_WATCHER !== "false") {
    startFileWatcher(WATCH_DIR, OUTPUT_DIR);
  }

  const shutdown = async (signal: string) => {
    fastify.log.info(`Received ${signal}. Shutting down...`);
    stopCleanupDaemon();
    await stopEmailConnector();
    stopEscalationDaemon();
    stopFileWatcher();
    await fastify.close();
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await fastify.listen({ port: PORT, host: HOST });

    fastify.log.info(`🐊 CrocAgentic v0.12.0 at http://${HOST}:${PORT}`);
    fastify.log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // LLM status
    if (!llmReady) {
      fastify.log.warn(`⚠️  LLM not configured — run: npm run setup`);
    } else if (multiModels) {
      fastify.log.info(`🧠 Multi-model routing active:`);
      for (const [type, cfg] of Object.entries(multiModels)) {
        if (cfg) fastify.log.info(`   ${type.padEnd(12)}: ${(cfg as {provider:string;model:string}).provider}/${(cfg as {provider:string;model:string}).model}`);
      }
    } else {
      fastify.log.info(`🧠 LLM: ${config.llm.provider} / ${config.llm.model}`);
      fastify.log.info(`   Tip: run 'npm run setup:models' to configure per-task models`);
    }

    fastify.log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Connector status
    fastify.log.info(`🔌 Connectors:`);
    fastify.log.info(`   Webhook:     POST /webhook (secret: ${getOrCreateWebhookSecret().slice(0, 8)}...)`);
    fastify.log.info(`   FileWatcher: watching ${WATCH_DIR}`);
    fastify.log.info(`   Telegram:    ${process.env.TELEGRAM_BOT_TOKEN ? "✓ active" : "✗ set TELEGRAM_BOT_TOKEN"}`);
    fastify.log.info(`   Slack:       ${process.env.SLACK_BOT_TOKEN    ? "✓ active" : "✗ set SLACK_BOT_TOKEN"}`);
    fastify.log.info(`   Email:       ${isEmailConfigured()            ? "✓ active" : "✗ set EMAIL_* vars"}`);
    fastify.log.info(`   GitHub:      ${isGithubConfigured()           ? "✓ active" : "✗ set GITHUB_TOKEN + GITHUB_REPO"}`);
    fastify.log.info(`   WhatsApp:    ${isWhatsAppConfigured()         ? "✓ active" : "✗ set TWILIO_* or META_WHATSAPP_TOKEN"}`);
    fastify.log.info(`   Notion:      ${isNotionConfigured()           ? "✓ active" : "✗ set NOTION_TOKEN"}`);
    fastify.log.info(`   Drive:       ${isDriveConfigured()            ? "✓ active" : "✗ set GOOGLE_DRIVE_API_KEY"}`);

    fastify.log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    fastify.log.info(`📡 Endpoints:`);
    fastify.log.info(`   POST /agent/execute        — full pipeline`);
    fastify.log.info(`   POST /webhook              — webhook trigger`);
    fastify.log.info(`   GET  /webhook/info         — webhook details`);
    fastify.log.info(`   GET  /tools                — available tools`);
    fastify.log.info(`   GET  /profiles             — agent profiles`);
    fastify.log.info(`   GET  /llm/status           — LLM status`);
    fastify.log.info(`   GET  /health               — health check`);
  } catch (err) {
    fastify.log.error(err, "Failed to start server");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
