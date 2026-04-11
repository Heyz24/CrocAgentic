/**
 * backend/llm/routing/modelRouter.ts
 * CrocAgentic Phase 12 — Multi-Model Router.
 * Fixed: general model now falls back to crocagentic.config.json if not in models.json
 */

import * as fs   from "fs";
import * as path from "path";
import { loadConfig } from "../../config/configLoader";
import type { LLMProvider } from "../../config/configLoader";

export type TaskType = "coding" | "reasoning" | "analysis" | "heavy" | "fast" | "general";

const TASK_PATTERNS: Array<{ pattern: RegExp; type: TaskType }> = [
  { pattern: /\b(comprehensive|detailed|thorough|elaborate|extensive|full|complete)\b.*\b(report|analysis|review|document|guide|plan)\b/i, type: "heavy" },
  { pattern: /\b(write|create|build|code|script|function|class|program|app|website|api|debug|fix|refactor|implement)\b.*\b(code|script|function|app|website|python|javascript|typescript|rust|go|java|py|js|ts)\b/i, type: "coding" },
  { pattern: /\b(code|script|program|function|class|implement|develop)\b/i, type: "coding" },
  { pattern: /\b(quick|fast|simple|brief|short|summarize briefly|tldr|in one line)\b/i, type: "fast" },
  { pattern: /\b(analyse|analyze|report|summarize|summarise|insights|findings|data|statistics|metrics|forecast)\b/i, type: "analysis" },
  { pattern: /\b(reason|think|explain|why|how|compare|evaluate|assess|judge|decide|strategy|plan)\b/i, type: "reasoning" },
  { pattern: /\b(complex|detailed|comprehensive|thorough|deep|elaborate|extensive)\b/i, type: "heavy" },
];

export function detectTaskType(goal: string): TaskType {
  for (const { pattern, type } of TASK_PATTERNS) {
    if (pattern.test(goal)) return type;
  }
  return "general";
}

export interface ModelConfig {
  provider:    LLMProvider;
  model:       string;
  apiKey?:     string;
  ollamaHost?: string;
}

export interface MultiModelConfig {
  coding?:    ModelConfig;
  reasoning?: ModelConfig;
  analysis?:  ModelConfig;
  heavy?:     ModelConfig;
  fast?:      ModelConfig;
  general?:   ModelConfig; // now optional — falls back to crocagentic.config.json
}

const MULTI_MODEL_CONFIG_PATH = path.resolve(process.cwd(), "crocagentic.models.json");
let _modelConfig: MultiModelConfig | null = null;

export function loadModelConfig(): MultiModelConfig | null {
  if (_modelConfig) return _modelConfig;
  if (!fs.existsSync(MULTI_MODEL_CONFIG_PATH)) return null;
  try {
    _modelConfig = JSON.parse(fs.readFileSync(MULTI_MODEL_CONFIG_PATH, "utf-8")) as MultiModelConfig;
    return _modelConfig;
  } catch {
    return null;
  }
}

export function saveModelConfig(config: MultiModelConfig): void {
  const safeConfig = JSON.parse(JSON.stringify(config)) as MultiModelConfig;
  for (const key of Object.keys(safeConfig) as (keyof MultiModelConfig)[]) {
    const entry = safeConfig[key] as ModelConfig | undefined;
    if (entry) delete entry.apiKey;
  }
  fs.writeFileSync(MULTI_MODEL_CONFIG_PATH, JSON.stringify(safeConfig, null, 2), "utf-8");
  _modelConfig = config;
}

export function reloadModelConfig(): void {
  _modelConfig = null;
}

export function getDefaultModelConfig(): ModelConfig {
  // Fall back to primary config if no general in models.json
  const config = loadConfig();
  return {
    provider: config.llm.provider as LLMProvider,
    model:    config.llm.model,
    ollamaHost: config.llm.ollamaHost,
  };
}

export function routeTaskToModel(
  goal:     string,
  profile?: string
): { taskType: TaskType; modelConfig: ModelConfig } {
  const taskType    = detectTaskType(goal);
  const multiConfig = loadModelConfig();

  // Always return a valid modelConfig — never null
  const fallback = getDefaultModelConfig();

  if (!multiConfig) {
    return { taskType, modelConfig: fallback };
  }

  // Profile overrides task type
  let resolvedType: TaskType = taskType;
  if (profile === "coder")   resolvedType = "coding";
  if (profile === "analyst") resolvedType = "analysis";
  if (profile === "worker")  resolvedType = "fast";

  // Get model for task type, fall back through chain: taskType → general → primary config
  const modelConfig =
    multiConfig[resolvedType] ??
    multiConfig.general ??
    fallback;

  return { taskType: resolvedType, modelConfig };
}
