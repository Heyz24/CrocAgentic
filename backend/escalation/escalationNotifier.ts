/**
 * backend/escalation/escalationNotifier.ts
 * CrocAgentic Phase 8 — Escalation Notifier.
 *
 * Sends escalation notifications via all configured channels:
 * Email, Telegram, Slack, Webhook callback.
 *
 * Also handles reminders (1h) and expiry notifications.
 */

import * as nodemailer from "nodemailer";
import { Escalation }  from "./escalationStore";
import { loadEmailConfig } from "../connectors/emailConnector";

// ─── Format Evidence ───────────────────────────────────────────────────────────

function formatEscalationMessage(esc: Escalation, channel: "text" | "html" = "text"): string {
  const lines = [
    `🚨 CrocAgentic ESCALATION — Action Required`,
    ``,
    `ID:        ${esc.id}`,
    `Task:      ${esc.taskId}`,
    `Trigger:   ${esc.trigger}`,
    `Risk:      ${esc.risk}`,
    `Expires:   ${new Date(esc.expiresAt).toLocaleString()}`,
    ``,
    `━━━ SITUATION ━━━`,
    `Goal: ${esc.evidence.goal}`,
    ``,
    `Why escalating: ${esc.evidence.whyEscalating}`,
    `What is needed: ${esc.evidence.whatIsNeeded}`,
    `Confidence score: ${esc.evidence.confidenceScore}/100`,
    `Risk assessment: ${esc.evidence.riskAssessment}`,
    ``,
    `━━━ SUGGESTED ACTIONS ━━━`,
    ...esc.evidence.suggestedActions.map((a, i) => `${i + 1}. ${a}`),
    ``,
    `━━━ HOW TO RESPOND ━━━`,
  ];

  const baseUrl = process.env.SERVER_URL ?? "http://localhost:3000";

  if (esc.risk === "HIGH" && esc.approvalToken) {
    lines.push(`This is a HIGH RISK action. Approval token required:`);
    lines.push(`Token: ${esc.approvalToken}`);
    lines.push(``);
    lines.push(`To APPROVE: POST ${baseUrl}/escalation/${esc.id}/approve`);
    lines.push(`  Body: { "token": "${esc.approvalToken}", "resolution": "your message" }`);
    lines.push(``);
    lines.push(`To REJECT: POST ${baseUrl}/escalation/${esc.id}/reject`);
    lines.push(`  Body: { "token": "${esc.approvalToken}", "resolution": "reason" }`);
  } else {
    lines.push(`To APPROVE: POST ${baseUrl}/escalation/${esc.id}/approve`);
    lines.push(`  Body: { "resolution": "approved" }`);
    lines.push(``);
    lines.push(`To REJECT: POST ${baseUrl}/escalation/${esc.id}/reject`);
    lines.push(`  Body: { "resolution": "reason for rejection" }`);
  }

  lines.push(``);
  lines.push(`Or reply to this email with APPROVE or REJECT as the first word.`);
  lines.push(`— CrocAgentic v0.8.0`);

  return lines.join("\n");
}

// ─── Email Notification ────────────────────────────────────────────────────────

async function notifyViaEmail(esc: Escalation, isReminder = false): Promise<boolean> {
  const config = loadEmailConfig();
  if (!config) return false;

  const notifyEmail = process.env.ESCALATION_NOTIFY_EMAIL ?? config.user;

  try {
    const transporter = nodemailer.createTransport({
      host:   config.smtpHost,
      port:   config.smtpPort,
      secure: config.smtpPort === 465,
      auth:   { user: config.user, pass: config.pass },
    });

    const prefix  = isReminder ? "[REMINDER] " : "";
    const subject = `${prefix}🚨 CrocAgentic Escalation — ${esc.risk} Risk — Action Required`;

    await transporter.sendMail({
      from:    `"CrocAgentic" <${config.user}>`,
      to:      notifyEmail,
      subject,
      text:    formatEscalationMessage(esc),
    });

    console.log(`[EscalationNotifier] ✓ Email sent to ${notifyEmail}`);
    return true;
  } catch (err) {
    console.error(`[EscalationNotifier] Email failed:`, (err as Error).message);
    return false;
  }
}

