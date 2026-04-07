/**
 * backend/security/rateLimiter.ts
 * CrocAgentic Phase 10 — Rate Limiter.
 *
 * Per-IP and per-task-type rate limiting.
 * Prevents runaway agents, abuse, and DoS.
 *
 * Limits:
 *   Global:   100 requests/min per IP
 *   Execute:   10 pipeline runs/min per IP
 *   Setup:      3 setup calls/min per IP
 *   Webhook:   10 calls/min per IP (already in webhookConnector)
 *   LLM calls: configurable per provider (free tier protection)
 */

interface RateBucket {
  count:   number;
  resetAt: number;
}

type LimitKey = string; // `${ip}:${endpoint}`

const buckets = new Map<LimitKey, RateBucket>();

// Rate limit config per endpoint category
const RATE_LIMITS: Record<string, { maxPerMin: number; label: string }> = {
  "execute":  { maxPerMin: 10,  label: "Pipeline executions" },
  "setup":    { maxPerMin: 3,   label: "Setup calls" },
  "webhook":  { maxPerMin: 10,  label: "Webhook triggers" },
  "api":      { maxPerMin: 100, label: "API calls" },
  "llm":      { maxPerMin: 15,  label: "LLM calls (free tier)" },
};

export interface RateLimitResult {
  allowed:        boolean;
  remaining:      number;
  resetInSeconds: number;
  limit:          number;
  category:       string;
}

export function checkRateLimit(ip: string, category: keyof typeof RATE_LIMITS = "api"): RateLimitResult {
  const config  = RATE_LIMITS[category] ?? RATE_LIMITS["api"];
  const key: LimitKey = `${ip}:${category}`;
  const now     = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, bucket);
  }

  const allowed   = bucket.count < config.maxPerMin;
  if (allowed) bucket.count++;

  return {
    allowed,
    remaining:      Math.max(0, config.maxPerMin - bucket.count),
    resetInSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    limit:          config.maxPerMin,
    category,
  };
}

// LLM-specific rate limiter (tracks across all requests, not just per IP)
const llmCallLog: number[] = [];

export function checkLLMRateLimit(): { allowed: boolean; callsThisMinute: number } {
  const now     = Date.now();
  const cutoff  = now - 60_000;

  // Remove calls older than 1 minute
  while (llmCallLog.length > 0 && llmCallLog[0] < cutoff) llmCallLog.shift();

  const limit   = parseInt(process.env.LLM_CALLS_PER_MIN ?? "15");
  const allowed = llmCallLog.length < limit;

  if (allowed) llmCallLog.push(now);

  return { allowed, callsThisMinute: llmCallLog.length };
}

// Cleanup old buckets periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now > bucket.resetAt + 60_000) buckets.delete(key);
  }
}, 5 * 60_000).unref();

export function getRateLimitStats(): Record<string, { current: number; limit: number }> {
  const now    = Date.now();
  const result: Record<string, { current: number; limit: number }> = {};

  for (const [key, bucket] of buckets.entries()) {
    if (now <= bucket.resetAt) {
      const [, category] = key.split(":");
      const config = RATE_LIMITS[category];
      if (config) result[key] = { current: bucket.count, limit: config.maxPerMin };
    }
  }

  return result;
}
