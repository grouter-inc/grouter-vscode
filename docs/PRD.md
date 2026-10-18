# gRouter — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| **Product** | gRouter — AI Coding, Debugging & Planning Assistant for VS Code |
| **Document** | PRD v0.1 (Draft for discussion) |
| **Date** | 2026-10-15 |
| **Status** | 🟡 Draft — awaiting review |
| **Owner** | TBD |
| **Related docs** | [PLANNING.md](./PLANNING.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md) · [STATE.md](./STATE.md) |
| **Upstream API** | gRouter Gateway — https://prod.grouter.web.id |

---

> **Status (2026-10-16):** This document predates the gRouter rebrand and the
> 0.3.1 release. The design decisions below carried over unchanged; product
> identifiers, storage paths and the model gateway now use gRouter naming
> (`grouter-code`, `grouter.grouter-code`, `~/.grouter`,
> `https://prod.grouter.web.id/v1`). See [STATE.md](./STATE.md) for current status.

## 1. Summary

gRouter is a VS Code extension that brings an AI **coding, debugging, and planning** assistant directly into the editor. It is powered by the **gRouter model gateway** (OpenAI-compatible, `https://prod.grouter.web.id/v1`) and combines:

- **LangChain / LangGraph** for agent orchestration (plan → act → observe → verify loops, human-in-the-loop interrupts, checkpointed sessions),
- **Vercel AI SDK** as the LLM transport layer to the gateway,
- **Built-in tools** (filesystem, search, terminal, git) and **VS Code tools** (diagnostics, editor state, workspace symbols, debug session),
- **MCP** in both directions: gRouter **consumes** external MCP servers as a client, and **exposes** its tools as an MCP server so external agents (Claude Code, Cursor, etc.) can drive VS Code through gRouter,
- **Reasoning/thinking display** surfaced natively in the Chat view,
- **Per-phase delivery**: every phase produces a usable product increment (see ROADMAP.md).

The user experience lives primarily in the **native VS Code Chat view** via the Chat Participant API (`@grouter`), keeping full compatibility with VS Code's tool confirmation UX, model picker, and future platform features.

---

## 2. Problem Statement

Developers using VS Code + Copilot-style assistants face these gaps:

1. **Model lock-in.** Native chat works with a fixed model set; developers who use a gateway (like gRouter) cannot plug their own models into the editor experience.
2. **Shallow agentic loops.** Simple prompt→answer flows fail at multi-step tasks: refactors across files, running tests, reading failures, fixing, re-running.
3. **No real debugging assistance.** Assistants rarely read actual debugger state (breakpoints, stack, variables) or launch debug sessions to reproduce a bug.
4. **Plans live outside the editor.** Multi-step work is not tracked as durable, resumable artifacts inside the workspace.
5. **Tooling silos.** Tools built for one agent (MCP servers) are not reusable across editors and agents.

---

## 3. Goals & Non-Goals

### 3.1 Goals (V1)

| # | Goal | Measure |
|---|---|---|
| G1 | Native chat with gRouter models, streaming, in Chat view | `@grouter` responds with streamed markdown; first token < 2s on p50 |
| G2 | Agentic coding loop with tools + approvals | Multi-file edit task completed end-to-end from one prompt with user-visible tool steps |
| G3 | Debug assistance using real debug state | Agent can read stop-state (stack, scopes, variables) and explain/fix a bug |
| G4 | Planning mode producing durable, editable plans | Plan file created in workspace; agent executes plan step-by-step with progress |
| G5 | MCP client | ≥ 3 external MCP servers consumable (stdio + HTTP), tools listed in chat |
| G6 | MCP server | gRouter tools callable from an external MCP client (e.g. Claude Code) against the open workspace |
| G7 | Reasoning display | Model reasoning/thinking visible in collapsible UI when model returns it |
| G8 | Zero-config start | User pastes gRouter API key once (`grx_...`); model list fetched from `GET /v1/models` |

### 3.2 Non-Goals (V1)

