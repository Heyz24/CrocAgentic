#!/usr/bin/env node
/**
 * cli/index.ts
 * CrocAgentic Phase 12 — CLI Interface.
 *
 * Pure natural language. No curl. No JSON. No flags.
 * User types in plain English, agent processes and responds.
 *
 * Usage:
 *   npx crocagentic
 *   crocagentic --profile coder
 *   crocagentic --once "analyse this file"
 *   crocagentic --server   (start API server instead of CLI)
 */

import * as readline from "readline";
import * as path     from "path";
import * as fs       from "fs";
import { runPipeline }     from "../backend/pipeline/orchestrator";
import { loadConfig, isLLMConfigured } from "../backend/config/configLoader";
import { loadModelConfig } from "../backend/llm/routing/modelRouter";
import { getMemoryStats }  from "../backend/memory/memoryStore";
import { toolRegistry }    from "../backend/tools/toolRegistry";

// ─── CLI Config ────────────────────────────────────────────────────────────────

interface CLIOptions {
  profile:    string;
  once?:      string;
  verbose:    boolean;
  noColor:    boolean;
  projectId:  string;
  userId:     string;
}

function parseArgs(): CLIOptions {
  const args    = process.argv.slice(2);
  const options: CLIOptions = {
    profile:   "default",
    verbose:   false,
    noColor:   false,
    projectId: "global",
    userId:    "user",
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile" && args[i + 1])   { options.profile   = args[++i]; }
    if (args[i] === "--project" && args[i + 1])   { options.projectId = args[++i]; }
    if (args[i] === "--once"    && args[i + 1])   { options.once      = args[++i]; }
    if (args[i] === "--verbose")                   { options.verbose   = true; }
    if (args[i] === "--no-color")                  { options.noColor   = true; }
    if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    if (args[i] === "--version" || args[i] === "-v") {
      console.log("CrocAgentic v0.12.0");
      process.exit(0);
    }
  }

  return options;
}

// ─── Colors ────────────────────────────────────────────────────────────────────

const C = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
  bold:   "\x1b[1m",
  blue:   "\x1b[34m",
};

function color(text: string, ...codes: string[]): string {
  return codes.join("") + text + C.reset;
}

// ─── Output Formatter ──────────────────────────────────────────────────────────

function formatResult(result: Awaited<ReturnType<typeof runPipeline>>, verbose: boolean): string {
  const lines: string[] = [];

  const statusColor = result.finalStatus === "COMPLETED" ? C.green
    : result.finalStatus === "DENIED" ? C.red : C.yellow;

  lines.push(`\n${color("●", C.bold, statusColor)} ${color(result.finalStatus, statusColor)} · ${result.riskScore} risk · ${result.durationMs}ms`);

  // Show execution output
  if (result.execution?.steps) {
    for (const step of result.execution.steps) {
      if (step.stdout?.trim()) {
        lines.push(`\n${step.stdout.trim()}`);
      }
      if (step.stderr?.trim() && verbose) {
        lines.push(color(`\nSTDERR: ${step.stderr.trim()}`, C.yellow));
      }
    }
  }

  // Memory info
  if (result.memory?.contextUsed) {
    lines.push(color(`\n[Memory: ${result.memory.memoriesFound} context entries used, ${result.memory.entriesWritten} saved]`, C.gray));
  }

  // Verbose agent trace
  if (verbose) {
    lines.push(color("\nAgent trace:", C.gray));
    for (const agent of result.agentTrace) {
      const icon = agent.success ? "✓" : "✗";
      lines.push(color(`  ${icon} ${agent.agent}: ${agent.decision ?? agent.error ?? ""} (${agent.durationMs}ms)`, C.gray));
    }
  }

  // Escalation notice
  if (result.agentTrace.some((a) => a.agent === "EscalationAgent" && a.success)) {
    const esc = result.agentTrace.find((a) => a.agent === "EscalationAgent");
    lines.push(color(`\n⚠  Escalated — ${esc?.decision}`, C.yellow));
  }

  return lines.join("");
}

