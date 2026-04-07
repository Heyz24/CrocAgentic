/**
 * backend/config/configLoader.ts
 * CrocAgentic Phase 4 — Config Loader.
 *
 * Loads provider config from:
 *   1. config/crocagentic.config.json  (provider selection + settings)
 *   2. .env file                        (API keys — never in config.json)
 *
 * Config is validated at startup. Missing keys = graceful fallback to
 * deterministic planner.
 */

import * as fs   from "fs";
import * as path from "path";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LLMProvider = "claude" | "openai" | "gemini" | "ollama" | "none";

export interface LLMConfig {
  provider:     LLMProvider;
  model:        string;
  maxTokens:    number;
  temperature:  number;
  ollamaHost?:  string;  // default: http://localhost:11434
  timeout:      number;  // ms
}

export interface CrocAgenticConfig {
  version:     string;
  llm:         LLMConfig;
  setupDone:   boolean;
}

// ─── Paths ─────────────────────────────────────────────────────────────────────

const ROOT_DIR     = process.cwd();
const CONFIG_PATH  = path.join(ROOT_DIR, "crocagentic.config.json");
const ENV_PATH     = path.join(ROOT_DIR, ".env");

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: CrocAgenticConfig = {
  version:   "0.4.0",
  setupDone: false,
  llm: {
    provider:    "none",
    model:       "",
    maxTokens:   1024,
    temperature: 0.2,
    ollamaHost:  "http://localhost:11434",
    timeout:     30000,
  },
};

// Provider → default model mapping
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude:  "claude-haiku-4-5-20251001",
  openai:  "gpt-4o-mini",
  gemini:  "gemini-2.0-flash",
  ollama:  "phi3:mini",
  none:    "",
};

// ─── Env Loader ────────────────────────────────────────────────────────────────

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(ENV_PATH)) return env;

  const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

// ─── Config Loader ─────────────────────────────────────────────────────────────

let _config: CrocAgenticConfig | null = null;
let _env:    Record<string, string>   = {};

export function loadConfig(): CrocAgenticConfig {
  if (_config) return _config;

  // Load env first
  _env = { ...process.env as Record<string, string>, ...loadEnv() };

  // Load config file
  if (!fs.existsSync(CONFIG_PATH)) {
    console.warn("[Config] No config file found. Using defaults (deterministic planner).");
    _config = { ...DEFAULT_CONFIG };
    return _config;
  }

  try {
    const raw  = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as CrocAgenticConfig;
    _config = { ...DEFAULT_CONFIG, ...parsed, llm: { ...DEFAULT_CONFIG.llm, ...parsed.llm } };
  } catch (err) {
    console.error("[Config] Failed to parse config file:", (err as Error).message);
    _config = { ...DEFAULT_CONFIG };
  }

  return _config;
}

export function getApiKey(provider: LLMProvider): string | null {
  const keyMap: Record<LLMProvider, string> = {
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    ollama: "",   // no key needed
    none:   "",
  };

  const envKey = keyMap[provider];
  if (!envKey) return null;

  return _env[envKey] ?? null;
}

export function saveConfig(config: CrocAgenticConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  _config = config; // update cache
}

export function saveEnvKey(provider: LLMProvider, apiKey: string): void {
  const keyMap: Record<LLMProvider, string> = {
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    ollama: "",
    none:   "",
  };

  const envKey = keyMap[provider];
  if (!envKey) return;

  // Read existing .env
  let existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";

  // Replace or append
  const regex = new RegExp(`^${envKey}=.*$`, "m");
  const newLine = `${envKey}=${apiKey}`;

  if (regex.test(existing)) {
    existing = existing.replace(regex, newLine);
  } else {
    existing = existing.trimEnd() + "\n" + newLine + "\n";
  }

  fs.writeFileSync(ENV_PATH, existing, "utf-8");
  _env[envKey] = apiKey; // update cache
}

export function reloadConfig(): void {
  _config = null;
  _env    = {};
}

export function isLLMConfigured(): boolean {
  const cfg = loadConfig();
  if (!cfg.setupDone)                    return false;
  if (cfg.llm.provider === "none")       return false;
  if (cfg.llm.provider === "ollama")     return true; // no key needed
  return getApiKey(cfg.llm.provider) !== null;
}