- ❌ Being a general-purpose chatbot outside coding/debugging/planning workflows.
- ❌ Supporting non-gRouter providers (BYO keys to other vendors) — **deferred, see PRD §12**.
- ❌ Fine-tuning, training, or hosting models.
- ❌ Team/enterprise admin features (SSO, policy, shared config) — post-V1.
- ❌ Remote/cloud agent execution (agent runs in the extension host only) — post-V1.
- ❌ Mobile/web VS Code (vscode.dev) support in V1 — desktop only (web worker constraints; revisit later).

---

## 4. Target Users & Personas

| Persona | Description | Key needs |
|---|---|---|
| **P1 — gRouter Subscriber Dev** | Developer already using gRouter gateway (e.g. via OpenClaw/Hermes) | Use same subscription/models inside VS Code; single key; usage visibility |
| **P2 — Agentic Power User** | Uses agent mode daily (Copilot/Cursor/Claude Code) | Multi-step tasks, plan approval, checkpoint/resume, MCP extensibility |
| **P3 — Debugging-Focused Dev** | Spends time in breakpoints, test failures, stack traces | "Why did this fail?" with real runtime context; assisted reproduction |
| **P4 — Planner / Tech Lead** | Breaks down features before coding | Durable plan artifacts, reviewable diffs of plans, progress tracking |

---

## 5. Product Modes

gRouter ships **four modes**, mapped to Chat view slash commands and (later) VS Code custom agents. All modes share one agent runtime; they differ in system prompt, tool policy, and UX affordances.

### 5.1 Chat mode — `/ask` (default)
- Q&A about the codebase with workspace context (`#file`, `#selection`, `#problems`).
- Streaming markdown, code blocks with *Apply* action, references list.
- No autonomous edits. Read-only tools only.

### 5.2 Coding Agent mode — `/agent`
- Task-oriented autonomous loop: inspect → edit → run → observe → fix.
- Tools: file read/write/patch, search, terminal, git status/diff, diagnostics.
- **Approval policy**: every mutating action (file write, terminal command, git op) requires confirmation by default; "Always allow" per tool; `autoApprove` list in settings.
- Produces a change summary with per-file diffs; integrates with VS Code undo/redo via `WorkspaceEdit`.

### 5.3 Planning mode — `/plan`
- Turns a goal into a **structured plan artifact** (`.grouter/plans/<slug>.md`) with ordered steps, each having: objective, files touched, verification command, status.
- Human-in-the-loop: plan review + step-by-step approval before execution (`interrupt()`).
- `/plan execute` runs the plan; progress is written back into the artifact (durable across sessions via checkpointer).

### 5.4 Debug mode — `/debug`
- Reads real debug state via `vscode.debug` + DAP: active session, threads, stack frames, scopes, variables, breakpoints.
- Can **launch** configured debug sessions (`vscode.debug.startDebugging`) to reproduce, set/remove breakpoints (`vscode.debug.addBreakpoints`), and read stopped-state on `onDidStopDebugging`/`onDidReceiveDebugSessionCustomEvent`.
- Interprets test failures: runs test task, reads terminal output + Test API results, proposes fixes.
- Never mutates debug state (no `setVariable`, no `evaluate` with side effects in V1) without explicit approval; evaluation expressions are gated by confirmation.

### 5.5 Persistence mode — `/ralph`

- Wraps the `/agent` loop in an outer `work → verify → feed failure back` cycle.
- Verification is **host-owned**: the loop runs the test suite / typecheck itself, so the
  agent cannot self-certify.
- Stop reasons are explicit and only one of them means success:
  `verified | max-iterations | no-progress | canceled | aborted`.
- A `no-progress` stop (identical failure signature repeated `stallLimit` times) exists to
  stop burning tokens on a loop that is not converging.
- Bounded by `grouter.ralph.maxIterations` (default 5) and `grouter.ralph.stallLimit` (default 2).

### 5.6 Verify gate — cross-cutting (all mutating modes)

- Before a mutating turn closes, the assistant text is scanned for a completion claim.
- On a claim, real evidence is collected: test suite, typecheck, `git diff --stat`.
- **Red evidence rejects the claim**: the turn is recorded as `unverified`, the failing
  command and its output are quoted, and a corrective instruction is queued for the model.
