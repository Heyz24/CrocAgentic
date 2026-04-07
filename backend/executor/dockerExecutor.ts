/**
 * backend/executor/dockerExecutor.ts
 * CrocAgentic Phase 2 — Docker Sandbox Executor.
 *
 * SECURITY GUARANTEES:
 * - Commands NEVER run on the host OS directly.
 * - Every execution gets an isolated per-task workspace folder.
 * - Workspace is mounted read-write ONLY at /workspace inside container.
 * - Network is disabled by default unless NETWORK_ACCESS is requested.
 * - Container is CPU/memory/pids limited.
 * - Never --privileged. Always --rm (auto-cleanup).
 * - Runs as non-root user (node:20-alpine default user = node, uid 1000).
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { PlanStep, StepResult, StepStatus } from "../../utils/zodSchemas";

// ─── Config ────────────────────────────────────────────────────────────────────

const DOCKER_IMAGE = "node:20-alpine";
const RUNTIME_DIR = path.resolve(process.cwd(), "runtime", "tasks");

export interface DockerExecutorOptions {
  networkAccess: boolean;
  cpus?: string;
  memory?: string;
  pidsLimit?: number;
}

const DEFAULT_OPTIONS: Required<DockerExecutorOptions> = {
  networkAccess: false,
  cpus: "1",
  memory: "512m",
  pidsLimit: 256,
};

// ─── Workspace Management ──────────────────────────────────────────────────────

export function createTaskWorkspace(taskId: string): string {
  const workspacePath = path.join(RUNTIME_DIR, taskId, "workspace");
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function removeTaskWorkspace(taskId: string): void {
  const taskPath = path.join(RUNTIME_DIR, taskId);
  if (fs.existsSync(taskPath)) {
    fs.rmSync(taskPath, { recursive: true, force: true });
  }
}

// ─── Docker Availability Check ─────────────────────────────────────────────────

export async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("docker", ["info"], { stdio: "ignore" });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

// ─── Core Step Executor ────────────────────────────────────────────────────────

export async function executeStep(
  step: PlanStep,
  hostWorkspacePath: string,
  options: DockerExecutorOptions = DEFAULT_OPTIONS
): Promise<StepResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  // Build docker run arguments
  const dockerArgs: string[] = [
    "run",
    "--rm",                                          // auto-remove container after exit
    "--workdir", "/workspace",                       // default working dir inside container
    "--volume", `${hostWorkspacePath}:/workspace`,   // mount ONLY the task workspace
    "--cpus", opts.cpus,                             // CPU limit
    "--memory", opts.memory,                         // memory limit
    "--pids-limit", String(opts.pidsLimit),          // process limit (anti fork-bomb)
    "--user", "node",                                // run as non-root (node user in alpine)
    "--read-only",                                   // read-only rootfs
    "--tmpfs", "/tmp:size=64m,mode=1777",            // writable /tmp only
    "--security-opt", "no-new-privileges",           // prevent privilege escalation
    "--cap-drop", "ALL",                             // drop all Linux capabilities
  ];

  // Network policy
  if (!opts.networkAccess) {
    dockerArgs.push("--network", "none");
  }

  // Image + command
  dockerArgs.push(DOCKER_IMAGE);
  dockerArgs.push(...step.cmd);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const proc = spawn("docker", dockerArgs, {
      cwd: hostWorkspacePath,
    });

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    // Enforce step timeout
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, step.timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      let status: StepStatus;
      if (timedOut) {
        status = "TIMEOUT";
      } else if (code === 0) {
        status = "SUCCESS";
      } else {
        status = "FAILED";
      }

      resolve({
        stepId: step.stepId,
        cmd: step.cmd,
        cwd: step.cwd,
        exitCode: timedOut ? -1 : (code ?? -1),
        stdout: stdout.slice(0, 50_000), // cap output size
        stderr: stderr.slice(0, 10_000),
        durationMs,
        status,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stepId: step.stepId,
        cmd: step.cmd,
        cwd: step.cwd,
        exitCode: -1,
        stdout: "",
        stderr: `Docker spawn error: ${err.message}`,
        durationMs: Date.now() - startTime,
        status: "FAILED",
      });
    });
  });
}

// ─── Mock Executor (when Docker is not available) ──────────────────────────────

export async function executeMockStep(step: PlanStep): Promise<StepResult> {
  const startTime = Date.now();
  await new Promise((r) => setTimeout(r, 50)); // simulate tiny delay

  const mockOutputs: Record<string, string> = {
    ls: "total 0\ndrwxr-xr-x 2 node node 40 Jan 1 00:00 .\ndrwxr-xr-x 3 node node 60 Jan 1 00:00 ..\n",
    echo: step.cmd.slice(1).join(" ") + "\n",
    cat: "[mock file contents]\n",
    find: "/workspace/example.ts\n",
    grep: "[mock grep result]\n",
    mkdir: "",
    touch: "",
    git: "[mock git output]\n",
    npm: "[mock npm output]\n",
    node: "[mock node output]\n",
    pwd: "/workspace\n",
    date: new Date().toString() + "\n",
    whoami: "node\n",
  };

  const root = step.cmd[0] ?? "unknown";
  const stdout = mockOutputs[root] ?? `[mock] executed: ${step.cmd.join(" ")}\n`;

  return {
    stepId: step.stepId,
    cmd: step.cmd,
    cwd: step.cwd,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: Date.now() - startTime,
    status: "SUCCESS",
  };
}
