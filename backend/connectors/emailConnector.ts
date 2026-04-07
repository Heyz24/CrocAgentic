/**
 * backend/connectors/emailConnector.ts
 * CrocAgentic Phase 6 — Full Email Connector.
 *
 * Reads inbox via IMAP, processes emails as tasks, replies via SMTP.
 * Supports Gmail, Outlook, any IMAP/SMTP server.
 *
 * Flow:
 * 1. Poll inbox every EMAIL_CHECK_INTERVAL_MS
 * 2. Find unread emails not from self
 * 3. Extract goal from subject + body
 * 4. Run through SecB injection scan
 * 5. Run full pipeline
 * 6. Reply to sender with result
 * 7. Mark email as read
 */

import * as nodemailer from "nodemailer";
import { runPipeline } from "../pipeline/orchestrator";

export interface EmailConfig {
  imapHost:        string;
  imapPort:        number;
  smtpHost:        string;
  smtpPort:        number;
  user:            string;
  pass:            string;
  checkIntervalMs: number;
  agentName:       string;
}

export function loadEmailConfig(): EmailConfig | null {
  const required = ["EMAIL_IMAP_HOST", "EMAIL_USER", "EMAIL_PASS"];
  for (const key of required) {
    if (!process.env[key]) return null;
  }
  return {
    imapHost:        process.env.EMAIL_IMAP_HOST!,
    imapPort:        parseInt(process.env.EMAIL_IMAP_PORT ?? "993"),
    smtpHost:        process.env.EMAIL_SMTP_HOST ?? process.env.EMAIL_IMAP_HOST!,
    smtpPort:        parseInt(process.env.EMAIL_SMTP_PORT ?? "587"),
    user:            process.env.EMAIL_USER!,
    pass:            process.env.EMAIL_PASS!,
    checkIntervalMs: parseInt(process.env.EMAIL_CHECK_INTERVAL_MS ?? "30000"),
    agentName:       process.env.EMAIL_AGENT_NAME ?? "CrocAgentic",
  };
}

export function isEmailConfigured(): boolean {
  return loadEmailConfig() !== null;
}

// ─── SMTP Sender ───────────────────────────────────────────────────────────────

async function sendReply(
  config:    EmailConfig,
  to:        string,
  subject:   string,
  body:      string,
  inReplyTo: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host:   config.smtpHost,
    port:   config.smtpPort,
    secure: config.smtpPort === 465,
    auth:   { user: config.user, pass: config.pass },
  });

  await transporter.sendMail({
    from:      `"${config.agentName}" <${config.user}>`,
    to,
    subject:   subject.startsWith("Re:") ? subject : `Re: ${subject}`,
    text:      body,
    inReplyTo,
    headers:   { "X-CrocAgentic": "true" },
  });

  console.log(`[EmailConnector] ✓ Reply sent to ${to}`);
}

// ─── Goal Extractor ────────────────────────────────────────────────────────────

function extractGoal(subject: string, body: string): string {
  // Clean up email body — remove quoted replies, signatures
  const cleanBody = body
    .split(/\n--\n|\nOn .* wrote:/)[0] // remove signatures and quoted text
    .replace(/>/g, "")                  // remove quote markers
    .trim()
    .slice(0, 2000);

  // If subject looks like a task, use subject + body
  const taskSubjectPattern = /^(task|do|please|can you|help|analyse|analyze|write|create|build|run|check)/i;
  if (taskSubjectPattern.test(subject)) {
    return `${subject}\n\n${cleanBody}`.trim();
  }

  // Otherwise use body if substantial, else fall back to subject
  if (cleanBody.length > 20) return cleanBody;
  return subject;
}

// ─── Format Result ─────────────────────────────────────────────────────────────

function formatEmailReply(
  result: Awaited<ReturnType<typeof runPipeline>>,
  agentName: string
): string {
  const lines: string[] = [
    `${agentName} completed your task.`,
    "",
    `Status:    ${result.finalStatus}`,
    `Risk:      ${result.riskScore}`,
    `Task ID:   ${result.taskId}`,
    `Duration:  ${result.durationMs}ms`,
    "",
    "─────────────────────────",
    "RESULT",
    "─────────────────────────",
    "",
  ];

  if (result.execution?.steps) {
    for (const step of result.execution.steps) {
      if (step.stdout?.trim()) {
        lines.push(step.stdout.trim());
      }
    }
  }

  if (result.finalStatus === "DENIED" || result.finalStatus === "ABORTED") {
    lines.push(`Task was not executed: ${result.reason}`);
  }

  lines.push("", "─────────────────────────");
  lines.push(`Processed by ${agentName} | CrocAgentic v0.6.0`);
  lines.push("This is an automated response.");

  return lines.join("\n");
}

