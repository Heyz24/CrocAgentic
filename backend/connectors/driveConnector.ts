/**
 * backend/connectors/driveConnector.ts
 * CrocAgentic Phase 11 — Google Drive Connector.
 *
 * Read files from Drive, write results back.
 * Config via .env: GOOGLE_DRIVE_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON
 *
 * Use cases:
 *   - Agent reads a Drive doc as task input
 *   - Agent uploads results as Drive file
 *   - Watch a Drive folder for new files
 */

import * as fs   from "fs";
import * as path from "path";
import { detectRagPoisoning } from "../security/ragPoisonDetector";
import { runPipeline } from "../pipeline/orchestrator";

export function isDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

async function driveRequest<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.GOOGLE_DRIVE_API_KEY!;
  const url  = new URL(`https://www.googleapis.com/drive/v3${endpoint}`);
  url.searchParams.set("key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } };
    throw new Error(`Drive API ${res.status}: ${err.error?.message}`);
  }
  return res.json() as Promise<T>;
}

export async function getDriveFile(fileId: string): Promise<{ content: string; name: string; mimeType: string }> {
  const meta = await driveRequest<{ name: string; mimeType: string }>(`/files/${fileId}`, { fields: "name,mimeType" });

  // Export as plain text for Google Docs
  let content = "";
  if (meta.mimeType === "application/vnd.google-apps.document") {
    const key = process.env.GOOGLE_DRIVE_API_KEY!;
    const exportUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain&key=${key}`;
    const res = await fetch(exportUrl, { signal: AbortSignal.timeout(15000) });
    content = await res.text();
  } else {
    const key = process.env.GOOGLE_DRIVE_API_KEY!;
    const dlUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${key}`;
    const res   = await fetch(dlUrl, { signal: AbortSignal.timeout(15000) });
    content = await res.text();
  }

  return { content: content.slice(0, 50000), name: meta.name, mimeType: meta.mimeType };
}

export async function listDriveFolder(folderId: string): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const res = await driveRequest<{ files: Array<{ id: string; name: string; mimeType: string }> }>(
    "/files",
    { q: `'${folderId}' in parents`, fields: "files(id,name,mimeType)", pageSize: "20" }
  );
  return res.files;
}

// Process a Drive file as a CrocAgentic task
export async function processDriveFile(fileId: string): Promise<{ taskId: string; status: string }> {
  const { content, name } = await getDriveFile(fileId);
  const ragScan = detectRagPoisoning(content, `drive:${fileId}`);
  const goal    = `Process Google Drive file "${name}":\n\n${ragScan.sanitized}`;
  const result  = await runPipeline(goal, true);
  return { taskId: result.taskId, status: result.finalStatus };
}
