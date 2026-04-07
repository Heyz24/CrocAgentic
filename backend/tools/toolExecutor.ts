/**
 * backend/tools/toolExecutor.ts
 * CrocAgentic Phase 5 — Tool Executor.
 *
 * Executes tool calls safely:
 * 1. Validate input schema
 * 2. Check permissions against plan
 * 3. Execute tool
 * 4. Scan output with SecB (injection detection)
 * 5. Return sanitized result
 */

import { toolRegistry } from "./toolRegistry";
import type { ToolInput, ToolResult } from "./baseTool";

// Import SecB for output scanning
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /\[INST\]|\[\/INST\]/,
  /<\|system\|>|<\|user\|>|<\|assistant\|>/,
  /;\s*(rm|sudo|chmod)\s+-rf/i,
  /eval\s*\(/i,
];

function scanOutputForInjection(output: string): { clean: boolean; pattern?: string } {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(output)) {
      return { clean: false, pattern: pattern.toString() };
    }
  }
  return { clean: true };
}

export interface ToolCall {
  toolName:      string;
  input:         ToolInput;
  workspacePath: string;
  allowedPerms:  string[];
}

export interface ToolExecutionResult {
  toolName:   string;
  success:    boolean;
  output:     string;
  metadata?:  Record<string, unknown>;
  error?:     string;
  durationMs: number;
  blocked?:   string;
}

export async function executeTool(call: ToolCall): Promise<ToolExecutionResult> {
  const { toolName, input, workspacePath, allowedPerms } = call;

  // 1. Find tool
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    return { toolName, success: false, output: "", error: `Tool not found: ${toolName}`, durationMs: 0 };
  }

  // 2. Permission check
  const missing = tool.manifest.permissions.filter((p) => !allowedPerms.includes(p));
  if (missing.length > 0) {
    return {
      toolName, success: false, output: "",
      error:   `Tool "${toolName}" requires permissions not granted: ${missing.join(", ")}`,
      durationMs: 0,
      blocked: "PERMISSION_DENIED",
    };
  }

  // 3. Input validation
  const validation = tool.validateInput(input);
  if (!validation.valid) {
    return { toolName, success: false, output: "", error: `Invalid input: ${validation.error}`, durationMs: 0 };
  }

  // 4. Execute
  let result: ToolResult;
  try {
    result = await tool.execute(input, workspacePath);
  } catch (err) {
    return {
      toolName, success: false, output: "",
      error:   `Tool execution error: ${(err as Error).message}`,
      durationMs: 0,
    };
  }

  // 5. Output injection scan (SecB layer)
  if (result.success && result.output) {
    const scan = scanOutputForInjection(result.output);
    if (!scan.clean) {
      return {
        toolName, success: false, output: "",
        error:   `Tool output blocked by security scan: ${scan.pattern}`,
        durationMs: result.durationMs,
        blocked: "OUTPUT_INJECTION_DETECTED",
      };
    }
  }

  return {
    toolName,
    success:    result.success,
    output:     result.output,
    metadata:   result.metadata,
    error:      result.error,
    durationMs: result.durationMs,
  };
}
