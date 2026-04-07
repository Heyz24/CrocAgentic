/**
 * backend/tools/builtin/codeExecuteTool.ts
 * CrocAgentic Phase 5 — Code Execute Tool.
 * Cross-platform: Windows uses 'python', Linux/Mac uses 'python3'.
 */

import { spawn }   from "child_process";
import * as fs     from "fs";
import * as path   from "path";
import * as os     from "os";
import * as crypto from "crypto";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  language: z.enum(["python", "node", "typescript", "bash", "powershell"]),
  code:     z.string().min(1).max(100_000),
  timeout:  z.number().int().positive().max(120_000).default(30_000),
  args:     z.array(z.string()).default([]),
});

// Auto-detect correct python command per platform
function getPythonCmd(): string {
  return os.platform() === "win32" ? "python" : "python3";
}

function getPwshCmd(): string {
  return os.platform() === "win32" ? "powershell.exe" : "pwsh";
}

function getRunners(): Record<string, { cmd: string; ext: string; args: string[] }> {
  return {
    python:     { cmd: getPythonCmd(), ext: ".py",  args: ["-u"] },
    node:       { cmd: "node",         ext: ".js",  args: [] },
    typescript: { cmd: "ts-node",      ext: ".ts",  args: [] },
    bash:       { cmd: "bash",         ext: ".sh",  args: [] },
    powershell: { cmd: getPwshCmd(),   ext: ".ps1", args: ["-File"] },
  };
}

export class CodeExecuteTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "code_execute",
    description: "Write and execute code in Python, Node.js, TypeScript, Bash, or PowerShell. Returns stdout, stderr, and exit code.",
    category:    "code",
    permissions: ["EXECUTE_COMMAND", "PROCESS_SPAWN", "WRITE_FILESYSTEM"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    dangerous:    true,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    let tempFile = "";

    try {
      const parsed  = InputSchema.parse(input);
      const runners = getRunners();
      const runner  = runners[parsed.language];

      if (!runner) {
        return this.failure(`Unsupported language: ${parsed.language}`, Date.now() - start);
      }

      const id   = crypto.randomBytes(4).toString("hex");
      tempFile   = path.join(workspacePath, `_croc_exec_${id}${runner.ext}`);
      fs.writeFileSync(tempFile, parsed.code, "utf-8");

      return new Promise((resolve) => {
        let stdout   = "";
        let stderr   = "";
        let timedOut = false;

        const args = [...runner.args, tempFile, ...parsed.args];
        const proc = spawn(runner.cmd, args, {
          cwd:   workspacePath,
          env:   { ...process.env, WORKSPACE: workspacePath, PYTHONUNBUFFERED: "1" },
          stdio: "pipe",
        });

        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString().slice(0, 100_000); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString().slice(0, 20_000);  });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, parsed.timeout);

        proc.on("close", (code) => {
          clearTimeout(timer);
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }

          const durationMs = Date.now() - start;
          if (timedOut) {
            resolve(this.failure(`Code execution timed out after ${parsed.timeout}ms`, durationMs));
            return;
          }

          const output = [
            stdout ? `STDOUT:\n${stdout}` : "(no stdout)",
            stderr ? `STDERR:\n${stderr}` : "",
            `\nExit code: ${code ?? -1}`,
          ].filter(Boolean).join("\n");

          resolve(this.success(output, { stdout, stderr, exitCode: code ?? -1 }, durationMs));
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
          resolve(this.failure(
            `Failed to run ${runner.cmd}: ${err.message}. Is it installed?`,
            Date.now() - start
          ));
        });
      });
    } catch (err) {
      try { if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* ignore */ }
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const codeExecuteTool = new CodeExecuteTool();
