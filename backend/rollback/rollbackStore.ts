/**
 * backend/rollback/rollbackStore.ts
 * CrocAgentic Phase 9 — Rollback Store.
 *
 * Records every reversible action before execution.
 * Enables full undo of any task's side effects.
 *
 * Action types tracked:
 *   FILE_WRITE    — original content saved before overwrite
 *   FILE_CREATE   — file path recorded for deletion on rollback
 *   FILE_DELETE   — file moved to quarantine before deletion
 *   SHELL_EXEC    — command recorded (output cannot be undone, but logged)
 *   HTTP_REQUEST  — request recorded (cannot undo, but logged)
 *   DIR_CREATE    — directory path recorded for removal on rollback
 */

import * as fs     from "fs";
import * as path   from "path";
import * as crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RollbackActionType =
  | "FILE_WRITE"
  | "FILE_CREATE"
  | "FILE_DELETE"
  | "SHELL_EXEC"
  | "HTTP_REQUEST"
  | "DIR_CREATE"
  | "WORKSPACE_SNAPSHOT";

export type RollbackStatus = "PENDING" | "ROLLED_BACK" | "COMMITTED";

export interface RollbackAction {
  id:             string;
  taskId:         string;
  actionType:     RollbackActionType;
  timestamp:      string;
  reversible:     boolean;
  status:         RollbackStatus;
  // Pre-action state
  filePath?:      string;           // affected file
  originalContent?: string;         // content before write
  quarantinePath?: string;          // where deleted file was moved
  // Action details
  command?:       string[];         // shell command executed
  httpMethod?:    string;
  httpUrl?:       string;
  // Snapshot
  snapshotId?:    string;
}

