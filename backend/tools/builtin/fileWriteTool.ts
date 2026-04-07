/**
 * backend/tools/builtin/fileWriteTool.ts
 * CrocAgentic Phase 5 — File Write Tool.
 */

import * as fs   from "fs";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  filePath:  z.string().min(1),
  content:   z.string(),
  mode:      z.enum(["overwrite", "append", "create_only"]).default("overwrite"),
  createDir: z.boolean().default(true),
});

export class FileWriteTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "file_write",
    description: "Write content to a file in the workspace. Can create, overwrite, or append.",
    category:    "filesystem",
    permissions: ["WRITE_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ filePath: z.string(), bytesWritten: z.number() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed   = InputSchema.parse(input);
      const resolved = path.resolve(workspacePath, parsed.filePath);

      // Security: must stay within workspace
      if (!resolved.startsWith(path.resolve(workspacePath))) {
        return this.failure("Path traversal detected", Date.now() - start);
      }

      if (parsed.mode === "create_only" && fs.existsSync(resolved)) {
        return this.failure(`File already exists: ${parsed.filePath}`, Date.now() - start);
      }

      if (parsed.createDir) {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
      }

      const flag = parsed.mode === "append" ? "a" : "w";
      fs.writeFileSync(resolved, parsed.content, { encoding: "utf-8", flag });

      return this.success(
        `Successfully wrote ${parsed.content.length} bytes to ${parsed.filePath}`,
        { filePath: parsed.filePath, bytesWritten: parsed.content.length },
        Date.now() - start
      );
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const fileWriteTool = new FileWriteTool();
