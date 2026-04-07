/**
 * backend/tools/builtin/fileReadTool.ts
 * CrocAgentic Phase 5 — File Read Tool.
 */

import * as fs   from "fs";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  filePath: z.string().min(1),
  maxBytes: z.number().int().positive().max(10_000_000).default(1_000_000),
});

export class FileReadTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "file_read",
    description: "Read the contents of a file from the workspace. Returns file content as text.",
    category:    "filesystem",
    permissions: ["READ_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ content: z.string(), sizeBytes: z.number() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed   = InputSchema.parse(input);
      const resolved = path.resolve(workspacePath, parsed.filePath);

      if (!resolved.startsWith(path.resolve(workspacePath))) {
        return this.failure("Path traversal detected — file must be inside workspace", Date.now() - start);
      }
      if (!fs.existsSync(resolved)) {
        return this.failure(`File not found: ${parsed.filePath}`, Date.now() - start);
      }

      const stat = fs.statSync(resolved);
      if (stat.size > parsed.maxBytes) {
        return this.failure(`File too large: ${stat.size} bytes (max ${parsed.maxBytes})`, Date.now() - start);
      }

      // Always read as Buffer then convert — avoids TS encoding inference issues
      const buffer  = fs.readFileSync(resolved);
      const content = buffer.toString("utf-8");

      return this.success(content, { sizeBytes: stat.size, filePath: parsed.filePath }, Date.now() - start);
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const fileReadTool = new FileReadTool();