// ─── IMAP Poller ───────────────────────────────────────────────────────────────

let _pollInterval: NodeJS.Timeout | null = null;
let _processing   = false;

async function pollInbox(config: EmailConfig): Promise<void> {
  if (_processing) return;
  _processing = true;

  try {
    // Dynamic import of imap-simple
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const imapSimple = require("imap-simple");

    const connection = await imapSimple.connect({
      imap: {
        user:     config.user,
        password: config.pass,
        host:     config.imapHost,
        port:     config.imapPort,
        tls:      true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      },
    });

    await connection.openBox("INBOX");

    // Search for unread emails
    const searchCriteria  = ["UNSEEN"];
    const fetchOptions    = {
      bodies:   ["HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)", "TEXT"],
      markSeen: false, // we mark seen after processing
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages.length === 0) {
      connection.end();
      _processing = false;
      return;
    }

    console.log(`[EmailConnector] Found ${messages.length} unread email(s)`);

    for (const message of messages) {
      try {
        // Extract headers
        const headerPart = message.parts.find((p: {which: string}) => p.which.includes("HEADER"));
        const textPart   = message.parts.find((p: {which: string}) => p.which === "TEXT");

        const headers = headerPart?.body ?? {};
        const from    = (headers.from?.[0] ?? "").toString();
        const subject = (headers.subject?.[0] ?? "No subject").toString();
        const msgId   = (headers["message-id"]?.[0] ?? "").toString();
        const body    = (textPart?.body ?? "").toString().slice(0, 5000);

        // Skip emails from self
        if (from.includes(config.user)) {
          await connection.addFlags(message.attributes.uid, ["\\Seen"]);
          continue;
        }

        // Skip already-processed CrocAgentic replies
        if (subject.startsWith("Re:") && body.includes("CrocAgentic v0.6.0")) {
          await connection.addFlags(message.attributes.uid, ["\\Seen"]);
          continue;
        }

        console.log(`[EmailConnector] Processing email from: ${from} | Subject: ${subject}`);

        // Extract goal
        const goal = extractGoal(subject, body);

        // Run pipeline
        const result = await runPipeline(goal, true);

        // Format and send reply
        const replyBody = formatEmailReply(result, config.agentName);
        await sendReply(config, from, subject, replyBody, msgId);

        // Mark as read
        await connection.addFlags(message.attributes.uid, ["\\Seen"]);

        console.log(`[EmailConnector] ✓ Processed: ${subject} | Status: ${result.finalStatus}`);
      } catch (msgErr) {
        console.error(`[EmailConnector] Failed to process message:`, (msgErr as Error).message);
      }
    }

    connection.end();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Invalid credentials") || msg.includes("AUTHENTICATIONFAILED")) {
      console.error(`[EmailConnector] ✗ Authentication failed. Check EMAIL_USER and EMAIL_PASS in .env`);
      console.error(`[EmailConnector]   For Gmail: use App Password from myaccount.google.com/apppasswords`);
    } else {
      console.error(`[EmailConnector] Poll error:`, msg);
    }
  } finally {
    _processing = false;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function startEmailConnector(): Promise<void> {
  const config = loadEmailConfig();
  if (!config) {
    console.log("[EmailConnector] Not configured. Set EMAIL_* vars in .env to enable.");
    return;
  }

  console.log(`[EmailConnector] Starting for ${config.user}`);
  console.log(`[EmailConnector] Checking every ${config.checkIntervalMs / 1000}s`);

  // Run immediately on start
  await pollInbox(config);

  // Then poll on interval
  _pollInterval = setInterval(() => pollInbox(config), config.checkIntervalMs);
  if (_pollInterval.unref) _pollInterval.unref();

  console.log(`[EmailConnector] ✓ Active — waiting for emails at ${config.user}`);
}

export async function stopEmailConnector(): Promise<void> {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
    console.log("[EmailConnector] Stopped.");
  }
}

export async function triggerEmailCheck(): Promise<void> {
  const config = loadEmailConfig();
  if (!config) return;
  await pollInbox(config);
}
