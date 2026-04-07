/**
 * backend/connectors/whatsappConnector.ts
 * CrocAgentic Phase 11 — WhatsApp Connector.
 *
 * Uses WhatsApp Business API via Twilio or Meta's Cloud API.
 * Config via .env:
 *   WHATSAPP_PROVIDER: "twilio" | "meta"
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER
 *   META_WHATSAPP_TOKEN, META_PHONE_NUMBER_ID, META_VERIFY_TOKEN
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runPipeline } from "../pipeline/orchestrator";
import { detectRagPoisoning } from "../security/ragPoisonDetector";
import { scanForSecrets } from "../security/secretsScanner";

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID || process.env.META_WHATSAPP_TOKEN);
}

// ─── Twilio WhatsApp ───────────────────────────────────────────────────────────

async function sendViaTwilio(to: string, message: string): Promise<void> {
  const sid     = process.env.TWILIO_ACCOUNT_SID!;
  const token   = process.env.TWILIO_AUTH_TOKEN!;
  const from    = process.env.TWILIO_WHATSAPP_NUMBER ?? "whatsapp:+14155238886";

  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To:   `whatsapp:${to}`,
    Body: message.slice(0, 1600),
  });

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type":  "application/x-www-form-urlencoded",
    },
    body:   body.toString(),
    signal: AbortSignal.timeout(10000),
  });
}

// ─── Meta WhatsApp Cloud API ───────────────────────────────────────────────────

async function sendViaMeta(to: string, message: string): Promise<void> {
  const token   = process.env.META_WHATSAPP_TOKEN!;
  const phoneId = process.env.META_PHONE_NUMBER_ID!;

  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message.slice(0, 1600) } }),
    signal:  AbortSignal.timeout(10000),
  });
}

async function sendWhatsApp(to: string, message: string): Promise<void> {
  if (process.env.META_WHATSAPP_TOKEN) {
    await sendViaMeta(to, message);
  } else {
    await sendViaTwilio(to, message);
  }
}

export function registerWhatsAppRoutes(fastify: FastifyInstance): void {
  if (!isWhatsAppConfigured()) {
    console.log("[WhatsApp] Not configured. Set TWILIO_* or META_WHATSAPP_TOKEN in .env to enable.");
    return;
  }

  // Twilio incoming webhook
  fastify.post("/whatsapp/twilio", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as { Body?: string; From?: string } ?? {};
      const text = body.Body ?? "";
      const from = (body.From ?? "").replace("whatsapp:", "");

      if (!text || !from) return reply.status(200).send("OK");

      const ragScan = detectRagPoisoning(text, `whatsapp:${from}`);
      const secretScan = scanForSecrets(text);

      const goal   = secretScan.redacted;
      await sendWhatsApp(from, "⏳ Processing your request...");

      const result = await runPipeline(ragScan.sanitized, true);
      const output = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "Done.";
      await sendWhatsApp(from, `✅ ${result.finalStatus}\n\n${output.slice(0, 1500)}`);

      return reply.status(200).send("OK");
    }
  );

  // Meta webhook verification
  fastify.get("/whatsapp/meta", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { "hub.mode"?: string; "hub.verify_token"?: string; "hub.challenge"?: string };
      if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === process.env.META_VERIFY_TOKEN) {
        return reply.status(200).send(q["hub.challenge"]);
      }
      return reply.status(403).send("Forbidden");
    }
  );

  // Meta incoming messages
  fastify.post("/whatsapp/meta", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as {
        entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ from: string; text?: { body: string } }> } }> }>;
      };

      const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message?.text?.body) return reply.status(200).send({ ok: true });

      const text = message.text.body;
      const from = message.from;

      const ragScan = detectRagPoisoning(text, `whatsapp:meta:${from}`);
      const goal    = ragScan.sanitized;

      await sendWhatsApp(from, "⏳ Processing...");
      const result = await runPipeline(goal, true);
      const output = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "Completed.";
      await sendWhatsApp(from, `✅ ${result.finalStatus}\n\n${output.slice(0, 1500)}`);

      return reply.status(200).send({ ok: true });
    }
  );

  fastify.log.info("[WhatsApp] Routes registered at POST /whatsapp/twilio and POST /whatsapp/meta");
}
