/**
 * backend/tools/builtin/webSearchTool.ts
 * CrocAgentic Phase 5 — Web Search Tool.
 *
 * Primary:   Tavily (if TAVILY_API_KEY set) — best for AI agents
 * Fallback:  DuckDuckGo Instant Answer API — free, no key needed
 */

import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  query:       z.string().min(1).max(400),
  maxResults:  z.number().int().min(1).max(10).default(5),
  searchDepth: z.enum(["basic", "advanced"]).default("basic"),
});

interface TavilyResult {
  title:   string;
  url:     string;
  content: string;
  score:   number;
}

interface DDGResult {
  Abstract:        string;
  AbstractURL:     string;
  RelatedTopics:   Array<{ Text: string; FirstURL: string }>;
}

async function searchTavily(query: string, maxResults: number, apiKey: string): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
    signal:  AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Tavily error: ${res.status}`);
  const data = await res.json() as { results: TavilyResult[] };

  return data.results
    .slice(0, maxResults)
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 500)}`)
    .join("\n\n");
}

async function searchDDG(query: string, maxResults: number): Promise<string> {
  const encoded = encodeURIComponent(query);
  const res = await fetch(
    `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`);
  const data = await res.json() as DDGResult;

  const results: string[] = [];

  if (data.Abstract) {
    results.push(`[Summary] ${data.Abstract}\n${data.AbstractURL}`);
  }

  data.RelatedTopics
    ?.slice(0, maxResults - 1)
    .filter((t) => t.Text && t.FirstURL)
    .forEach((t, i) => {
      results.push(`[${i + 2}] ${t.Text}\n${t.FirstURL}`);
    });

  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  return results.join("\n\n");
}

export class WebSearchTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "web_search",
    description: "Search the web for current information. Returns titles, URLs, and summaries. Use for research, finding docs, checking facts.",
    category:    "search",
    permissions: ["NETWORK_ACCESS"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ results: z.string(), provider: z.string() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, _workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed   = InputSchema.parse(input);
      const tavilyKey = process.env.TAVILY_API_KEY ?? "";

      let results:  string;
      let provider: string;

      if (tavilyKey) {
        results  = await searchTavily(parsed.query, parsed.maxResults, tavilyKey);
        provider = "tavily";
      } else {
        results  = await searchDDG(parsed.query, parsed.maxResults);
        provider = "duckduckgo";
      }

      return this.success(results, { provider, query: parsed.query }, Date.now() - start);
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const webSearchTool = new WebSearchTool();
