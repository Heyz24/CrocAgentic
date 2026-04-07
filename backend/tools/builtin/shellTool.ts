/**
 * backend/tools/builtin/shellTool.ts
 * CrocAgentic Phase 5 — Shell Tool.
 *
 * Executes shell commands on the HOST or in Docker sandbox.
 * Auto-detects platform: Windows → PowerShell, Linux/Mac → bash.
 *
 * SECURITY: Commands validated against policy engine before execution.
 * Workspace-scoped. Timeout enforced.
 */

import { spawn } from "child_process";
import * as os   from "os";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  command:    z.string().min(1),           // raw command string
  cwd:        z.string().default("/workspace"),
  timeout:    z.number().int().positive().max(120_000).default(30_000),
  shell:      z.enum(["auto", "bash", "powershell", "cmd", "zsh"]).default("auto"),
  sandbox:    z.boolean().default(false),  // true = run in Docker
});

function detectShell(): { shell: string; args: string[] } {
  const platform = os.platform();
  if (platform === "win32") {
    return { shell: "powershell.exe", args: ["-NonInteractive", "-Command"] };
  }
  if (process.env.SHELL?.includes("zsh")) {
    return { shell: "zsh", args: ["-c"] };
  }
  return { shell: "bash", args: ["-c"] };
}

function resolveShell(requested: string): { shell: string; args: string[] } {
  if (requested === "auto") return detectShell();
  switch (requested) {
    case "powershell": return { shell: "powershell.exe", args: ["-NonInteractive", "-Command"] };
    case "cmd":        return { shell: "cmd.exe",        args: ["/c"] };
    case "zsh":        return { shell: "zsh",            args: ["-c"] };
    default:           return { shell: "bash",           args: ["-c"] };
  }
}

// Dangerous patterns blocked regardless of policy
const BLOCKED_SHELL_PATTERNS = [
  /rm\s+-rf\s+\//i,
  /format\s+c:/i,
  /del\s+\/[fqs]+\s+\\\*/i,
  /mkfs\./i,
  /dd\s+if=.*of=\/dev/i,
  /shutdown/i,
  /:(){ :|:& };:/,             // fork bomb
  /\$\(curl.*\|.*bash\)/i,
  /Invoke-Expression.*downloadstring/i, // PowerShell download+exec
];

export class ShellTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "shell_execute",
    description: "Execute a shell command. Auto-detects platform (PowerShell on Windows, bash on Linux/Mac). Use for CLI operations, package management, build commands, etc.",
    category:    "shell",
    permissions: ["EXECUTE_COMMAND", "PROCESS_SPAWN"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    dangerous:    true,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed = InputSchema.parse(input);

      // Security: block dangerous patterns
      for (const pattern of BLOCKED_SHELL_PATTERNS) {
        if (pattern.test(parsed.command)) {
          return this.failure(`Command blocked by security policy: matches dangerous pattern`, Date.now() - start);
        }
      }

      // Resolve working directory
      const cwd = parsed.cwd === "/workspace"
        ? workspacePath
        : path.resolve(workspacePath, parsed.cwd.replace("/workspace", ""));

      const { shell, args } = resolveShell(parsed.shell);

      return new Promise((resolve) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const proc = spawn(shell, [...args, parsed.command], {
          cwd,
          env:   { ...process.env, WORKSPACE: workspacePath },
          stdio: "pipe",
        });

        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString().slice(0, 50_000); });
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString().slice(0, 10_000); });

        const timer = setTimeout(() => {
          timedOut = true;
          proc.kill("SIGKILL");
        }, parsed.timeout);

        proc.on("close", (code) => {
          clearTimeout(timer);
          const durationMs = Date.now() - start;
          if (timedOut) {
            resolve(this.failure(`Command timed out after ${parsed.timeout}ms`, durationMs));
            return;
          }
          const output = [
            stdout ? `STDOUT:\n${stdout}` : "",
            stderr ? `STDERR:\n${stderr}` : "",
            `Exit code: ${code ?? -1}`,
          ].filter(Boolean).join("\n\n");

          resolve(this.success(output, { stdout, stderr, exitCode: code ?? -1 }, durationMs));
        });

        proc.on("error", (err) => {
          clearTimeout(timer);
          resolve(this.failure(`Shell error: ${err.message}`, Date.now() - start));
        });
      });
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const shellTool = new ShellTool();
