/**
 * backend/memory/memoryStore.ts
 * CrocAgentic Phase 7 — Memory Store.
 *
 * Three memory layers:
 *   Short-term:  per-task, in-memory Map, cleared after task
 *   Medium-term: per-project, SQLite + vector search, 90-day TTL
 *   Long-term:   permanent preferences/rules, SQLite, never expires
 *
 * Storage: runtime/memory/memory.db
 */

import * as fs   from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MemoryLayer = "short" | "medium" | "long";
export type MemoryCategory = "task" | "project" | "preference" | "rule" | "file" | "result";

export interface MemoryEntry {
  id:         string;
  layer:      MemoryLayer;
  category:   MemoryCategory;
  userId:     string;          // "shared" for org-wide
  projectId:  string;          // "global" for cross-project
  key:        string;          // searchable identifier
  content:    string;          // the actual memory text
  metadata:   Record<string, unknown>;
  createdAt:  string;
  accessedAt: string;
  expiresAt:  string | null;   // null = never expires
  accessCount: number;
}

export interface ContextPacket {
  projectSummary:  string;
  recentTasks:     MemoryEntry[];
  relevantFiles:   MemoryEntry[];
  userPreferences: MemoryEntry[];
  orgRules:        MemoryEntry[];
}

// ─── TTL Config ────────────────────────────────────────────────────────────────

const TTL_MS = {
  short:  24 * 60 * 60 * 1000,        // 1 day
  medium: 90 * 24 * 60 * 60 * 1000,   // 90 days
  long:   null,                         // never
};

// ─── Storage ───────────────────────────────────────────────────────────────────

const MEMORY_DIR = path.resolve(process.cwd(), "runtime", "memory");
const MEMORY_DB  = path.join(MEMORY_DIR, "memory.db");

// Short-term: pure in-memory
const shortTermStore = new Map<string, MemoryEntry[]>();

// Medium + Long term: JSON file store (no native deps)
// Upgrades to vector DB in Phase 10
let _db: MemoryEntry[] = [];
let _dbLoaded = false;