- No runnable check ⇒ also `unverified` (an unprovable claim is not an accepted claim).
- Negated / hedged / interrogative sentences are not treated as claims.
- Read-only modes (`ask`, `skills`, `mcp`, `help`) are never gated.

---

## 6. User Stories & Acceptance Criteria

### US-1 — First-run setup (G8)
> As P1, I install gRouter, paste my `gRouter-` key, and chat within 60 seconds.

**Acceptance**
- [ ] On first `@grouter` use, if no key: prompt for API key; store in `vscode.SecretStorage` (never settings/plaintext).
- [ ] `GET /v1/models` called with key; model picker populated with account-visible models.
- [ ] Invalid key (`401 invalid_api_key`) → clear error telling the user to check the key from the [Telegram bot](https://t.me/grouteerbot) and open https://prod.grouter.web.id/check-usage.
- [ ] `403 model_not_allowed` → message explains plan restriction and offers model switch.

### US-2 — Streaming chat with reasoning (G1, G7)
> As P1, I ask a question and see the answer stream, with thinking shown when available.

**Acceptance**
- [ ] Text streams incrementally into Chat view (markdown).
- [ ] When model returns reasoning content, it renders in a collapsed "Thinking…" section (expanded while streaming, auto-collapsed when done; toggle persists per session).
- [ ] Citations/references (files read) listed under the response.
- [ ] Cancel button stops generation; partial content retained.
- [ ] `429 rate_limit_exceeded` → auto-retry honoring `retry-after` (bounded), then clear message.

### US-3 — Multi-file coding task (G2)
> As P2, I ask "rename `getUser` to `fetchUser` across the repo and fix tests", and approve the steps.

**Acceptance**
- [ ] Agent produces tool steps: search → patch files → run tests → report.
- [ ] Each mutating tool call shows a confirmation with parameters (editable where possible per VS Code UX).
- [ ] "Always allow" suppresses future prompts for that tool (session-scoped default; optional global setting).
- [ ] Diffs applied via `WorkspaceEdit`; `Ctrl+Z` reverts the whole edit atomically.
- [ ] Final summary lists files changed + test result.
- [ ] If tests fail, agent loops (bounded, e.g. `maxIterations`) and reports blocker instead of hanging.

### US-4 — Debug a failing test (G3)
> As P3, I say "the test `auth.spec.ts > rejects expired token` fails — find out why".

**Acceptance**
- [ ] Agent runs the test (task/terminal), reads output and Test API results.
- [ ] If configured, launches debug session for the test; on stop, reads stack/variables and correlates with source.
- [ ] Response explains root cause with file:line references; proposes a fix as a diff.
- [ ] No debug mutation without approval; expression evaluation requires confirmation.

### US-5 — Plan a feature (G4)
> As P4, I say "plan how to add OAuth login", review the plan, then execute it.

**Acceptance**
- [ ] `/plan` generates `.grouter/plans/add-oauth-login.md` with structured steps (objective, files, verification).
- [ ] Plan rendered in chat with per-step checkboxes; user can edit the file and re-run.
- [ ] `/plan execute` asks approval per step (or per phase if "approve all" chosen).
- [ ] Progress written back to the plan file; resuming after reload continues from last completed step (checkpointed).

### US-6 — MCP client (G5)
> As P2, I add my database MCP server in `.vscode/mcp.json`; `@grouter` can use its tools.

**Acceptance**
- [ ] Stdio and Streamable HTTP transports supported; OAuth-protected servers surface an auth prompt.
- [ ] Tools appear in tool picker; read-only tools (`readOnlyHint`) skip confirmation.
- [ ] A server crash/restart doesn't break the chat; errors are reported per-tool.

### US-7 — MCP server (G6)
> As P2, I run Claude Code in my terminal and it drives VS Code via gRouter's MCP server.

**Acceptance**
- [ ] `grouter mcp serve` (or a VS Code command) starts a stdio MCP server exposing gRouter tools (read/edit/terminal/diagnostics) bound to the open workspace.
- [ ] Mutating tools require approval in VS Code UI before executing.
- [ ] Documented setup snippet for a generic MCP client.

### US-8 — Tool approval & safety (G2, cross-cutting)
> As any user, I am never surprised by an autonomous action.

**Acceptance**
- [ ] Destructive tools (delete file, `git reset`, force push detection) always require explicit confirmation, even with "Always allow" — hard-blocked list.
- [ ] Workspace Trust: in untrusted workspaces, all mutating tools disabled; extension still answers read-only questions.
- [ ] Terminal commands show the exact command string in the confirmation.

---

## 7. Functional Requirements

### FR-1 Configuration & Auth
| ID | Requirement | Priority |
|---|---|---|
| FR-1.1 | API key stored in `SecretStorage` (`grouter.apiKey`); never logged | P0 |
| FR-1.2 | Base URL setting `grouter.baseUrl` default `https://prod.grouter.web.id/v1` (override for self-host/testing) | P0 |
| FR-1.3 | Model picker from `GET /v1/models` (id, display_name, context_window, max_output_tokens) | P0 |
| FR-1.4 | Settings: model default, temperature, max tokens, approval policy, max agent iterations, MCP servers on/off | P0 |
| FR-1.5 | "Test connection" command with result toast | P1 |

### FR-2 LLM Gateway Client
| ID | Requirement | Priority |
|---|---|---|
| FR-2.1 | Use Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) for all gateway calls | P0 |
| FR-2.2 | SSE streaming with abort support | P0 |
| FR-2.3 | Map gateway errors (`invalid_api_key`, `model_not_allowed`, `model_not_found`, `rate_limit_exceeded`, `concurrency_limit_exceeded`, `insufficient_quota`, `upstream_error`, `circuit_open`) to actionable UI messages | P0 |
| FR-2.4 | Retry with exponential backoff + jitter for 429/502/503/network; honor `retry-after` | P0 |
| FR-2.5 | Surface `x-ratelimit-remaining`/`reset` in status bar (lightweight) | P2 |
| FR-2.6 | Reasoning/thinking extraction from gateway deltas when model supports it | P0 |
| FR-2.7 | Optional `/responses` endpoint usage behind a flag (gateway supports it; keep chat/completions as default for widest tool-call compatibility) | P2 |

