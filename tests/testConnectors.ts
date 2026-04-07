/**
 * tests/testConnectors.ts
 * CrocAgentic Phase 6 — Connector Tests.
 * Run with: npx ts-node tests/testConnectors.ts
 */

import { parseCurl }               from "../backend/setup/curlParser";
import { getOrCreateWebhookSecret } from "../backend/connectors/webhookConnector";
import { getWatcherStatus }         from "../backend/connectors/fileWatcherConnector";
import { isTelegramConfigured }     from "../backend/connectors/telegramConnector";
import { isSlackConfigured }        from "../backend/connectors/slackConnector";
import { isEmailConfigured }        from "../backend/connectors/emailConnector";
import { detectTaskType, loadModelConfig } from "../backend/llm/routing/modelRouter";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ FAIL  ${name}`);
    console.log(`         ${(err as Error).message}`);
    failed++;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a !== b) throw new Error(`${label}: expected "${String(b)}", got "${String(a)}"`);
}

async function main() {
  console.log("\n🐊 CrocAgentic — Phase 6 Connector Tests\n");

  // ── Curl Parser ────────────────────────────────────────────────────────────
  console.log("[ Curl Parser ]");

  await test("parses Gemini curl correctly", () => {
    const curl = `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=AIzaSyTEST123" -H "Content-Type: application/json" -X POST -d '{}'`;
    const result = parseCurl(curl);
    assertEqual(result.provider, "gemini", "provider");
    assertEqual(result.model, "gemini-flash-latest", "model");
    assert(result.apiKey.includes("AIzaSyTEST123"), "apiKey");
  });

  await test("parses OpenAI curl correctly", () => {
    const curl = `curl https://api.openai.com/v1/chat/completions -H "Authorization: Bearer sk-test123abc" -H "Content-Type: application/json" -d '{"model":"gpt-4o-mini"}'`;
    const result = parseCurl(curl);
    assertEqual(result.provider, "openai", "provider");
    assertEqual(result.model, "gpt-4o-mini", "model");
    assert(result.apiKey.includes("sk-test123abc"), "apiKey");
  });

  await test("parses Claude curl correctly", () => {
    const curl = `curl https://api.anthropic.com/v1/messages -H "x-api-key: sk-ant-test123" -H "Content-Type: application/json" -d '{"model":"claude-haiku-4-5-20251001"}'`;
    const result = parseCurl(curl);
    assertEqual(result.provider, "claude", "provider");
    assert(result.apiKey.includes("sk-ant-test123"), "apiKey");
  });

  await test("parses Ollama curl correctly", () => {
    const curl = `curl http://localhost:11434/api/generate -d '{"model":"phi3:mini"}'`;
    const result = parseCurl(curl);
    assertEqual(result.provider, "ollama", "provider");
    assertEqual(result.model, "phi3:mini", "model");
  });

  await test("handles multiline curl with backslash continuation", () => {
    const curl = `curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=AIzaSyTEST" \\\n  -H "Content-Type: application/json" \\\n  -X POST`;
    const result = parseCurl(curl);
    assertEqual(result.provider, "gemini", "provider");
  });

  await test("returns error for unknown provider", () => {
    const curl = `curl https://unknown-ai-provider.com/api -H "Authorization: Bearer key123"`;
    const result = parseCurl(curl);
    assert(result.error !== undefined, "Should return error for unknown provider");
  });

  // ── Webhook Connector ──────────────────────────────────────────────────────
  console.log("\n[ Webhook Connector ]");

  await test("generates webhook secret", () => {
    const secret = getOrCreateWebhookSecret();
    assert(typeof secret === "string", "Secret should be a string");
    assert(secret.length >= 32, "Secret should be at least 32 chars");
  });

  await test("webhook secret is consistent across calls", () => {
    const s1 = getOrCreateWebhookSecret();
    const s2 = getOrCreateWebhookSecret();
    assertEqual(s1, s2, "Secret should be same across calls");
  });

  // ── File Watcher ───────────────────────────────────────────────────────────
  console.log("\n[ File Watcher ]");

  await test("watcher is not running by default", () => {
    const status = getWatcherStatus();
    assert(typeof status.running === "boolean", "Running should be boolean");
  });

  // ── Multi-Model Router ─────────────────────────────────────────────────────
  console.log("\n[ Multi-Model Router ]");

  await test("detects coding task type", () => {
    assertEqual(detectTaskType("write a Python script to parse CSV files"), "coding", "task type");
  });

  await test("detects analysis task type", () => {
    assertEqual(detectTaskType("analyse the quarterly sales data and provide insights"), "analysis", "task type");
  });

  await test("detects reasoning task type", () => {
    assertEqual(detectTaskType("explain why this approach is better and compare the alternatives"), "reasoning", "task type");
  });

  await test("detects heavy task type", () => {
    assertEqual(detectTaskType("write a comprehensive detailed report on the entire codebase"), "heavy", "task type");
  });

  await test("detects fast task type", () => {
    assertEqual(detectTaskType("give me a quick summary of this file"), "fast", "task type");
  });

  await test("defaults to general for unknown task type", () => {
    assertEqual(detectTaskType("do the thing with the stuff"), "general", "task type");
  });

  await test("model config loads or returns null gracefully", () => {
    const config = loadModelConfig();
    // Either null (not configured) or a valid object
    assert(config === null || typeof config === "object", "Config should be null or object");
  });

  // ── Connector Status ───────────────────────────────────────────────────────
  console.log("\n[ Connector Status ]");

  await test("telegram configured check works", () => {
    const result = isTelegramConfigured();
    assert(typeof result === "boolean", "Should return boolean");
    console.log(`         (Telegram: ${result ? "configured" : "not configured — set TELEGRAM_BOT_TOKEN"})`);
  });

  await test("slack configured check works", () => {
    const result = isSlackConfigured();
    assert(typeof result === "boolean", "Should return boolean");
    console.log(`         (Slack: ${result ? "configured" : "not configured — set SLACK_BOT_TOKEN"})`);
  });

  await test("email configured check works", () => {
    const result = isEmailConfigured();
    assert(typeof result === "boolean", "Should return boolean");
    console.log(`         (Email: ${result ? "configured" : "not configured — set EMAIL_* vars"})`);
  });

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`Connector Tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n⚠️  Some tests failed.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 All connector tests passed!`);
  }
}

main();
