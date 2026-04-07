/**
 * backend/connectors/slackConnector.ts
 * CrocAgentic Phase 6 — Slack Connector.
 *
 * Receives Slack events via webhook, processes them, replies.
 * Config via .env: SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET
 *
 * NOTE: Phase 6 scaffold — full Slack implementation in Phase 7.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runPipeline } from "../pipeline/orchestrator";

export function isSlackConfigured(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

async function sendSlackMessage(channel: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch("https://slack.com/api/chat.postMessage", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body:    JSON.stringify({ channel, text: text.slice(0, 3000) }),
  });
}

export function registerSlackRoutes(fastify: FastifyInstance): void {
  if (!isSlackConfigured()) {
    console.log("[Slack] Not configured. Set SLACK_BOT_TOKEN in .env to enable.");
    return;
  }

  fastify.post("/slack/events", {}, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      type?:      string;
      challenge?: string;
      event?:     { type?: string; text?: string; channel?: string; bot_id?: string };
    };

    // Slack URL verification
    if (body.type === "url_verification") {
      return reply.send({ challenge: body.challenge });
    }

    // Ignore bot messages
    if (body.event?.bot_id) return reply.status(200).send({ ok: true });

    const text    = body.event?.text;
    const channel = body.event?.channel;

    if (!text || !channel || body.event?.type !== "message") {
      return reply.status(200).send({ ok: true });
    }

    // Acknowledge immediately (Slack requires <3s response)
    reply.status(200).send({ ok: true });

    // Process async
    try {
      await sendSlackMessage(channel, `⏳ Processing: "${text.slice(0, 80)}"...`);
      const result  = await runPipeline(text, true);
      const output  = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "Done.";
      await sendSlackMessage(channel, `✅ *${result.finalStatus}* | Risk: ${result.riskScore}\n\`\`\`${output.slice(0, 2000)}\`\`\``);
    } catch (err) {
      await sendSlackMessage(channel, `❌ Error: ${(err as Error).message}`);
    }
  });

  fastify.log.info("[Slack] Events registered at POST /slack/events");
}
