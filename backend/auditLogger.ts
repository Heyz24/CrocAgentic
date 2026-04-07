/**
 * backend/auditLogger.ts
 * CrocAgentic Audit Logger — uses sql.js (pure JS SQLite, no native build).
 */

import initSqlJs, { Database } from "sql.js";
import * as fs from "fs";
import * as path from "path";
import type { AuditLogEntry, TaskSession } from "../utils/zodSchemas";

const DB_DIR  = path.resolve(__dirname, "../data");
const DB_PATH = path.join(DB_DIR, "audit.db");

let _db: Database | null = null;

async function getDb(): Promise<Database> {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  _db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     TEXT NOT NULL UNIQUE,
      timestamp   TEXT NOT NULL,
      goal        TEXT NOT NULL,
      plan_json   TEXT NOT NULL,
      approval    INTEGER NOT NULL,
      risk_score  TEXT NOT NULL,
      reason      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ts   ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_risk ON audit_log(risk_score);
  `);

  return _db;
}

function persist(): void {
  if (!_db) return;
  const data = _db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function logTaskSession(goal: string, session: TaskSession): Promise<void> {
  const db = await getDb();
  db.run(
    `INSERT OR IGNORE INTO audit_log
     (task_id, timestamp, goal, plan_json, approval, risk_score, reason)
     VALUES (?,?,?,?,?,?,?)`,
    [
      session.taskId,
      new Date().toISOString(),
      goal,
      JSON.stringify(session.plan),
      session.approval ? 1 : 0,
      session.riskScore,
      session.reason,
    ]
  );
  persist();
}

export async function getAuditLog(limit = 100, offset = 0): Promise<AuditLogEntry[]> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  );
  if (!result.length) return [];
  return result[0].values.map(rowToEntry);
}

export async function getAuditEntry(taskId: string): Promise<AuditLogEntry | null> {
  const db = await getDb();
  const result = db.exec(
    `SELECT * FROM audit_log WHERE task_id = '${taskId.replace(/'/g, "''")}'`
  );
  if (!result.length || !result[0].values.length) return null;
  return rowToEntry(result[0].values[0]);
}

export async function countAuditEntries(): Promise<number> {
  const db = await getDb();
  const result = db.exec(`SELECT COUNT(*) FROM audit_log`);
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

export async function getAuditStats(): Promise<{
  total: number;
  approved: number;
  denied: number;
  byRisk: Record<string, number>;
}> {
  const db = await getDb();
  const total = await countAuditEntries();
  const approvedRes = db.exec(`SELECT COUNT(*) FROM audit_log WHERE approval = 1`);
  const approved = (approvedRes[0]?.values[0]?.[0] as number) ?? 0;
  const riskRes = db.exec(`SELECT risk_score, COUNT(*) FROM audit_log GROUP BY risk_score`);
  const byRisk: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  if (riskRes.length) {
    for (const row of riskRes[0].values) {
      byRisk[row[0] as string] = row[1] as number;
    }
  }
  return { total, approved, denied: total - approved, byRisk };
}

export function closeDb(): void {
  persist();
  _db?.close();
  _db = null;
}

type SqlRow = (string | number | null | Uint8Array)[];

function rowToEntry(row: SqlRow): AuditLogEntry {
  return {
    taskId:    row[1] as string,
    timestamp: row[2] as string,
    goal:      row[3] as string,
    planJson:  row[4] as string,
    approval:  (row[5] as number) === 1,
    riskScore: row[6] as "LOW" | "MEDIUM" | "HIGH",
    reason:    row[7] as string,
  };
}
