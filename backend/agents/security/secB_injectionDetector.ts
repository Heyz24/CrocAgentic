/**
 * backend/agents/security/secB_injectionDetector.ts
 * CrocAgentic Phase 10 — Hardened Injection Detector.
 *
 * 50+ patterns covering all known injection attack vectors.
 * Also integrates secrets scanning and RAG poison detection.
 */

import { BaseAgent, AgentResult } from "../baseAgent";
import { scanForSecrets } from "../../security/secretsScanner";
import { detectRagPoisoning } from "../../security/ragPoisonDetector";

export interface InjectionScanResult {
  clean:      boolean;
  sanitized:  string;
  violations: string[];
  secrets:    number;
  ragAttacks: number;
}

// ─── 50+ Injection Patterns ───────────────────────────────────────────────────

const INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Classic overrides
  { pattern: /ignore\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?|context)/i, label: "Instruction override" },
  { pattern: /disregard\s+(all\s+)?(previous|prior|above|your)/i,                                  label: "Disregard injection" },
  { pattern: /forget\s+(everything|all|your\s+instructions?)/i,                                     label: "Forget injection" },
  { pattern: /override\s+(your\s+)?(instructions?|rules?|guidelines?)/i,                            label: "Override injection" },
  { pattern: /your\s+(new\s+)?(instructions?|rules?|purpose)\s*(are|is)\s*:/i,                      label: "New instructions" },
  { pattern: /from\s+now\s+on\s+you\s+(will|must|should|are)/i,                                     label: "From now on injection" },

  // Role/persona hijacking
  { pattern: /you\s+are\s+now\s+(a\s+)?(different|new|evil|unrestricted|DAN|GPT)/i,                label: "Role override" },
  { pattern: /act\s+as\s+(if\s+)?(you\s+(are|were)\s+)?(a\s+)?(different|evil|DAN)/i,              label: "Act as injection" },
  { pattern: /pretend\s+(you\s+are|to\s+be)\s+(a\s+)?(human|real|different)/i,                      label: "Pretend injection" },
  { pattern: /you\s+are\s+no\s+longer\s+(an?\s+)?(ai|assistant|claude|gemini|gpt)/i,               label: "No longer AI" },
  { pattern: /roleplay\s+as|simulate\s+being/i,                                                      label: "Roleplay injection" },

  // Control tokens (all major LLM families)
  { pattern: /\[INST\]|\[\/INST\]|\[SYS\]|\[\/SYS\]/,                                              label: "LLaMA control token" },
  { pattern: /<\|system\|>|<\|user\|>|<\|assistant\|>|<\|im_start\|>|<\|im_end\|>/,               label: "Chat template token" },
  { pattern: /<<SYS>>|<<\/SYS>>/,                                                                    label: "Alpaca system tag" },
  { pattern: /Human:\s+|Assistant:\s+/,                                                              label: "Anthropic format injection" },
  { pattern: /<human>|<assistant>|<\/?s>/i,                                                         label: "XML role tag" },
  { pattern: /\|im_start\||<\|endoftext\|>/,                                                        label: "GPT control token" },

  // Shell injections
  { pattern: /;\s*(rm|sudo|chmod|chown|curl|wget|bash|sh|python|node)\b/i,                          label: "Shell command injection" },
  { pattern: /\$\([^)]{1,200}\)/,                                                                    label: "Command substitution" },
  { pattern: /`[^`]{1,200}`/,                                                                        label: "Backtick injection" },
  { pattern: /\|\s*(bash|sh|python|node|exec|eval)/i,                                               label: "Pipe to shell" },
  { pattern: /&&\s*(rm|sudo|curl|wget|nc|netcat)/i,                                                  label: "Chain injection" },
  { pattern: /;\s*base64\s*-d\s*\|/i,                                                                label: "Base64 decode pipe" },

  // Sensitive file access
  { pattern: /\/etc\/(passwd|shadow|sudoers|hosts)/i,                                               label: "Sensitive file access" },
  { pattern: /~\/\.ssh\/|id_rsa|id_ed25519/i,                                                       label: "SSH key access" },
  { pattern: /\/proc\/\d+|\/sys\/kernel/i,                                                           label: "System proc access" },

  // Destructive commands
  { pattern: /(rm|rmdir)\s+-rf?\s+\//i,                                                              label: "Destructive rm" },
  { pattern: /format\s+c:|del\s+\/[fqs]+\s+\\\*/i,                                                  label: "Windows destructive" },
  { pattern: /dd\s+if=.*of=\/dev/i,                                                                  label: "DD device write" },
  { pattern: /mkfs\.(ext|xfs|ntfs|fat)/i,                                                           label: "Filesystem format" },

  // Code execution
  { pattern: /eval\s*\(/i,                                                                            label: "Eval injection" },
  { pattern: /exec\s*\(/i,                                                                            label: "Exec injection" },
  { pattern: /process\.env\.[A-Z_]{3,}/,                                                             label: "Env var access" },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/,                                            label: "Child process access" },
  { pattern: /import\s+subprocess|os\.system\s*\(/i,                                                 label: "Python exec injection" },

  // Data exfiltration
  { pattern: /send\s+\S.*?\s+to\s+https?:\/\//i,                                                    label: "Data exfiltration" },
  { pattern: /POST\s+.*\s+(your\s+)?(data|content)\s+to\s+https?:\/\//i,                            label: "HTTP exfiltration" },
  { pattern: /base64\s+encode.*\|\s*curl/i,                                                          label: "Base64 exfiltration" },
  { pattern: /nc\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s+\d{2,5}/i,                               label: "Netcat exfiltration" },

  // Jailbreaks
  { pattern: /developer\s+mode\s+(enabled|on|activated)/i,                                           label: "Developer mode jailbreak" },
  { pattern: /DAN\s+(mode|prompt|jailbreak)/i,                                                        label: "DAN jailbreak" },
  { pattern: /no\s+restrictions?\s+(mode|enabled)/i,                                                  label: "No restrictions mode" },
  { pattern: /jailbreak(ed)?/i,                                                                        label: "Explicit jailbreak" },

  // PowerShell specific
  { pattern: /Invoke-Expression|IEX\s*\(/i,                                                           label: "PowerShell IEX" },
  { pattern: /Invoke-WebRequest.*downloadstring/i,                                                     label: "PowerShell download+exec" },
  { pattern: /-Enc(?:odedCommand)?\s+[A-Za-z0-9+/=]{8,}/i,                                          label: "PowerShell encoded" },

  // Network attacks
  { pattern: /curl\s+.*\|\s*(bash|sh|python)/i,                                                      label: "Curl pipe exec" },
  { pattern: /wget\s+.*-O\s*-\s*\|\s*(bash|sh)/i,                                                   label: "Wget pipe exec" },
  { pattern: /python\s+-c\s+['"]import\s+os/i,                                                       label: "Python one-liner exec" },
];

export class SecBInjectionDetector extends BaseAgent {
  readonly name = "SecB_InjectionDetector" as const;

  async scan(taskId: string, goal: string): Promise<AgentResult<InjectionScanResult>> {
    return this.run(taskId, async () => {
      const violations: string[] = [];
      let sanitized = goal;

      // 1. Injection pattern scan (50+ patterns)
      for (const { pattern, label } of INJECTION_PATTERNS) {
        const freshPattern = new RegExp(pattern.source, pattern.flags);
        if (freshPattern.test(goal)) {
          violations.push(label);
        }
      }

      // 2. Secrets scanning — detect API keys, passwords in goal
      const secretsScan = scanForSecrets(goal);
      if (!secretsScan.clean) {
        sanitized = secretsScan.redacted;
        console.warn(`[SecB] Secrets detected in goal: ${secretsScan.matches.map((m) => m.type).join(", ")}`);
      }

      // 3. RAG poison detection on goal itself
      const ragScan = detectRagPoisoning(goal, "user_goal");
      if (!ragScan.clean) {
        violations.push(...ragScan.violations);
        sanitized = ragScan.sanitized;
      }

      const clean = violations.length === 0 && ragScan.clean;

      if (!clean) {
        this.log(`BLOCKED — ${violations.length} violation(s): ${violations.slice(0, 3).join(", ")}`, taskId);
      } else {
        this.log("Goal passed injection scan", taskId);
      }

      this.publish("INJECTION_SCAN_DONE", taskId, {
        clean,
        violations,
        secretCount: secretsScan.matches.length,
        ragAttacks: ragScan.violations.length,
      });

      return {
        clean,
        sanitized,
        violations,
        secrets:    secretsScan.matches.length,
        ragAttacks: ragScan.violations.length,
      };
    });
  }
}

export const secB = new SecBInjectionDetector();