export interface RollbackTransaction {
  taskId:     string;
  actions:    RollbackAction[];
  status:     RollbackStatus;
  createdAt:  string;
  rolledBackAt?: string;
  committedAt?:  string;
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const ROLLBACK_DIR   = path.resolve(process.cwd(), "runtime", "rollback");
const QUARANTINE_DIR = path.resolve(process.cwd(), "runtime", ".trash");
const SNAPSHOT_DIR   = path.resolve(process.cwd(), "runtime", "snapshots");
const ROLLBACK_DB    = path.join(ROLLBACK_DIR, "rollback.json");

// Quarantine TTL: 7 days
const QUARANTINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDirs(): void {
  for (const dir of [ROLLBACK_DIR, QUARANTINE_DIR, SNAPSHOT_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── In-memory transaction registry ───────────────────────────────────────────

const activeTransactions = new Map<string, RollbackTransaction>();

let _persistedTransactions: RollbackTransaction[] = [];
let _dbLoaded = false;

function loadDb(): void {
  if (_dbLoaded) return;
  ensureDirs();
  if (fs.existsSync(ROLLBACK_DB)) {
    try {
      _persistedTransactions = JSON.parse(fs.readFileSync(ROLLBACK_DB, "utf-8"));
    } catch { _persistedTransactions = []; }
  }
  _dbLoaded = true;
}

function saveDb(): void {
  ensureDirs();
  fs.writeFileSync(ROLLBACK_DB, JSON.stringify(_persistedTransactions, null, 2), "utf-8");
}

// ─── Transaction Management ────────────────────────────────────────────────────

export function beginTransaction(taskId: string): void {
  activeTransactions.set(taskId, {
    taskId,
    actions:   [],
    status:    "PENDING",
    createdAt: new Date().toISOString(),
  });
}

export function recordAction(taskId: string, action: Omit<RollbackAction, "id" | "taskId" | "timestamp" | "status">): string {
  const tx = activeTransactions.get(taskId);
  if (!tx) return "";

  const entry: RollbackAction = {
    id:        crypto.randomBytes(6).toString("hex"),
    taskId,
    timestamp: new Date().toISOString(),
    status:    "PENDING",
    ...action,
  };

  tx.actions.push(entry);
  return entry.id;
}

export function commitTransaction(taskId: string): void {
  const tx = activeTransactions.get(taskId);
  if (!tx) return;

  tx.status      = "COMMITTED";
  tx.committedAt = new Date().toISOString();

  loadDb();
  _persistedTransactions.push(tx);
  saveDb();
  activeTransactions.delete(taskId);
}

export function getTransaction(taskId: string): RollbackTransaction | null {
  return activeTransactions.get(taskId) ??
    _persistedTransactions.find((t) => t.taskId === taskId) ?? null;
}

// ─── Rollback Execution ────────────────────────────────────────────────────────

export async function rollbackTransaction(taskId: string): Promise<{
  success: boolean;
  actionsRolledBack: number;
  errors: string[];
}> {
  const tx = activeTransactions.get(taskId) ??
    _persistedTransactions.find((t) => t.taskId === taskId);

  if (!tx) return { success: false, actionsRolledBack: 0, errors: ["Transaction not found"] };
  if (tx.status === "ROLLED_BACK") return { success: false, actionsRolledBack: 0, errors: ["Transaction already rolled back"] };

  const errors: string[] = [];
  let rolledBack = 0;

  // Reverse order — undo newest action first
  const reversible = [...tx.actions].reverse().filter((a) => a.reversible);

  for (const action of reversible) {
    try {
      await undoAction(action);
      action.status = "ROLLED_BACK";
      rolledBack++;
    } catch (err) {
      errors.push(`Failed to undo ${action.actionType} on ${action.filePath}: ${(err as Error).message}`);
    }
  }

  tx.status        = "ROLLED_BACK";
  tx.rolledBackAt  = new Date().toISOString();

  // Persist
  loadDb();
  const idx = _persistedTransactions.findIndex((t) => t.taskId === taskId);
  if (idx >= 0) _persistedTransactions[idx] = tx;
  else _persistedTransactions.push(tx);
  saveDb();
  activeTransactions.delete(taskId);

  return { success: errors.length === 0, actionsRolledBack: rolledBack, errors };
}

async function undoAction(action: RollbackAction): Promise<void> {
  switch (action.actionType) {
    case "FILE_WRITE": {
      if (!action.filePath) return;
      if (action.originalContent !== undefined) {
        // Restore original content
        fs.writeFileSync(action.filePath, action.originalContent, "utf-8");
      } else {
        // File was created by the write — delete it
        if (fs.existsSync(action.filePath)) fs.unlinkSync(action.filePath);
      }
      break;
    }
    case "FILE_CREATE": {
      if (action.filePath && fs.existsSync(action.filePath)) {
        // Move to quarantine instead of deleting
        const quarantinePath = path.join(
          QUARANTINE_DIR,
          `${path.basename(action.filePath)}_${Date.now()}`
        );
        fs.renameSync(action.filePath, quarantinePath);
      }
      break;
    }
    case "FILE_DELETE": {
      // Restore from quarantine
      if (action.quarantinePath && action.filePath) {
        if (fs.existsSync(action.quarantinePath)) {
          fs.mkdirSync(path.dirname(action.filePath), { recursive: true });
          fs.renameSync(action.quarantinePath, action.filePath);
        }
      }
      break;
    }
    case "DIR_CREATE": {
      if (action.filePath && fs.existsSync(action.filePath)) {
        // Only remove if empty
        const contents = fs.readdirSync(action.filePath);
        if (contents.length === 0) fs.rmdirSync(action.filePath);
      }
      break;
    }
    case "WORKSPACE_SNAPSHOT": {
      if (action.snapshotId) await restoreSnapshot(action.snapshotId);
      break;
    }
    // SHELL_EXEC and HTTP_REQUEST: not reversible, just logged
    default:
      break;
  }
}

// ─── Pre-Action Capture ────────────────────────────────────────────────────────

export function captureFileState(taskId: string, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    // File doesn't exist yet — record as FILE_CREATE
    recordAction(taskId, {
      actionType:  "FILE_CREATE",
      reversible:  true,
      filePath,
    });
  } else {
    // File exists — save original content
    const originalContent = fs.readFileSync(filePath, "utf-8");
    recordAction(taskId, {
      actionType:   "FILE_WRITE",
      reversible:   true,
      filePath,
      originalContent,
    });
  }
}

export function captureFileDelete(taskId: string, filePath: string): string {
  // Move to quarantine before deletion
  ensureDirs();
  const quarantinePath = path.join(
    QUARANTINE_DIR,
    `${path.basename(filePath)}_${Date.now()}`
  );

  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, quarantinePath);
  }

  recordAction(taskId, {
    actionType:    "FILE_DELETE",
    reversible:    true,
    filePath,
    quarantinePath,
  });

  return quarantinePath;
}

export function captureShellCommand(taskId: string, command: string[]): void {
  recordAction(taskId, {
    actionType: "SHELL_EXEC",
    reversible: false,
    command,
  });
}

export function captureHttpRequest(taskId: string, method: string, url: string): void {
  recordAction(taskId, {
    actionType:  "HTTP_REQUEST",
    reversible:  false,
    httpMethod:  method,
    httpUrl:     url,
  });
}

// ─── Workspace Snapshot ────────────────────────────────────────────────────────

export async function takeSnapshot(taskId: string, workspacePath: string): Promise<string> {
  ensureDirs();
  const snapshotId = `${taskId.slice(0, 8)}_${Date.now()}`;
  const snapshotPath = path.join(SNAPSHOT_DIR, snapshotId);
  fs.mkdirSync(snapshotPath, { recursive: true });

  // Copy all files from workspace to snapshot
  if (fs.existsSync(workspacePath)) {
    const files = fs.readdirSync(workspacePath);
    for (const file of files) {
      const src = path.join(workspacePath, file);
      const dst = path.join(snapshotPath, file);
      const stat = fs.statSync(src);
      if (stat.isFile()) {
        fs.copyFileSync(src, dst);
      }
    }
  }

  recordAction(taskId, {
    actionType:  "WORKSPACE_SNAPSHOT",
    reversible:  true,
    snapshotId,
    filePath:    workspacePath,
  });

  return snapshotId;
}

async function restoreSnapshot(snapshotId: string): Promise<void> {
  const snapshotPath = path.join(SNAPSHOT_DIR, snapshotId);
  if (!fs.existsSync(snapshotPath)) return;

  // Read snapshot manifest and restore files
  const files = fs.readdirSync(snapshotPath);
  const workspacePath = path.resolve(process.cwd(), "runtime", "tasks");

  for (const file of files) {
    const src = path.join(snapshotPath, file);
    const dst = path.join(workspacePath, file);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

// ─── Quarantine Management ─────────────────────────────────────────────────────

export function listQuarantine(): Array<{ name: string; size: number; quarantinedAt: string }> {
  ensureDirs();
  return fs.readdirSync(QUARANTINE_DIR).map((file) => {
    const stat = fs.statSync(path.join(QUARANTINE_DIR, file));
    return {
      name:          file,
      size:          stat.size,
      quarantinedAt: stat.birthtime.toISOString(),
    };
  });
}

export function restoreFromQuarantine(filename: string, targetPath: string): boolean {
  const src = path.join(QUARANTINE_DIR, filename);
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(src, targetPath);
  return true;
}

export function purgeQuarantine(): number {
  ensureDirs();
  const now   = Date.now();
  const files = fs.readdirSync(QUARANTINE_DIR);
  let purged  = 0;

  for (const file of files) {
    const fullPath = path.join(QUARANTINE_DIR, file);
    const stat     = fs.statSync(fullPath);
    if (now - stat.birthtimeMs > QUARANTINE_TTL_MS) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      purged++;
    }
  }

  if (purged > 0) console.log(`[Quarantine] Purged ${purged} expired file(s)`);
  return purged;
}

export function getRollbackStats(): {
  activeTransactions:    number;
  persistedTransactions: number;
  quarantineFiles:       number;
  totalActions:          number;
} {
  loadDb();
  ensureDirs();
  return {
    activeTransactions:    activeTransactions.size,
    persistedTransactions: _persistedTransactions.length,
    quarantineFiles:       fs.readdirSync(QUARANTINE_DIR).length,
    totalActions:          _persistedTransactions.reduce((sum, t) => sum + t.actions.length, 0),
  };
}
