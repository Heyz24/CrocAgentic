/**
 * backend/tools/builtin/imageReadTool.ts
 * CrocAgentic Phase 5 — Image Read Tool.
 *
 * Reads image files from workspace.
 * Returns: base64 encoded image + metadata.
 * LLM can then describe/analyse it (if provider supports vision).
 */

import * as fs   from "fs";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const SUPPORTED_FORMATS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

const InputSchema = z.object({
  filePath:    z.string().min(1),
  returnBase64: z.boolean().default(false), // true = include base64 in output
  maxSizeBytes: z.number().int().positive().max(20_000_000).default(10_000_000),
});

export class ImageReadTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "image_read",
    description: "Read an image file from the workspace. Returns image metadata and optionally base64 content for vision-capable LLMs.",
    category:    "media",
    permissions: ["READ_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ metadata: z.record(z.unknown()), base64: z.string().optional() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed   = InputSchema.parse(input);
      const resolved = path.resolve(workspacePath, parsed.filePath);

      if (!resolved.startsWith(path.resolve(workspacePath))) {
        return this.failure("Path traversal detected", Date.now() - start);
      }
      if (!fs.existsSync(resolved)) {
        return this.failure(`Image not found: ${parsed.filePath}`, Date.now() - start);
      }

      const ext = path.extname(resolved).toLowerCase();
      if (!SUPPORTED_FORMATS.includes(ext)) {
        return this.failure(
          `Unsupported image format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(", ")}`,
          Date.now() - start
        );
      }

      const stat = fs.statSync(resolved);
      if (stat.size > parsed.maxSizeBytes) {
        return this.failure(`Image too large: ${stat.size} bytes`, Date.now() - start);
      }

      const metadata = {
        filePath:  parsed.filePath,
        sizeBytes: stat.size,
        format:    ext.replace(".", ""),
        modified:  stat.mtime.toISOString(),
      };

      let base64: string | undefined;
      let outputText = `Image: ${parsed.filePath}\nSize: ${stat.size} bytes\nFormat: ${metadata.format}`;

      if (parsed.returnBase64) {
        const buffer = fs.readFileSync(resolved);
        base64       = buffer.toString("base64");
        outputText  += `\nBase64 length: ${base64.length} chars`;
      }

      return this.success(outputText, { metadata, ...(base64 ? { base64 } : {}) }, Date.now() - start);
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const imageReadTool = new ImageReadTool();
