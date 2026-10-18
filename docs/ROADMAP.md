# gRouter — ROADMAP

| Field | Value |
|---|---|
| **Document** | ROADMAP v0.1 (Draft for discussion) |
| **Date** | 2026-10-15 |
| **Status** | 🟡 Draft |
| **Related** | [PRD.md](./PRD.md) · [PLANNING.md](./PLANNING.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [STATE.md](./STATE.md) |

> Execution tracking (task-level status, evidence, dates) lives in **STATE.md**. This document defines the phases, deliverables, and exit criteria.

---

> **Status (2026-10-16):** This document predates the gRouter rebrand and the
> 0.3.1 release. The design decisions below carried over unchanged; product
> identifiers, storage paths and the model gateway now use gRouter naming
> (`grouter-code`, `grouter.grouter-code`, `~/.grouter`,
> `https://prod.grouter.web.id/v1`). See [STATE.md](./STATE.md) for current status.

## 1. Phase Map

```
Phase 0 ─ Foundation & Spikes      → de-risked stack, skeleton extension, GO/NO-GO on AI SDK 7
Phase 1 ─ Chat Mode (ask)          → @grouter streams answers + reasoning  ────────► usable
Phase 2 ─ Coding Agent Mode        → multi-file tasks with approvals      ────────► usable
Phase 3 ─ Planning Mode            → durable plans + step execution       ────────► usable
Phase 4 ─ Debug Mode               → real debugger & test state           ────────► usable
Phase 5 ─ MCP (client + server)    → ecosystem in + out                    ────────► usable
Phase 6 ─ Hardening & Release      → marketplace-ready V1.0
```

**Order is locked** (D-03): Chat → Agent → Plan → Debug, then MCP, then release hardening. MCP is Phase 5 because its value depends on the tool registry (Phase 2) being complete.

**Cadence:** each phase = discuss → plan (STATE.md) → implement → verify → gate → demo. See PLANNING §3.

---

## 2. Phase 0 — Foundation & Spikes

**Goal:** Eliminate the unknowns that could invalidate the architecture, and stand up the extension skeleton.

### Deliverables
- Repo scaffold: TypeScript strict, esbuild, ESLint/Prettier, Vitest, `@vscode/test-electron` wiring.
- Extension skeleton: activates, registers a **placeholder** `@grouter` participant that echoes a canned streamed response.
- **Spike S-1**: extension-host Node version check (GO/NO-GO for AI SDK 7; fallback AI SDK 6).
- **Spike S-3**: bundle LangGraph 1.5 + AI SDK 7 with esbuild, load in Extension Development Host, run a trivial graph.
- Mock gateway server (`test/mock-gateway/`): `/v1/models`, `/v1/chat/completions` SSE, error injection.
- Gateway smoke test against the **real** endpoint (manual, user's key): `/models` + one streamed completion.
- **Spike S-4** (if key available): confirm reasoning content shape from a real reasoning-capable model.

### Exit Criteria
- [ ] `F5` launches Extension Development Host; `@grouter` responds with streamed text.
- [ ] Node version question resolved and recorded in PLANNING §1.2 (AI SDK 7 kept **or** downgraded).
- [ ] LangGraph trivial graph runs inside extension host (no module errors).
- [ ] Mock gateway passes smoke tests in CI.
- [ ] Decision recorded: prebuilt `createAgent` vs custom StateGraph (for Phase 2 planning).

### Demo
Placeholder chat streaming + `npm test` green + bundle report.

---

## 3. Phase 1 — Chat Mode (`/ask`)

**Goal:** A genuinely useful read-only assistant with reasoning display and robust gateway handling.

### Deliverables
- `GatewayClient` complete: streaming, retries (429/502/503 + network, honor `retry-after`), full error mapping table (ARCHITECTURE §3.3).
- `AiSdkChatModel` bridge (or documented fallback per spike) wired to the ask graph.
- Model picker: `GET /v1/models` → QuickPick + status bar; `grouter.model` persisted; per-model token limits in registry.
- Auth UX: first-run key prompt, `SecretStorage`, "Test connection" command, `401/403` actionable errors.
- Context assembly v1: active file + selection, `#file` variables, diagnostics summary, token budget + omission notes.
- Reasoning display: collapsible thinking block; toggle setting `grouter.reasoning.show`.
- Response polish: references list, code-block Apply/Insert/Copy buttons, cancellation, follow-up suggestions (basic).
- `/ask` command + default routing; `/help`.
- Output channel + diagnostics command.

### Exit Criteria
- [ ] US-1 and US-2 acceptance criteria pass (PRD §6).
- [ ] Error matrix demo: 401, 403, 404, 429 (auto-retry + message), 502/503 behavior verifiable via mock gateway.
- [ ] Cancellation mid-stream leaves partial content and clean state.
- [ ] First-token p50 < 2s on real gateway (informal measurement, documented).
- [ ] ≥ 15 unit/integration tests green.

### Demo
Full first-run experience: install → key → model pick → streamed answer with thinking → cancel/retry.

---

## 4. Phase 2 — Coding Agent Mode (`/agent`)

**Goal:** Autonomous multi-step coding with the full tool registry and safe approvals.

### Deliverables
- `ToolRegistry` + `ToolSpec` framework + truncation policy.
- Builtin tools: `read_file`, `list_dir`, `search_text`, `search_symbols`, `get_diagnostics`, `get_open_editors`, `get_selection`, `get_workspace_tree`, `write_file`, `apply_patch`, `run_command`, `git_status`, `git_diff`.
- `ApprovalGate`: policy (readOnly/destructive/autoApprove/trust), surfaces (LM tool confirmation + modal), session allow-list, hard-blocked destructive list.
- `agentGraph`: assemble → model ⇄ tools → summarize, bounded iterations, checkpointing (MemorySaver), single-flight concurrency guard.
- VS Code LM Tools adapter: registry → `contributes.languageModelTools` codegen + `vscode.lm.registerTool` runtime; `prepareInvocation` confirmations.
- Terminal integration: shell-integration capture (spike S-6 fallback ready), exact-command confirmations, timeouts.
- Change summary: per-file diff list, test command results; `WorkspaceEdit` atomic undo verified.
- Agent settings: `grouter.agent.maxIterations`, `grouter.agent.autoApprove`, `grouter.tools.truncateKB`.

### Exit Criteria
- [ ] US-3 and US-8 acceptance criteria pass.
- [ ] Multi-file rename+test demo completes with ≤ 5 approvals using "always allow".
- [ ] Denied tool → model adapts (continues or reports blocker); no hang.
- [ ] Untrusted workspace: all mutating tools disabled; chat still works.
- [ ] Path-escape attempts rejected (test).
- [ ] Hard-blocked destructive commands cannot be auto-approved (test).
- [ ] ≥ 30 total tests green; diagnostics clean.

### Demo
"Rename symbol across repo + fix tests" end-to-end, including one denied approval and one failed test iteration.

---

## 5. Phase 3 — Planning Mode (`/plan`)

**Goal:** Durable, reviewable plans that execute step-by-step with human-in-the-loop control.

### Deliverables
- Plan artifact format + writer/parser (`.grouter/plans/<slug>.md`): ordered steps, objective, files, verification, status.
- `planGraph`: structured-output plan generation (zod) → review interrupt → execute loop with per-step approval → write-back.
- `interrupt()/Command` resume wired to Chat UI (approve / approve-all / edit / skip / abort).
- Plan rendering: checkbox markdown in chat; "Open plan file" button; re-run/edit guidance.
- Resume: interrupted execution continues from last completed step (checkpointer + plan file as durable state).
- Resolve PRD Q-1 (plans dir) at phase start.

### Exit Criteria
- [ ] US-5 acceptance criteria pass.
- [ ] Plan survives window reload; `/plan execute` resumes from last completed step.
- [ ] Editing the plan file manually and re-running respects edits.
- [ ] "Approve all" path works with a bounded demo plan (3+ steps).
- [ ] Tests: plan parse/write roundtrip, interrupt/resume integration with mock gateway.

### Demo
"Plan add OAuth login" → review → execute 3 steps with one manual edit mid-flight → completion summary.

---

## 6. Phase 4 — Debug Mode (`/debug`)

**Goal:** Real debugging assistance grounded in actual runtime state, not guesses.

### Deliverables
- `get_debug_state` tool: active session, threads, stack, scopes, variables (DAP via `customRequest`; spike S-7 payload map).
- Breakpoint tools: list/set/remove (`vscode.debug.addBreakpoints` / `removeBreakpoints`), launch config picker + `startDebugging` on approval.
- `run_tests` tool: Test API (`tests.getTestItems`, results) + task fallback; output parsing helpers.
- `debugGraph`: collect (tests + debug state) → model ⇄ debug tools → explain + propose fix diff.
- Failure explainer UX: file:line references, root-cause statement, proposed patch button.
- Safety: no debug mutation without approval; expression evaluation gated by confirmation (V1: read-only evaluation only, documented).
- Debug-context section in context assembler (only when a session is active/stopped).

### Exit Criteria
- [ ] US-4 acceptance criteria pass.
- [ ] Demo: failing test → run → breakpoint → stopped-state read → explanation + patch.
- [ ] No debug mutation without explicit confirmation (test via mocked debug API facade).
- [ ] Debug tools absent/no-op when no session & no test framework (graceful message).
- [ ] Tests: DAP payload mappers, test-output parsers.

### Demo
Live debugging walkthrough on a sample bug in the test workspace.

---

## 7. Phase 5 — MCP (Client + Server)

**Goal:** gRouter both consumes the MCP ecosystem and becomes a first-class MCP server for VS Code.

### Deliverables
- **Client:** config discovery (`.vscode/mcp.json`, user profile, `grouter.mcp.servers`), stdio + Streamable HTTP transports, lifecycle/health/restart, tool namespacing, `readOnlyHint` handling, dynamic tool updates, auth prompt flow.
- **Server:** stdio MCP server exposing registry tools; `gRouter: Start MCP Server` command + CLI entry (`dist/mcp-server.js --stdio`); approval gate routes mutating calls to VS Code modal; denial → MCP error; setup docs for external clients (Claude Code etc.).
- Optional: `vscode.lm.registerMcpServerDefinitionProvider` registration so VS Code itself can consume the gRouter MCP server (resolve Q-4: expose workspace tools; VS Code-specific tools (debug/diagnostics) = decide).
- Resources/prompts: list + attach as context (P1); prompt→slash commands (P2).
- Threat-model doc update (external driver surface).

### Exit Criteria
- [ ] US-6 and US-7 acceptance criteria pass.
- [ ] ≥ 3 real external MCP servers consumed successfully (documented list).
- [ ] External MCP client (e.g. Claude Code) performs a file edit through gRouter server with approval; denial path verified.
- [ ] Server crash/restart of a client-side MCP server doesn't break chat.
- [ ] Tests: in-process MCP roundtrip (client↔server), namespacing collisions.

### Demo
Two-terminal demo: Claude Code (or generic client) edits a file in VS Code through gRouter's MCP server, with approval modal; plus chat using an external MCP tool.

---

## 8. Phase 6 — Hardening & Release (V1.0)

**Goal:** Marketplace-quality release.

### Deliverables
- Performance pass: activation < 300ms, lazy graph imports, bundle < 5MB, memory steady-state check.
- Security review: secrets, trust, path confinement, destructive list, MCP threat model; fix findings.
- Full test matrix: Win/macOS/Linux × VS Code stable; manual QA script.
- Docs: README, setup guide, MCP setup, troubleshooting, model compatibility notes (tested models table).
- Marketplace assets: icon, banner, description, changelog, `vsce package` → VSIX; publisher setup (Q-7).
- Release criteria audit (PRD §11) + go/no-go.

### Exit Criteria
- [ ] PRD §11 release criteria all checked.
- [ ] No P0/P1 security findings open.
- [ ] VSIX installs and passes smoke on clean profile on all three OSes.
- [ ] Changelog + version tagged.

### Demo
Clean-machine install from VSIX → full feature tour.

---

## 9. Milestones & Dependencies

```
P0 ──► P1 ──► P2 ──► P3 ──► P4 ──► P5 ──► P6
 │      │      │      │      │      │
 │      │      │      │      │      └─ depends on ToolRegistry (P2) for server exposure
 │      │      │      │      └─ depends on agent tool loop (P2)
 │      │      │      └─ depends on graph interrupts (P1/P2 infra)
 │      │      └─ depends on GatewayClient (P1)
 │      └─ depends on spikes S-1/S-3/S-4 (P0)
 └─ de-risks everything (S-1 can change AI SDK choice)
```

**Hard dependencies:** none cross-phase beyond the chain above. **Soft:** reasoning display (P1) reused by all modes; approval gate (P2) reused by P3/P5.

---

## 10. Post-V1 Backlog (parking lot → PLANNING §9)

| Idea | Value | Est. phase |
|---|---|---|
| Multi-provider BYO keys | Wider audience | V1.x |
| Checkpoint persistence (sqlite/file) | Cross-session resume | V1.x |
| `registerLanguageModelChatProvider` (gRouter models in VS Code picker for ALL extensions) | Strategic platform play | V1.x |
| Custom webview dashboards (timeline, usage) | Power-user UX | V2 |
| Multi-agent graphs (supervisor/swarm) | Complex tasks | V2 |
| Inline chat integration | Flow | V2 |
| Remote/cloud agent execution | Scale | V3 |
| Team/enterprise config | B2B | V3 |

---

## 11. Timeline Guidance (effort, not dates)

| Phase | Relative effort | Notes |
|---|---|---|
| P0 | S | Mostly verification + scaffold |
| P1 | M | Gateway client + UI polish is the bulk |
| P2 | L | Largest phase: tools + approvals + LM Tools adapter |
| P3 | M | Interrupt/resume plumbing |
| P4 | M–L | DAP payloads are fiddly |
| P5 | L | Two directions + lifecycle management |
| P6 | M | Mostly process, testing, docs |

> No calendar dates until Phase 0 completes and effort is calibrated against the first real increments (per PLANNING §3 gate discipline).

---

*End of ROADMAP v0.1 — see STATE.md for the live task checklists per phase.*
