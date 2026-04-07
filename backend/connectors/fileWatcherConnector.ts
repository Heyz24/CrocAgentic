/**
 * backend/connectors/fileWatcherConnector.ts
 * CrocAgentic Phase 6 — File Watcher Connector.
 *
 * Watches a folder for new files.
 * Auto-detects file type → routes to correct profile.
 * Output saved to /workspace/output/.
 *
 * File routing:
 *   .pdf, .docx, .xlsx, .csv  → analyst profile
 *   .py, .js, .ts, .go, .rs   → coder profile
 *   .txt, .md, .json           → worker profile
 *   .png, .jpg, .webp          → worker profile (image analysis)
 *   anything else              → default profile
 */

import * as fs   from "fs";
import * as path from "path";
import * as os   from "os";
import { runPipeline } from "../pipeline/orchestrator";

// ─── File Type → Profile Mapping ──────────────────────────────────────────────

const FILE_TYPE_PROFILES: Record<string, string> = {
  ".pdf":  "analyst",
  ".docx": "analyst",
  ".xlsx": "analyst",
  ".csv":  "analyst",
  ".py":   "coder",
  ".js":   "coder",
  ".ts":   "coder",
  ".go":   "coder",
  ".rs":   "coder",
  ".java": "coder",
  ".cpp":  "coder",
  ".c":    "coder",
  ".txt":  "worker",
  ".md":   "worker",
  ".json": "worker",
  ".png":  "worker",
  ".jpg":  "worker",
  ".webp": "worker",
  ".jpeg": "worker",
};

function getProfileForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return FILE_TYPE_PROFILES[ext] ?? "default";
}

function buildGoalForFile(filePath: string, profile: string): string {
  const ext      = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  const goalMap: Record<string, string> = {
    "analyst": `Analyse the file "${filename}" and provide a comprehensive summary with key findings and recommendations.`,
    "coder":   `Review the code file "${filename}", identify any issues, suggest improvements, and explain what it does.`,
    "worker":  `Read and process the file "${filename}", extract the key information, and provide a clear summary.`,
    "default": `Process the file "${filename}" and provide relevant output based on its content.`,
  };

  return goalMap[profile] ?? goalMap["default"];
}

// ─── Processing Queue ──────────────────────────────────────────────────────────

const processingSet = new Set<string>(); // prevent double-processing

async function processFile(filePath: string, outputDir: string): Promise<void> {
  if (processingSet.has(filePath)) return;
  processingSet.add(filePath);

  const profile  = getProfileForFile(filePath);
  const goal     = buildGoalForFile(filePath, profile);
  const filename = path.basename(filePath);

  console.log(`[FileWatcher] Processing: ${filename} → profile: ${profile}`);

  try {
    // Small delay to ensure file is fully written
    await new Promise((r) => setTimeout(r, 500));

    const result = await runPipeline(goal, true);

    // Save output
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_result.json`);
    fs.writeFileSync(outputFile, JSON.stringify({
      sourceFile:  filePath,
      profile,
      goal,
      result,
      processedAt: new Date().toISOString(),
    }, null, 2), "utf-8");

    // Also save plain text summary
    const summaryFile = path.join(outputDir, `${path.basename(filePath, path.extname(filePath))}_summary.txt`);
    const summary = [
      `File: ${filename}`,
      `Profile: ${profile}`,
      `Status: ${result.finalStatus}`,
      `Risk: ${result.riskScore}`,
      `Processed: ${new Date().toISOString()}`,
      "",
      result.execution?.steps?.map((s) => s.stdout).join("\n") ?? "No output",
    ].join("\n");
    fs.writeFileSync(summaryFile, summary, "utf-8");

    console.log(`[FileWatcher] ✓ Done: ${filename} → ${outputFile}`);
  } catch (err) {
    console.error(`[FileWatcher] ✗ Failed: ${filename}:`, (err as Error).message);
  } finally {
    processingSet.delete(filePath);
  }
}

// ─── Watcher ──────────────────────────────────────────────────────────────────

let _watcher: fs.FSWatcher | null = null;

export function startFileWatcher(watchDir: string, outputDir: string): void {
  if (!fs.existsSync(watchDir)) {
    fs.mkdirSync(watchDir, { recursive: true });
  }

  console.log(`[FileWatcher] Watching: ${watchDir}`);
  console.log(`[FileWatcher] Output:   ${outputDir}`);

  _watcher = fs.watch(watchDir, { persistent: false }, (eventType, filename) => {
    if (!filename || eventType !== "rename") return;

    const fullPath = path.join(watchDir, filename);

    // Skip hidden files, output files, temp files
    if (filename.startsWith(".") || filename.startsWith("_")) return;
    if (!fs.existsSync(fullPath)) return; // deletion event

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return;
    if (stat.size === 0) return; // empty file

    // Don't process files in output dir
    if (fullPath.startsWith(outputDir)) return;

    processFile(fullPath, outputDir);
  });

  _watcher.on("error", (err) => {
    console.error("[FileWatcher] Error:", err.message);
  });
}

export function stopFileWatcher(): void {
  if (_watcher) {
    _watcher.close();
    _watcher = null;
    console.log("[FileWatcher] Stopped.");
  }
}

export function getWatcherStatus(): { running: boolean; watchDir?: string } {
  return { running: _watcher !== null };
}