function formatError(error: string): string {
  return color(`\n✗ Error: ${error}`, C.red);
}

// ─── Built-in Commands ─────────────────────────────────────────────────────────

async function handleBuiltinCommand(input: string): Promise<{ handled: boolean; output?: string }> {
  const cmd = input.trim().toLowerCase();

  if (cmd === "help" || cmd === "?") {
    return { handled: true, output: [
      color("\nBuilt-in commands:", C.bold),
      "  help              — show this help",
      "  status            — show agent status",
      "  memory            — show memory stats",
      "  tools             — list available tools",
      "  clear             — clear screen",
      "  exit / quit       — exit CrocAgentic",
      "",
      color("File commands:", C.bold),
      "  attach <filepath> — attach a file to next task",
      "  attach <filepath> <task description>",
      "  Examples:",
      "    attach report.pdf summarise this report",
      "    attach data.csv   analyse this data",
      "",
      color("Or type anything in plain English:", C.bold),
      "  analyse the sales data in q3.csv",
      "  write a Python script to sort a CSV file",
      "  search the web for TypeScript best practices",
      "  remember that I prefer JSON output format",
      "  forget project myproject",
    ].join("\n") };
  }

  if (cmd === "status") {
    const config  = loadConfig();
    const multi   = loadModelConfig();
    const mem     = getMemoryStats();
    const tools   = toolRegistry.getAll();
    return { handled: true, output: [
      color("\n● CrocAgentic Status", C.bold),
      `  Version:  v0.12.0`,
      `  LLM:      ${config.llm.provider} / ${config.llm.model}`,
      multi ? `  Multi-model: ${Object.keys(multi).join(", ")}` : "  Multi-model: not configured",
      `  Tools:    ${tools.length} available`,
      `  Memory:   ${mem.shortTerm} short, ${mem.mediumTerm} medium, ${mem.longTerm} long`,
    ].join("\n") };
  }

  if (cmd === "memory") {
    const stats = getMemoryStats();
    return { handled: true, output: [
      color("\n● Memory Stats", C.bold),
      `  Short-term:  ${stats.shortTerm} entries (current session)`,
      `  Medium-term: ${stats.mediumTerm} entries (project memory)`,
      `  Long-term:   ${stats.longTerm} entries (preferences + rules)`,
      `  Total:       ${stats.total} entries`,
    ].join("\n") };
  }

  if (cmd === "tools") {
    const tools = toolRegistry.getAll();
    const lines = [color("\n● Available Tools", C.bold)];
    for (const t of tools) {
      lines.push(`  ${color(t.name, C.cyan)} — ${t.manifest.description}`);
    }
    return { handled: true, output: lines.join("\n") };
  }

  if (cmd === "clear") {
    process.stdout.write("\x1bc");
    return { handled: true };
  }

  if (cmd === "exit" || cmd === "quit" || cmd === "bye") {
    console.log(color("\nGoodbye.\n", C.gray));
    process.exit(0);
  }

  return { handled: false };
}

// ─── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log([
    "",
    color("🐊 CrocAgentic CLI v0.12.0", C.bold, C.cyan),
    "",
    color("Usage:", C.bold),
    "  crocagentic                        Start interactive mode",
    "  crocagentic --profile coder        Start with coder profile",
    "  crocagentic --once \"your task\"     Run one task and exit",
    "  crocagentic --verbose              Show agent trace",
    "  crocagentic --project myproject    Set project context",
    "",
    color("Examples:", C.bold),
    "  crocagentic",
    "  > analyse the sales data in q3.csv and give me key insights",
    "",
    "  crocagentic --profile coder --once \"write a hello world in Rust\"",
    "",
    color("Multi-model setup:", C.bold),
    "  npm run setup:models",
    "",
  ].join("\n"));
}

// ─── Main REPL ────────────────────────────────────────────────────────────────

