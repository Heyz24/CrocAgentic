/**
 * backend/tools/toolRegistry.ts
 * CrocAgentic Phase 5 — Tool Registry.
 *
 * Discovers, registers, and provides all tools.
 * Built-in tools loaded at startup.
 * Plugin tools loaded from /plugins/ folder.
 */

import * as fs   from "fs";
import * as path from "path";
import { BaseTool } from "./baseTool";

// Built-in tools
import { fileReadTool }    from "./builtin/fileReadTool";
import { fileWriteTool }   from "./builtin/fileWriteTool";
import { shellTool }       from "./builtin/shellTool";
import { webSearchTool }   from "./builtin/webSearchTool";
import { httpRequestTool } from "./builtin/httpRequestTool";
import { codeExecuteTool } from "./builtin/codeExecuteTool";
import { imageReadTool }   from "./builtin/imageReadTool";
import { pdfReadTool }     from "./builtin/pdfReadTool";

const BUILTIN_TOOLS: BaseTool[] = [
  fileReadTool,
  fileWriteTool,
  shellTool,
  webSearchTool,
  httpRequestTool,
  codeExecuteTool,
  imageReadTool,
  pdfReadTool,
];

class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  private loaded = false;

  load(): void {
    if (this.loaded) return;

    // Register built-in tools
    for (const tool of BUILTIN_TOOLS) {
      this.tools.set(tool.name, tool);
      console.log(`[ToolRegistry] Registered built-in: ${tool.name}`);
    }

    // Load plugins from /plugins/ folder
    const pluginsDir = path.resolve(process.cwd(), "plugins");
    if (fs.existsSync(pluginsDir)) {
      const files = fs.readdirSync(pluginsDir)
        .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
        .filter((f) => !f.startsWith("_"));

      for (const file of files) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod = require(path.join(pluginsDir, file));
          const plugin = mod.default ?? Object.values(mod)[0];
          if (plugin && plugin instanceof BaseTool) {
            this.tools.set(plugin.name, plugin);
            console.log(`[ToolRegistry] Loaded plugin: ${plugin.name} from ${file}`);
          }
        } catch (err) {
          console.error(`[ToolRegistry] Failed to load plugin ${file}:`, (err as Error).message);
        }
      }
    }

    this.loaded = true;
    console.log(`[ToolRegistry] ${this.tools.size} tools available`);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  getAll(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  getByCategory(category: string): BaseTool[] {
    return this.getAll().filter((t) => t.manifest.category === category);
  }

  getByPermission(permission: string): BaseTool[] {
    return this.getAll().filter((t) => t.manifest.permissions.includes(permission));
  }

  describe(): string {
    return this.getAll()
      .map((t) => `- ${t.name}: ${t.manifest.description} [${t.manifest.permissions.join(", ")}]`)
      .join("\n");
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export const toolRegistry = new ToolRegistry();
