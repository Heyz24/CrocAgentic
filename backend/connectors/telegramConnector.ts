/**
 * backend/connectors/telegramConnector.ts
 * CrocAgentic Phase 6 — Telegram Bot Connector.
 *
 * User sends message to bot → agent processes → replies.
 * Config via .env: TELEGRAM_BOT_TOKEN
 *
 * Uses Telegram webhook mode — Telegram calls our /telegram/webhook endpoint.
 * Alternative: polling mode for local dev.
 *
 * NOTE: Phase 6 scaffold — full bot implementation in Phase 7.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runPipeline } from "../pipeline/orchestrator";

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), parse_mode: "Markdown" }),
  });
}

export function registerTelegramRoutes(fastify: FastifyInstance): void {
  if (!isTelegramConfigured()) {
    console.log("[Telegram] Not configured. Set TELEGRAM_BOT_TOKEN in .env to enable.");
    return;
  }

  // Telegram webhook endpoint
  fastify.post("/telegram/webhook", {}, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      message?: { chat?: { id?: number }; text?: string; from?: { first_name?: string } };
    };

    const chatId = body?.message?.chat?.id;
    const text   = body?.message?.text;
    const name   = body?.message?.from?.first_name ?? "User";

    if (!chatId || !text) return reply.status(200).send({ ok: true });

    // Ignore commands for now
    if (text.startsWith("/start")) {
      await sendTelegramMessage(chatId, `Hello ${name}! 🐊 I'm CrocAgentic. Send me a task in plain English and I'll handle it.`);
      return reply.status(200).send({ ok: true });
    }

    // Acknowledge immediately
    await sendTelegramMessage(chatId, `⏳ Processing: "${text.slice(0, 100)}"...`);

    // Run pipeline
    try {
      const result = await runPipeline(text, true);
      const output = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "Task completed.";
      const response = `✅ Done!\n\n*Status:* ${result.finalStatus}\n*Risk:* ${result.riskScore}\n\n${output.slice(0, 3000)}`;
      await sendTelegramMessage(chatId, response);
    } catch (err) {
      await sendTelegramMessage(chatId, `❌ Error: ${(err as Error).message}`);
    }

    return reply.status(200).send({ ok: true });
  });

  fastify.log.info("[Telegram] Webhook registered at POST /telegram/webhook");
}

export async function setTelegramWebhook(serverUrl: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const webhookUrl = `${serverUrl}/telegram/webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ url: webhookUrl }),
  });
  const data = await res.json() as { ok: boolean; description?: string };
  console.log(`[Telegram] Webhook set: ${data.ok ? "✓" : "✗ " + data.description}`);
}
