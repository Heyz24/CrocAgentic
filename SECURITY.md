# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Active  |
| < 1.0   | ❌ No      |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email: `harshal.29@icloud.com`
Subject: `[CrocAgentic Security] Brief description`

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will respond within 48 hours and work with you on a fix before public disclosure.

## Security Architecture

CrocAgentic is built security-first:
- 50+ injection pattern detection on all inputs
- RAG poisoning protection on all external content
- Secrets scanning and redaction
- Cryptographic audit integrity (SHA-256)
- Network egress monitoring
- Rate limiting per endpoint
- Supply chain integrity verification
- Transaction rollback for all file operations
