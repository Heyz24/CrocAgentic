/**
 * backend/security/secretsScanner.ts
 * CrocAgentic Phase 10 — Secrets Scanner.
 *
 * Detects and redacts sensitive data from ANY text:
 * API keys, passwords, tokens, PII, private keys, etc.
 * Runs on all inputs AND outputs — nothing leaks in either direction.
 */

export interface SecretMatch {
  type:     string;
  pattern:  string;
  redacted: string;
  position: number;
}

export interface ScanResult {
  clean:    boolean;
  redacted: string;
  matches:  SecretMatch[];
  riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

// ─── Secret Patterns ───────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{
  type:    string;
  pattern: RegExp;
  risk:    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}> = [
  // API Keys
  { type: "OpenAI API Key",      pattern: /sk-[a-zA-Z0-9]{20,}/g,                    risk: "CRITICAL" },
  { type: "Anthropic API Key",   pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/g,            risk: "CRITICAL" },
  { type: "Google API Key",      pattern: /AIza[0-9A-Za-z\-_]{30,}/g,               risk: "CRITICAL" },
  { type: "GitHub Token",        pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g,            risk: "CRITICAL" },
  { type: "AWS Access Key",      pattern: /AKIA[0-9A-Z]{16}/g,                      risk: "CRITICAL" },
  { type: "AWS Secret Key",      pattern: /aws[_\-]?secret[_\-]?access[_\-]?key\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi, risk: "CRITICAL" },
  { type: "Stripe Secret Key",   pattern: /sk_live_[a-zA-Z0-9]{24,}/g,              risk: "CRITICAL" },
  { type: "Stripe Publishable",  pattern: /pk_live_[a-zA-Z0-9]{24,}/g,              risk: "HIGH" },
  { type: "Twilio Account SID",  pattern: /AC[a-zA-Z0-9]{32}/g,                     risk: "HIGH" },
  { type: "Twilio Auth Token",   pattern: /\b[a-f0-9]{32}\b/g,                       risk: "LOW" },
  { type: "Generic Bearer",      pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,       risk: "HIGH" },
  { type: "Basic Auth",          pattern: /Basic\s+[A-Za-z0-9+/]+=*/g,             risk: "HIGH" },

  // Private Keys
  { type: "RSA Private Key",     pattern: /-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+RSA\s+PRIVATE\s+KEY-----/g, risk: "CRITICAL" },
  { type: "PEM Private Key",     pattern: /-----BEGIN\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+PRIVATE\s+KEY-----/g,             risk: "CRITICAL" },
  { type: "EC Private Key",      pattern: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----[\s\S]*?-----END\s+EC\s+PRIVATE\s+KEY-----/g,   risk: "CRITICAL" },

  // Passwords
  { type: "Password in text",    pattern: /password\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi, risk: "HIGH" },
  { type: "Secret in text",      pattern: /secret\s*[:=]\s*['"]?([^\s'"]{8,})['"]?/gi,   risk: "HIGH" },
  { type: "Token in text",       pattern: /token\s*[:=]\s*['"]?([A-Za-z0-9\-._~]{16,})['"]?/gi, risk: "MEDIUM" },

  // PII
  { type: "Credit Card",         pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11})\b/g, risk: "CRITICAL" },
  { type: "SSN (US)",            pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                risk: "CRITICAL" },
  { type: "Email Address",       pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, risk: "LOW" },

  // Database URLs
  { type: "Database URL",        pattern: /(mongodb|postgres|mysql|redis|mssql):\/\/[^@\s]+@[^\s]+/g, risk: "CRITICAL" },
  { type: "Connection String",   pattern: /Server=.{1,100};Database=.{1,100};(User Id|Password)=[^;]+/gi, risk: "HIGH" },
];

// Redact a matched secret — show type + first/last chars only
function redactMatch(match: string, type: string): string {
  if (match.length <= 8) return `[REDACTED:${type}]`;
  return `[REDACTED:${type}:${match.slice(0, 4)}...${match.slice(-4)}]`;
}

// ─── Main Scanner ──────────────────────────────────────────────────────────────

export function scanForSecrets(text: string): ScanResult {
  let redacted  = text;
  const matches: SecretMatch[] = [];
  let highestRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "NONE";

  const riskOrder = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

  for (const { type, pattern, risk } of SECRET_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    const localPattern = new RegExp(pattern.source, pattern.flags);

    while ((match = localPattern.exec(text)) !== null) {
      const original  = match[0];
      const replacement = redactMatch(original, type);

      matches.push({
        type,
        pattern:  localPattern.source.slice(0, 50),
        redacted: replacement,
        position: match.index,
      });

      if (riskOrder[risk] > riskOrder[highestRisk]) {
        highestRisk = risk;
      }

      // Replace in output
      redacted = redacted.replace(original, replacement);

      // Prevent infinite loop for zero-length matches
      if (match.index === localPattern.lastIndex) localPattern.lastIndex++;
    }
  }

  return {
    clean:     matches.length === 0,
    redacted,
    matches,
    riskLevel: highestRisk,
  };
}

// ─── Input Sanitizer ───────────────────────────────────────────────────────────

export function sanitizeInput(text: string): {
  sanitized: string;
  hadSecrets: boolean;
  secretCount: number;
  riskLevel: string;
} {
  const result = scanForSecrets(text);
  return {
    sanitized:   result.redacted,
    hadSecrets:  !result.clean,
    secretCount: result.matches.length,
    riskLevel:   result.riskLevel,
  };
}

// ─── Output Auditor ────────────────────────────────────────────────────────────

export function auditOutput(text: string): {
  safe:        boolean;
  redacted:    string;
  violations:  string[];
} {
  const result = scanForSecrets(text);
  return {
    safe:       result.clean,
    redacted:   result.redacted,
    violations: result.matches.map((m) => `${m.type} at position ${m.position}`),
  };
}
