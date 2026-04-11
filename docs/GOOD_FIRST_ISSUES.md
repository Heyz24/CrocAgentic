# Good First Issues for Contributors

Post these as GitHub Issues to attract contributors.

---

## Issue 1 — WebSocket streaming for real-time pipeline logs

**Title**: `feat: add WebSocket streaming so CLI/GUI shows live agent logs`

**Labels**: `enhancement`, `good first issue`

**Body**:
Currently the pipeline runs and returns results only when complete. This means users wait 10-30s with no feedback.

We want WebSocket support so the GUI and CLI can show each agent's status in real time as they complete — like watching the pipeline breathe.

**Acceptance criteria:**
- `ws://localhost:3000/pipeline/stream` WebSocket endpoint
- Emits `{agent, decision, durationMs}` as each agent completes
- GUI updates each agent row in real time without waiting for full completion
- CLI shows a live spinner with current agent name

**Files to look at:**
- `backend/server.ts` — add WebSocket upgrade
- `backend/pipeline/orchestrator.ts` — emit events during execution
- `gui/src/index.html` — connect to WebSocket and update UI

**Difficulty**: Medium | **Estimated time**: 4-6 hours

---

## Issue 2 — Add Jira/Linear connector

**Title**: `feat: Jira and Linear connector — agent processes tickets automatically`

**Labels**: `enhancement`, `good first issue`, `connector`

**Body**:
CrocAgentic has GitHub, Slack, Notion connectors. We need Jira and Linear so dev teams can label a ticket and have the agent process it.

**Acceptance criteria:**
- `backend/connectors/jiraConnector.ts` — polls for tickets labeled `crocagentic`
- `backend/connectors/linearConnector.ts` — processes Linear issues
- All input scanned by SecB (RAG injection protection already exists)
- Agent posts result as comment on the ticket
- Status in `/connectors/status` endpoint

**Files to look at:**
- `backend/connectors/githubConnector.ts` — use this as template
- `backend/server.ts` — register new connector routes
- `backend/routes.ts` — add status endpoint

**APIs:**
- Jira: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Linear: https://developers.linear.app/docs/graphql/working-with-the-graphql-api

**Difficulty**: Easy-Medium | **Estimated time**: 3-5 hours

---

## Issue 3 — Add `@xenova/transformers` for offline vector embeddings

**Title**: `feat: offline semantic memory search using local embeddings`

**Labels**: `enhancement`, `memory`, `good first issue`

**Body**:
Currently the 3-layer memory system uses keyword matching for search. We want semantic search using local embeddings — so "write code" matches memories about "programming tasks" even without exact keywords.

`@xenova/transformers` runs completely offline, zero API calls, free forever.

**Acceptance criteria:**
- `npm install @xenova/transformers`
- `backend/memory/embeddingStore.ts` — generates embeddings locally
- `recall()` in `memoryStore.ts` uses cosine similarity when available
- Falls back to keyword search if `@xenova/transformers` not installed
- New test in `tests/testMemory.ts` for semantic search

**Files to look at:**
- `backend/memory/memoryStore.ts` — add embedding support to `recall()`
- `backend/memory/contextBuilder.ts` — use semantic search for context building

**Difficulty**: Medium | **Estimated time**: 4-6 hours

---

## Issue 4 — Plugin: Veo video generation tool

**Title**: `feat: Veo 2 video generation plugin`

**Labels**: `plugin`, `good first issue`

**Body**:
Google's Veo 2 API can generate videos from text prompts. We want a CrocAgentic plugin so the agent can generate videos as part of any task.

**Acceptance criteria:**
- `plugins/veoTool.ts` — extends `BaseTool`
- Input: `{ prompt: string, duration: number, aspectRatio: string }`
- Output: video file URL or local path
- Requires `GOOGLE_VEO_API_KEY` in `.env`
- Added to `plugins/README.md` as example plugin

**Files to look at:**
- `plugins/README.md` — plugin development guide
- `backend/tools/baseTool.ts` — BaseTool class to extend
- `backend/tools/builtin/httpRequestTool.ts` — example of HTTP API call tool

**Difficulty**: Easy | **Estimated time**: 2-3 hours

---

## Issue 5 — Dark/light theme toggle in GUI

**Title**: `feat: dark/light theme toggle in dashboard`

**Labels**: `enhancement`, `ui`, `good first issue`

**Body**:
The GUI is currently dark-only. We want a toggle button in the header to switch between dark and light themes, with preference saved to localStorage.

**Acceptance criteria:**
- Toggle button in header (moon/sun icon)
- Light theme CSS variables defined
- Theme preference saved (localStorage or memory API)
- Smooth transition animation between themes

**Files to look at:**
- `gui/src/index.html` — all CSS variables and theme in `:root`

**Difficulty**: Easy | **Estimated time**: 1-2 hours

---

## Issue 6 — Rate limit feedback in CLI

**Title**: `fix: CLI should show clear message when Gemini rate limit hit`

**Labels**: `bug`, `good first issue`, `ux`

**Body**:
When Gemini free tier rate limit is hit, the CLI just shows `[FALLBACK]` with no explanation. Users don't understand why results are wrong.

**Acceptance criteria:**
- When `[FALLBACK]` is triggered by rate limit, show: `⚠ Rate limit hit — switching to deterministic mode. Wait 60s or configure a local model.`
- Optionally show a countdown timer
- Link to docs on setting up Ollama

**Files to look at:**
- `backend/llm/llmRouter.ts` — where fallback is triggered
- `cli/index.ts` — where output is formatted
- `backend/pipeline/orchestrator.ts` — Thinker decision string

**Difficulty**: Easy | **Estimated time**: 1-2 hours
