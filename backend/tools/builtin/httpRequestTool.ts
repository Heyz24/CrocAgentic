/**
 * backend/tools/builtin/httpRequestTool.ts
 * CrocAgentic Phase 5 — HTTP Request Tool.
 *
 * Makes HTTP calls to allowlisted APIs.
 * Supports: GET, POST, PUT, DELETE, PATCH.
 * All URLs validated against networkAllowlist.json before execution.
 */

import * as fs   from "fs";
import * as path from "path";
import { z } from "zod";
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../baseTool";

const InputSchema = z.object({
  url:        z.string().url(),
  method:     z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
  headers:    z.record(z.string()).default({}),
  body:       z.string().optional(),
  timeout:    z.number().int().positive().max(30_000).default(15_000),
  parseJSON:  z.boolean().default(true),
});

interface NetworkAllowlist {
  allowedDomains:   string[];
  deniedDomains:    string[];
  allowedProtocols: string[];
}

function loadNetworkAllowlist(): NetworkAllowlist {
  const p = path.resolve(process.cwd(), "policies", "networkAllowlist.json");
  return JSON.parse(fs.readFileSync(p, "utf-8")) as NetworkAllowlist;
}

function isDomainAllowed(url: string): boolean {
  try {
    const parsed  = new URL(url);
    const domain  = parsed.hostname.toLowerCase();
    const proto   = parsed.protocol.replace(":", "");
    const policy  = loadNetworkAllowlist();

    if (!policy.allowedProtocols.includes(proto)) return false;

    for (const denied of policy.deniedDomains) {
      const clean = denied.replace(/^\*\./, "");
      if (domain === clean || domain.endsWith("." + clean)) return false;
    }

    // If allowedDomains has "*" entry, allow all non-denied
    if (policy.allowedDomains.includes("*")) return true;

    for (const allowed of policy.allowedDomains) {
      const clean = allowed.replace(/^\*\./, "");
      if (domain === clean || domain.endsWith("." + clean)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

export class HttpRequestTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "http_request",
    description: "Make an HTTP request to an external API or URL. Supports GET, POST, PUT, DELETE, PATCH. URL must be on the network allowlist.",
    category:    "network",
    permissions: ["NETWORK_ACCESS"],
    inputSchema:  InputSchema,
    outputSchema: z.object({ status: z.number(), body: z.string(), headers: z.record(z.string()) }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, _workspacePath: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const parsed = InputSchema.parse(input);

      // Security: validate URL against allowlist
      if (!isDomainAllowed(parsed.url)) {
        return this.failure(
          `URL domain not on network allowlist: ${parsed.url}. Add it to policies/networkAllowlist.json`,
          Date.now() - start
        );
      }

      const res = await fetch(parsed.url, {
        method:  parsed.method,
        headers: { "User-Agent": "CrocAgentic/0.5.0", ...parsed.headers },
        body:    parsed.body,
        signal:  AbortSignal.timeout(parsed.timeout),
      });

      const rawBody = await res.text();
      let formattedBody = rawBody;

      if (parsed.parseJSON) {
        try {
          const json = JSON.parse(rawBody);
          formattedBody = JSON.stringify(json, null, 2).slice(0, 100_000);
        } catch { /* keep raw */ }
      }

      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((val, key) => { responseHeaders[key] = val; });

      const output = `HTTP ${res.status} ${res.statusText}\n\n${formattedBody.slice(0, 50_000)}`;

      return this.success(output, {
        status:  res.status,
        headers: responseHeaders,
        body:    formattedBody,
      }, Date.now() - start);
    } catch (err) {
      return this.failure((err as Error).message, Date.now() - start);
    }
  }
}

export const httpRequestTool = new HttpRequestTool();
