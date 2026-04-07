# Changelog

All notable changes to CrocAgentic are documented here.

## [1.0.0] - 2026-04-07

### Added
- Natural language CLI — type plain English, agent does the rest
- 10-agent governance pipeline (SecB, Thinker, Tester, SecA, SecC, Decider, Allocator, Executor, Monitor, Manager)
- Multi-provider LLM support: Claude, GPT-4o, Gemini, Ollama
- Per-task model routing (coding/reasoning/analysis/heavy/fast)
- 3-layer memory system (short/medium/long-term)
- Transaction rollback + file quarantine
- Human escalation with evidence packages
- 9 connectors: Email, Telegram, Slack, WhatsApp, GitHub, Notion, Drive, Webhook, FileWatcher
- 50+ injection patterns + RAG poisoning protection
- Secrets scanning and redaction
- Dependency supply chain verifier
- Plugin system with `/plugins/` folder
- NSIS Windows installer
- Cross-platform: Windows, macOS, Linux

### Security
- 50+ prompt injection patterns
- RAG poisoning detection (25 patterns)
- Secrets scanner (25 pattern types including API keys, PEM keys, PII)
- Model fingerprinting at startup
- Network egress monitoring
- Rate limiting per IP per endpoint
- Cryptographic audit integrity (SHA-256)

## [0.x.x] - Development phases
See git history for development phase details.
