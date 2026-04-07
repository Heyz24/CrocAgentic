/**
 * backend/setup/setupWizard.ts
 * CrocAgentic Phase 4 — Smart Setup Wizard.
 *
 * User just pastes their API studio curl. We do the rest:
 * - Parse provider, key, model from the curl automatically
 * - Test the connection live before saving
 * - Support multiple LLMs (primary + optional secondary)
 * - Save to .env and crocagentic.config.json
 */

import * as readline from "readline";
import * as fs       from "fs";
import * as path     from "path";
import { parseCurl }       from "./curlParser";
import { testConnection }  from "./connectionTester";
import {
  saveConfig,
  saveEnvKey,
  loadConfig,
  DEFAULT_MODELS,
  LLMProvider,
  CrocAgenticConfig,
} from "../config/configLoader";

const ROOT = process.cwd();

function createRL(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

async function readMultiLine(rl: readline.Interface, prompt: string): Promise<string> {
  console.log(prompt);
  console.log("(Paste your curl, then press Enter twice)\n");
  return new Promise((resolve) => {
    let input = "";
    let emptyCount = 0;
    rl.on("line", function handler(line: string) {
      if (line.trim() === "") {
        emptyCount++;
        if (emptyCount >= 1 && input.trim()) {
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

async function setupSingleLLM(rl: readline.Interface, label: string): Promise<{
  provider: LLMProvider;
  model:    string;
  apiKey:   string;
} | null> {
  console.log(`\n── ${label} ──────────────────────────────────`);
  console.log("Supported providers: Gemini · OpenAI · Claude · Ollama");
  console.log("Get your curl from:");
  console.log("  Gemini:  https://aistudio.google.com/app/apikey");
  console.log("  OpenAI:  https://platform.openai.com/api-keys");
  console.log("  Claude:  https://console.anthropic.com/settings/keys");
  console.log("  Ollama:  use 'curl http://localhost:11434/api/generate'");

  const rawCurl = await readMultiLine(rl, "\nPaste curl:");

  if (!rawCurl) return null;

  const parsed = parseCurl(rawCurl);

  if (parsed.error) {
    console.log(`\n❌ Could not parse curl: ${parsed.error}`);
    return null;
  }

  console.log(`\n✓ Provider detected: ${parsed.provider}`);
  console.log(`✓ Model detected:    ${parsed.model}`);
  if (parsed.apiKey) {
    console.log(`✓ API key detected:  ${parsed.apiKey.slice(0, 8)}...${parsed.apiKey.slice(-4)}`);
  }

  // Test connection
  process.stdout.write("\n🔌 Testing connection...");
  const testResult = await testConnection(
    parsed.provider,
    parsed.apiKey,
    parsed.model
  );

  if (testResult.success) {
    console.log(` ✓ OK (${testResult.durationMs}ms)`);
  } else {
    console.log(` ❌ Failed: ${testResult.error}`);
    const retry = await ask(rl, "Save anyway? (y/n): ");
    if (retry.toLowerCase() !== "y") return null;
  }

  return {
    provider: parsed.provider,
    model:    parsed.model,
    apiKey:   parsed.apiKey,
  };
}

export async function runSetupWizard(): Promise<void> {
  const rl = createRL();

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║       🐊 CrocAgentic Setup Wizard        ║");
  console.log("╚══════════════════════════════════════════╝");

  const existing = loadConfig();
  if (existing.setupDone) {
    console.log(`\nCurrent: ${existing.llm.provider} / ${existing.llm.model}`);
    const change = await ask(rl, "Reconfigure? (y/n): ");
    if (change.toLowerCase() !== "y") {
      console.log("\nSetup unchanged. Run npm run dev to start.\n");
      rl.close();
      return;
    }
  }

  // Primary LLM
  const primary = await setupSingleLLM(rl, "Primary LLM (required)");

  if (!primary) {
    console.log("\n⚠️  Setup cancelled — no primary LLM configured.");
    console.log("   Using deterministic planner until setup is complete.\n");
    rl.close();
    return;
  }

  // Ask about secondary LLM
  const wantSecondary = await ask(rl, "\nAdd a secondary/fallback LLM? (y/n): ");
  let secondary: { provider: LLMProvider; model: string; apiKey: string } | null = null;

  if (wantSecondary.toLowerCase() === "y") {
    secondary = await setupSingleLLM(rl, "Secondary LLM (fallback)");
  }

  // Save primary API key
  if (primary.apiKey) {
    saveEnvKey(primary.provider, primary.apiKey);
  }

  // Save secondary API key
  if (secondary?.apiKey) {
    saveEnvKey(secondary.provider, secondary.apiKey);
  }

  // Build and save config
  const config: CrocAgenticConfig = {
    version:   "0.4.0",
    setupDone: true,
    llm: {
      provider:    primary.provider,
      model:       primary.model,
      maxTokens:   1024,
      temperature: 0.2,
      ollamaHost:  "http://localhost:11434",
      timeout:     primary.provider === "ollama" ? 60000 : 30000,
    },
  };

  saveConfig(config);

  // Summary
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║          ✅ Setup Complete!               ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\n  Primary LLM:  ${primary.provider} / ${primary.model}`);
  if (secondary) {
    console.log(`  Secondary:    ${secondary.provider} / ${secondary.model}`);
  }
  console.log("\n🚀 Run: npm run dev\n");

  rl.close();
}