async function startREPL(options: CLIOptions): Promise<void> {
  // Load tool registry
  toolRegistry.load();

  const config = loadConfig();
  const llmReady = isLLMConfigured();

  // Banner
  console.log([
    "",
    color("🐊 CrocAgentic v0.12.0", C.bold, C.cyan),
    color(`   ${config.llm.provider !== "none" ? `${config.llm.provider} / ${config.llm.model}` : "deterministic mode"} · profile: ${options.profile}`, C.gray),
    "",
  ].join("\n"));

  if (!llmReady) {
    console.log(color("⚠  No LLM configured. Run: npm run setup\n", C.yellow));
  }

  console.log(color("Type your task in plain English. Type 'help' for commands, 'exit' to quit.\n", C.gray));

  const rl = readline.createInterface({
    input:   process.stdin,
    output:  process.stdout,
    prompt:  color("● ", C.cyan),
  });

  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // Check built-in commands first
    const builtin = await handleBuiltinCommand(input);
    if (builtin.handled) {
      if (builtin.output) console.log(builtin.output);
      console.log();
      rl.prompt();
      return;
    }

    // Handle file attach command
    if (input.toLowerCase().startsWith("attach ")) {
      const parts = input.slice(7).trim().split(/\s+/);
      const filePath = parts[0];
      const taskDesc = parts.slice(1).join(" ") || "analyse this file";
      
      const fullPath = require("path").resolve(filePath);
      if (!require("fs").existsSync(fullPath)) {
        console.log(color(`\n✗ File not found: ${filePath}`, C.red));
        console.log();
        rl.prompt();
        return;
      }
      
      const fs = require("fs");
      const stat = fs.statSync(fullPath);
      const ext  = require("path").extname(filePath).toLowerCase();
      const textExts = [".txt", ".md", ".json", ".csv", ".ts", ".js", ".py", ".html", ".xml", ".yaml", ".yml"];
      
      let fileContent = "";
      if (textExts.includes(ext) && stat.size < 500_000) {
        fileContent = fs.readFileSync(fullPath, "utf-8").slice(0, 10_000);
        process.stdout.write(color(\`⏳ Processing file: \${filePath}...\r\`, C.gray));
        
        const enrichedGoal = \`\${taskDesc}\n\nFile: \${require("path").basename(filePath)}\nContent:\n\${fileContent}\`;
        
        try {
          const result = await runPipeline(enrichedGoal, {
            autoApproveLowRisk: true,
            userId:    options.userId,
            projectId: options.projectId,
            profile:   options.profile,
          });
          process.stdout.write("\x1b[2K\r");
          console.log(formatResult(result, options.verbose));
        } catch (err) {
          process.stdout.write("\x1b[2K\r");
          console.log(formatError((err as Error).message));
        }
      } else {
        console.log(color(\`\n✗ Cannot read file: \${ext} files over 500KB not supported in CLI. Use the GUI for large files.\`, C.yellow));
      }
      
      console.log();
      rl.prompt();
      return;
    }

    // Run through pipeline
    process.stdout.write(color("⏳ Processing...\r", C.gray));

    try {
      const result = await runPipeline(input, {
        autoApproveLowRisk: true,
        userId:    options.userId,
        projectId: options.projectId,
        profile:   options.profile,
      });

      // Clear the processing line
      process.stdout.write("\x1b[2K\r");
      console.log(formatResult(result, options.verbose));
    } catch (err) {
      process.stdout.write("\x1b[2K\r");
      console.log(formatError((err as Error).message));
    }

    console.log();
    rl.prompt();
  });

  rl.on("close", () => {
    console.log(color("\nGoodbye.\n", C.gray));
    process.exit(0);
  });
}

// ─── Entry Point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const options = parseArgs();
  toolRegistry.load();

  // Single task mode
  if (options.once) {
    const result = await runPipeline(options.once, {
      autoApproveLowRisk: true,
      userId:    options.userId,
      projectId: options.projectId,
      profile:   options.profile,
    });
    console.log(formatResult(result, options.verbose));
    process.exit(result.finalStatus === "COMPLETED" ? 0 : 1);
    return;
  }

  await startREPL(options);
}

main().catch((err) => {
  console.error(color(`\nFatal error: ${(err as Error).message}`, C.red));
  process.exit(1);
});
