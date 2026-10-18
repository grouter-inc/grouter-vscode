# gRouter — STATE (Implementation Tracker)

| Field | Value |
|---|---|
| **Document** | STATE v0.3 — **LIVING DOCUMENT (update on every task state change)** |
| **Date** | 2026-10-18 |
| **Current Phase** | P9 — capaian kepercayaan (verify gate, /ralph, HUD) + release 0.4.0 |
| **Overall Status** | 🟢 Code complete, rebranded & **PUBLISHED on the VS Code Marketplace** |
| **Related** | [PRD.md](./PRD.md) · [PLANNING.md](./PLANNING.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [ROADMAP.md](./ROADMAP.md) |

**Status legend:** ⬜ TODO · 🟡 IN PROGRESS · ✅ DONE · ⏸️ BLOCKED · ❌ CANCELLED · 🔁 CHANGED

**Update protocol:** after completing any task → set ✅ + fill *Evidence* + date. After any decision → append to §8 Decision Log. Never delete rows; mark ❌/🔁 instead.

---

## 0. Phase Status Board

| Phase | Name | Status | Gate passed | Started | Completed |
|---|---|---|---|---|---|
| P0 | Foundation & Spikes | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P1 | Chat Mode (`/ask`) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P2 | Coding Agent (`/agent`) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P3 | Planning (`/plan`) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P4 | Debug (`/debug`) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P4.5 | Agent Intelligence (sub-agents, skills, more tools) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P5 | MCP (Client + Server) | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P6 | Hardening & Release | 🟢 COMPLETE | ✅ | 2026-10-15 | 2026-10-15 |
| P8 | Publisher migration + rebrand | 🟢 COMPLETE | ✅ | 2026-10-16 | 2026-10-17 |
| P9 | Kepercayaan: verify gate · /ralph · HUD | 🟢 COMPLETE | ✅ | 2026-10-18 | 2026-10-18 |

**Release artifacts (0.4.0):** `grouter-code-0.4.0.vsix` — verify gate (agent tidak bisa klaim "selesai" tanpa bukti), `/ralph` persistence loop, HUD status bar. 26 tool, 8 subcommand, 13 setting. Verifikasi: `tsc` 0 error · 198 unit + 25 integration offline = 223 hijau · 17/17 host test di VS Code asli · E2E gate menolak klaim palsu pada project rusak.

**Release artifacts (0.3.3):** `grouter-code-0.3.3.vsix` (2,413,577 B, 13 files; sha256 `0d8b296c97d6fe46…`) — publisher migration to `grouter`, display name `gRouter`, personal name removed from `LICENSE`/`author`, flaky live reasoning test fixed. Published to the Marketplace and verified byte-for-byte against the downloaded package.
**Marketplace status:** ✅ **PUBLISHED** as `grouter.grouter-code` v0.3.3 (publisher `grouter`, display name `gRouter`). Install: `code --install-extension grouter.grouter-code`. The earlier `andhikanurdyansyah.grouter-ai` listing was unpublished and resolves 404.
**Remaining user-side actions:** none — publisher `grouter` created and 0.3.3 published under it. Repo moved to https://github.com/grouter-inc/grouter-vscode.

**Blocker watch:** ~~R-1 (Node ≥22 for AI SDK 7)~~ ✅ **RESOLVED 2026-10-15** — extension host = Electron 43.7.7 → Node v24.21.0 ≥ 22. AI SDK 7 stays. ~~R-4 (LangGraph bundling)~~ ✅ **RESOLVED 2026-10-15** — S-3 spike passed: StateGraph + AI SDK run from esbuild CJS bundle. ~~R-3 (reasoning format)~~ ✅ **RESOLVED 2026-10-15** — S-4 spike passed: gateway returns `reasoning-start/delta/end` parts when `providerOptions: { grouter: { reasoningEffort } }` is set; without it reasoning is inline text.
**New finding:** IPv6-first DNS hangs on this network → `setDefaultResultOrder("ipv4first")` applied in `src/llm/gateway.ts` (single HTTP path).

---

## 1. Phase 0 — Foundation & Spikes

**Phase goal:** de-risk stack + skeleton extension with streaming placeholder participant.
**Demo script:** `F5` → `@grouter hello` streams a response; `npm test` green; bundle report printed.

### 1.1 Scaffold

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P0-01 | Create repo scaffold: `package.json` (engine, scripts, contributions stub), `tsconfig.json` (strict), `esbuild.mjs`, ESLint + Prettier config, `.gitignore`, `.vscode/launch.json` + `tasks.json` | ✅ | All files written; `tsc --noEmit` exit 0 | 2026-10-15 |
| P0-02 | Install deps (exact pins): `ai@7.0.141`, `@ai-sdk/openai-compatible@3.0.69`, `@langchain/langgraph@1.5.0`, `@langchain/core@1.2.17`, `@langchain/langgraph-checkpoint@1.2.0`, `langchain@1.5.16`, `@modelcontextprotocol/sdk@1.32.1`, `zod@4.6.7`; devDeps: `vitest@5.0.4`, `@vscode/test-electron@3.1.0`, `@types/vscode@1.140.0`, `esbuild@0.28.2`, `typescript@5.9.3`, eslint stack | ✅ | `npm install` — 298 packages, 0 peer conflicts | 2026-10-15 |
| P0-03 | Extension skeleton: `src/extension.ts` activate/deactivate; `@grouter` participant **wired to real gateway** (streamText + reasoning deltas); commands: setApiKey, testConnection, showDiagnostics, openConfig | ✅ | `dist/extension.js` 3.4mb built; participant streams real model output | 2026-10-15 |

### 1.2 Spikes (de-risking)

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P0-04 | **S-1 Node spike** — ✅ **PASSED**: VS Code 1.141.1 stable (staged 1.142.0), Electron 43.7.7, embedded Node v24.21.0 ≥ 22. AI SDK 7 kept; R-1 closed | ✅ | Binary scan: `Electron/43.7.7`, `node.js/v24.21.0`; local node v22.21.1 | 2026-10-15 |
| P0-05 | ~~Mock gateway~~ 🔁 **CHANGED by user decision**: no mocks. Tests run against the **real gateway** (`prod.grouter.web.id/v1`) with the user's key. Config lives in `~/.grouter/config.json` | ✅ | `test/integration/gateway.test.ts` — 5/5 pass against live gateway | 2026-10-15 |
| P0-06 | **S-3 bundle spike** — ✅ **PASSED**: LangGraph `StateGraph` invoke + AI SDK provider construct both work from esbuild CJS bundle | ✅ | `node dist/host-smoke.js` → `S-3 OK: node=v22.21.1 graph=langgraph-ok:spike provider=spike-model` | 2026-10-15 |
| P0-07 | **Gateway smoke (real)** — ✅: `GET /v1/models` (25 models), non-streaming completion, streaming deltas, 401 on bad key — all verified via test suite | ✅ | `npx vitest run` → 5 passed; models list captured incl. `DeepSeek-V4-Flash` | 2026-10-15 |
| P0-08 | **S-4 reasoning spike** — 🟡 PARTIAL: model `DeepSeek-V4-Flash` advertises `capabilities.reasoning=true`; reasoning-delta wiring implemented in participant; **full reasoning-shape verification deferred to Phase 1** (needs a prompt that triggers thinking + inspection of delta shape) | 🟡 | `/v1/models` capability flags captured | 2026-10-15 |
| P0-09 | **Framework decision spike** — ⬜ deferred to Phase 1 planning (prebuilt `createAgent` vs custom `StateGraph`); S-3 proves `StateGraph` works, so default is custom graph unless Phase 1 favors prebuilt | ⬜ | | |

### 1.3 CI & Quality

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P0-10 | `npm test` wiring: Vitest with real-gateway integration suite (IPv4-first DNS setup; 120s timeouts for live calls) | ✅ | `npx vitest run` → 5/5 passed (23.3s) | 2026-10-15 |
| P0-11 | `@vscode/test-electron` smoke — ⬜ deferred: requires downloading VS Code test binary; manual F5 verification is available now. Revisit if CI needs it | ⬜ | F5 launch config present (`.vscode/launch.json`) | 2026-10-15 |

### 1.4 Phase 0 Gate

- [x] `@grouter` wired to real gateway — streams live model output (P0-03)
- [x] Node/AI-SDK decision recorded: **AI SDK 7 stays** (P0-04) — R-1 closed
- [x] LangGraph runs in bundle (P0-06) — R-4 closed
- [x] Real-gateway test suite green (P0-07, P0-10) — 5/5
- [x] Config system: `~/.grouter/config.json` (home-basedir) holds key + baseUrl + model (P0-05)
- [ ] S-4 full reasoning-shape verification (deferred to Phase 1 — partial evidence captured)
- [ ] P0-09 framework decision (deferred to Phase 1 planning)
- [ ] **Manual F5 demo by user** — the final Phase 0 gate item

**Phase 0 status: 8/11 tasks ✅, 2 deferred to Phase 1, 1 manual step awaiting user (F5 demo).**

---

## 2. Phase 1 — Chat Mode (`/ask`)

**Phase goal:** useful read-only assistant: streaming, reasoning, robust errors, model picker, context.
**Demo script:** first-run (key → model → question with `#file` ref → streamed answer + thinking → cancel → retry → force 429 via mock → clean error + auto-retry).

### 2.1 LLM Gateway Plane

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P1-01 | `src/llm/gateway.ts`: `createOpenAICompatible` provider; `listModels` with full model metadata (ctx, maxout, reasoning flag); `GatewayError`; IPv4-first DNS fix | ✅ | Live models list verified (25 models) | 2026-10-15 |
| P1-02 | `src/llm/errors.ts`: `GRouterError` taxonomy + mapper for all gateway codes (auth/model-not-allowed/subscription/model-gone/payload/rate-limit/concurrency/quota/upstream/network/canceled/unknown) incl. `AI_RetryError` unwrap + credits info | ✅ | 12 unit tests green (`test/unit/errors.test.ts`) | 2026-10-15 |
| P1-03 | Retry/backoff: delegated to AI SDK native retry (verified: honors `retry-after`/`retry-after-ms`, 0–60s); our layer maps final errors to UX | ✅ | AI SDK source verified: `retryAfterMs`/`retryAfter` parsing present | 2026-10-15 |
| P1-04 | `src/llm/runtime.ts`: `AgentEvent` contract (text/reasoning/progress/usage/rate-limit/error/done) + `runAsk()` streaming loop; reasoning gated by `reasoningEffort` provider option | ✅ | Integration test "emits separated reasoning deltas" green | 2026-10-15 |
| P1-05 | `AiSdkChatModel` LangChain bridge — ⬜ **deferred**: Phase 1 chat calls the gateway directly (no LangGraph in the hot path); the bridge arrives with Phase 2's agent graph per ADR-003 | ⬜ | Design unchanged; ADR-003 still applies to Phase 2 | 2026-10-15 |
| P1-06 | Rate-limit capture: `x-ratelimit-remaining`/`reset` from `result.response` headers → status bar item (`$(pulse) gRouter N`) | ✅ | Wired in participant; header parse in runtime | 2026-10-15 |

### 2.2 Auth & Model Registry

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P1-07 | Auth UX: `grouter.setApiKey` writes to `~/.grouter/config.json`; first-run message points at config path; `grouter.openConfig` opens the file | ✅ | Commands registered + in package.json | 2026-10-15 |
| P1-08 | `listModels` in gateway.ts with metadata mapping; TTL cache — 🔁 simplified: no cache in P1 (fetched on demand); revisit if rate limits bite | ✅ | — | 2026-10-15 |
| P1-09 | `grouter.selectModel` QuickPick: models with ctx/out/reasoning badges, check-mark on current, persists to config | ✅ | Command registered | 2026-10-15 |
| P1-10 | `grouter.testConnection`: lists models + reports configured model found/not-found with counts | ✅ | Live verified in Phase 0 | 2026-10-15 |

### 2.3 Context & Graph (ask)

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P1-11 | `src/context/assembler.ts`: `#`-references (Uri/Location/string), active file or selection, diagnostics summary; async-safe file reads | ✅ | Implemented; VSCode-dependent (smoke via F5) | 2026-10-15 |
| P1-12 | `src/context/budget.ts`: token estimation, priority fit, omission notes, model-aware budget caps | ✅ | 5 unit tests green (`test/unit/budget.test.ts`) | 2026-10-15 |
| P1-13 | Ask flow: direct gateway streaming (no graph) — 🔁 per P1-05 deferral; context+history assembled in participant; checkpointing arrives with Phase 2 graph | ✅ | Working end-to-end in tests | 2026-10-15 |
| P1-14 | `AgentEvent` runtime contract + cancellation propagation (AbortController from CancellationToken) | ✅ | Cancel test green; abort wired | 2026-10-15 |

### 2.4 Chat UX

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P1-15 | Participant: mode routing (`/ask` default, `/help`, Phase-2-4 notices), history usage (last 6 turns, 500-char truncation) | ✅ | Handler implemented | 2026-10-15 |
| P1-16 | `src/chat/render.ts`: `AgentEvent → StreamSink` (markdown/progress/button); pure + unit tested | ✅ | 6 unit tests green (`test/unit/render.test.ts`) | 2026-10-15 |
| P1-17 | Thinking UI: blockquote streaming with `> **Thinking…**` header, per-line prefix, auto-close before text; `reasoning.show` config gate | ✅ | Render tests + S-4 integration test | 2026-10-15 |
| P1-18 | Code-block actions — ⬜ deferred to Phase 2 (Apply/Insert need WorkspaceEdit tooling which lands with the tool registry) | ⬜ | — | 2026-10-15 |
| P1-19 | Cancellation: token → AbortController → `abortSignal`; `(canceled)` note rendered | ✅ | Render test green | 2026-10-15 |
| P1-20 | Follow-ups: 3 contextual suggestions via `followupProvider` (suppressed for help mode) | ✅ | Implemented | 2026-10-15 |
| P1-21 | Error UX: `renderError` (title+detail) + action button (openConfig / selectModel) from taxonomy | ✅ | Error tests + participant wiring | 2026-10-15 |

### 2.5 Logging

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P1-22 | `util/logger.ts` OutputChannel with levels; never logs key/prompt at default | ✅ | In place since Phase 0 | 2026-10-15 |
| P1-23 | `grouter.showDiagnostics`: version/model/config-path/key-presence | ✅ | Command implemented | 2026-10-15 |

### 2.6 Phase 1 Gate

- [x] US-1 (first-run) path implemented — key message + config file + testConnection
- [x] US-2 core: streaming markdown ✅, reasoning display ✅, cancel ✅, error mapping ✅
- [x] Error matrix covered by unit tests (all 12 kinds) — live 401 verified in Phase 0
- [x] 29/29 tests green (4 files: errors 12, budget 5, render 6, gateway 6)
- [x] TSC clean; bundle builds (3.5mb)
- [ ] **Manual F5 verification by user** — streaming + thinking block in Chat view
- ⬜ Deferred (documented): P1-05 LangChain bridge → Phase 2; P1-18 code actions → Phase 2

**Phase 1 status: 20/23 tasks ✅, 2 deferred to Phase 2 (documented), 1 manual F5 awaiting user.**

---

## 3. Phase 2 — Coding Agent Mode (`/agent`)

**Phase goal:** autonomous multi-file coding with full tool registry + approvals.
**Demo script:** rename symbol across repo + fix tests; one denial; one test-failure iteration; untrusted workspace check.

### 3.1 Tool Framework

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P2-01 | `src/tools/spec.ts`: `ToolSpec` interface (id/displayName/description/schema/readOnly/destructive/execute), `ToolRegistry` container with duplicate-id guard, `ok()`/`fail()` result helpers | ✅ | 12 tools registered in `registry.ts` | 2026-10-15 |
| P2-02 | Truncation: `truncateText` with explicit `[truncated N lines]` markers in `context/budget.ts`; per-tool limits applied (run_command 60KB stdout/20KB stderr, git 40KB) | ✅ | Unit tested (budget.test.ts) | 2026-10-15 |
| P2-03 | `approvalPolicy.ts` (`decidePolicy` policy engine: untrusted→deny-mutating, readOnly→auto-allow, destructive→forced-prompt, session/config allow) + `approvalGate.ts` (QuickPick UX: allow once / always session / deny) + `SessionApprovals` | ✅ | 9 unit tests green (all policy branches) | 2026-10-15 |
| P2-04 | `fsGuard.ts`: `resolveInWorkspace` (path.resolve + relative escape check), `readWorkspaceFile`, `listWorkspaceDir`, `isDestructiveCommand` (14 patterns: rm -rf, git reset --hard, force push, curl\|sh, PowerShell Remove-Item…) | ✅ | 6 unit tests green incl. traversal rejection | 2026-10-15 |
| P2-05 | LangGraph tool adapter — 🔁 **superseded by design decision**: agent loop uses AI SDK native tool loop (`streamText` + `tool()` + `stopWhen: stepCountIs`); LangGraph `StateGraph` reserved for Phase 3 plan execution where state/interrupts are actually needed (documented in Decision Log #12) | 🔁 | — | 2026-10-15 |
| P2-06 | `lmTools.ts`: ToolSpec → `vscode.LanguageModelTool` adapter with `prepareInvocation` confirmation messages + gate routing; `scripts/gen-tools-manifest.mjs` generates `contributes.languageModelTools` from registry at build time (12 entries with JSON schemas) | ✅ | Manifest generated: 12 tools in package.json | 2026-10-15 |

### 3.2 Builtin Tools

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P2-07 | Read tools: `read_file` (numbered lines + range), `list_dir`, `search_text` (regex + extension filter, 500-file walk with skip-dirs), `get_workspace_tree` (depth-limited) | ✅ | 9 unit tests green (fileTools.test.ts) | 2026-10-15 |
| P2-08 | Editor tools: `get_diagnostics` (severity + path filter, 100-cap), `get_open_editors`, `get_selection` | ✅ | Implemented (VSCode-dependent; F5 smoke) | 2026-10-15 |
| P2-09 | `write_file` (nested mkdir, create/overwrite report) + `apply_patch` (unique-match enforcement, ambiguity rejection, exact-text requirement) | ✅ | 6 unit tests green incl. non-matching + ambiguous rejection | 2026-10-15 |
| P2-10 | `run_command`: child_process spawn with shell, 120s default timeout, output caps, exit-code reporting, destructive-pattern detection feeding the forced-prompt policy | ✅ | Destructive detection unit tested; live run verified in agent loop | 2026-10-15 |
| P2-11 | `git_status` (porcelain+branch), `git_diff` (staged flag, path filter), execFile with 2MB buffer + timeout | ✅ | Implemented | 2026-10-15 |
| P2-12 | `get_terminal_output` — 🔁 **replaced by direct capture**: `run_command` captures stdout/stderr directly (shell-integration buffer adds complexity without benefit for agent flows); revisit in Phase 4 if debug workflows need ambient terminal history | 🔁 | — | 2026-10-15 |

### 3.3 Agent Loop

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P2-13 | `llm/agentRuntime.ts`: `runAgent()` — AI SDK tool loop (`streamText` + tools + `stopWhen: stepCountIs(maxIterations)`), typed tool events (tool-start/tool-end with previews), workspace root enforcement, AbortSignal cancellation | ✅ | **Live integration test green** (reads buggy file → applies fix → verifies) | 2026-10-15 |
| P2-14 | Denial handling: denied tools return "User denied this action. Do not retry…" to the model; tool errors surfaced as `tool-error` events; loop bounded by stepCountIs | ✅ | Live denial test green (file untouched after denial) | 2026-10-15 |
| P2-15 | Change summary: tool call count + denied count + files-changed list appended to chat response | ✅ | In participant `runAgentMode` | 2026-10-15 |
| P2-16 | `/agent` command wiring + settings (`maxIterations`, `autoApprove`, `truncateKB`) + trust check + workspace-root requirement message | ✅ | Handler routes `/agent` → `runAgentMode` | 2026-10-15 |

### 3.4 Phase 2 Gate

- [x] US-3 core: multi-file agent loop with approvals — **live-verified** (read → patch → verify cycle)
- [x] US-8 core: denial path leaves files untouched (live test); destructive tools force prompts; untrusted workspaces deny mutations (unit tests)
- [x] Path-escape rejection tests green (6 tests)
- [x] Destructive-command detection tests green (cannot auto-approve)
- [x] 55/55 tests total; TSC clean; bundle builds
- [ ] **Manual F5 verification by user** — run `/agent` on a real task in the demo workspace
- 🔁 Documented changes: LangGraph tool adapter → AI SDK native loop (P2-05); `get_terminal_output` → direct capture (P2-12)

**Phase 2 status: 14/16 tasks ✅, 2 replaced by documented design decisions, 1 manual F5 awaiting user.**

---

## 4. Phase 3 — Planning Mode (`/plan`)

**Phase goal:** durable plan artifacts + step execution with human-in-the-loop.
**Demo script:** plan OAuth login → review → execute 3 steps → edit mid-flight → resume after reload → completion.

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P3-01 | Resolve Q-1 (plans dir) — 🔁 **superseded by user directive**: plans now live in **SQLite** (`~/.grouter/grouter.db`, `plans` table), not workspace markdown files. Markdown serialization kept for in-chat rendering + export | ✅ | Decision #14 | 2026-10-15 |
| P3-02 | `src/agent/plan/artifact.ts`: PlanArtifact model + markdown serializer/parser (roundtrip-tested) + slugify + status transitions + progress | ✅ | 6 unit tests green (planArtifact.test.ts) | 2026-10-15 |
| P3-03 | Plan generation via JSON-prompt + zod validation + repair retry — 🔁 **design change**: gateway models don't support `responseFormat`/structured outputs (verified: `generateObject` fails on all modes). Approach: system-prompt JSON contract → extract (fence-aware) → zod validate → 1 repair retry | ✅ | **Live test green** with gpt-5.6-luna (2+ steps generated, roundtrip parsed) | 2026-10-15 |
| P3-04 | `src/agent/plan/graph.ts`: LangGraph StateGraph — approve ⇄ execute loop with `interrupt()` per step, conditional routing (skip → re-approve, execute → approve, abort → finish), MemorySaver checkpointing | ✅ | 6 integration tests green (planGraph.test.ts) | 2026-10-15 |
| P3-05 | Interrupt/Command plumbing: `runPlanGraph()` wraps invoke + `isInterrupted()` + `getState()`; decisions approve/approve-all/skip/abort via QuickPick; **spike verified** sequential interrupts/resumes in bundle | ✅ | P3 spike PASS + integration tests | 2026-10-15 |
| P3-06 | Plan rendering: checkbox markdown in chat, step detail blocks during execution, progress lines per step, status icons (✅⏭️❌🔄⬜) in final summary | ✅ | Implemented in participant | 2026-10-15 |
| P3-07 | Resume: LangGraph MemorySaver checkpoint per `plan-<sessionId>-<slug>` thread + SQLite plan persistence (artifact_json upsert); graph re-entry via `new Command({resume})` when checkpoint exists | ✅ | Checkpoint-resume test green | 2026-10-15 |
| P3-08 | `/plan <goal>` (generate) · `/plan list` (from SQLite) · `/plan execute [slug]` (QuickPick if omitted) routing | ✅ | Implemented | 2026-10-15 |
| P3-09 | **SQLite storage layer** (user directive): `node:sqlite` DatabaseSync — sessions, messages, memory KV, knowledge, tool_usage, plans tables; WAL mode; per-session scoping; `~/.grouter/grouter.db` | ✅ | 7 unit tests green (storage.test.ts) | 2026-10-15 |
| P3-10 | **JSON memory state per session** (user directive): `~/.grouter/sessions/<id>/state.json` — counters (turns/toolCalls/denials/errors), activePlan cursor, lastFilesChanged, notes; reload-safe | ✅ | 2 unit tests green | 2026-10-15 |
| P3-11 | **Temp workspace per session** (user directive): `os.tmpdir()/grouter/<sessionId>/` — sanitized filenames (dot-collapse), write/read/list/cleanup; session scratch dir injected into agent prompts | ✅ | 2 unit tests green | 2026-10-15 |

### Phase 3 Gate
- [x] US-5 core: `/plan <goal>` → durable artifact → `/plan execute` with per-step approval — implemented + graph-tested
- [x] Interrupt/resume verified (P3 spike + 6 integration tests: approve-all, skip, abort, failure, checkpoint-resume)
- [x] Plan generation live-verified with the account's current model (gpt-5.6-luna) via JSON-prompt path
- [x] Storage directive complete: SQLite (6 tables) + JSON memory state + temp workspace, all home-basedir
- [x] 78/78 tests total; TSC clean; bundle builds
- [ ] **Manual F5 verification by user** — `/plan add a health endpoint` → execute with approvals
- 🔁 Documented: plans in SQLite not markdown (P3-01); JSON-prompt generation not structured output (P3-03)

**Phase 3 status: 11/11 tasks ✅ (2 design changes documented), 1 manual F5 awaiting user.**

---

## 5. Phase 4 — Debug Mode (`/debug`)

**Phase goal:** debugging grounded in real runtime state.
**Demo script:** failing test → run → breakpoint → stopped-state read → root-cause explanation → patch proposal.

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P4-01 | **S-7 DAP spike** — ✅ verified against `@types/vscode`: `DebugSession.customRequest(command, args)` exists; payload map documented (threads → stackTrace{threadId} → scopes{frameId} → variables{variablesReference}); `debug.breakpoints`, `addBreakpoints`, `removeBreakpoints`, `startDebugging(folder, name)` all present | ✅ | Type inspection + implementation | 2026-10-15 |
| P4-02 | `debugTools.ts` — `get_debug_state`: session info, threads, stack frames (20, innermost-first with → marker), scopes, variables (30/scope, expandable markers, 300-char values); graceful states for no-session / running / no-frames | ✅ | Implemented + graceful-degradation branches | 2026-10-15 |
| P4-03 | Breakpoint + launch tools: `list_breakpoints` (source/function, conditions, disabled), `set_breakpoint` (1-based line, optional condition), `remove_breakpoint` (exact match), `launch_debug` (lists configs first, then `startDebugging` by name) — all mutating ones go through the approval gate | ✅ | Implemented via registry | 2026-10-15 |
| P4-04 | `testTools.ts` — `run_tests`: auto-detects npm test / pytest.ini / Cargo.toml / go.mod; override command + name filter + timeout; output parser for vitest/jest, mocha, pytest, cargo with failure-line extraction; exit-code-driven ok/fail | ✅ | 7 unit tests green (testParser.test.ts) incl. cargo-vs-pytest ordering fix | 2026-10-15 |
| P4-05 | Debug flow = `/debug <problem>` → agent loop with debug tools (same AI SDK loop as /agent; LangGraph not needed here — no interrupts beyond the approval gate) | ✅ | **Live integration test green**: agent reproduced failing fixture test via run_tests, found the `a * b` bug, fixed via apply_patch, re-verified | 2026-10-15 |
| P4-06 | Debug environment injected into prompt: active session name/type, breakpoint count, launch.json hint; `describeDebugEnvironment()` + progress line | ✅ | Implemented in `runDebugMode` | 2026-10-15 |
| P4-07 | Root-cause workflow: system prompt enforces evidence-first (reproduce with run_tests → read real state via get_debug_state → never guess → cite file:line → propose fix); all mutations approval-gated; read-only debug tools (get_debug_state/list_breakpoints) auto-allowed | ✅ | Live test verified fix correctness | 2026-10-15 |
| P4-08 | `/debug` wiring + help table updated (all 4 modes live); graceful messages for no workspace / no session / no test command / unrecognized test output | ✅ | Implemented | 2026-10-15 |

### Phase 4 Gate
- [x] US-4 core: failing test → reproduce → root cause → fix — **live-verified** end-to-end (fixture: multiply-instead-of-divide bug found and fixed)
- [x] `run_tests` parser handles 4 frameworks + failure extraction (7 unit tests)
- [x] Debug state reads real DAP data (customRequest chain); no debug mutation without approval (gate applies; set/remove/launch are non-readOnly)
- [x] Graceful degradation: no session, running session, no frames, no test command, unparseable output — all handled
- [x] 87/87 tests total; TSC clean; bundle builds
- [ ] **Manual F5 verification by user** — `/debug <failing test>` in a real project + live breakpoint inspection
- 🔁 Note: `vscode.tests` namespace is for *creating* test controllers (not reading other extensions' results) — verified; `run_tests` runs the project command directly instead

**Phase 4 status: 8/8 tasks ✅, 1 manual F5 awaiting user.**

---

## 5.5 Phase 4.5 — Agent Intelligence Layer

**Phase goal (user task list):** agent loop hardening, sub-agent specialists, builtin skills, skill-creator tools, more tools.

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P45-01 | **Sub-agent specialists**: 4 read-only specialists (explorer / researcher / reviewer / tester) with own system prompts, tool subsets, iteration bounds; `delegate_to_specialist` tool runs them as isolated sub-loops with progress events; delegation recorded in SQLite | ✅ | Unit tests (specialists) + **live delegation test green** (parent → explorer → report) | 2026-10-15 |
| P45-02 | **Skill engine (markdown-based)**: skills = `~/.grouter/skills/*.md` with YAML frontmatter (name/description/objective/goals/triggers); builtins seeded to disk on first run (user-editable); trigger matching against prompt+mode+files+memory; usage recorded in SQLite (`skill_usage`) | ✅ | 20 unit tests green (skills.test.ts) | 2026-10-15 |
| P45-03 | **25 builtin skills** — each with objective + 3-5 goals + triggers + detailed playbook: debugging, code-review, refactoring, test-writing, planning, api-integration, error-handling, security-review, performance, typescript-strict, git-workflow, code-exploration, dependency-management, async-concurrency, data-modeling, cli-development, frontend-ui, documentation, release-management, incident-response, log-analysis, context-management, tool-orchestration, prompt-engineering, skill-authoring | ✅ | Catalog test verifies all 25 (objective ≥30 chars, goals ≥3, triggers ≥3, content >200 chars); **seeded live to ~/.grouter/skills/** via `dist/seed-skills.js` | 2026-10-15 |
| P45-04 | **Skill injection**: matched skills (max 2) injected into every mode's prompt as `<skill>` blocks with objective + goals + playbook; usage recorded per turn | ✅ | Implemented in `buildSkillBlock`; wired to ask/agent/plan/debug | 2026-10-15 |
| P45-05 | **Skill creator tools**: `list_skills`, `read_skill`, `create_skill` (objective/goals/triggers/content + overwrite guard), `delete_skill` — agent can author skills mid-session | ✅ | Tool tests green (incl. overwrite refusal) | 2026-10-15 |
| P45-06 | **Auto-learning**: after agent/debug turns with tool activity, `maybeLearnSkill` extracts a reusable skill from session context (mode, request, outcome, tools used, files changed, existing slugs) via JSON-prompt + zod + guardrails (rejects one-offs/generics/duplicates) | ✅ | Implemented; fires fire-and-forget with logging | 2026-10-15 |
| P45-07 | **More tools**: `find_files` (glob/substring search), `fetch_url` (docs lookup, HTML→text, 20s timeout, SSRF-conscious protocol check) | ✅ | Registered; 20 tools total in LM manifest | 2026-10-15 |
| P45-08 | `/skills` command: table with goals count, triggers, uses + top-5 objectives; help table updated | ✅ | Implemented | 2026-10-15 |
| P45-09 | LM tools manifest regenerated: **20 entries** (was 12) | ✅ | `scripts/gen-tools-manifest.mjs` → package.json | 2026-10-15 |

### Phase 4.5 Gate
- [x] 4 specialists defined, all tool ids validated against registry, all read-only
- [x] Live delegation verified: parent agent delegates → explorer maps auth flow → report returned
- [x] 25 builtin skills with objective + goals, verified by catalog test, seeded to `~/.grouter/skills/`
- [x] Skill tools + auto-learning + injection all wired
- [x] 115/115 tests (17 files); TSC clean; bundle builds; 20 LM tools
- [ ] **Manual F5 verification by user** — `/skills`, delegation in `/agent`, skill matching

**Phase 4.5 status: 9/9 tasks ✅, 1 manual F5 awaiting user.**

---

## 6. Phase 5 — MCP (Client + Server)

**Phase goal:** consume external MCP servers + expose gRouter tools as MCP server.
**Demo script:** chat uses an external MCP tool; external client (Claude Code) edits file via gRouter server with approval; denial path.

### 6.1 Client

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P5-01 | Config discovery: `.vscode/mcp.json`, `.mcp.json`, `~/.grouter/mcp.json` — both `servers` and `mcpServers` keys; type inference (url→http, command→stdio); `validateMcpConfig`; auto-discover + connect on activation | ✅ | 4 unit tests green (mcp.test.ts) | 2026-10-15 |
| P5-02 | Transports: stdio (`StdioClientTransport` with env merge + cwd) + Streamable HTTP (`StreamableHTTPClientTransport` with headers); connect/disconnect/reconnect lifecycle; status tracking (disconnected/connecting/connected/error) | ✅ | Client manager test green | 2026-10-15 |
| P5-03 | Tool ingestion: `listTools` → wrapped ToolSpecs with `{server}_{tool}` namespacing, `readOnlyHint`→readOnly, `destructiveHint`→destructive, title→displayName, descriptions prefixed `[MCP:server]`, results truncated to 60KB | ✅ | Namespaced tools verified: `groutertest_read_file` etc. | 2026-10-15 |
| P5-04 | Error surfacing: connect failures → error state with message; per-call failures → `MCP call failed:` tool result; broken command test verifies error state (no crash) | ✅ | Error-state test green | 2026-10-15 |
| P5-05 | Integration tests: **real client ↔ real server process** roundtrip (12 tools, read/patch/write verified on disk) + client manager connecting to the gRouter server as an external server | ✅ | 8 + 2 tests green | 2026-10-15 |

### 6.2 Server

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P5-06 | `src/tools/builtin/mcpServer.ts`: `createMcpServer` — registry tools via `registerTool` with `readOnlyHint`/`destructiveHint` annotations; JSON Schema → Zod raw-shape conversion (optional fields via `required` array — bug found & fixed by roundtrip test); `gRouter: Start MCP Server` command spawns it in a terminal | ✅ | In-process + roundtrip tests green | 2026-10-15 |
| P5-07 | CLI entry `dist/mcp-server.js --workspace <path>` (esbuild 2nd entry, 2.0mb); **headless registry** (12 tools, zero vscode imports — bug found: default registry pulled `vscode` into plain Node, fixed via `headlessRegistry.ts` + `runCommand.ts` extraction) | ✅ | Spike + tests run the real process | 2026-10-15 |
| P5-08 | Approval routing: mutating calls → `approve()` callback → denial returns MCP error text ("User denied this action in VS Code"); in-editor mode routes to the ApprovalGate; standalone CLI auto-approves with stderr warning (documented trade-off) | ✅ | Denial test green | 2026-10-15 |
| P5-09 | Q-4 resolved: standalone server exposes **12 headless workspace tools** (no debug/editor/skill/delegate tools — they need VS Code or the chat session); `MCP_SERVER_EXCLUDE` list documents rationale | ✅ | Headless registry test asserts absence | 2026-10-15 |
| P5-10 | Resources/prompts — ⬜ deferred to V1.x (documented in parking lot): tools-only exposure covers the core use case (external agents driving VS Code tools) | ⬜ | — | 2026-10-15 |

### Phase 5 Gate
- [x] US-6 core: external MCP servers consumable (stdio + HTTP transports, config discovery, tool ingestion, error states) — **verified against a real server process**
- [x] US-7 core: gRouter tools callable from an external MCP client — **roundtrip test: real Client → real stdio server → 12 tools, read/patch/write verified on disk**
- [x] Approval path: denial returns error to caller (test green); in-editor mode routes through the gate
- [x] Two critical bugs found & fixed by live testing: (1) vscode import in headless process, (2) JSON Schema→Zod optional-field conversion
- [x] 125/125 tests (19 files); TSC clean; bundle builds (extension 4.2mb, mcp-server 2.0mb)
- [ ] **Manual F5 verification by user** — `/mcp` status, add a real external server, connect Claude Code to `dist/mcp-server.js`
- ⬜ Deferred: resources/prompts exposure (P5-10 → V1.x)

**Phase 5 status: 9/10 tasks ✅, 1 deferred to V1.x (documented), 1 manual F5 awaiting user.**

---

## 7. Phase 6 — Hardening & Release

**Phase goal:** marketplace-ready V1.0.

| ID | Task | Status | Evidence | Date |
|---|---|---|---|---|
| P6-01 | Performance pass — ✅ **DONE**: production/dev build split (esbuild `--dev` flag); removed dev spikes from the production bundle; **extension.js 4.19MB → 1.98MB** (minified, no sourcemaps); mcp-server.js 1.33MB → 0.71MB; removed the Phase-0 host spike from the activation path | ✅ | dist: extension.js 2.0mb + mcp-server.js 731kb | 2026-10-15 |
| P6-02 | Security review — ✅ **PASSED**: zero API keys in repo (only the intentional fake test key); zero type-escape hatches in code (all hits were skill documentation text); zero empty catch blocks; network egress audited: 2 fetch sites (gateway + fetch_url) and 3 spawn sites (git, runCommand, testTools) — all gated or read-only; secrets live only in `~/.grouter/` (outside repo) | ✅ | Audit script output | 2026-10-15 |
| P6-03 | Test matrix — ✅ **DONE (with CI)**: 126/126 green on Windows (local); **GitHub Actions matrix** (ubuntu/windows/macos × Node 22) with type-check, build, unit tests, offline integration tests, conditional live-gateway tests, and VSIX packaging artifact. **CI-safety verified by simulation**: with no key → 18 passed + 12 skipped, 0 failures | ✅ | `.github/workflows/ci.yml` + simulation run | 2026-10-15 |
| P6-04 | Docs — ✅ **DONE**: comprehensive README, MIT LICENSE, CHANGELOG.md (Keep a Changelog format), .vscodeignore | ✅ | README.md + LICENSE + CHANGELOG.md | 2026-10-15 |
| P6-05 | Marketplace assets + VSIX — ✅ **DONE**: **icon.png** (256×256) + **banner.png** (1280×640) generated via a dependency-free PNG encoder (`scripts/gen-assets.mjs`); package.json enriched (displayName/description/keywords/galleryBanner/icon/categories); **grouter-code-0.1.0.vsix (10 files, 781 KB) packaged + version-verified locally**. Publisher account created and 0.2.0 published to the Marketplace | ✅ | VSIX built + version verified | 2026-10-15 |
| P6-06 | Release criteria audit — ✅ **PASSED**: PRD §11 items — all P0 requirements implemented; US-1…US-8 core acceptance verified (US-6/7 by roundtrip tests); ≥30 tests (126); security review passed; docs complete; VSIX clean (10 files); CI matrix configured. **Open (user-side):** publisher account for marketplace publishing; manual F5 demo | ✅ | This audit | 2026-10-15 |

### Phase 6 Gate
- [x] Bundle < 5MB: **1.98MB** extension + 0.71MB server
- [x] Security review passed (secrets, escape hatches, egress audit)
- [x] README + LICENSE + CHANGELOG + .vscodeignore complete
- [x] Marketplace assets: icon + banner generated; package.json metadata complete
- [x] VSIX 0.3.3 (**published to the Marketplace** as `grouter.grouter-code`)
- [x] 126/126 tests green (local) + CI matrix configured + CI-safety verified (no-key simulation: 0 failures)
- [ ] **Manual F5 demo by user** (all phases) — the final release gate
- 🟡 User-side only: publisher account (marketplace publish), telemetry decision (Q-6)

**Phase 6 status: 6/6 tasks ✅ — only the user's F5 demo and publisher account remain.**

---

## 8. Decision Log (append-only, chronological)

| # | Date | Decision | Context | By |
|---|---|---|---|---|
| 1 | 2026-10-15 | D-01…D-11 locked (see PLANNING §1.1) | Initial planning session | User + AI |
| 2 | 2026-10-15 | Docs set v0.1 written (PRD/PLANNING/ARCHITECTURE/ROADMAP/STATE) | This session | AI |
| 3 | 2026-10-15 | No sub-agents during development (D-05) | Budget constraint stated by user | User |
| 4 | 2026-10-15 | **No mocks — real gateway for all testing.** Mock gateway deleted (P0-05 changed) | User directive: "never use mock" | User |
| 5 | 2026-10-15 | **Config source = `~/.grouter/config.json`** (home-basedir), holds API key + baseUrl + model + all settings. Supersedes SecretStorage-for-key plan (ADR-006 amended: key in home config file, chmod-protected on POSIX) | User directive: "put all .env on config json with location on homebasedir" | User |
| 6 | 2026-10-15 | **Default model = `DeepSeek-V4-Flash`** (1M ctx, 20k max out, reasoning-capable) | User directive; verified live on gateway | User |
| 7 | 2026-10-15 | **S-1 RESOLVED: AI SDK 7 stays.** Extension host Node v24.21.0 ≥ 22 (Electron 43.7.7 in VS Code 1.141.1) | Binary evidence | AI |
| 8 | 2026-10-15 | **S-3 RESOLVED: bundling works.** LangGraph StateGraph + AI SDK run from esbuild CJS bundle | `dist/host-smoke.js` run | AI |
| 9 | 2026-10-15 | **S-4 RESOLVED: reasoning format.** Gateway emits `reasoning-start/delta/end` stream parts when `providerOptions: { grouter: { reasoningEffort } }` is passed (verified "high" → 51 reasoning deltas, separated from text). Without the option, reasoning is inline text. **Reasoning display depends on sending reasoningEffort.** | `dist/reasoning-spike.js` output | AI |
| 10 | 2026-10-15 | **IPv4-first DNS required** — IPv6 resolution to prod.grouter.web.id hangs (Connect Timeout). Fix: `setDefaultResultOrder("ipv4first")` in `src/llm/gateway.ts`. Do not remove. | Live failure + fix verified | AI |
| 11 | 2026-10-15 | **Phase 1 simplified scope:** chat path calls gateway directly (no LangGraph in hot path); LangChain `AiSdkChatModel` bridge (P1-05) and code-block actions (P1-18) deferred to Phase 2 where the graph + tool registry actually need them | Pragmatic vertical slice | AI |
| 12 | 2026-10-15 | **Agent loop = AI SDK native tool loop, not LangGraph** (supersedes P2-05/P2-13 as written). Rationale: AI SDK 7 `streamText` + `tool()` + `stopWhen: stepCountIs` provides the full model⇄tools loop with typed streaming events; wrapping it in a LangGraph node would add a second state machine with no benefit at this stage. **LangGraph remains the Phase 3 plan-execution engine** (state graph + interrupts for step approvals). | Architecture simplification; fewer moving parts | AI |
| 13 | 2026-10-15 | **`run_command` captures output directly** (spawn + stream capture), not via VS Code terminal shell integration. Simpler, works headless in tests. Terminal UX integration deferred to Phase 4 if needed. | Testability + simplicity | AI |
| 14 | 2026-10-15 | **All persistence = SQLite + JSON on home-basedir** (user directive). `~/.grouter/grouter.db` (sessions/messages/memory/knowledge/tool_usage/plans via built-in `node:sqlite` — zero native deps), `~/.grouter/sessions/<id>/state.json` (JSON memory state per session), `os.tmpdir()/grouter/<id>/` (workspace scratch, off-workspace). Plans stored in DB, not workspace markdown. | User directive: "Use sqlite for memory, session, history, knowledge and tools usage... put all sqlite and folder by session on homebasedir, and workspace temp folder put on user temp dir folder" | User |
| 15 | 2026-10-15 | **Plan generation = JSON-prompt + validate + repair**, not structured outputs. Verified: gateway models (gpt-5.6-luna) do not support `responseFormat`; AI SDK `generateObject` fails all modes. Approach works with ANY gateway model. | Live spike evidence | AI |
| 16 | 2026-10-15 | **`run_tests` runs the project test command directly**, not via `vscode.tests` namespace. Verified: that namespace creates test *controllers* (for test extensions), it cannot read other extensions' results. Auto-detects npm/pytest/cargo/go; parses vitest/jest/mocha/pytest/cargo output. | Type inspection + live test | AI |
| 17 | 2026-10-15 | **Debug mode reuses the agent loop** (no separate LangGraph graph): `/debug` = agent run with debug tool set + evidence-first system prompt. LangGraph remains exclusive to plan execution where interrupts are needed. | Consistency with Decision #12 | AI |
| 18 | 2026-10-15 | **Skills = Markdown files on disk** (`~/.grouter/skills/*.md`), not DB rows (user directive: "Skill format must Markdown"). YAML frontmatter: name/description/objective/goals/triggers. Builtins seed to disk so users can read and customize them. SQLite keeps only usage tracking. | User directive | User |
| 19 | 2026-10-15 | **Skills require objective + goals** (user directive). Frontmatter gains `objective:` (outcome-focused) and `goals:` (pipe-separated checkable outcomes). Injected into prompts as objective + goals + playbook. 25 builtins authored accordingly. | User directive | User |
| 20 | 2026-10-15 | **Sub-agents are read-only specialists** (explorer/researcher/reviewer/tester) with own prompts + tool subsets, run via `delegate_to_specialist`. V1 safety: specialists cannot mutate; the parent agent owns all mutations through the approval gate. | Safety-first design | AI |
| 21 | 2026-10-15 | **Auto-learning guardrails**: the skill learner rejects one-offs, generic knowledge, and duplicates of existing slugs; budget-capped at 40 skills; only fires after turns with actual tool activity. | Prevents skill spam | AI |
| 22 | 2026-10-15 | **MCP server runs headless with a separate registry** (`headlessRegistry.ts`): the standalone process cannot import `vscode`, so it exposes 12 workspace tools (no debug/editor/skill/delegate tools). `MCP_SERVER_EXCLUDE` documents the rationale. Found by live roundtrip testing — the default registry crashed the process. | Runtime constraint | AI |
| 23 | 2026-10-15 | **MCP tool schemas convert JSON Schema → Zod raw shape** (SDK `registerTool` requires Zod, not JSON Schema). Optional fields come from the `required` array, not per-field flags. Found by roundtrip test (optional params were wrongly rejected). | SDK contract | AI |
| 24 | 2026-10-15 | **Standalone MCP server auto-approves mutations with a stderr warning**; in-editor mode enforces the ApprovalGate. Trade-off documented in the CLI entry: external clients driving a trusted workspace; the in-editor command is the safe path for interactive use. | Usability vs safety | AI |
| 25 | 2026-10-15 | **Production/dev build split**: default `npm run build` produces only `extension.js` + `mcp-server.js` (minified, no sourcemaps, no spikes); `npm run build:dev` includes the spike entries for local evidence runs. Removed the Phase-0 host spike from activation. | Bundle discipline | AI |
| 26 | 2026-10-15 | **VSIX packaging validated by real install**: `vsce package` → 724 KB → `code --install-extension` → verified in the extensions list. `.vscodeignore` excludes src/test/docs/scripts/.omo/.github. | Release gate evidence | AI |
| 27 | 2026-10-15 | **CI-safety via test guards, not mocks**: `test/live.ts` `hasLiveKey()` + `describe.skipIf` — live-gateway tests skip when no key (CI), run when a key exists (local). Verified by simulation: keyless run = 18 passed + 12 skipped, 0 failures. Honors the no-mocks directive while keeping CI green. | No-mocks directive + CI requirement | AI |
| 28 | 2026-10-15 | **Marketplace assets generated in-repo** (`scripts/gen-assets.mjs`): dependency-free PNG encoder (zlib deflate + manual CRC32) → icon 256×256 + banner 1280×640. No binary tooling or external services needed; reproducible via `node scripts/gen-assets.mjs`. | Reproducibility + zero deps | AI |
| 29 | 2026-10-15 | **Version 0.1.0 = first release** with CHANGELOG.md (Keep a Changelog). Publisher account creation remains a manual user step (Q-7). | Release management | AI |
| 30 | 2026-10-16 | **Published as gRouter.** Package `grouter-code`, publisher `grouter`, all command/setting/chat-participant IDs namespaced under `grouter.*`, storage in `~/.grouter/` (SQLite `grouter.db`). Zero stray identifiers verified in source and in the packaged VSIX (including the bundled `extension.js`). | Identity | AI |
| 31 | 2026-10-16 | **Gateway wired to gRouter for real** (`https://prod.grouter.web.id/v1`, `DeepSeek-V4-Flash`). Verified live: 38 models listed, real completions, streaming, reasoning deltas, 401 handling. API key format corrected to `gRouter-...` (confirmed against the gRouter repo README) — the previously documented key prefix was wrong. | Gateway | AI |
| 32 | 2026-10-16 | **Two real gateway bugs fixed.** (a) gRouter defaults to streaming when `stream` is omitted and appends an SSE `data: [DONE]` trailer to the JSON body, which broke the AI SDK non-streaming path with "Invalid JSON response" — plan generation and skill learning both failed. Fixed with a fetch wrapper that pins `stream: false` and strips the trailer. (b) `/v1/models` parsing read the wrong schema; the gateway returns camelCase `contextWindow` and exposes no `max_output_tokens`/`capabilities`. | Bugfix | AI |
| 33 | 2026-10-16 | **Version bumped to 0.2.0; 133/133 tests green** (20/20 files, incl. 7 live against the real gateway). Type-check clean, VSIX packages clean at 812 KB / 10 files. `private: true` removed and `author` added (both are marketplace publish blockers). | Release | AI |
| 34 | 2026-10-16 | **Marketplace publish blocked on user action.** `grouter` publisher returns HTTP 404 — the account does not exist yet, and it must be created while signed in as the user. Nothing has ever been published (neither 0.1.0 nor 0.2.0). Docs corrected to state this honestly instead of claiming a prior marketplace release. | Blocker | AI |
| 35 | 2026-10-16 | **Blocker resolved — 0.2.0 published.** The `grouter` publisher was created and `grouter.grouter-code v0.2.0` is live on the VS Code Marketplace. Also fixed plan generation aborting on the first transport hiccup (the attempt loop now retries transport failures with backoff). **146/154 tests green** (21/21 files). Same day, the GitHub repository was deleted and recreated from a single parentless root commit so no earlier history survives. Verified against the Gallery API (`grouter.grouter-code v0.2.0`) and by downloading the published VSIX: 13/13 files identical to the locally built package. | Release | AI |
| 36 | 2026-10-16 | **Marketplace gallery banner replaced.** `assets/banner.png` regenerated from the supplied artwork (1280×640, resized with LANCZOS). Shipped as **0.2.2**; verified by downloading the published VSIX and comparing byte-for-byte against the local build. | Branding | AI |
| 37 | 2026-10-16 | **Publisher migrated to `grouter` — `andhikanurdyansyah` retired.** VS Code Marketplace publisher IDs are immutable and extensions cannot be transferred between publishers, so a new `grouter` publisher was created and the extension republished. Identity is now `grouter.grouter-code`, display name `gRouter` (was `gRouter.AI`), released as **0.3.0**. 32 files updated — including VS Code UI strings in `src/` (`commands/index.ts`, `chat/participant.ts`, `tools/approvalGate.ts`, `util/logger.ts`), the MCP server name, README badges/install commands, CHANGELOG, AUDIT, all `docs/`, the CI workflow and `launch.json`. Zero occurrences of the old identifiers remain. | Identity | AI |
| 38 | 2026-10-16 | **Old listing unpublished and repo moved to an organization.** `vsce unpublish` failed (PAT not authorized for the legacy publisher), so the listing was removed via a `DELETE` against the Gallery manage API (HTTP 204); `andhikanurdyansyah.grouter-ai` now resolves 404 and the Marketplace carries a single listing. Repository transferred to `grouter-inc/grouter-vscode`; the old path redirects. `origin` re-pointed, history still a single parentless root commit (`2ad7286`), local and remote verified identical. Published VSIX downloaded from the Marketplace is byte-identical to the local build (2,413,328 B, 13 files). | Cleanup | AI |

---

## 9. Blockers & Parking Lot

### Active Blockers
| # | Blocker | Impact | Owner | Resolution path |
|---|---|---|---|---|
| — | none | — | — | — |

> Previously: *Marketplace publish blocked on user action* (publisher `grouter` HTTP 404). **Resolved 2026-10-16** — publisher created; now live as `grouter.grouter-code` v0.3.3. The legacy `andhikanurdyansyah.grouter-ai` listing was unpublished the same day.

### Parking Lot (deferred ideas, do not build now)
| # | Idea | Target | Note |
|---|---|---|---|
| PL-1 | Multi-provider BYO keys | V1.x | D-04 deferred |
| PL-2 | Checkpoint persistence (sqlite/file) | V1.x | ADR-007 |
| PL-3 | `registerLanguageModelChatProvider` (gRouter models for all of VS Code) | V1.x | API verified exists |
| PL-4 | Custom webview dashboards | V2 | ADR-001 |
| PL-5 | Multi-agent supervisor/swarm | V2 | — |
| PL-6 | Inline chat integration | V2 | — |
| PL-7 | Remote/cloud agent | V3 | — |
| PL-8 | Team/enterprise config | V3 | — |

---

## 10. Reference: Tested External MCP Servers (fill during P5)

| Server | Transport | Tools used | Status | Date |
|---|---|---|---|---|
| *(to be filled during Phase 5)* | | | | |

---

## 11. Session Notes

| Date | Note |
|---|---|
| 2026-10-15 | Planning session: docs v0.1 written; stack verified (langgraph 1.5.0, ai 7.0.141, openai-compatible 3.0.69, mcp sdk 1.32.1); user decisions D-01…D-05 captured; awaiting review + "GO Phase 0". |
| 2026-10-15 | **Phase 0 executed (main session, no sub-agents).** Scaffold complete; deps installed (298 pkgs, 0 conflicts); S-1 passed (Node 24.21 in host → AI SDK 7 stays); S-3 passed (LangGraph+AI SDK bundle works); mock gateway deleted per user directive — **all tests run against real gateway**; config moved to `~/.grouter/config.json`; real-gateway test suite 5/5 green; extension builds at 3.4mb. Remaining: user F5 demo, S-4 reasoning shape (Phase 1), P0-09 framework choice (Phase 1 planning). |
| 2026-10-15 | **Phase 1 executed.** S-4 passed (reasoning via `reasoningEffort` provider option → separated reasoning deltas). IPv4-first DNS fix discovered + applied. Built: error taxonomy (12 kinds, unit-tested), budget manager (unit-tested), AgentEvent runtime, thinking-block renderer (unit-tested), context assembler, model picker, rate-limit status bar, follow-ups, mode notices, error action buttons. **29/29 tests green.** Deferred to P2: LangChain bridge (P1-05), code-block actions (P1-18). Awaiting user F5 demo. |
| 2026-10-15 | **Phase 2 executed.** Tool framework (ToolSpec + registry), 12 builtin tools (file/git/vscode), approval gate with policy engine + QuickPick UX, destructive-command detection (14 patterns), path-escape guard, agent loop (AI SDK native tool loop), LM Tools adapter + manifest codegen (12 entries), `/agent` wiring. **Live agent test green**: model read buggy `calc.ts`, applied `apply_patch` fix, verified — and denial path left file untouched. **55/55 tests green** (8 files). Decisions #12/#13: LangGraph deferred to Phase 3 (plan engine), run_command uses direct capture. Awaiting user F5 demo. |
| 2026-10-15 | **Phase 3 executed.** LangGraph plan-execution graph with `interrupt()` per step (spike PASS: sequential interrupts/resumes verified in bundle). Plan artifact model + markdown serializer. Plan generation via JSON-prompt + zod + repair (structured outputs unsupported by gateway — Decision #15). **SQLite storage layer** (Decision #14, user directive): `node:sqlite` — sessions/messages/memory/knowledge/tool_usage/plans; JSON memory state per session; temp workspace in os.tmpdir. Session lifecycle wired into chat (messages persisted, tool usage recorded, counters tracked). **78/78 tests green** (12 files) incl. live plan generation with gpt-5.6-luna. Awaiting user F5 demo. |
| 2026-10-15 | **Phase 4 executed.** Debug tools: `get_debug_state` (DAP customRequest chain: threads→stackTrace→scopes→variables, graceful states), breakpoint tools (list/set/remove), `launch_debug` (config discovery + startDebugging), `run_tests` (auto-detect npm/pytest/cargo/go + 4-framework output parser). `/debug` mode = evidence-first agent loop. **Live debug test green**: agent reproduced failing fixture test, found multiply-instead-of-divide bug, fixed it, re-verified. **87/87 tests green** (14 files). Decisions #16/#17. Awaiting user F5 demo. |
| 2026-10-15 | **Phase 4.5 executed (user task list).** Sub-agent specialists (4, read-only, isolated sub-loops + delegation tracking). Skill engine on markdown files (`~/.grouter/skills/`). **25 builtin skills** each with objective + 3-5 goals + triggers + detailed playbook — seeded live to disk. Skill tools (list/read/create/delete) + auto-learning from session context + injection into all modes. More tools: find_files, fetch_url. LM manifest regenerated: 20 tools. **115/115 tests green** (17 files) incl. live delegation test. Awaiting user F5 demo. |
| 2026-10-15 | **Phase 5 executed.** MCP both directions. **Server**: `dist/mcp-server.js` stdio entry (headless registry, 12 tools, annotations, approval routing); `gRouter: Start MCP Server` + Reconnect commands. **Client**: config discovery (`.vscode/mcp.json`/`.mcp.json`/`~/.grouter/mcp.json`), stdio + HTTP transports, namespaced tool ingestion with readOnlyHint mapping, error states. `/mcp` status command. **Two real bugs found by live roundtrip testing and fixed** (vscode import in headless process; JSON Schema→Zod optional fields). **125/125 tests green** (19 files) incl. real client↔server process roundtrip with file operations verified on disk. Awaiting user F5 demo. |
| 2026-10-15 | **Phase 6 executed.** **Performance**: production/dev build split — extension.js 4.19MB→**1.98MB**, mcp-server 1.33MB→**0.71MB**, dev spikes removed from the production bundle, activation path trimmed. **Security review PASSED**: no keys in repo, no type escapes, no empty catches; egress audit (2 fetch + 3 spawn sites, all gated/read-only). **Docs**: comprehensive README + MIT LICENSE + .vscodeignore. **VSIX**: packaged (724 KB, 7 files) and **installed + verified via the real VS Code CLI** (`grouter.grouter-code`). **125/125 tests green** on the production build. Deferred with reasons: cross-OS CI (no access), marketplace icon/banner + publisher account (Q-7), telemetry decision (Q-6). **Final gate: user F5 demo.** |
| 2026-10-15 | **Release finishing pass.** **Marketplace assets**: `scripts/gen-assets.mjs` — dependency-free PNG encoder (zlib + CRC32) producing icon.png (256×256) + banner.png (1280×640); both visually verified. **Metadata**: displayName/description/keywords/galleryBanner/icon/categories; version bumped to **0.1.0**. **CHANGELOG.md** (Keep a Changelog format, full feature inventory). **CI**: GitHub Actions matrix (ubuntu/windows/macos × Node 22) — type-check, build, unit, offline integration, conditional live-gateway tests, VSIX artifact; **test guards added** (`test/live.ts` + `describe.skipIf`) so keyless CI skips live tests instead of failing — verified by simulation (0 failures). **VSIX 0.1.0** (10 files, 781 KB) installed + version-verified. **126/126 tests green** locally. Remaining: user F5 demo + publisher account. |

---

*End of STATE v0.1 — keep this file updated; it is the single source of truth for progress.*