### FR-3 Agent Runtime (LangGraph)
| ID | Requirement | Priority |
|---|---|---|
| FR-3.1 | Agent graph: `model → tools → model …` with bounded iterations, per mode | P0 |
| FR-3.2 | State checkpointing per chat session (memory in V1; SQLite/workspace-file persistence post-V1) | P1 |
| FR-3.3 | Human-in-the-loop interrupts for plan steps and mutating tools | P0 |
| FR-3.4 | Streaming of: tokens, reasoning, tool start/end, progress notes → ChatResponseStream | P0 |
| FR-3.5 | Context assembly: active file/selection, `#`-referenced files, diagnostics, workspace tree (bounded by token budget) | P0 |
| FR-3.6 | Structured output (zod) for plan generation and tool-args repair | P0 |
| FR-3.7 | Cancellation propagates to HTTP abort + graph stop | P0 |

### FR-4 Tools
| ID | Requirement | Priority |
|---|---|---|
| FR-4.1 | Built-in tools: `read_file`, `list_dir`, `search_text`, `search_symbols`, `write_file`, `apply_patch`, `run_command`, `git_status`, `git_diff` | P0 |
| FR-4.2 | VS Code tools: `get_diagnostics`, `get_open_editors`, `get_selection`, `get_workspace_tree`, `get_terminal_output`, `get_debug_state`, `run_tests` | P0 (debug/tests: Phase 4) |
| FR-4.3 | Every mutating tool: approval UX + `readOnlyHint` classification | P0 |
| FR-4.4 | Tool results truncated by policy (bytes/lines) with explicit truncation markers | P0 |
| FR-4.5 | Same tool implementations serve: (a) LangGraph agent, (b) `vscode.lm.registerTool` (LM Tools API), (c) MCP server | P0 |

