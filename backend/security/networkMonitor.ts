/**
 * backend/security/networkMonitor.ts
 * CrocAgentic Phase 10 — Network Egress Monitor.
 *
 * Logs and alerts on all outbound HTTP calls the agent makes.
 * Detects unexpected domains, data exfiltration patterns.
 * All calls go through this before being executed.
 */

import * as fs   from "fs";
import * as path from "path";

export interface EgressEvent {
  timestamp:  string;
  url:        string;
  domain:     string;
  method:     string;
  taskId?:    string;
  allowed:    boolean;
  reason?:    string;
  bodySize?:  number;
}

const EGRESS_LOG  = path.resolve(process.cwd(), "runtime", "security", "egress.log");
const MAX_LOG_MB  = 10;

function ensureDir(): void {
  const dir = path.dirname(EGRESS_LOG);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return "invalid"; }
}

// Known suspicious patterns
const SUSPICIOUS_DOMAINS = [
  "requestbin.com", "webhook.site", "ngrok.io", "burpsuite.net",
  "interactsh.com", "canarytokens.com", "oast.me",
];

const DATA_EXFIL_PATTERNS = [
  /base64/i, /exfil/i, /dump/i, /steal/i, /payload=.*data/i,
];

export function logEgress(event: Omit<EgressEvent, "timestamp" | "domain">): void {
  ensureDir();

  const domain   = extractDomain(event.url);
  const fullEvent: EgressEvent = {
    ...event,
    timestamp: new Date().toISOString(),
    domain,
  };

  // Alert on suspicious domains
  if (SUSPICIOUS_DOMAINS.some((d) => domain.includes(d))) {
    console.error(`[NetworkMonitor] 🚨 SUSPICIOUS DOMAIN: ${domain} — ${event.url}`);
  }

  // Alert on possible exfiltration
  for (const pattern of DATA_EXFIL_PATTERNS) {
    if (pattern.test(event.url)) {
      console.error(`[NetworkMonitor] 🚨 POSSIBLE EXFILTRATION: ${event.url}`);
      break;
    }
  }

  // Rotate log if too large
  try {
    if (fs.existsSync(EGRESS_LOG)) {
      const stats = fs.statSync(EGRESS_LOG);
      if (stats.size > MAX_LOG_MB * 1024 * 1024) {
        fs.renameSync(EGRESS_LOG, `${EGRESS_LOG}.old`);
      }
    }
    fs.appendFileSync(EGRESS_LOG, JSON.stringify(fullEvent) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function getEgressLog(limit = 100): EgressEvent[] {
  ensureDir();
  if (!fs.existsSync(EGRESS_LOG)) return [];

  try {
    const lines = fs.readFileSync(EGRESS_LOG, "utf-8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as EgressEvent);
    return lines.reverse(); // newest first
  } catch {
    return [];
  }
}

export function getEgressStats(): {
  totalCalls:   number;
  blockedCalls: number;
  topDomains:   Array<{ domain: string; count: number }>;
} {
  const log = getEgressLog(1000);
  const domainCounts = new Map<string, number>();

  for (const event of log) {
    domainCounts.set(event.domain, (domainCounts.get(event.domain) ?? 0) + 1);
  }

  const topDomains = Array.from(domainCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

  return {
    totalCalls:   log.length,
    blockedCalls: log.filter((e) => !e.allowed).length,
    topDomains,
  };
}