// ─── Telegram Notification ─────────────────────────────────────────────────────

async function notifyViaTelegram(esc: Escalation, isReminder = false): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.ESCALATION_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  const prefix  = isReminder ? "🔔 *REMINDER* " : "";
  const message = `${prefix}🚨 *CrocAgentic Escalation*\n\n` +
    `*Risk:* ${esc.risk}\n` +
    `*Trigger:* ${esc.trigger}\n` +
    `*Goal:* ${esc.evidence.goal.slice(0, 200)}\n\n` +
    `*Why:* ${esc.evidence.whyEscalating}\n\n` +
    `*Needed:* ${esc.evidence.whatIsNeeded}\n\n` +
    `*Expires:* ${new Date(esc.expiresAt).toLocaleString()}\n\n` +
    `To respond: POST /escalation/${esc.id}/approve or /reject`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
    console.log(`[EscalationNotifier] ✓ Telegram sent`);
    return true;
  } catch (err) {
    console.error(`[EscalationNotifier] Telegram failed:`, (err as Error).message);
    return false;
  }
}

// ─── Slack Notification ────────────────────────────────────────────────────────

async function notifyViaSlack(esc: Escalation, isReminder = false): Promise<boolean> {
  const token   = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.ESCALATION_SLACK_CHANNEL ?? "#general";
  if (!token) return false;

  const prefix = isReminder ? ":bell: *REMINDER* " : "";
  const text   = `${prefix}:rotating_light: *CrocAgentic Escalation — ${esc.risk} Risk*\n` +
    `Goal: ${esc.evidence.goal.slice(0, 200)}\n` +
    `Why: ${esc.evidence.whyEscalating}\n` +
    `Needed: ${esc.evidence.whatIsNeeded}\n` +
    `Expires: ${new Date(esc.expiresAt).toLocaleString()}\n` +
    `Respond: \`POST /escalation/${esc.id}/approve\` or \`/reject\``;

  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body:    JSON.stringify({ channel, text }),
    });
    console.log(`[EscalationNotifier] ✓ Slack sent`);
    return true;
  } catch (err) {
    console.error(`[EscalationNotifier] Slack failed:`, (err as Error).message);
    return false;
  }
}

// ─── Webhook Notification ──────────────────────────────────────────────────────

async function notifyViaWebhook(esc: Escalation): Promise<boolean> {
  const webhookUrl = process.env.ESCALATION_WEBHOOK_URL;
  if (!webhookUrl) return false;

  try {
    await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-CrocAgentic-Event": "escalation" },
      body:    JSON.stringify({ event: "escalation", escalation: esc }),
      signal:  AbortSignal.timeout(10000),
    });
    console.log(`[EscalationNotifier] ✓ Webhook sent to ${webhookUrl}`);
    return true;
  } catch (err) {
    console.error(`[EscalationNotifier] Webhook failed:`, (err as Error).message);
    return false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function notifyEscalation(esc: Escalation, isReminder = false): Promise<void> {
  console.log(`[EscalationNotifier] Sending ${isReminder ? "reminder" : "notification"} for ${esc.id} (${esc.risk} risk)`);

  const results = await Promise.allSettled([
    notifyViaEmail(esc, isReminder),
    notifyViaTelegram(esc, isReminder),
    notifyViaSlack(esc, isReminder),
    notifyViaWebhook(esc),
  ]);

  const sent = results.filter((r) => r.status === "fulfilled" && r.value).length;
  console.log(`[EscalationNotifier] Sent via ${sent} channel(s)`);

  if (sent === 0) {
    console.warn(`[EscalationNotifier] ⚠️  No notification channels configured.`);
    console.warn(`[EscalationNotifier]    Set EMAIL_*, TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, or ESCALATION_WEBHOOK_URL`);
    console.warn(`[EscalationNotifier]    Escalation ${esc.id} requires manual resolution at POST /escalation/${esc.id}/approve`);
  }
}
