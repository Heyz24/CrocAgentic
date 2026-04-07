/**
 * backend/escalation/escalationDaemon.ts
 * CrocAgentic Phase 8 — Escalation Daemon.
 *
 * Background process that:
 * - Sends reminders after 1h
 * - Expires escalations after 24h
 * - Notifies on server restart if pending escalations exist
 * - Runs every 15 minutes
 */

import {
  getPendingEscalations,
  expireOldEscalations,
  markReminderSent,
  getEscalationStats,
} from "./escalationStore";
import { notifyEscalation } from "./escalationNotifier";

const CHECK_INTERVAL_MS  = 15 * 60 * 1000; // 15 minutes
const REMINDER_AFTER_MS  =  1 * 60 * 60 * 1000; // 1 hour

let _interval: NodeJS.Timeout | null = null;

async function runEscalationCheck(): Promise<void> {
  // 1. Expire old escalations
  const expired = expireOldEscalations();
  if (expired > 0) {
    console.log(`[EscalationDaemon] Expired ${expired} escalation(s)`);
  }

  // 2. Send reminders for escalations older than 1h without a reminder
  const pending = getPendingEscalations();
  for (const esc of pending) {
    const age = Date.now() - new Date(esc.createdAt).getTime();
    if (age > REMINDER_AFTER_MS && !esc.reminderSentAt) {
      console.log(`[EscalationDaemon] Sending reminder for ${esc.id}`);
      await notifyEscalation(esc, true);
      markReminderSent(esc.id);
    }
  }
}

export async function startEscalationDaemon(): Promise<void> {
  console.log("[EscalationDaemon] Starting...");

  // On restart — notify about any pending escalations
  const pending = getPendingEscalations();
  if (pending.length > 0) {
    console.log(`[EscalationDaemon] Found ${pending.length} pending escalation(s) from before restart`);
    for (const esc of pending) {
      console.log(`[EscalationDaemon]   → ${esc.id} (${esc.risk} risk, created ${esc.createdAt})`);
      await notifyEscalation(esc, true); // send as reminder
    }
  }

  // Run immediately
  await runEscalationCheck();

  // Schedule
  _interval = setInterval(runEscalationCheck, CHECK_INTERVAL_MS);
  if (_interval.unref) _interval.unref();

  const stats = getEscalationStats();
  console.log(`[EscalationDaemon] Active — checking every 15min | Stats: ${JSON.stringify(stats)}`);
}

export function stopEscalationDaemon(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log("[EscalationDaemon] Stopped.");
  }
}