### FR-5 MCP Client
| ID | Requirement | Priority |
|---|---|---|
| FR-5.1 | Read servers from VS Code's MCP config (`.vscode/mcp.json` + user config) and/or own `grouter.mcp.servers` setting | P0 |
| FR-5.2 | Transports: stdio, Streamable HTTP (SSE legacy best-effort) | P0 |
| FR-5.3 | Tool discovery (incl. dynamic updates), namespacing (`serverName_toolName`) to avoid collisions | P0 |
| FR-5.4 | Approvals: `readOnlyHint` respected; others confirmed | P0 |
| FR-5.5 | Resources & prompts: list/attach as context (P1), slash commands from prompts (P2) | P1/P2 |

### FR-6 MCP Server
| ID | Requirement | Priority |
|---|---|---|
| FR-6.1 | Expose gRouter tools over stdio MCP server bound to the workspace | P0 |
| FR-6.2 | Mutating calls routed to VS Code UI for approval; denial returns MCP error to caller | P0 |
| FR-6.3 | Server startable via command palette and CLI (`grouter mcp serve --stdio`) | P0 |
| FR-6.4 | Tool schemas = single source of truth shared with FR-4 | P0 |

### FR-7 Chat UX
| ID | Requirement | Priority |
|---|---|---|
| FR-7.1 | Participant `@grouter` with commands: `/ask`, `/agent`, `/plan`, `/debug`, `/help` | P0 |
| FR-7.2 | Follow-up suggestions after each response | P1 |
| FR-7.3 | Apply-code buttons on code blocks; "Insert", "Copy", "New file" | P0 |
| FR-7.4 | Progress lines for long tool runs | P0 |
| FR-7.5 | Participant detection (disambiguation) so plain questions can route to `@grouter` | P2 |

### FR-8 Logging & Diagnostics
| ID | Requirement | Priority |
|---|---|---|
| FR-8.1 | Output channel `gRouter` with levels; request/tool spans (no prompt content by default) | P0 |
| FR-8.2 | `/grouter: Show diagnostics` command: version, model, endpoint reachability, last errors | P1 |
| FR-8.3 | Optional redacted trace file for bug reports | P2 |

### FR-9 Verification Gate

| ID | Requirement |
|---|---|
| FR-9.1 | Detect completion claims in assistant output, ignoring negated, hedged and interrogative phrasing |
| FR-9.2 | Collect evidence by running the project's real test suite, typecheck and `git diff --stat`; judge by exit code only |
| FR-9.3 | Reject a claim when any evidence is red: mark the turn `unverified` and surface the failing command + output |
| FR-9.4 | Treat "nothing to verify" as unverified, not as success |
| FR-9.5 | Never gate read-only modes |
| FR-9.6 | Expose manual verification as a command and as the `verify_work` tool |
| FR-9.7 | Bound cost: per-command timeout (`grouter.verify.timeoutSeconds`), configurable commands, disable switch |

### FR-10 Persistence Loop (`/ralph`)

| ID | Requirement |
|---|---|
| FR-10.1 | Loop work → verify → feed the failure into the next iteration |
| FR-10.2 | Evidence collected by the loop, never by the agent |
| FR-10.3 | Only a green report may yield `verified`; every other exit is `verified = false` |
| FR-10.4 | Stop on iteration budget, repeated identical failure, user cancel, or agent error |
| FR-10.5 | Render a per-iteration table with the honest final status |

---

## 8. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | First streamed token p50 < 2s (network aside); extension activation < 300ms; no blocking work on activation |
| NFR-2 | Memory | Agent runtime + graph state < 150MB steady-state for typical sessions; tool outputs truncated aggressively |
| NFR-3 | Reliability | Gateway retries per FR-2.4; agent loops bounded; no unhandled promise rejections; session survives reload (P1) |
| NFR-4 | Security | Key in SecretStorage; no telemetry of code/prompts by default; all mutating tools gated; Workspace Trust respected; terminal commands never auto-run in untrusted workspaces |
| NFR-5 | Privacy | Only data sent to gateway is what the task requires (explicit context assembly); user-visible "context used" list per request |
| NFR-6 | Compatibility | VS Code ≥ 1.106 (engine bump during Phase 0 to the current stable at build time); Node runtime as provided by VS Code (do **not** depend on Node ≥22-only features without guard — AI SDK 7 requires Node ≥22, verify extension host) |
| NFR-7 | Accessibility | All interactions keyboard-navigable; respects `chat` view defaults; no custom webview needed for core flows |
| NFR-8 | Localization | All user-facing strings via `vscode.l10n`; ship `en` first |
| NFR-9 | Maintainability | TypeScript strict; ESLint + Prettier; unit + integration tests; esbuild bundling; single tool-registry source of truth |