function ensureDir(): void {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadDb(): MemoryEntry[] {
  if (_dbLoaded) return _db;
  ensureDir();
  if (fs.existsSync(MEMORY_DB)) {
    try {
      _db = JSON.parse(fs.readFileSync(MEMORY_DB, "utf-8")) as MemoryEntry[];
    } catch {
      _db = [];
    }
  }
  _dbLoaded = true;
  return _db;
}

function saveDb(): void {
  ensureDir();
  fs.writeFileSync(MEMORY_DB, JSON.stringify(_db, null, 2), "utf-8");
}

function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

// ─── Expiry ────────────────────────────────────────────────────────────────────

function makeExpiry(layer: MemoryLayer): string | null {
  const ttl = TTL_MS[layer];
  if (!ttl) return null;
  return new Date(Date.now() + ttl).toISOString();
}

export function pruneExpired(): number {
  const db  = loadDb();
  const now = Date.now();
  const before = db.length;
  _db = db.filter((e) => {
    if (!e.expiresAt) return true;
    return new Date(e.expiresAt).getTime() > now;
  });
  const pruned = before - _db.length;
  if (pruned > 0) {
    saveDb();
    console.log(`[MemoryStore] Pruned ${pruned} expired entries`);
  }
  return pruned;
}

// ─── Write ─────────────────────────────────────────────────────────────────────

export function remember(params: {
  layer:      MemoryLayer;
  category:   MemoryCategory;
  userId?:    string;
  projectId?: string;
  key:        string;
  content:    string;
  metadata?:  Record<string, unknown>;
}): MemoryEntry {
  const now   = new Date().toISOString();
  const entry: MemoryEntry = {
    id:          generateId(),
    layer:       params.layer,
    category:    params.category,
    userId:      params.userId    ?? "shared",
    projectId:   params.projectId ?? "global",
    key:         params.key,
    content:     params.content,
    metadata:    params.metadata  ?? {},
    createdAt:   now,
    accessedAt:  now,
    expiresAt:   makeExpiry(params.layer),
    accessCount: 0,
  };

  if (params.layer === "short") {
    const taskId = params.projectId ?? "global";
    const existing = shortTermStore.get(taskId) ?? [];
    existing.push(entry);
    shortTermStore.set(taskId, existing);
  } else {
    const db = loadDb();
    // Replace if same key + user + project
    const idx = db.findIndex((e) =>
      e.key === entry.key &&
      e.userId === entry.userId &&
      e.projectId === entry.projectId &&
      e.layer === entry.layer
    );
    if (idx >= 0) {
      _db[idx] = { ...entry, id: _db[idx].id, createdAt: _db[idx].createdAt };
    } else {
      _db.push(entry);
    }
    saveDb();
  }

  return entry;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export function recall(params: {
  layer?:      MemoryLayer;
  category?:   MemoryCategory;
  userId?:     string;
  projectId?:  string;
  query?:      string;   // keyword search
  limit?:      number;
}): MemoryEntry[] {
  const { layer, category, userId, projectId, query, limit = 10 } = params;
  const now = Date.now();

  let entries: MemoryEntry[] = [];

  // Short-term
  if (!layer || layer === "short") {
    const key = projectId ?? "global";
    entries.push(...(shortTermStore.get(key) ?? []));
  }

  // Medium + Long term
  if (!layer || layer === "medium" || layer === "long") {
    const db = loadDb();
    entries.push(...db.filter((e) => {
      if (layer && e.layer !== layer) return false;
      if (category && e.category !== category) return false;
      if (e.expiresAt && new Date(e.expiresAt).getTime() < now) return false;
      // userId filter: return shared + user-specific
      if (userId && e.userId !== "shared" && e.userId !== userId) return false;
      if (projectId && e.projectId !== "global" && e.projectId !== projectId) return false;
      return true;
    }));
  }

  // Keyword search
  if (query) {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    entries = entries.filter((e) =>
      terms.some((t) =>
        e.content.toLowerCase().includes(t) ||
        e.key.toLowerCase().includes(t)
      )
    );
  }

  // Sort by relevance: most recently accessed first
  entries.sort((a, b) =>
    new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime()
  );

  // Update access tracking
  const result = entries.slice(0, limit);
  for (const e of result) {
    e.accessedAt  = new Date().toISOString();
    e.accessCount++;
  }
  if (result.some((e) => e.layer !== "short")) saveDb();

  return result;
}

// ─── Forget ────────────────────────────────────────────────────────────────────

export function forget(params: {
  id?:        string;
  key?:       string;
  userId?:    string;
  projectId?: string;
  layer?:     MemoryLayer;
}): number {
  const db     = loadDb();
  const before = _db.length;

  _db = db.filter((e) => {
    if (params.id        && e.id        === params.id)        return false;
    if (params.key       && e.key       === params.key)       return false;
    if (params.projectId && e.projectId === params.projectId &&
        (!params.layer   || e.layer     === params.layer))    return false;
    return true;
  });

  // Short-term
  if (params.projectId) shortTermStore.delete(params.projectId);

  const removed = before - _db.length;
  if (removed > 0) saveDb();
  return removed;
}

export function clearShortTerm(taskId: string): void {
  shortTermStore.delete(taskId);
}

// ─── Context Builder ───────────────────────────────────────────────────────────

export function buildContextPacket(params: {
  userId:    string;
  projectId: string;
  goal:      string;
}): ContextPacket {
  const { userId, projectId, goal } = params;

  const projectSummaryEntry = recall({
    layer: "medium", category: "project",
    userId, projectId, limit: 1,
  })[0];

  const recentTasks = recall({
    layer: "medium", category: "task",
    userId, projectId, limit: 3,
  });

  const relevantFiles = recall({
    layer: "medium", category: "file",
    userId, projectId, query: goal, limit: 5,
  });

  const userPreferences = recall({
    layer: "long", category: "preference",
    userId, limit: 5,
  });

  const orgRules = recall({
    layer: "long", category: "rule",
    userId: "shared", limit: 5,
  });

  return {
    projectSummary:  projectSummaryEntry?.content ?? "No project summary yet.",
    recentTasks,
    relevantFiles,
    userPreferences,
    orgRules,
  };
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

export function getMemoryStats(): {
  shortTerm:  number;
  mediumTerm: number;
  longTerm:   number;
  total:      number;
} {
  const db         = loadDb();
  const shortTerm  = Array.from(shortTermStore.values()).reduce((acc, v) => acc + v.length, 0);
  const mediumTerm = db.filter((e) => e.layer === "medium").length;
  const longTerm   = db.filter((e) => e.layer === "long").length;
  return { shortTerm, mediumTerm, longTerm, total: shortTerm + mediumTerm + longTerm };
}
