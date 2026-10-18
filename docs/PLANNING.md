# gRouter — PLANNING

| Field | Value |
|---|---|
| **Document** | PLANNING v0.1 (working document — living) |
| **Date** | 2026-10-15 |
| **Status** | 🟡 Active |
| **Related** | [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md) · [STATE.md](./STATE.md) |

> This is the **how we work** document. PRD says *what*, ARCHITECTURE says *how it's built*, ROADMAP says *when*, STATE tracks *progress*. This file records decisions, principles, and process.

---

> **Status (2026-10-16):** This document predates the gRouter rebrand and the
> 0.3.1 release. The design decisions below carried over unchanged; product
> identifiers, storage paths and the model gateway now use gRouter naming
> (`grouter-code`, `grouter.grouter-code`, `~/.grouter`,
> `https://prod.grouter.web.id/v1`). See [STATE.md](./STATE.md) for current status.

## 1. Decisions Log (locked)

Decisions made with the user on 2026-10-15. Changing any of these requires an explicit decision (append to §1.3).

### 1.1 Locked Decisions

| ID | Decision | Rationale | Date |
|---|---|---|---|
| D-01 | **UI surface = Native Chat Participant API** (`@grouter` in built-in Chat view) | Native tool-confirmation UX, model picker integration, works alongside Copilot Chat, minimal UI maintenance. Custom webviews deferred. | 2026-10-15 |
| D-02 | **MCP = Client + Server (both directions)** | Consume external MCP servers for extra tools; expose gRouter tools as MCP server so external agents can drive VS Code through it. | 2026-10-15 |
| D-03 | **Mode scope order = Chat → Agent → Plan → Debug** | Each phase ships a usable increment; lowest-risk-first; debug builds on agent tooling. | 2026-10-15 |
| D-04 | **LLM access = gRouter gateway only** | Single provider, single key (`gRouter-...`), aligns with product. BYO-key multi-provider deferred post-V1. | 2026-10-15 |
| D-05 | **No sub-agents during development** (budget constraint) | All research/implementation done in main session with direct tools. | 2026-10-15 |
| D-06 | **Tool registry is single source of truth** | One `ToolSpec` definition per tool; three adapters generate: LangGraph tool, `vscode.lm.registerTool` contribution, MCP server tool. Prevents schema drift. | 2026-10-15 |
| D-07 | **Transport = Vercel AI SDK 7 + `@ai-sdk/openai-compatible`** | Verified current: `ai@7.0.141`, `@ai-sdk/openai-compatible@3.0.69`. Gateway is OpenAI-compatible. S-1 confirmed host Node 24.21 ≥ 22. | 2026-10-15 |
| D-08 | **Orchestration = LangGraph 1.5** (`@langchain/langgraph@1.5.0`, `@langchain/core@^1.1.48`, `@langchain/openai`) | Stable 1.x line; StateGraph + interrupt() for approvals; checkpointer for resume. S-3 confirmed bundling works. | 2026-10-15 |
| D-09 | **MCP SDK = `@modelcontextprotocol/sdk@1.32.1`** | Official TS SDK; supports stdio + Streamable HTTP client and server. | 2026-10-15 |
| D-10 | **Secrets = `~/.grouter/config.json` (home-basedir)** — superseded: key lives in home config file, not SecretStorage (user directive 2026-10-15) | Single config source outside the workspace; portable across editors; user directive: "put all .env on config json with location on homebasedir". ADR-006 amended. | 2026-10-15 |
| D-11 | **Bundling = esbuild**, `vscode` marked external | Standard for extensions; handles LangGraph dual ESM/CJS. S-3 verified. | 2026-10-15 |
| D-12 | **No mocks — real gateway for all testing** | User directive: "never use mock". Tests hit `prod.grouter.web.id/v1` with real key. Mock gateway deleted. | 2026-10-15 |
| D-13 | **Default model = `DeepSeek-V4-Flash`** | User directive; verified live (1M ctx, 20k max out, reasoning-capable). | 2026-10-15 |

### 1.2 Verified Environment Facts (2026-10-15)

