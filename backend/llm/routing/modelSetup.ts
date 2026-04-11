/**
 * backend/llm/routing/modelSetup.ts
 * CrocAgentic Phase 12 — Multi-Model Setup.
 * Fixed: general model optional, skipping works, uses existing primary config as fallback.
 */

import * as readline from "readline";
import { parseCurl }        from "../../setup/curlParser";
import { testConnection }   from "../../setup/connectionTester";
import { saveEnvKey, loadConfig } from "../../config/configLoader";
import { saveModelConfig, MultiModelConfig, ModelConfig, loadModelConfig } from "./modelRouter";
import type { LLMProvider } from "../../config/configLoader";

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));
}

async function readMultiLine(rl: readline.Interface, prompt: string): Promise<string> {
  console.log(prompt);
  console.log("(Paste curl or press Enter twice to skip)\n");
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
  taskLabel: string,
  required = false
): Promise<ModelConfig | null> {
  console.log(`\n── ${taskLabel} ──────────────────────────────────`);

  const method = await ask(rl, "Configure via: [1] Paste curl  [2] Manual entry  [3] Skip: ");

  if (method === "3" || !method) {
    if (required) {
      console.log("  (Skipped — will use primary LLM from npm run setup)");
    }
    return null;
  }

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
  const provChoice   = await ask(rl, "Provider: ");
  const provider     = PROVIDER_MAP[provChoice] ?? "none";
  const defaultModel = DEFAULT_MODELS[provider] ?? "";
  const model        = (await ask(rl, `Model (Enter for "${defaultModel}"): `)) || defaultModel;

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

  // Load primary config as base
  const primaryConfig = loadConfig();
  const existing      = loadModelConfig();

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║    🐊 CrocAgentic Multi-Model Setup      ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\nPrimary LLM (from npm run setup): ${primaryConfig.llm.provider} / ${primaryConfig.llm.model}`);
  console.log("Assign different models to specific task types. Press Enter/3 to skip (uses primary).\n");

  const tasks: Array<{ key: keyof MultiModelConfig; label: string; required: boolean }> = [
    { key: "general",   label: "General / Default (overrides primary for all tasks)", required: false },
    { key: "coding",    label: "Coding tasks (write code, debug, build apps)", required: false },
    { key: "reasoning", label: "Reasoning tasks (explain, compare, evaluate)", required: false },
    { key: "analysis",  label: "Analysis tasks (data, reports, research)", required: false },
    { key: "heavy",     label: "Heavy tasks (complex, detailed, comprehensive)", required: false },
    { key: "fast",      label: "Fast tasks (quick, simple, brief)", required: false },
  ];

  const config: Partial<MultiModelConfig> = {};

  for (const { key, label, required } of tasks) {
    const model = await configureModel(rl, label, required);
    if (model) config[key] = model;
  }

  // If nothing configured at all, just inform user
  if (Object.keys(config).length === 0) {
    console.log("\n  No models configured — all tasks will use primary LLM.");
    rl.close();
    return;
  }

  saveModelConfig(config as MultiModelConfig);

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║      ✅ Multi-Model Setup Complete!       ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("Configured routing:");
  console.log(`  default (unassigned tasks): ${primaryConfig.llm.provider} / ${primaryConfig.llm.model}`);
  for (const [key, val] of Object.entries(config)) {
    if (val) console.log(`  ${key.padEnd(12)}: ${(val as ModelConfig).provider} / ${(val as ModelConfig).model}`);
  }
  console.log("\nRun: npm run dev\n");

  rl.close();
}
