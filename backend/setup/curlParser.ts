/**
 * backend/setup/curlParser.ts
 * CrocAgentic Phase 4 — Curl Parser.
 *
 * Parses a raw curl command from any LLM provider's API studio
 * and extracts: provider, model, API key, endpoint.
 *
 * Supports: Gemini, OpenAI, Anthropic Claude, Ollama
 */

import type { LLMProvider } from "../config/configLoader";

export interface ParsedCurl {
  provider:   LLMProvider;
  apiKey:     string;
  model:      string;
  endpoint:   string;
  headers:    Record<string, string>;
  error?:     string;
}

// ─── Provider Detection ────────────────────────────────────────────────────────

function detectProvider(curl: string): LLMProvider {
  if (curl.includes("generativelanguage.googleapis.com")) return "gemini";
  if (curl.includes("api.openai.com"))                   return "openai";
  if (curl.includes("api.anthropic.com"))                return "claude";
  if (curl.includes("localhost:11434") ||
      curl.includes("ollama"))                           return "ollama";
  return "none";
}

// ─── URL Extractor ─────────────────────────────────────────────────────────────

function extractUrl(curl: string): string {
  // Match URL after curl keyword, handles quotes and no-quotes
  const patterns = [
    /curl\s+['"]?(https?:\/\/[^\s'"\\]+)/i,
    /curl\s+-[a-zA-Z\s]+\s+['"]?(https?:\/\/[^\s'"\\]+)/i,
    /(https?:\/\/[^\s'"\\]+)/i,
  ];
  for (const p of patterns) {
    const m = curl.match(p);
    if (m?.[1]) return m[1].replace(/['"]/g, "");
  }
  return "";
}

// ─── Header Extractor ─────────────────────────────────────────────────────────

function extractHeaders(curl: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // Match -H 'Key: Value' or -H "Key: Value"
  const headerRegex = /-H\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = headerRegex.exec(curl)) !== null) {
    const parts = match[1].split(/:\s*(.+)/);
    if (parts.length >= 2) {
      headers[parts[0].trim()] = parts[1].trim();
    }
  }
  return headers;
}

// ─── API Key Extractor ─────────────────────────────────────────────────────────

function extractApiKey(curl: string, provider: LLMProvider, headers: Record<string, string>): string {
  switch (provider) {
    case "gemini": {
      // From URL: ?key=AIza...
      const urlKey = curl.match(/[?&]key=([A-Za-z0-9_\-]+)/);
      if (urlKey?.[1]) return urlKey[1];
      // From header: X-goog-api-key
      return headers["X-goog-api-key"] ?? headers["x-goog-api-key"] ?? "";
    }
    case "openai": {
      // Authorization: Bearer sk-...
      const auth = headers["Authorization"] ?? headers["authorization"] ?? "";
      return auth.replace(/^Bearer\s+/i, "");
    }
    case "claude": {
      // x-api-key: sk-ant-...
      return headers["x-api-key"] ?? headers["X-Api-Key"] ?? "";
    }
    case "ollama":
      return ""; // no key needed
    default:
      return "";
  }
}

// ─── Model Extractor ──────────────────────────────────────────────────────────

function extractModel(curl: string, provider: LLMProvider): string {
  switch (provider) {
    case "gemini": {
      // URL: /models/gemini-flash-latest:generateContent
      const m = curl.match(/\/models\/([^/:?\s'"]+)/);
      return m?.[1] ?? "gemini-flash-latest";
    }
    case "openai": {
      // In JSON body: "model": "gpt-4o"
      const m = curl.match(/"model"\s*:\s*"([^"]+)"/);
      return m?.[1] ?? "gpt-4o-mini";
    }
    case "claude": {
      // In JSON body: "model": "claude-..."
      const m = curl.match(/"model"\s*:\s*"([^"]+)"/);
      return m?.[1] ?? "claude-haiku-4-5-20251001";
    }
    case "ollama": {
      const m = curl.match(/"model"\s*:\s*"([^"]+)"/);
      return m?.[1] ?? "phi3:mini";
    }
    default:
      return "";
  }
}

// ─── Main Parser ───────────────────────────────────────────────────────────────

export function parseCurl(rawCurl: string): ParsedCurl {
  // Normalize: remove line continuations and extra whitespace
  const curl = rawCurl
    .replace(/\\\n/g, " ")
    .replace(/\\\r\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const provider = detectProvider(curl);
  if (provider === "none") {
    return {
      provider: "none",
      apiKey:   "",
      model:    "",
      endpoint: "",
      headers:  {},
      error:    "Could not detect provider. Supported: Gemini, OpenAI, Claude, Ollama.",
    };
  }

  const headers  = extractHeaders(curl);
  const apiKey   = extractApiKey(curl, provider, headers);
  const model    = extractModel(curl, provider);
  const endpoint = extractUrl(curl);

  if (!apiKey && provider !== "ollama") {
    return { provider, apiKey: "", model, endpoint, headers,
      error: `Could not extract API key for ${provider}. Make sure the curl includes your key.` };
  }

  return { provider, apiKey, model, endpoint, headers };
}
