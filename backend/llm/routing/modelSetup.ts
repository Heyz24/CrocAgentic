/**
 * backend/llm/routing/modelSetup.ts
 * CrocAgentic Phase 6 — Multi-Model Setup.
 *
 * Extends setup wizard to configure multiple models per task type.
 * User can assign different LLMs to: coding, reasoning, analysis, heavy, fast.
 * Both curl-paste and manual entry supported.
 */

import * as readline from "readline";
import * as fs       from "fs";
import * as path     from "path";
import { parseCurl }        from "../../setup/curlParser";
import { testConnection }   from "../../setup/connectionTester";
import { saveEnvKey }       from "../../config/configLoader";
import { saveModelConfig, MultiModelConfig, ModelConfig, TaskType } from "./modelRouter";
import type { LLMProvider } from "../../config/configLoader";

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function readMultiLine(rl: readline.Interface, prompt: string): Promise<string> {
  console.log(prompt);
  console.log("(Paste curl or press Enter to skip)\n");
  return new Promise((resolve) => {
    let input = "";
    let emptyCount = 0;
    rl.on("line", function handler(line: string) {
      if (line.trim() === "") {
        emptyCount++;
        if (emptyCount >= 1) {
          rl.removeListener("line", handler);
          resolve(input.trim());
        }
      } else {
        emptyCount = 0;
        input += (input ? "\n" : "") + line;
      }
    });
  });
}

const PROVIDER_MAP: Record<string, LLMProvider> = {
  "1": "claude", "2": "openai", "3": "gemini", "4": "ollama",
};

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-flash-latest",
  ollama: "phi3:mini",
  none:   "",
};

async function configureModel(
  rl: readline.Interface,
  taskLabel: string
): Promise<ModelConfig | null> {
  console.log(`\n── ${taskLabel} ──────────────────────────────────`);

  const method = await ask(rl, "Configure via: [1] Paste curl  [2] Manual entry  [3] Skip: ");

  if (method === "3" || !method) return null;

  if (method === "1") {
    const rawCurl = await readMultiLine(rl, "Paste your API curl:");
    if (!rawCurl) return null;

    const parsed = parseCurl(rawCurl);
    if (parsed.error) {
      console.log(`❌ Could not parse: ${parsed.error}`);
      return null;
    }

    console.log(`✓ Provider: ${parsed.provider} / Model: ${parsed.model}`);
    process.stdout.write("Testing connection...");

    const test = await testConnection(parsed.provider, parsed.apiKey, parsed.model);
    console.log(test.success ? ` ✓ OK (${test.durationMs}ms)` : ` ❌ ${test.error}`);

    if (parsed.apiKey) saveEnvKey(parsed.provider, parsed.apiKey);

    return { provider: parsed.provider, model: parsed.model };
  }

  // Manual entry
  console.log("\nProviders: [1] Claude  [2] OpenAI  [3] Gemini  [4] Ollama");
  const provChoice  = await ask(rl, "Provider: ");
  const provider    = PROVIDER_MAP[provChoice] ?? "none";
  const defaultModel = DEFAULT_MODELS[provider] ?? "";
  const model       = (await ask(rl, `Model (Enter for "${defaultModel}"): `)) || defaultModel;

  let apiKey = "";
  if (provider !== "ollama" && provider !== "none") {
    apiKey = await ask(rl, "API key: ");
    if (apiKey) saveEnvKey(provider, apiKey);
  }

  process.stdout.write("Testing connection...");
  const test = await testConnection(provider, apiKey, model);
  console.log(test.success ? ` ✓ OK (${test.durationMs}ms)` : ` ❌ ${test.error}`);

  return { provider, model };
}

export async function runMultiModelSetup(): Promise<void> {
  const rl = createRL();

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║    🐊 CrocAgentic Multi-Model Setup      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("\nAssign different LLMs to different task types.");
  console.log("Press Enter to skip any task type (uses default).\n");

  const tasks: Array<{ key: keyof MultiModelConfig; label: string }> = [
    { key: "general",   label: "General / Default (required)" },
    { key: "coding",    label: "Coding tasks (write code, debug, build apps)" },
    { key: "reasoning", label: "Reasoning tasks (explain, compare, evaluate)" },
    { key: "analysis",  label: "Analysis tasks (data, reports, research)" },
    { key: "heavy",     label: "Heavy tasks (complex, detailed, comprehensive)" },
    { key: "fast",      label: "Fast tasks (quick, simple, brief)" },
  ];

  const config: Partial<MultiModelConfig> = {};

  for (const { key, label } of tasks) {
    const model = await configureModel(rl, label);
    if (model) {
      config[key] = model;
    } else if (key === "general" && !config.general) {
      console.log("⚠️  General model is required. Using deterministic fallback.");
    }
  }

  if (!config.general) {
    console.log("\n⚠️  No general model configured. Multi-model routing disabled.");
    rl.close();
    return;
  }

  saveModelConfig(config as MultiModelConfig);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║      ✅ Multi-Model Setup Complete!       ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("Configured models:");
  for (const [key, val] of Object.entries(config)) {
    if (val) console.log(`  ${key.padEnd(12)}: ${(val as ModelConfig).provider} / ${(val as ModelConfig).model}`);
  }
  console.log("\nRun: npm run dev\n");

  rl.close();
}
