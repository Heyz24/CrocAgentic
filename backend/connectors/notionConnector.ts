/**
 * backend/connectors/notionConnector.ts
 * CrocAgentic Phase 11 — Notion Connector.
 *
 * Read pages, create pages, update databases.
 * Config via .env: NOTION_TOKEN, NOTION_DATABASE_ID
 *
 * Use cases:
 *   - Agent reads a Notion page as task input
 *   - Agent writes analysis results to Notion database
 *   - Agent creates new pages for completed tasks
 */

import { runPipeline } from "../pipeline/orchestrator";
import { detectRagPoisoning } from "../security/ragPoisonDetector";

export function isNotionConfigured(): boolean {
  return !!process.env.NOTION_TOKEN;
}

async function notionRequest<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const token = process.env.NOTION_TOKEN!;
  const res   = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      "Authorization":  `Bearer ${token}`,
      "Content-Type":   "application/json",
      "Notion-Version": "2022-06-28",
    },
    body:   body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json() as { message?: string };
    throw new Error(`Notion API ${res.status}: ${err.message}`);
  }
  return res.json() as Promise<T>;
}

export async function getPage(pageId: string): Promise<{ content: string; title: string }> {
  const page = await notionRequest<{ properties: Record<string, unknown>; id: string }>(`/pages/${pageId}`);
  const blocks = await notionRequest<{ results: Array<{ type: string; paragraph?: { rich_text: Array<{ plain_text: string }> } }> }>(`/blocks/${pageId}/children`);

  const content = blocks.results
    .filter((b) => b.type === "paragraph")
    .map((b) => b.paragraph?.rich_text.map((t) => t.plain_text).join("") ?? "")
    .join("\n");

  return { content, title: pageId };
}

export async function createPage(databaseId: string, title: string, content: string): Promise<string> {
  const page = await notionRequest<{ id: string }>("/pages", "POST", {
    parent:     { database_id: databaseId },
    properties: { Name: { title: [{ text: { content: title } }] } },
    children: [{
      object: "block",
      type:   "paragraph",
      paragraph: { rich_text: [{ type: "text", text: { content: content.slice(0, 2000) } }] },
    }],
  });
  return page.id;
}

export async function queryDatabase(databaseId: string): Promise<Array<{ id: string; title: string }>> {
  const res = await notionRequest<{ results: Array<{ id: string; properties: Record<string, { title?: Array<{ plain_text: string }> }> }> }>(
    `/databases/${databaseId}/query`, "POST", {}
  );
  return res.results.map((r) => ({
    id:    r.id,
    title: (Object.values(r.properties).find((p) => p.title)?.title ?? [])[0]?.plain_text ?? "Untitled",
  }));
}

// Process a Notion page as a task
export async function processNotionPage(pageId: string): Promise<{
  taskId: string; status: string; notionPageId?: string;
}> {
  const { content, title } = await getPage(pageId);

  // Security scan
  const ragScan = detectRagPoisoning(content, `notion:${pageId}`);
  const safeContent = ragScan.sanitized;

  const goal   = `Process Notion page: ${title}\n\n${safeContent}`;
  const result = await runPipeline(goal, true);

  // Write result back to Notion if database configured
  let notionPageId: string | undefined;
  if (process.env.NOTION_DATABASE_ID && result.finalStatus === "COMPLETED") {
    const output = result.execution?.steps?.map((s) => s.stdout).join("\n") ?? "Completed";
    notionPageId = await createPage(
      process.env.NOTION_DATABASE_ID,
      `CrocAgentic Result: ${title}`,
      output.slice(0, 2000)
    );
  }

  return { taskId: result.taskId, status: result.finalStatus, notionPageId };
}
