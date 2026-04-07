<div align="center">

# 🐊 CrocAgentic

**The secure, modular AI agent framework. Brain by you. Body by us.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Heyz24/crocagentic/releases)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*Bring your own LLM. We handle everything else.*

[**Quick Start**](#quick-start) · [**Features**](#features) · [**Connectors**](#connectors) · [**Contributing**](CONTRIBUTING.md) · [**Releases**](https://github.com/crocagentic/crocagentic/releases)

</div>

---

## What is CrocAgentic?

CrocAgentic is a secure, multi-agent AI framework that acts as the **body** for any LLM brain. You connect your own API key (Claude, GPT-4o, Gemini, or local Ollama models), and CrocAgentic handles everything else:

- **Security** — 50+ injection patterns, secrets scanning, RAG poison detection
- **Governance** — 10-agent pipeline with cryptographic audit integrity
- **Memory** — 3-layer memory system (short/medium/long-term)
- **Connectors** — Email, Telegram, Slack, WhatsApp, GitHub, Notion, Drive, Webhook
- **Rollback** — Transaction undo system — first agent with this
- **Escalation** — Human-in-the-loop with full evidence packages
- **Multi-model routing** — Different LLMs for different task types

## Quick Start

```bash
# Clone
git clone https://github.com/crocagentic/crocagentic.git
cd crocagentic

# Install
npm install

# Setup your LLM (paste curl from your provider's API studio)
npm run setup

# Start CLI
npm run cli

# Or start API server
npm run dev
```

Then just type in plain English:
```
🐊 CrocAgentic v1.0.0
● analyse the sales data in q3.csv and give me key insights
● write a Python script to parse CSV files
● remember that I always want JSON output format
```

## Features

| Feature | Status |
|---------|--------|
| Natural language CLI | ✅ |
| Multi-provider LLM support | ✅ Claude, GPT-4o, Gemini, Ollama |
| Per-task model routing | ✅ coding → Claude, analysis → GPT-4o |
| 10-agent security pipeline | ✅ |
| 50+ injection patterns | ✅ |
| RAG poisoning protection | ✅ |
| Secrets scanning + redaction | ✅ |
| 3-layer memory system | ✅ |
| Transaction rollback + quarantine | ✅ |
| Human escalation with evidence | ✅ |
| 9 connectors | ✅ |
| Plugin system | ✅ |
| Cross-platform | ✅ Windows, macOS, Linux |

## Connectors

Connect CrocAgentic to anything:

| Connector | Setup |
|-----------|-------|
| Email (Gmail/Outlook) | `EMAIL_IMAP_HOST`, `EMAIL_USER`, `EMAIL_PASS` |
| Telegram | `TELEGRAM_BOT_TOKEN` |
| Slack | `SLACK_BOT_TOKEN` |
| WhatsApp | `TWILIO_ACCOUNT_SID` or `META_WHATSAPP_TOKEN` |
| GitHub | `GITHUB_TOKEN`, `GITHUB_REPO` |
| Notion | `NOTION_TOKEN` |
| Google Drive | `GOOGLE_DRIVE_API_KEY` |
| Webhook | Auto-configured, secret in `.webhook_secret` |
| File Watcher | Auto-configured, watches `runtime/inbox/` |

## Multi-Model Setup

```bash
npm run setup:models
```

Configure different LLMs per task type:
- **Coding** → Claude / Qwen-Coder
- **Reasoning** → GPT-4o / Claude Sonnet
- **Analysis** → Claude Opus / GPT-4o
- **Fast** → Gemini Flash / Haiku
- **Heavy** → Claude Opus / Qwen-480b
- **Offline** → Any Ollama model

## Architecture

```
User Input (natural language)
    ↓
MemoryAgent (reads context)
    ↓
SecB (50+ injection patterns + secrets scan)
    ↓
Thinker (LLM plans the task)
    ↓
Tester → SecA → SecC (validate + policy + audit)
    ↓
Decider → Allocator
    ↓
RollbackAgent (begin transaction)
    ↓
Executor (runs the plan)
    ↓
RollbackAgent (commit or rollback)
    ↓
OutputValidator → EscalationAgent
    ↓
MemoryAgent (saves results)
    ↓
Manager → TopManager
```

## API

```bash
# Full pipeline
POST /agent/execute
{"goal": "your task in plain English", "autoApproveLowRisk": true}

# Security scan
POST /security/scan
{"text": "...", "type": "secrets|rag"}

# Memory
GET  /memory/stats
POST /memory/preference

# Escalation
GET  /escalation/pending
POST /escalation/:id/approve
```

Full API reference: [docs/API.md](docs/API.md)

## Contributing

We welcome contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — Copyright © 2026 Harshal Vakharia

---

<div align="center">
Built with purpose. Engineered for trust.
</div>
