/**
 * backend/llm/routing/modelRouter.ts
 * CrocAgentic Phase 6 — Multi-Model Router.
 */

import * as fs   from "fs";
import * as path from "path";
import type { LLMProvider } from "../../config/configLoader";

export type TaskType = "coding" | "reasoning" | "analysis" | "heavy" | "fast" | "general";

// IMPORTANT: Order matters — more specific patterns first
const TASK_PATTERNS: Array<{ pattern: RegExp; type: TaskType }> = [
  // Heavy must come BEFORE analysis — "comprehensive detailed report" is heavy, not analysis
  { pattern: /\b(comprehensive|detailed|thorough|elaborate|extensive|full|complete)\b.*\b(report|analysis|review|document|guide|plan)\b/i, type: "heavy" },
  { pattern: /\b(write|create|build|code|script|function|class|program|app|website|api|debug|fix|refactor|implement)\b.*\b(code|script|function|app|website|python|javascript|typescript|rust|go|java)\b/i, type: "coding" },
  { pattern: /\b(code|script|program|function|class|implement|develop|build app|build website|write python|write js|write ts)\b/i, type: "coding" },
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
  general:    ModelConfig;
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

export function routeTaskToModel(
  goal: string,
  profile?: string
): { taskType: TaskType; modelConfig: ModelConfig | null } {
  const taskType    = detectTaskType(goal);
  const multiConfig = loadModelConfig();

  if (!multiConfig) return { taskType, modelConfig: null };

  let resolvedType: TaskType = taskType;
  if (profile === "coder")   resolvedType = "coding";
  if (profile === "analyst") resolvedType = "analysis";
  if (profile === "worker")  resolvedType = "fast";

  const modelConfig = multiConfig[resolvedType] ?? multiConfig.general;
  return { taskType: resolvedType, modelConfig };
}
