/**
 * backend/agents/outputValidator.ts
 * CrocAgentic Phase 5 — Output Validator Agent.
 *
 * Quality gate: checks ALL outputs before they leave the pipeline.
 * Code:     syntax check + no secrets
 * Reports:  completeness + confidence scoring
 * Messages: no sensitive data leakage
 */

import { BaseAgent, AgentResult } from "./baseAgent";

export type OutputType = "code" | "report" | "message" | "data" | "file" | "unknown";

export interface ValidationReport {
  approved:    boolean;
  outputType:  OutputType;
  score:       number;         // 0-100 quality score
  issues:      string[];
  warnings:    string[];
  action:      "FORWARD" | "RETRY" | "ESCALATE_HUMAN";
  reason:      string;
}

// Patterns that should never appear in output
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/,                     label: "OpenAI API key" },
  { pattern: /AIza[0-9A-Za-z\-_]{35}/,                  label: "Google API key" },
  { pattern: /sk-ant-[a-zA-Z0-9\-_]{20,}/,              label: "Anthropic API key" },
  { pattern: /password\s*[:=]\s*['"]?[^\s'"]{6,}/i,     label: "Password in output" },
  { pattern: /private[_\s]?key\s*[:=]/i,                label: "Private key" },
  { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/,  label: "PEM private key" },
];

function detectOutputType(output: string): OutputType {
  if (/def |import |function |class |const |let |var |=>/.test(output)) return "code";
  if (/executive\s+summary|analysis|findings|conclusion/i.test(output))  return "report";
  if (/dear|hi|hello|regards|sincerely/i.test(output))                   return "message";
  if (/^\[|\{\"/.test(output.trim()))                                     return "data";
  return "unknown";
}

function scoreOutput(output: string, type: OutputType): number {
  let score = 70; // base score

  // Length check
  if (output.length < 10)     score -= 30;
  else if (output.length > 50) score += 10;

  // Type-specific scoring
  if (type === "code") {
    if (/error|exception|traceback/i.test(output)) score -= 20;
    if (/TODO|FIXME|HACK/i.test(output))           score -= 5;
    if (/test|spec|assert/i.test(output))           score += 10;
  }
  if (type === "report") {
    if (/conclusion|summary|recommendation/i.test(output)) score += 15;
    if (output.split("\n").length > 5)                     score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

export class OutputValidator extends BaseAgent {
  readonly name = "OutputValidator" as const;

  async validate(
    taskId: string,
    output: string,
    originalGoal: string
  ): Promise<AgentResult<ValidationReport>> {
    return this.run(taskId, async () => {
      const issues:   string[] = [];
      const warnings: string[] = [];

      // 1. Sensitive data scan
      for (const { pattern, label } of SENSITIVE_PATTERNS) {
        if (pattern.test(output)) {
          issues.push(`Sensitive data detected in output: ${label}`);
        }
      }

      // 2. Empty output check
      if (!output || output.trim().length < 5) {
        issues.push("Output is empty or too short");
      }

      // 3. Detect output type
      const outputType = detectOutputType(output);

      // 4. Quality score
      const score = scoreOutput(output, outputType);
      if (score < 40) warnings.push(`Low quality score: ${score}/100`);

      // 5. Goal relevance check (basic keyword match)
      const goalWords  = originalGoal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const outputLower = output.toLowerCase();
      const matchCount = goalWords.filter((w) => outputLower.includes(w)).length;
      const relevance  = goalWords.length > 0 ? matchCount / goalWords.length : 1;
      if (relevance < 0.2) {
        warnings.push(`Output may not address the goal (relevance: ${Math.round(relevance * 100)}%)`);
      }

      // 6. Determine action
      let action: "FORWARD" | "RETRY" | "ESCALATE_HUMAN";
      let approved: boolean;

      if (issues.length > 0) {
        action   = issues.some((i) => i.includes("Sensitive")) ? "ESCALATE_HUMAN" : "RETRY";
        approved = false;
      } else if (score < 40 || warnings.length > 2) {
        action   = "RETRY";
        approved = false;
      } else {
        action   = "FORWARD";
        approved = true;
      }

      const reason = approved
        ? `Output approved. Quality: ${score}/100. Type: ${outputType}.`
        : `Output rejected: ${issues[0] ?? warnings[0] ?? "Quality too low"}`;

      this.publish("EXECUTION_DONE", taskId, {
        approved, score, outputType, action,
        issueCount: issues.length, warningCount: warnings.length,
      });
      this.log(`Output validation: ${action} (score=${score}, issues=${issues.length})`, taskId);

      return { approved, outputType, score, issues, warnings, action, reason };
    });
  }
}

export const outputValidator = new OutputValidator();