---

## 9. Success Metrics (V1)

| Metric | Target |
|---|---|
| Setup completion rate (install → first successful response) | > 80% |
| Agent task completion (multi-file task w/o manual retry) | > 60% on internal benchmark suite |
| Tool-approval friction | Median approvals per typical task ≤ 5 (with "always allow") |
| Crash-free sessions | > 99% |
| Chat feedback (`Unhelpful` ratio) | < 15% |

Instrumentation: local counters + `onDidReceiveFeedback` telemetry (opt-in), never prompt contents.

---

## 10. Constraints & Dependencies

| Constraint | Impact |
|---|---|
| gRouter gateway is OpenAI-compatible but tool-call support is model-dependent (docs: "Dukungan bergantung pada model") | Model capability registry needed; degrade gracefully (no tools → chat-only mode with notice) |
| `max_output_tokens` / context per model from `GET /v1/models` | Token budgeting must be dynamic per model |
| Rate limits per plan (per-minute, concurrency, quota, token credits) | Backoff + user messaging; concurrency guard (single in-flight agent run by default) |
| VS Code Chat API stability | Prefer stable APIs; avoid proposed APIs in V1; track `enabledApiProposals` only if unavoidable |
| Node runtime in extension host | AI SDK 7 needs Node ≥22 — **must verify against current VS Code extension host**; fallback: pin AI SDK 6.x if needed (see PLANNING.md Q-3) |
| LangGraph 1.5 ESM/CJS dual package | Bundle with esbuild; mark `vscode` external; test CJS require path |

---

## 11. Release Criteria (V1.0)

- [ ] All P0 requirements implemented and demoed.
- [ ] US-1 … US-8 acceptance criteria pass.
- [ ] ≥ 30 automated tests (unit + integration incl. mock gateway).
- [ ] Security review: SecretStorage, trust, tool gating, terminal policy.
- [ ] Docs: README, setup guide, MCP server setup, troubleshooting.
- [ ] Marketplace listing (icon, description, changelog) + VSIX artifact.
- [ ] Manual QA matrix: Win/macOS/Linux × VS Code stable.

---

## 12. Open Questions (to resolve via discussion)

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q-1 | Should `/plan` artifacts default to `.grouter/plans/` (committed) or `.vscode/`? | Product | Phase 3 |
| Q-2 | "Always allow" scope default: session vs workspace vs global? | Product/UX | Phase 2 |
| Q-3 | Node ≥22 availability in target VS Code versions — pin AI SDK 6 if not | Eng | Phase 0 |
| Q-4 | Should MCP server expose *VS Code* tools (diagnostics, debug state) or only workspace tools? | Product | Phase 5 |
| Q-5 | Reasoning display: does the gateway return `reasoning_content` consistently? Verify with real models | Eng | Phase 1 |
| Q-6 | Telemetry: opt-in or none at all in V1? | Product | Phase 1 |
| Q-7 | Naming/branding: extension ID (`grouter.grouter-code`?), publisher account | Product | Phase 0 |

---

## 13. Appendix — Gateway Quick Reference

```
Base URL: https://prod.grouter.web.id/v1
Auth:     Authorization: Bearer gRouter-...
Endpoints: GET /models · POST /chat/completions · POST /responses · POST /embeddings
Streaming: SSE, ends with data: [DONE]; usage chunk auto-included
Headers:  x-ratelimit-remaining · x-ratelimit-reset · retry-after (on 429)
Key errors: 401 invalid_api_key · 403 model_not_allowed · 404 model_not_found ·
            429 rate_limit_exceeded / concurrency_limit_exceeded / insufficient_quota ·
            502 upstream_error · 503 circuit_open
Limits:   per-minute requests, concurrency, per-period quota, token credits (per plan)
```

---

*End of PRD v0.1 — comments welcome; see PLANNING.md for how we will iterate per phase.*
