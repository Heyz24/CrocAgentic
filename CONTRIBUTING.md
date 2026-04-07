# Contributing to CrocAgentic

First — thank you. Every contributor makes CrocAgentic better for everyone building on it. This project started as one person's vision of what an AI agent should be, and it grows through people like you.

---

## Code of Conduct

Be respectful. Be direct. Be constructive. We're here to build, not to argue.

---

## How to Contribute

### Reporting Bugs

1. Search existing issues first
2. Include: OS, Node.js version, exact error message, steps to reproduce
3. Label it `bug`

### Suggesting Features

1. Open a Discussion first (not an Issue)
2. Explain the use case, not just the feature
3. We'll discuss feasibility and roadmap fit

### Submitting Code

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Run tests: `npm test`
5. Run security check: `npm run verify:deps`
6. Commit with a clear message: `feat: add X connector`
7. Push and open a PR

### Commit Message Format

```
type: short description

feat:     new feature
fix:      bug fix
security: security improvement
test:     test addition/fix
docs:     documentation
refactor: code cleanup
```

---

## Development Setup

```bash
git clone https://github.com/crocagentic/crocagentic.git
cd crocagentic
npm install
cp .env.example .env
# Add your LLM API key to .env
npm run setup
npm run dev
```

Run tests:
```bash
npm test                    # all phases
npm run test:phase5         # specific phase
npm run verify:deps         # security check
```

---

## What We Need Most

- **Connector plugins** — integrations with new services
- **LLM provider adapters** — new providers in `backend/llm/providers/`
- **Security patterns** — new injection/attack patterns for SecB
- **Documentation** — usage examples, tutorials
- **Bug fixes** — especially cross-platform issues
- **Tests** — more edge case coverage

---

## Plugin Development

The easiest way to contribute is a plugin. Drop a `.ts` file in `/plugins/`:

```typescript
// plugins/myTool.ts
import { BaseTool, ToolManifest, ToolInput, ToolResult } from "../backend/tools/baseTool";
import { z } from "zod";

class MyTool extends BaseTool {
  readonly manifest: ToolManifest = {
    name:        "my_tool",
    description: "What it does",
    category:    "custom",
    permissions: ["NETWORK_ACCESS"],
    inputSchema:  z.object({ query: z.string() }),
    outputSchema: z.object({ result: z.string() }),
    dangerous:    false,
    platform:     "all",
  };

  async execute(input: ToolInput, workspacePath: string): Promise<ToolResult> {
    // your implementation
    return this.success("result");
  }
}

export default new MyTool();
```

---

## Security

If you find a security vulnerability, **do not open a public issue**. Email directly: `harshal.29@icloud.com` with subject `[CrocAgentic Security]`.

We take security seriously. Every input is scanned, every output is validated. If you find a gap, tell us privately first.

---

## Recognition

All contributors are listed in [CONTRIBUTORS.md](CONTRIBUTORS.md). Significant contributions get a mention in release notes.

---

Thank you for being part of this.

— Harshal Vakharia, Founder
