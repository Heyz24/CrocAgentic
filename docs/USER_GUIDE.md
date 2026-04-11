# CrocAgentic User Guide

## Table of Contents

1. [Quick Start](#quick-start)
2. [CLI Usage](#cli-usage)
3. [GUI Dashboard](#gui-dashboard)
4. [LLM Setup](#llm-setup)
5. [Local Models (Ollama)](#local-models)
6. [Multi-Model Routing](#multi-model-routing)
7. [Connectors](#connectors)
8. [Memory System](#memory-system)
9. [Profiles](#profiles)
10. [Security](#security)
11. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
git clone https://github.com/crocagentic/crocagentic.git
cd crocagentic
npm install
npm run setup       # configure your LLM
npm run cli         # start CLI
```

---

## CLI Usage

Start the interactive CLI:
```bash
npm run cli
```

You'll see:
```
🐊 CrocAgentic v1.0.0
   gemini / gemini-flash-latest · profile: default

Type your task in plain English. Type 'help' for commands, 'exit' to quit.

●
```

Just type naturally:
```
● what is today's date?
● list all files in the workspace
● write a Python script to parse a CSV file
● analyse this data and give me a summary
● remember that I always prefer JSON output
● forget project myproject
● help
● exit
```

**CLI flags:**
```bash
npm run cli -- --profile coder      # use coder profile
npm run cli -- --verbose            # show all agent steps
npm run cli -- --once "your task"   # run one task and exit
npm run cli -- --project myapp      # set project context
```

---

## GUI Dashboard

**Start the server first:**
```bash
npm run dev
```

**Open the GUI:**
```
gui/src/index.html
```
Open this file in your browser. It connects to `http://localhost:3000` automatically.

**Features:**
- **Run Task** — type in plain English, watch all agents process in real time
- **Pipeline** — live agent trace with timing
- **History** — all past tasks with status and duration
- **Memory** — view and manage agent memory
- **Connectors** — status of all integrations
- **Security** — scan text for secrets/injections
- **Escalations** — approve/reject pending human-in-the-loop items
- **Tools** — all available tools
- **Profiles** — agent profiles

---

## LLM Setup

### Option 1: Paste curl (recommended)

```bash
npm run setup
```

Go to your provider's API dashboard, copy the test curl command, paste it when prompted.

- **Gemini**: https://aistudio.google.com/app/apikey
- **OpenAI**: https://platform.openai.com/api-keys
- **Claude**: https://console.anthropic.com/settings/keys

### Option 2: Manual entry

When prompted, choose manual entry and enter provider, model name, and API key directly.

---

## Local Models

Run AI completely offline with Ollama. No API key needed, no internet required.

### Step 1: Install Ollama

**Windows:**
```
https://ollama.com/download/windows
```

**Mac:**
```
https://ollama.com/download/mac
```

**Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Step 2: Pull models

For a laptop with AMD Ryzen 7 5700U + 16GB RAM (no GPU):

**Coding tasks — Qwen 2.5 Coder (recommended):**
```bash
ollama pull qwen2.5-coder:7b
```
~4.5GB — excellent for code generation, fast on CPU

**Reasoning/General — Phi-3 Mini (fastest):**
```bash
ollama pull phi3:mini
```
~2.2GB — great reasoning, very fast on 5700U

**Alternative — Mistral 7B (balanced):**
```bash
ollama pull mistral:7b
```
~4.1GB — good balance of speed and quality

### Step 3: Start Ollama

```bash
ollama serve
```

Verify it's running:
```bash
ollama list
```

### Step 4: Configure CrocAgentic

```bash
npm run setup
```
Choose Ollama as provider. Enter model name (e.g. `qwen2.5-coder:7b`).

Or edit `crocagentic.config.json`:
```json
{
  "llm": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "ollamaHost": "http://localhost:11434",
    "timeout": 60000
  }
}
```

**Performance on 5700U 16GB (no GPU):**
- phi3:mini — ~3-5 tokens/sec, good for quick tasks
- qwen2.5-coder:7b — ~1-2 tokens/sec, best for code
- mistral:7b — ~1-2 tokens/sec, good general purpose

---

## Multi-Model Routing

Configure different models for different task types:

```bash
npm run setup:models
```

Recommended for 5700U 16GB no GPU:
```
coding    → qwen2.5-coder:7b  (offline, Ollama)
fast      → phi3:mini          (offline, Ollama)
general   → gemini-flash-latest (online, free)
reasoning → gemini-flash-latest (online, free)
```

This way: coding tasks use the best local code model, quick tasks use the fast local model, and complex reasoning uses Gemini free tier online.

---

## Connectors

Add to your `.env` file:

### Email (Gmail)
```
EMAIL_IMAP_HOST=imap.gmail.com
EMAIL_USER=your@gmail.com
EMAIL_PASS=your-app-password    # from myaccount.google.com/apppasswords
```

### Telegram
1. Message @BotFather on Telegram
2. Create new bot → copy token
```
TELEGRAM_BOT_TOKEN=your-token
```

### GitHub
```
GITHUB_TOKEN=your-personal-access-token
GITHUB_REPO=username/repository
```
Label any issue with `crocagentic` → agent processes it automatically.

### WhatsApp (Twilio)
```
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=+14155238886
```

### File Watcher
Drop any file into `runtime/inbox/` — agent auto-processes it:
- PDF → analyst profile (analysis + summary)
- `.py`, `.ts` → coder profile (review + explain)
- `.txt`, `.json` → worker profile (process + summarize)

---

## Memory System

CrocAgentic remembers across sessions.

**Three layers:**
- **Short-term**: current task session, cleared after each task
- **Medium-term**: project knowledge, 90-day TTL
- **Long-term**: preferences and rules, permanent

**Natural language commands:**
```
● remember that I always want markdown output
● forget project myproject
● add rule: always require approval before deleting files
```

**API:**
```bash
curl http://localhost:3000/memory/stats
curl -X POST http://localhost:3000/memory/preference \
  -H "Content-Type: application/json" \
  -d '{"key":"format","value":"always use markdown"}'
```

---

## Profiles

Choose a profile to optimize the agent for your use case:

| Profile | Best for | LLM recommendation |
|---------|----------|--------------------|
| `default` | General tasks | Any model |
| `coder` | Writing code, debugging | Claude / Qwen-Coder |
| `analyst` | Data analysis, reports | GPT-4o / Claude Opus |
| `worker` | Email, quick tasks | Gemini Flash / Haiku |

```bash
npm run cli -- --profile coder
```

Or in the GUI, click the profile pill before running a task.

---

## Security

CrocAgentic is security-first:

- **50+ injection patterns** — blocks all known prompt injection attacks
- **RAG poisoning protection** — scans documents, emails, web content for injections
- **Secrets redaction** — API keys, passwords, PII detected and redacted before LLM sees them
- **Cryptographic audit** — every task signed with SHA-256, tamper-proof
- **Rate limiting** — 10 pipeline runs/min per IP
- **Network monitoring** — all outbound calls logged

**Scan text via API:**
```bash
curl -X POST http://localhost:3000/security/scan \
  -H "Content-Type: application/json" \
  -d '{"text":"your text here","type":"secrets"}'
```

---

## Troubleshooting

### LLM falling back to deterministic

**Symptom**: Thinker shows `[FALLBACK]` for every task

**Fix 1**: Check rate limits. Gemini free tier is 15 calls/minute. Wait 1 minute and retry.

**Fix 2**: Switch to local Ollama model for unlimited calls.

**Fix 3**: Check your API key is valid:
```bash
curl http://localhost:3000/debug/llm?goal=test
```

### Server not connecting in GUI

Make sure server is running:
```bash
npm run dev
```
Then open `gui/src/index.html` in your browser.

### "Cannot find module" errors

```bash
npm install
```

### Task output shows `ls -la` for everything

LLM is falling back to deterministic planner. Usually means:
1. Rate limited — wait 1 minute
2. API key expired — run `npm run setup` again
3. Switch to Ollama for unlimited local inference

### Windows Python not found

Go to: Settings → Apps → Advanced app settings → App execution aliases
Turn OFF `python.exe` and `python3.exe`

---

## Support

- GitHub Issues: https://github.com/crocagentic/crocagentic/issues
- Email: harshal.29@icloud.com