| Fact | Source | Value |
|---|---|---|
| gRouter base URL | prod.grouter.web.id/docs | `https://prod.grouter.web.id/v1` |
| gRouter endpoints | docs | `/models`, `/chat/completions`, `/responses`, `/embeddings` |
| Key prefix | docs | `gRouter-` |
| Streaming | docs | SSE, `data: [DONE]`, usage auto-included |
| Retryable statuses | docs | 429, 502, 503 + network; honor `retry-after` |
| Local VS Code | binary scan 2026-10-15 | 1.141.1 stable (1.142.0 staged), Electron 43.7.7, **host Node v24.21.0** |
| Local toolchain | shell 2026-10-15 | node v22.21.1, npm 10.9.4, git 2.46.0 |
| Live model (default) | gateway 2026-10-15 | `DeepSeek-V4-Flash` — 1M ctx, 20k max out, reasoning:true |
| Live model count | gateway 2026-10-15 | 25 models visible to this account |
| Reasoning wire format | S-4 spike 2026-10-15 | `reasoning-start`/`reasoning-delta`/`reasoning-end` stream parts **when** `providerOptions: { grouter: { reasoningEffort } }` is sent; otherwise reasoning is inline text. Usage: `outputTokenDetails.reasoningTokens` |
| DNS quirk | live 2026-10-15 | IPv6-first resolution hangs on this network → `setDefaultResultOrder("ipv4first")` required in gateway client |
| AI SDK retry | source verify 2026-10-15 | Native retry honors `retry-after`/`retry-after-ms` (0–60s window); our layer only maps final errors to UX |
| Config file | this session | `~/.grouter/config.json` (home-basedir; key + baseUrl + model + maxOutputTokens + reasoning.effort + settings) |
| VSCode Chat Participant API | code.visualstudio.com (docs dated 10/14/2026) | Current; `vscode.chat.createChatParticipant`. Note: `ChatRequest.references` (not `variables`) |
| VSCode LM Tools API | code.visualstudio.com | Current; `contributes.languageModelTools` + `vscode.lm.registerTool` |
| VSCode LM Chat Provider API | code.visualstudio.com | Current; `vscode.lm.registerLanguageModelChatProvider` — can expose gRouter models to VSCode's model picker |
| VSCode MCP in extensions | code.visualstudio.com | `vscode.lm.registerMcpServerDefinitionProvider` + `contributes.mcpServerDefinitionProviders` |
| `@langchain/langgraph` | npm registry | `1.5.0` (stable, dual CJS/ESM, peer `@langchain/core ^1.1.48`, zod ^3.25/^4) |
| `ai` (Vercel AI SDK) | npm registry | `7.0.141` — `engines.node >= 22` ✅ satisfied by host Node 24.21. **Note: `result.stream` (fullStream deprecated); part props: `text`/`delta`** |
| `@ai-sdk/openai-compatible` | npm registry | `3.0.69` (engines node >= 22) |
| `@modelcontextprotocol/sdk` | npm registry | `1.32.1` (engines node >= 18) |

### 1.3 Decision Change Protocol

To change a locked decision: (1) state the decision ID, (2) reason, (3) impact on ROADMAP/STATE, (4) append a new row `D-XX'` marking the superseded ID. Never silently edit history — this file is append-only for §1.

---

## 2. Working Principles

