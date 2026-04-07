/**
 * backend/tools/baseTool.ts
 * CrocAgentic Phase 5 — Abstract Base Tool.
 *
 * All tools (built-in and plugins) extend this.
 * Enforces: name, description, permissions, input schema, execute().
 */

import { z } from "zod";

export type ToolCategory =
  | "filesystem"
  | "network"
  | "shell"
  | "code"
  | "search"
  | "media"
  | "data"
  | "custom";

export interface ToolManifest {
  name:          string;       // unique snake_case identifier
  description:   string;       // what this tool does (shown to LLM)
  category:      ToolCategory;
  permissions:   string[];     // required CrocAgentic permissions
  inputSchema:   z.ZodTypeAny; // validates input before execution
  outputSchema:  z.ZodTypeAny; // validates output before returning
  dangerous:     boolean;      // if true, requires explicit approval
  platform?:     "all" | "windows" | "linux" | "mac"; // OS restriction
}

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolResult {
  success:    boolean;
  output:     string;         // always string — LLM readable
  metadata?:  Record<string, unknown>;
  error?:     string;
  durationMs: number;
}

export abstract class BaseTool {
  abstract readonly manifest: ToolManifest;

  get name(): string { return this.manifest.name; }

  validateInput(input: ToolInput): { valid: boolean; error?: string } {
    const result = this.manifest.inputSchema.safeParse(input);
    if (!result.success) {
      return {
        valid: false,
        error: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", "),
      };
    }
    return { valid: true };
  }

  abstract execute(input: ToolInput, workspacePath: string): Promise<ToolResult>;

  protected success(output: string, metadata?: Record<string, unknown>, durationMs = 0): ToolResult {
    return { success: true, output, metadata, durationMs };
  }

  protected failure(error: string, durationMs = 0): ToolResult {
    return { success: false, output: "", error, durationMs };
  }
}
