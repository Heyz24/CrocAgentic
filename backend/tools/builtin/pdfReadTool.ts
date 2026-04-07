/**
 * backend/tools/builtin/pdfReadTool.ts
 * CrocAgentic Phase 5 — PDF Read Tool.
 */

import * as fs   from "fs";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

// Declare pdf-parse as any to avoid missing type declarations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(id: string): any;

const InputSchema = z.object({
  filePath: z.string().min(1),
  maxPages: z.number().int().positive().max(500).default(50),
});

export class PdfReadTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "pdf_read",
    description: "Extract text content from a PDF file in the workspace. Returns text by page.",
    category:    "data",
    permissions: ["READ_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ text: z.string(), pageCount: z.number() }),
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
        return this.failure(`PDF not found: ${parsed.filePath}`, Date.now() - start);
      }
      if (!resolved.toLowerCase().endsWith(".pdf")) {
        return this.failure("File must be a PDF", Date.now() - start);
      }

      // Try to load pdf-parse — it's optional
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pdfParse: ((buf: Buffer) => Promise<{ text: string; numpages: number }>) | null = null;
      try {
        // Use require to avoid TS module resolution issues with optional deps
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require("pdf-parse");
        pdfParse  = typeof mod === "function" ? mod : (mod.default ?? null);
      } catch {
        // pdf-parse not installed
      }

      if (!pdfParse) {
        const stat = fs.statSync(resolved);
        return this.success(
          `PDF file found: ${parsed.filePath} (${stat.size} bytes)\n` +
          `Text extraction unavailable — install: npm install pdf-parse`,
          { filePath: parsed.filePath, sizeBytes: stat.size, pageCount: 0 },
          Date.now() - start
        );
      }

      const buffer = fs.readFileSync(resolved);
      const data   = await pdfParse(buffer);
      const text   = data.text.slice(0, 500_000);

      return this.success(
        `PDF: ${parsed.filePath}\nPages: ${data.numpages}\n\n${text}`,
        { pageCount: data.numpages, charCount: text.length },
        Date.now() - start
      );
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const pdfReadTool = new PdfReadTool();
