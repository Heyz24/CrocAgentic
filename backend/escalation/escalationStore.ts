/**
 * backend/escalation/escalationStore.ts
 * CrocAgentic Phase 8 — Escalation Store.
 *
 * Persists escalations to SQLite so they survive server restarts.
 * Tracks status, approval tokens, reminders, timeouts.
 */

import * as fs     from "fs";
import * as path   from "path";
import * as crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EscalationStatus   = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type EscalationTrigger  = "LOW_CONFIDENCE" | "DESTRUCTIVE_ACTION" | "HIGH_RISK" | "RETRY_LIMIT";
export type EscalationRisk     = "MEDIUM" | "HIGH";

export interface EscalationEvidence {
  goal:             string;
  planSteps:        unknown[];
  executedSteps:    unknown[];
  whyEscalating:    string;
  whatIsNeeded:     string;
  confidenceScore:  number;
  riskAssessment:   string;
  suggestedActions: string[];
}

export interface Escalation {
  id:              string;
  taskId:          string;
  trigger:         EscalationTrigger;
  risk:            EscalationRisk;
  status:          EscalationStatus;
  evidence:        EscalationEvidence;
  approvalToken?:  string;           // required for HIGH risk
  createdAt:       string;
  expiresAt:       string;           // 24h from creation
  reminderSentAt?: string;
  resolvedAt?:     string;
  resolvedBy?:     string;           // "email" | "webhook" | "api"
  resolution?:     string;           // human's message
}

// ─── Storage ───────────────────────────────────────────────────────────────────

const ESCALATION_DIR  = path.resolve(process.cwd(), "runtime", "escalations");
const ESCALATION_DB   = path.join(ESCALATION_DIR, "escalations.json");

let _db: Escalation[] = [];
let _loaded = false;

function ensureDir(): void {
  if (!fs.existsSync(ESCALATION_DIR)) fs.mkdirSync(ESCALATION_DIR, { recursive: true });
}

function load(): Escalation[] {
  if (_loaded) return _db;
  ensureDir();
  if (fs.existsSync(ESCALATION_DB)) {
    try { _db = JSON.parse(fs.readFileSync(ESCALATION_DB, "utf-8")); }
    catch { _db = []; }
  }
  _loaded = true;
  return _db;
}

function save(): void {
  ensureDir();
  fs.writeFileSync(ESCALATION_DB, JSON.stringify(_db, null, 2), "utf-8");
}

// ─── CRUD ──────────────────────────────────────────────────────────────────────

export function createEscalation(params: {
  taskId:   string;
  trigger:  EscalationTrigger;
  risk:     EscalationRisk;
  evidence: EscalationEvidence;
}): Escalation {
  load();
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const escalation: Escalation = {
    id:             crypto.randomBytes(8).toString("hex"),
    taskId:         params.taskId,
    trigger:        params.trigger,
    risk:           params.risk,
    status:         "PENDING",
    evidence:       params.evidence,
    approvalToken:  params.risk === "HIGH"
      ? crypto.randomBytes(16).toString("hex")
      : undefined,
    createdAt:      now.toISOString(),
    expiresAt,
  };

  _db.push(escalation);
  save();
  return escalation;
}

export function getEscalation(id: string): Escalation | null {
  return load().find((e) => e.id === id) ?? null;
}

export function getEscalationByTask(taskId: string): Escalation | null {
  return load().find((e) => e.taskId === taskId) ?? null;
}

export function getPendingEscalations(): Escalation[] {
  return load().filter((e) => e.status === "PENDING");
}

export function resolveEscalation(
  id:         string,
  approved:   boolean,
  resolvedBy: string,
  resolution?: string,
  token?:     string
): { success: boolean; error?: string; escalation?: Escalation } {
  const db  = load();
  const idx = db.findIndex((e) => e.id === id);
  if (idx === -1) return { success: false, error: "Escalation not found" };

  const esc = db[idx];
  if (esc.status !== "PENDING") {
    return { success: false, error: `Escalation already ${esc.status}` };
  }

  // Check expiry
  if (new Date() > new Date(esc.expiresAt)) {
    _db[idx].status = "EXPIRED";
    save();
    return { success: false, error: "Escalation has expired" };
  }

  // Token check for HIGH risk
  if (esc.risk === "HIGH" && esc.approvalToken) {
    if (!token || token !== esc.approvalToken) {
      return { success: false, error: "Invalid approval token. Required for HIGH risk escalations." };
    }
  }

  _db[idx] = {
    ...esc,
    status:     approved ? "APPROVED" : "REJECTED",
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    resolution,
  };
  save();
  return { success: true, escalation: _db[idx] };
}

export function markReminderSent(id: string): void {
  const idx = _db.findIndex((e) => e.id === id);
  if (idx >= 0) {
    _db[idx].reminderSentAt = new Date().toISOString();
    save();
  }
}

export function expireOldEscalations(): number {
  const db  = load();
  const now = new Date();
  let count = 0;
  for (const esc of db) {
    if (esc.status === "PENDING" && new Date(esc.expiresAt) < now) {
      esc.status = "EXPIRED";
      count++;
    }
  }
  if (count > 0) save();
  return count;
}

export function getEscalationStats(): {
  pending: number; approved: number; rejected: number; expired: number; total: number;
} {
  const db = load();
  return {
    pending:  db.filter((e) => e.status === "PENDING").length,
    approved: db.filter((e) => e.status === "APPROVED").length,
    rejected: db.filter((e) => e.status === "REJECTED").length,
    expired:  db.filter((e) => e.status === "EXPIRED").length,
    total:    db.length,
  };
}
