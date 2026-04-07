/**
 * backend/connectors/githubConnector.ts
 * CrocAgentic Phase 11 — GitHub Connector.
 *
 * Reads issues, creates PRs, pushes code, comments on PRs.
 * Config via .env: GITHUB_TOKEN, GITHUB_REPO (owner/repo)
 *
 * Triggers:
 *   - New issue created → agent processes it
 *   - Issue labeled "crocagentic" → agent handles it
 *   - PR review requested → agent reviews code
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runPipeline } from "../pipeline/orchestrator";
import { scanForSecrets } from "../security/secretsScanner";
import { detectRagPoisoning } from "../security/ragPoisonDetector";

export function isGithubConfigured(): boolean {
  return !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
}

interface GitHubIssue {
  number:  number;
  title:   string;
  body:    string;
  labels:  Array<{ name: string }>;
  user:    { login: string };
  html_url: string;
}

interface GitHubPR {
  number:   number;
  title:    string;
  body:     string;
  head:     { ref: string; sha: string };
  base:     { ref: string };
  user:     { login: string };
  html_url: string;
}

async function githubRequest<T>(endpoint: string, method = "GET", body?: unknown): Promise<T> {
  const token = process.env.GITHUB_TOKEN!;
  const repo  = process.env.GITHUB_REPO!;
  const url   = `https://api.github.com/repos/${repo}${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept":        "application/vnd.github+json",
      "Content-Type":  "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.json() as { message?: string };
    throw new Error(`GitHub API ${res.status}: ${err.message ?? "Unknown error"}`);
  }
  return res.json() as Promise<T>;
}

async function commentOnIssue(number: number, comment: string): Promise<void> {
  await githubRequest(`/issues/${number}/comments`, "POST", { body: comment });
}

async function addLabel(number: number, label: string): Promise<void> {
  await githubRequest(`/issues/${number}/labels`, "POST", { labels: [label] });
}

export async function getOpenIssues(): Promise<GitHubIssue[]> {
  return githubRequest<GitHubIssue[]>("/issues?state=open&per_page=10");
}

export async function createComment(issueNumber: number, body: string): Promise<void> {
  await commentOnIssue(issueNumber, body);
}

export function registerGithubRoutes(fastify: FastifyInstance): void {
  if (!isGithubConfigured()) {
    console.log("[GitHub] Not configured. Set GITHUB_TOKEN and GITHUB_REPO in .env to enable.");
    return;
  }

  // GitHub webhook — receives events from GitHub
  fastify.post("/github/webhook", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const event = req.headers["x-github-event"] as string ?? "";
      const body  = req.body as Record<string, unknown>;

      // Only process labeled issues with "crocagentic" label
      if (event === "issues") {
        const action = body.action as string;
        const issue  = body.issue as GitHubIssue;

        if (action === "labeled" && issue.labels.some((l) => l.name === "crocagentic")) {
          const issueText = `${issue.title}\n\n${issue.body ?? ""}`;

          // Security scan
          const secretScan = scanForSecrets(issueText);
          const ragScan    = detectRagPoisoning(issueText, `github:issue:${issue.number}`);

          if (!ragScan.clean) {
            await commentOnIssue(issue.number,
              "⚠️ CrocAgentic detected potential injection content in this issue. Skipping processing."
            );
            return reply.status(200).send({ ok: true });
          }

          const goal = `GitHub Issue #${issue.number}: ${issue.title}\n\n${secretScan.redacted}`;

          // Acknowledge
          await commentOnIssue(issue.number, "🐊 CrocAgentic is processing this issue...");

          // Run pipeline
          const result = await runPipeline(goal, true);
          const output = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "No output";

          // Reply with result
          await commentOnIssue(issue.number,
            `🐊 **CrocAgentic Result**\n\n` +
            `**Status:** ${result.finalStatus}\n` +
            `**Risk:** ${result.riskScore}\n\n` +
            `\`\`\`\n${output.slice(0, 3000)}\n\`\`\`\n\n` +
            `*Task ID: ${result.taskId}*`
          );

          await addLabel(issue.number, "crocagentic-processed");
        }
      }

      // PR review requests
      if (event === "pull_request") {
        const action = body.action as string;
        const pr     = body.pull_request as GitHubPR;

        if (action === "review_requested") {
          const goal = `Review this pull request: "${pr.title}"\n\n${pr.body ?? ""}\nBranch: ${pr.head.ref} → ${pr.base.ref}`;
          const result = await runPipeline(goal, true);
          const output = result.execution?.steps?.map((s) => s.stdout).filter(Boolean).join("\n") ?? "";
          await commentOnIssue(pr.number,
            `🐊 **CrocAgentic Code Review**\n\n${output.slice(0, 3000) || "Review completed."}`
          );
        }
      }

      return reply.status(200).send({ ok: true });
    }
  );

  // Manual trigger — process a specific issue
  fastify.post("/github/process-issue/:number", {},
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { number } = req.params as { number: string };
      try {
        const issues = await getOpenIssues();
        const issue  = issues.find((i) => i.number === parseInt(number));
        if (!issue) return reply.status(404).send({ error: "Issue not found" });

        const goal   = `${issue.title}\n\n${issue.body ?? ""}`;
        const result = await runPipeline(goal, true);
        return { success: true, taskId: result.taskId, status: result.finalStatus };
      } catch (err) {
        return reply.status(500).send({ error: (err as Error).message });
      }
    }
  );

  fastify.get("/github/status", {},
    async () => ({
      configured: true,
      repo:       process.env.GITHUB_REPO,
      webhookUrl: "POST /github/webhook",
      events:     ["issues:labeled[crocagentic]", "pull_request:review_requested"],
    })
  );

  fastify.log.info(`[GitHub] Connector registered for ${process.env.GITHUB_REPO}`);
}