1. **Each phase ends in a shippable increment.** No phase is "infrastructure only" — every phase has a demo.
2. **Vertical slices, not horizontal layers.** Build chat end-to-end (UI→graph→gateway→stream) before adding breadth.
3. **One source of truth per concern:** tools (registry), config (settings schema), state (graph checkpoints), plan artifacts (workspace files).
4. **Fail visibly.** Every gateway/tool error maps to a user-actionable message; never silent retries beyond policy.
5. **Approval before mutation.** Any action that changes files/terminal/git/debug state goes through the approval gate. No exceptions in V1.
6. **Budget-conscious development.** No sub-agents; verify with direct tool calls; keep context lean (write docs, don't re-read them).
7. **Pin versions, record facts.** Every version/API fact goes in §1.2 with date. Docs change; our log doesn't.
8. **Test the seams.** Mock gateway for unit tests; integration tests run against a local mock server (no real API key in CI).

---

## 3. Phase Protocol (per-phase lifecycle)

Every phase follows the same loop. STATE.md tracks each item's status.

```
┌─ 0. DISCUSS ──────────────────────────────────────────────┐
│  Present phase scope + open questions (use `question`).   │
│  Get explicit GO before writing implementation code.      │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌─ 1. PLAN ─────────────────────────────────────────────────┐
│  Update STATE.md: enumerate tasks with IDs (P<phase>-XX). │
│  Identify acceptance test per task.                       │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌─ 2. IMPLEMENT ────────────────────────────────────────────┐
│  Tasks in dependency order. Commit-sized changes.         │
│  Each task: code + test + docs touch if needed.           │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌─ 3. VERIFY ───────────────────────────────────────────────┐
│  - lsp diagnostics clean on changed files                 │
│  - unit/integration tests pass (npm test)                 │
│  - manual demo script executed (Extension Development     │
│    Host, F5)                                              │
└──────────────┬────────────────────────────────────────────┘
               ▼
┌─ 4. GATE ─────────────────────────────────────────────────┐
│  Exit criteria of the phase (ROADMAP §phase) all checked. │
│  Update STATE.md → phase status = DONE.                   │
│  Demo + collect feedback → adjust next phase scope.       │
└───────────────────────────────────────────────────────────┘
```

**Rule:** we do not start Phase N+1 until Phase N's gate passes, *unless* the user explicitly says "parallel" for specific tasks.

---

## 4. Discussion Cadence (how we talk)

- **Before each phase:** one `question` round (2–4 questions max) covering scope/UX choices with 2x+ effort impact. Decisions land in §1.1.
- **During a phase:** questions only for genuine blockers (missing info, conflicting requirements). Otherwise proceed with the documented default.
- **After each phase:** demo summary + metrics (from PRD §9 where applicable) + next-phase preview.
- **Any time:** user can veto/redirect; log outcome in STATE.md decision log.

Open questions currently tracked in [PRD §12](./PRD.md#12-open-questions-to-resolve-via-discussion) (Q-1 … Q-7).

---

## 5. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|---|
| R-1 | ~~**Node version mismatch**: AI SDK 7 needs Node ≥22~~ | — | — | **RESOLVED 2026-10-15**: extension host = Node v24.21.0 (Electron 43.7.7 / VS Code 1.141.1). AI SDK 7 kept | ✅ Closed |
| R-2 | **Tool-call support varies per model** (gateway docs say model-dependent) | Medium | High | Capability probe at model selection; chat-only fallback with notice; document tested models. Gateway exposes `capabilities` per model — use it | 🟡 Active |
| R-3 | ~~**Reasoning content format unknown**~~ | — | — | **RESOLVED 2026-10-15 (S-4)**: gateway emits `reasoning-start/delta/end` parts when `providerOptions: { grouter: { reasoningEffort: "high" } }` is set. Without it, reasoning is inline text. Reasoning UI depends on sending the option | ✅ Closed |
| R-4 | ~~**LangGraph bundling issues**~~ | — | — | **RESOLVED 2026-10-15**: S-3 spike passed — StateGraph + AI SDK run from esbuild CJS bundle (`dist/host-smoke.js`) | ✅ Closed |
| R-5 | **429/quota during development** (shared account limits) | High | Medium | Throttle manual testing; surface quota errors clearly; backoff in client | 🟡 Active |
| R-6 | **Chat API changes** (VSCode moves fast) | Low | Medium | Stable APIs only; abstract behind `ChatViewAdapter`; track release notes monthly. Noted: `ChatRequest.variables` → `references` API rename already handled | 🟡 Active |
| R-7 | **MCP server security** (external agent drives VS Code) | Medium | High | Approval gate mandatory; hard-blocked destructive list; workspace-trust check; document threat model | 🔴 Open |
| R-8 | **Context blowup** (large repos exceed model context) | High | Medium | Token budget manager; ranking (recent files, diagnostics, references); truncation markers. 1M ctx on default model helps | 🟡 Active |
| R-9 | **Scope creep across 4 modes** | High | Medium | Phase gates; PRD §3.2 non-goals enforced; "post-V1" parking lot in STATE.md | 🟡 Active |
| R-10 | **Marketplace review delays / branding** (Q-7) | Low | Low | Prepare listing early in Phase 6; use `vsce package` local installs meanwhile | 🔴 Open |
| R-11 | **Key in home config file** (D-10 change) | Medium | High | `~/.grouter/config.json` is outside workspace (not committed); document permissions guidance; never log key; consider OS keychain post-V1 | 🟡 Active |
| R-12 | **IPv6 resolution hangs** to gateway on some networks | Medium | High | `setDefaultResultOrder("ipv4first")` in `src/llm/gateway.ts` — **do not remove**; verified fix 2026-10-15 | ✅ Mitigated |

---

## 6. Definition of Done (global)

A task is DONE when ALL hold:

- [ ] Code implements the requirement (PRD/STATE task text).
- [ ] `lsp_diagnostics` clean on changed files.
- [ ] Unit test(s) added/updated where logic exists; integration test where a seam exists.
- [ ] `npm test` green locally.
- [ ] Manual check executed in Extension Development Host when UI-affecting.
- [ ] Docs touched if behavior/config changed (README or docs/).
- [ ] STATE.md row updated (status + date + evidence link/note).

A **phase** is DONE when: all its tasks are DONE + phase exit criteria (ROADMAP) checked + demo performed + STATE.md phase status updated.

---

## 7. Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit | Tool implementations, token budgeter, error mapper, config parsing | Vitest (fast, no VSCode dep — pure modules kept VSCode-free) |
| Integration | Graph run against mock gateway; tool loop with fake tools; MCP client against in-process server | Vitest + `@modelcontextprotocol/sdk` in-memory transports + local mock HTTP server |
| Extension smoke | Activation, participant registration, command wiring | `@vscode/test-electron` launching Extension Development Host |
| Manual | Real gateway end-to-end, debug flows, approvals | Documented demo script per phase (STATE.md) |

**Mock gateway**: a tiny local HTTP server implementing `/v1/models`, `/v1/chat/completions` (SSE), error injection (401/403/429/503), and canned tool-call responses. Lives in `test/mock-gateway/`. Never hit the real API in CI.

---

## 8. Repository & Workflow Conventions

```
grouter-vscode/
├─ docs/                    # this documentation set
├─ src/
│  ├─ extension.ts          # activate/deactivate — thin
│  ├─ chat/                 # ChatViewAdapter, participant, slash commands
│  ├─ agent/                # LangGraph graphs, nodes, state, checkpointing
│  ├─ llm/                  # gateway client (AI SDK), error mapping, retries, reasoning adapter
│  ├─ tools/                # ToolSpec registry + builtin/ + vscode/ + adapters (langgraph, lm, mcp)
│  ├─ mcp/
│  │  ├─ client/            # MCP client manager
│  │  └─ server/            # MCP server exposing tools
│  ├─ config/               # settings schema, secret storage, model registry
│  ├─ context/              # context assembly, token budget
│  └─ util/                 # logging, truncation, misc
├─ test/
│  ├─ unit/
│  ├─ integration/
│  └─ mock-gateway/
├─ package.json             # contributions: chatParticipants, languageModelTools, mcpServerDefinitionProviders, commands, config
├─ esbuild.mjs
└─ tsconfig.json            # strict
```

- **Commits**: conventional-ish, imperative, scoped (`chat: stream reasoning deltas`). Never commit unless user asks.
- **Branches**: single main branch unless user requests otherwise.
- **Dependencies**: pinned exact versions for `ai`, `@ai-sdk/*`, `@langchain/*`, `@modelcontextprotocol/sdk` (they move fast; upgrades are explicit tasks).

---

## 9. Parking Lot (post-V1 ideas — do not build now)

- Multi-provider BYO keys (OpenAI/Anthropic/OpenRouter) — D-04 deferred.
- SQLite/workspace-file checkpoint persistence + cross-session resume.
- Custom webview dashboards (agent timeline, token usage charts).
- Inline chat (`editor.inlineChat`) integration.
- `vscode.lm.registerLanguageModelChatProvider` — expose gRouter models to **all** of VSCode (verified feasible; candidate for Phase 6+ since it makes gRouter usable by other extensions).
- Multi-agent (supervisor/swarm) graphs; sub-agent delegation.
- Remote agent execution; team policy/config.
- Notebook support; web (vscode.dev) support.
- Telemetry dashboards; usage/cost forecasting from token credits.

---

## 10. Immediate Next Steps

1. **User review of this doc set** (PRD/PLANNING/ARCHITECTURE/ROADMAP/STATE) — comments → edits.
2. Resolve **Q-3 / R-1** (Node spike) as the very first Phase 0 task — it can invalidate AI SDK choice.
3. Answer remaining PRD §12 questions as phases approach them.
4. Say **"GO Phase 0"** to start implementation.

---

*End of PLANNING v0.1 — append-only decisions log; edit freely elsewhere.*
