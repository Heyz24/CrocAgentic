/**
 * backend/memory/contextBuilder.ts
 * CrocAgentic Phase 7 — Context Builder.
 *
 * Formats memory context into a structured prompt injection
 * that Thinker uses to plan with full awareness of past work.
 */

import { buildContextPacket, ContextPacket } from "./memoryStore";

export function formatContextForLLM(packet: ContextPacket, goal: string): string {
  const sections: string[] = [];

  // Project summary
  if (packet.projectSummary && packet.projectSummary !== "No project summary yet.") {
    sections.push(`PROJECT CONTEXT:\n${packet.projectSummary}`);
  }

  // Recent tasks
  if (packet.recentTasks.length > 0) {
    const tasks = packet.recentTasks
      .map((t) => `- [${t.createdAt.slice(0, 10)}] ${t.key}: ${t.content.slice(0, 200)}`)
      .join("\n");
    sections.push(`RECENT TASKS:\n${tasks}`);
  }

  // Relevant files
  if (packet.relevantFiles.length > 0) {
    const files = packet.relevantFiles
      .map((f) => `- ${f.key}: ${f.content.slice(0, 150)}`)
      .join("\n");
    sections.push(`RELEVANT FILES:\n${files}`);
  }

  // User preferences
  if (packet.userPreferences.length > 0) {
    const prefs = packet.userPreferences
      .map((p) => `- ${p.key}: ${p.content}`)
      .join("\n");
    sections.push(`USER PREFERENCES:\n${prefs}`);
  }

  // Org rules
  if (packet.orgRules.length > 0) {
    const rules = packet.orgRules
      .map((r) => `- ${r.content}`)
      .join("\n");
    sections.push(`ORGANIZATION RULES:\n${rules}`);
  }

  if (sections.length === 0) return "";

  return [
    "=== MEMORY CONTEXT ===",
    ...sections,
    "=== END CONTEXT ===",
    "",
    `Current goal: ${goal}`,
  ].join("\n\n");
}

export function buildContext(params: {
  userId:    string;
  projectId: string;
  goal:      string;
}): string {
  const packet = buildContextPacket(params);
  return formatContextForLLM(packet, params.goal);
}

// ─── Natural Language Memory Commands ─────────────────────────────────────────

export type MemoryCommand =
  | { type: "forget_project"; projectId: string }
  | { type: "forget_task";    key: string }
  | { type: "set_preference"; key: string; value: string }
  | { type: "add_rule";       rule: string }
  | { type: "none" };

const FORGET_PATTERNS = [
  /forget\s+(everything\s+about\s+)?project\s+["']?([^"'\n]+)["']?/i,
  /clear\s+(memory\s+for\s+)?project\s+["']?([^"'\n]+)["']?/i,
];

const PREFERENCE_PATTERNS = [
  /always\s+(use|format|output|save|send)\s+(.+)/i,
  /remember\s+that\s+i\s+(prefer|want|like|always)\s+(.+)/i,
  /set\s+preference[:\s]+(.+)/i,
];

const RULE_PATTERNS = [
  /add\s+(org\s+)?rule[:\s]+(.+)/i,
  /always\s+require\s+(.+)/i,
  /never\s+(do|allow|use)\s+(.+)/i,
];

export function parseMemoryCommand(goal: string): MemoryCommand {
  for (const pattern of FORGET_PATTERNS) {
    const match = goal.match(pattern);
    if (match) return { type: "forget_project", projectId: match[2].trim() };
  }

  for (const pattern of PREFERENCE_PATTERNS) {
    const match = goal.match(pattern);
    if (match) {
      const value = match[match.length - 1].trim();
      return { type: "set_preference", key: `preference_${Date.now()}`, value };
    }
  }

  for (const pattern of RULE_PATTERNS) {
    const match = goal.match(pattern);
    if (match) {
      return { type: "add_rule", rule: match[match.length - 1].trim() };
    }
  }

  return { type: "none" };
}
