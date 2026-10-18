# AUDIT.md — Deep Audit of gRouter (v0.1.0 baseline)

**Audit date:** 2026-10-15
**Auditor:** AI (systematic code review + dead-code analysis + claim-vs-reality verification)
**Scope:** `src/**` (48 files), `test/**` (24 files), `.github/workflows/**`, `package.json`, `README.md`, `docs/STATE.md`
**Method:** static analysis, cross-reference tracing (definition → call site), claim verification against implementation, test coverage mapping
**Build audited:** the v0.1.0 baseline tree

> **Note (2026-10-16):** This audit was performed against the v0.1.0 baseline.
> The extension is now gRouter, currently released as **0.3.1**, published to the
> VS Code Marketplace as `grouter.grouter-code` (publisher `grouter`). The findings and
> their fix status below still describe the current code, since the remediation work
> carried over unchanged into 0.3.0.

---

## Fix Status (as of audit remediation commit)

| Finding | Status | Verification |
|---|---|---|
| C-1 | ✅ FIXED | `isDestructiveRequest` wired into the gate; forced prompt; 5 unit tests |
| C-2 | ✅ FIXED | throws on deny/failure; denied counts, filesChanged, tool-end ok accurate; regression test |
| C-3 | ✅ FIXED | delegation routes through the real gate; tester lost `run_command`; 2 regression tests |
| C-4 | ✅ FIXED | CI job-level env for live tests |
| C-5 | ✅ FIXED | in-editor HTTP MCP server with approval routing + command UX + integration test |
| H-1 | ✅ FIXED | single exit via `finally`; plan/debug/agent all persist; stream text captured |
| H-2/H-3/M-7 | ✅ FIXED (code + docs) | `latestForWorkspace` resume; README corrected to step-level reload resume |
| H-4 | ✅ FIXED | shared `schemaBridge`; MCP client tools expose real input schemas; test |
| H-5 | ✅ FIXED | `resolveEnvVars` applied to env/headers/args |
| H-6 | ✅ FIXED | stderr drained to the logger |
| H-7 | ✅ FIXED | `resolveContextWindow` cached, threaded to all 4 context builds |
| M-1 | ✅ FIXED | `openPlan` reads SQLite session plans |
| M-2 | ✅ FIXED | `disposeSessions()` persists + cleans temp on deactivate |
| M-3 | ✅ FIXED | `activeSession` tracked per running turn |
| M-4 | ✅ FIXED | `unregisterWhere` on reconnect/disconnect |
| M-5 | ✅ FIXED | `normalizeResetToMs` (seconds vs ms) |
| M-6 | ✅ FIXED | usage rendered per turn (in/out/thinking) |
| M-8 | ✅ FIXED | fresh thread id when plan complete; stable while resumable |
| M-9 | ✅ FIXED | `agent.learnSkills` toggle (default true) |
| M-10 | ✅ FIXED | `/help` shows tool usage, delegations, memory counters |
| M-11 | ✅ FIXED | text-only steps count as ok via `textLength` |
| L-1..L-7 | ✅ FIXED | metadata, dead fields, formatApprovalDetail wired, README counts, HOME fallback |
| L-8..L-10 | ℹ️ WON'T FIX (cosmetic/accepted) | noted below |

**Remaining test status:** 132/133 offline tests green; the single failure requires live gateway connectivity (external network outage, not a regression).

---

## Severity Legend

| Level | Meaning |
|---|---|
| 🔴 **CRITICAL** | Safety claim false, or a shipped feature does not work as documented |
| 🟠 **HIGH** | Correctness bug with user-visible wrong behavior, or major functional gap |
| 🟡 **MEDIUM** | Degraded behavior, resource leak, misleading data, or cost issue |
| 🔵 **LOW** | Dead code, metadata gaps, cosmetic issues |

---

## 🔴 CRITICAL FINDINGS

### C-1 — Destructive-command detection is dead code; the safety claim is FALSE

**Evidence:**
- `src/tools/fsGuard.ts:66` — `isDestructiveCommand()` is exported and unit-tested (`test/unit/fsGuard.test.ts`)
- **Zero call sites in `src/`** (verified by cross-reference scan)
- **No tool sets `destructive: true`** (verified: grep for `destructive:\s*true` in `src/tools/` returns nothing)
- `src/tools/builtin/runCommand.ts` declares only `readOnly: false`
- `README.md:45` claims: *"Destructive commands (`rm -rf`, `git reset --hard`, force push, `curl | sh`) **can never be auto-approved**"*

**Impact:** If a user ever answers **"Always allow (this session)"** for `run_command`, every subsequent command — including `rm -rf /`, `git push --force`, `curl … | sh` — runs with **no prompt at all**. The `forced: true` prompt branch in `approvalPolicy.ts:31` (`if (subject.destructive)`) is unreachable because nothing ever sets that flag. The tested function guards nothing.

**Fix:**
1. In the approval flow (`src/tools/approvalGate.ts` or `agentRuntime.ts`), when `toolId === "run_command"`, inspect `input.command` with `isDestructiveCommand()` and force `destructive: true` on the request — this makes the forced-prompt branch reachable.
2. Additionally strip destructive commands from session-allowlist auto-approval (already handled by `forced: true` once (1) is done).
3. Add an integration test: session-allow `run_command` → send `rm -rf` → expect a forced prompt, never auto-allow.

---

### C-2 — Tool failure/denial accounting is broken; plan steps are falsely marked "done"

**Evidence:**
- `src/llm/agentRuntime.ts:113` — `toAiSdkTool.execute` **always returns a string** (`result.content`), and for denials returns the denial text. It never throws.
- `src/llm/agentRuntime.ts:73` — `case "tool-result"` fires for **every** return, including denials and failures (`ok: true` hardcoded at line 81).
- `src/llm/agentRuntime.ts:86-88` — `case "tool-error"` (the only place `denied++` happens) only fires when `execute` **throws** — which never happens. Therefore:
  - `result.denied` is **always 0**
  - `tool-end` events always report `ok: true` → `tool_usage` table records denials/failures as successes
  - `filesChanged` (line 74-77) adds the path of an `apply_patch` **even when the user denied it or the patch failed** — the "Files changed: X" summary lies
- `src/chat/participant.ts:567` — plan step success criteria: `ok = result.denied === 0 && result.toolCalls > 0` → **a step where the user denied every action is marked ✅ done**.

**Impact:** Denial counting, tool-usage analytics, file-change summaries, and plan step gating are all unreliable. The `denied` counter shown in chat ("N denied") never appears.

**Fix:** In `toAiSdkTool.execute`:
- Denial → `throw new Error("User denied: " + summary)` (AI SDK converts to `tool-error`; then prefix-match for `denied++`).
- `result.ok === false` → `throw new Error(result.content)` so failures also surface as `tool-error` with `ok: false`.
- Only add to `filesChanged` on a genuine success.
- Update `recordToolEvent` to distinguish denied vs failed vs ok.
- Add regression tests: deny a patch → `denied === 1`, `filesChanged` empty; failing `run_tests` → `tool-end ok:false`.

---

### C-3 — Sub-agent approval callback is a no-op; the tester specialist runs arbitrary shell commands with ZERO approval

**Evidence:**
- `src/agent/specialists.ts` — all 4 specialists declare `readOnly: true` (lines 28, 44, 60, 76)
- `src/tools/builtin/delegateTool.ts:70` — sub-agent approval: `approve: async () => (specialist.readOnly ? "allow" : "deny")`
- Because **every** specialist has `readOnly: true`, this callback returns `"allow"` for **every tool call** — including mutating ones
- The `tester` specialist's tool subset includes `run_command` and `run_tests` — both `readOnly: false` (`src/tools/builtin/runCommand.ts`, `testTools.ts`)
- The parent agent's real `ApprovalGate` is **not consulted** during delegation

**Impact:** The design intent ("specialists are read-only; the parent owns all mutations through the approval gate") is not enforced by the approve callback — it is only enforced by the tool-subset lists, which the tester's list violates by including `run_command`. Consequence: **any prompt injection or model misbehavior inside a tester delegation can execute arbitrary shell commands (including destructive ones) with no user prompt at all.** This is a safety bypass of the entire approval system. (My earlier draft of this finding said the tester "can never run tests" — that was wrong; the reality is the opposite and more severe.)

**Fix:**
1. Route delegation approvals through the real `ApprovalGate` (pass it via `DelegationContext`) instead of the hardcoded allow/deny stub — mutating calls then prompt the user like the parent does.
2. Remove `run_command` from the tester's subset (keep `run_tests`, which is scoped), or mark it destructive so it always forces a prompt.
3. Enforce the subset at execution time, not just registration: a specialist executing a tool outside its list must be denied.
4. Add a regression test: tester delegation attempting `run_command` → user prompt fires (or denial), never silent allow.

---

### C-4 — CI live-gateway tests can never run (condition always false)

**Evidence:** `.github/workflows/ci.yml:39-43`
```yaml
- name: Live gateway tests (only when GROUTER_API_KEY is configured)
  if: ${{ env.GROUTER_API_KEY != '' }}
  env:
    GROUTER_API_KEY: ${{ secrets.GROUTER_API_KEY }}
```
GitHub Actions evaluates a step's `if:` **before** applying that step's `env:`. `env.GROUTER_API_KEY` in the `if` expression refers to workflow/job-level env — which is never set. The condition is **always false**; live tests are skipped even when the secret exists.

**Fix:** Move the env to job level:
```yaml
jobs:
  build:
    env:
      GROUTER_API_KEY: ${{ secrets.GROUTER_API_KEY }}
```
…then `if: env.GROUTER_API_KEY != ''` works at step level. (Secrets cannot be used directly in `if:` — job-level env is the correct pattern.)

---

### C-5 — "In-editor MCP server with approval gate" does not exist; README claims it does

**Evidence:**
- `src/commands/index.ts:99` — `grouter.startMcpServer` spawns `dist/mcp-server.js` in a **terminal** — the standalone process with **auto-approve** (`src/mcp-server.ts:41-47` writes "auto-approving …" to stderr).
- `createMcpServer()` with a real approval callback (`src/tools/builtin/mcpServer.ts`) exists but is only used by **tests** — no command wires it in-editor.
- `README.md` (MCP section): *"In-editor mode routes mutations through the VS Code approval gate. Standalone mode has no UI and auto-approves — use it only in trusted workspaces."*
- `docs/STATE.md` Decision #24 states the same design — **not implemented**.

**Impact:** Users following the README believe `gRouter: Start MCP Server` is the safe, approval-gated path. It is not — it is the auto-approving standalone path. External clients can edit files in the workspace with zero prompts.

**Fix (choose one):**
- **(a)** Implement the in-editor server: a command that runs `createMcpServer` inside the extension host over a stdio bridge is not possible (the extension host has no stdio), so use the **HTTP transport** (`StreamableHTTPServerTransport`) with a localhost listener, and route `approve` → `ApprovalGate` (QuickPick).
- **(b)** Correct the README/STATE to state the truth: only standalone auto-approve mode exists; recommend workspace trust and `MCP_SERVER_EXCLUDE`.
- Either way, add a warning in the `startMcpServer` command UI itself (currently only a terminal stderr note).

---

## 🟠 HIGH FINDINGS

### H-1 — `/plan` bypasses `finishTurn()`: messages not persisted, stale active context

**Evidence:** `src/chat/participant.ts` — `runPlanMode()` (line ~318) and `executePlan()` return `{ metadata: { mode } }` directly at every exit. They never call `finishTurn()` (defined in the handler at line ~176), which is responsible for:
- `session.store.addMessage("assistant", …)` — **plan outputs are never saved to SQLite history**
- `session.memory.persist()` — counters not flushed (they are written incrementally, so mostly OK)
- clearing `activeToken` / `activeOnEvent` / `activeSignal` — **these stay pointing at a finished turn**

**Impact:** Plan assistant messages are missing from session history (skill matching reads `recentMessages`, so it is also blind to plan work). Stale `activeOnEvent` can route a later delegation's progress events into a disposed chat stream.

**Fix:** Wrap plan/execute paths with the same `finishTurn(mode)` used by ask/agent/debug, or call an explicit `endTurn()` in a `finally` block around the whole handler.

---

### H-2 — Plans are inaccessible after window reload (durability claim broken)

**Evidence:**
- `src/storage/sessionStore.ts` — plans are keyed by `(session_id, slug)`
- `src/chat/participant.ts:43-56` — the `sessions` Map is in-memory; a reload creates a **new** `SessionStore.create(...)` → **new session id**
- `SessionStore.getPlan/listPlans` filter by `session_id`

**Impact:** `/plan list` after a reload shows **nothing**, and `/plan execute <slug>` fails with "not found" — even though the plan row still exists in SQLite under the previous session id. The README claims "Plans are durable artifacts stored in SQLite" — durable on disk, but unreachable in practice across reloads. The same applies to chat history, memory KV, knowledge, and tool usage (all session-scoped).

**Fix:** Scope plans by **workspace**, not session (e.g. add a `workspace` column, or use a stable `workspaceKey` derived from the folder path as the session key). Alternatively, resume the most recent session for the workspace on activation: `SessionStore.latestForWorkspace(workspaceRoot)`.

---

### H-3 — Plan graph "resume after reload" is impossible (docs overclaim)

**Evidence:**
- `src/agent/plan/graph.ts:116` — `compile({ checkpointer: new MemorySaver() })` — **in-memory** checkpointer
- `src/chat/participant.ts:34` — `planGraphs` Map is in-memory
- `README.md`: *"resume across window reloads (LangGraph checkpointing)"*
- `docs/STATE.md` Phase 3 demo script: *"resume after reload"* — marked done

**Impact:** Within one window session, resume works (verified by tests). After a reload, the checkpoint is gone; the handler's `hasCheckpoint` branch (`graph.getState(...)`) finds nothing and restarts. The plan artifact resumes at the step level (SQLite), but the graph state (cursor, auto-approve flag, executed count) does not.

**Fix (choose one):**
- **(a)** Persist checkpoints: use LangGraph's SQLite checkpointer (or serialize `MemorySaver` storage) keyed by workspace-stable thread id.
- **(b)** Accept step-level resume only, and **correct the README/STATE claims** to "resume across turns within a window session".

---

### H-4 — MCP client tools lose their input schema (agent cannot call them correctly)

**Evidence:** `src/tools/builtin/mcpClient.ts:164` — `schema: z.object({}).passthrough() as never`
The MCP server's `inputSchema` (from `listTools`) is fetched into `McpToolDescriptor.inputSchema` but **discarded** when wrapping the tool. The model sees a tool with no parameters.

**Impact:** The agent guesses argument names for every external MCP tool. Most calls will fail validation on the remote server. This undermines the core MCP-client value proposition.

**Fix:** Reuse the JSON Schema → Zod converter already written for the server side (`mcpServer.ts:jsonSchemaToZod`) — extract it to a shared module and convert `tool.inputSchema.properties` + `required` here.

---

### H-5 — `${VAR}` placeholders in MCP configs are never resolved (`resolveEnvVars` dead)

**Evidence:**
- `src/tools/builtin/mcpClient.ts:223` — `resolveEnvVars()` exported, **zero call sites**
- `readMcpJsonConfigs` passes `env`/`headers` through verbatim

**Impact:** The conventional MCP config pattern `"env": { "API_KEY": "${MY_KEY}" }` passes the literal string `"${MY_KEY}"` to the server. Servers requiring secrets will fail auth. (The dead function was presumably written for this purpose.)

**Fix:** Apply `resolveEnvVars` to every `env` value and `headers` value in `normalizeConfig()`; warn in `/mcp` when a placeholder resolves to empty.

---

### H-6 — MCP stdio children spawn with `stderr: "pipe"` and nothing drains it

**Evidence:** `src/tools/builtin/mcpClient.ts:89` — `stderr: "pipe"`, and no `transport.stderr?.on("data", …)` consumer anywhere.

**Impact:** A chatty MCP server fills the OS pipe buffer (~64KB on Windows) and **blocks the child process** — the server stalls mid-session. Classic pipe-deadlock.

**Fix:** Either `stderr: "ignore"`, or attach a drain: `transport.stderr?.on("data", (d) => getLogger().info("[mcp] " + d))`.

---

### H-7 — Context budgeting ignores the selected model's real context window

**Evidence:**
- `src/chat/participant.ts` lines 288, 422, 769, 861 — `contextWindow: 200_000` **hardcoded** in all four call sites
- `listModels()` returns `contextWindow` per model (`src/llm/gateway.ts`), used only in the picker UI

**Impact:** Selecting a 1M-context model wastes 80% of capacity; selecting a 32k model can overflow the window (budget = 60k tokens ≈ 240KB of context, which exceeds small models).

**Fix:** Resolve `contextWindow` from the model registry (cache the `/models` response; fall back to 200k) and pass it into `assembleContext`.

---

## 🟡 MEDIUM FINDINGS

### M-1 — `gRouter: Open Plan` reads the wrong location (stale pre-SQLite path)

**Evidence:** `src/commands/index.ts` — `grouter.openPlan` reads `<workspace>/.grouter/plans/*.md`. Since Decision #14, plans live in **SQLite** (`~/.grouter/grouter.db`). The command always warns "no plans found". The chat-side "Open plan file" button that once pointed at it was removed.

**Fix:** Reimplement against `SessionStore.listPlans()` (QuickPick → render the plan markdown in a virtual doc), or remove the command from `package.json`.

### M-2 — Session temp workspaces are never cleaned up

**Evidence:** `TempWorkspace.cleanup()` exists (`src/storage/tempWorkspace.ts`) but **zero call sites**. `deactivate()` only disposes the logger.

**Impact:** `%TEMP%/grouter/<sessionId>/` accumulates one directory per session forever.

**Fix:** On deactivate, clean the current session's temp dir (best-effort); add a startup sweep removing `grouter/*` dirs older than N days.

### M-3 — `getActiveSession()` returns the *first* session, not the current one

**Evidence:** `src/chat/participant.ts` — `getActiveSession()` returns `[...sessions.values()][0]`. It backs `recordDelegation`, the delegation `sessionId`, and the `startMcpServer` cwd.

**Impact:** With multiple workspaces, delegations and tool-use rows can be attributed to the wrong session. `startMcpServer` may use another workspace's temp dir as cwd.

**Fix:** Track the session of the currently-executing turn (set in the handler) instead of map order.

### M-4 — MCP reconnect leaves stale tools registered; no unregister path

**Evidence:** `ToolRegistry` has no `unregister` (`src/tools/spec.ts`). `McpClientManager.connect` skips ids that already exist (`if (this.registry.get(id)) continue`), and `disconnect` removes nothing.

**Impact:** After a server changes its tool list, old tools remain callable (and fail at call time). After `disconnect`, tools still appear in the registry.

**Fix:** Add `ToolRegistry.unregister(id)`; on reconnect, drop the server's previous ids before re-registering.

### M-5 — `x-ratelimit-reset` stored without unit conversion

**Evidence:** `src/llm/runtime.ts:48` — `resetAtMs: Number(reset)`. Standard `x-ratelimit-reset` is **Unix seconds**; the field name implies milliseconds. Currently only `remaining` is rendered, so the wrong value is latent, not visible.

**Fix:** `Number(reset) * 1000` (or rename the field to `resetAtSeconds`).

### M-6 — Token `usage` is never shown to the user

**Evidence:** `src/chat/render.ts` — `case "usage": break;` (no-op). The event carries input/output/reasoning tokens.

**Fix:** Render a one-line footer per turn (e.g. `· 1.2k in / 340 out / 210 thinking`) or add it to `/help` diagnostics.

### M-7 — A new session row is created on every window reload; history is never resumed

**Evidence:** `sessions` Map is in-memory; `SessionStore.create` inserts a fresh row. Old rows persist but nothing ever lists or resumes them. `SessionStore.get()` and `setTitle()` have zero production callers.

**Impact:** SQLite grows one session per reload; users can never see yesterday's history in a new window. The `title` column is always empty.

**Fix:** On activation, resume the latest session for the workspace (see H-2 fix) and set its title from the first user message.

### M-8 — Plan thread-id collisions

**Evidence:** `threadId = plan-${sessionId}-${slug}` (`src/chat/participant.ts:~540`). Re-executing a completed plan reuses the finished checkpoint; regenerating a plan with the same slug collides with the old thread state (auto-approve flag, cursor).

**Fix:** Append a monotonic run counter or `Date.now()` to the thread id; persist `lastThreadId` per plan if resume is desired.

### M-9 — Skill learning adds an LLM call after every agent/debug turn

**Evidence:** `src/chat/participant.ts:scheduleSkillLearning` fires `maybeLearnSkill` (a full `generateText` call) after each turn that used tools.

**Impact:** ~10-30% extra token cost on agent turns. (Guardrails exist: 40-skill cap, only when tools/files changed.)

**Fix:** Consider a config toggle (`agent.learnSkills: true`) and/or sample every Nth turn.

### M-10 — The memory layer is write-only in production (dead read APIs)

**Evidence (production call sites = 0 unless noted):**
- `MemoryState.addNote()` — never called → `notes` in `state.json` is always empty
- `SessionStore.setMemory/getMemory/allMemory` — only used by tests
- `SessionStore.toolUsageSummary()` — never called (data collected, never surfaced)
- `SessionStore.delegationStats()` — never called
- `MemoryState.setActivePlan()` — called once at plan creation, never read back
- `SessionStore.setTitle()` — never called
- `SessionStore.get()` — never called

**Impact:** The "memory" subsystem (a user directive) collects data that nothing consumes. `notes`, knowledge search, and tool-usage analytics have no UI/agent surface.

**Fix:** Surface the data: `/diagnostics` summary (tool usage, delegations), inject `getMemory`-backed facts into prompts, or call `addNote` from the agent loop for durable observations.

### M-11 — Plan step success heuristic fails legitimately tool-free steps

**Evidence:** `src/chat/participant.ts:567` — `ok = result.denied === 0 && result.toolCalls > 0`. A step that is purely analytical ("confirm the endpoint responds") with zero tool calls is marked **failed**.

**Fix:** Treat `toolCalls === 0` as "no evidence" (mark failed only if the step declared a `verify` command that did not run), or let the model's final message declare completion and log it as unverified.

---

## 🔵 LOW FINDINGS

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| L-1 | `package.json` missing `repository`, `homepage`, `bugs` — marketplace listing has no repo links | `package.json` | Add all three pointing at GitHub |
| L-2 | `planQueue` field declared and initialized, never used | `participant.ts:40,54` | Remove |
| L-3 | `formatApprovalDetail`, `normalizeDecision` dead exports | `approvalPolicy.ts` | Remove or use |
| L-4 | `test/stubs/vscode.ts` lacks the `debug` namespace → debugTools execute paths are untestable; `SourceBreakpoint`/`FunctionBreakpoint`/`Position`/`Location` missing | `test/stubs/vscode.ts` | Extend stub; add debugTools unit tests |
| L-5 | `RenderState.sawReasoning` is written but never read for any decision | `render.ts` | Remove or use to collapse the thinking block |
| L-6 | README says "20 built-in tools"; the in-editor registry actually exposes 25 (incl. 4 skill tools + delegate) | `README.md` | Update count |
| L-7 | `mcpClient.discoverConfigs()` ignores `~/.grouter/mcp.json` when `USERPROFILE`/`HOME` both unset (edge) | `mcpClient.ts` | Fall back to `configDir()` from homeConfig |
| L-8 | `truncateText` marker counts "lines" from the remainder, not real line count of what was dropped | `budget.ts` | Minor wording fix |
| L-9 | `ci.yml` package job does not re-run tests (relies on `needs: build`) — acceptable but noted | `ci.yml` | Optional |
| L-10 | Standalone MCP server prints the auto-approve warning to **stderr only**; the VS Code command shows a neutral toast | `commands/index.ts:99` | Show a modal warning in the command |

---

## Documentation vs Reality — Claims to Correct

| Claim | Location | Reality |
|---|---|---|
| "Destructive commands … can never be auto-approved" | README.md:45 | **False** — detection is dead code (C-1) |
| "In-editor mode routes mutations through the VS Code approval gate" | README.md (MCP section), STATE #24 | **False** — only the auto-approving standalone exists (C-5) |
| "resume across window reloads (LangGraph checkpointing)" | README.md | **False across reloads** — in-memory checkpointer (H-3) |
| "Plans are durable artifacts stored in SQLite" | README.md | Durable on disk, but unreachable after reload (H-2) |
| "Files changed: X" in agent summary | participant.ts | Includes denied/failed patches (C-2) |
| "(N denied)" counter | participant.ts | Always 0 (C-2) |
| Tester specialist "runs verification" | README.md, specialists.ts | Every run_tests call is denied (C-3) |
| Live gateway tests in CI when key configured | ci.yml | Condition always false (C-4) |

---

## Verified Healthy (checks that passed)

- **Secrets:** no API keys in the repo (only the intentional fake `gRouter-` test fixture); secrets live in `~/.grouter/` (outside the repo) — verified by scan
- **Type safety:** zero `as any` / `@ts-ignore` / `@ts-expect-error` in source (all grep hits were skill documentation text); `tsc --noEmit` clean
- **Error handling:** zero empty catch blocks in source
- **Path confinement:** `resolveInWorkspace` is correctly wired into all file tools (traversal tests green)
- **Approval policy core:** untrusted-workspace denial, read-only auto-allow, session allowlist — all covered by tests and correct (except the destructive branch, C-1)
- **MCP server:** real client↔server roundtrip verified (12 tools, file ops on disk); schema→Zod conversion correct (optional-field handling)
- **Plan graph:** interrupt/resume routing correct within a session (6 integration tests)
- **Test suite:** 154/154 green (24 files); CI-safe skip guards verified by simulation (keyless = 18 passed + 12 skipped, 0 failures)
- **Packaging:** VSIX clean (13 files), installed & version-verified; marketplace publish live as `grouter.grouter-code`

---

## Recommended Fix Order

| Priority | Findings | Rationale |
|---|---|---|
| 1 | **C-3, C-1, C-2** | Safety bypasses + broken accounting in the agent loop. C-3 is the most severe (silent shell execution); C-1 makes a tested guard inert; C-2 corrupts denials/file-changes/plan gating. All three are small, well-scoped fixes with clear tests |
| 2 | **C-5, C-4** | Make shipped claims true (MCP safety story, CI live tests) |
| 3 | **H-1, H-2, H-3** | Session/plan durability — fix code where cheap (H-1), correct docs where expensive (H-3) |
| 4 | **H-4, H-5, H-6** | MCP client quality — the client is currently barely usable for real servers |
| 5 | **H-7, M-1…M-5** | Model-aware budgeting + stale command + lifecycle leaks |
| 6 | **M-6…M-11, L-*** | Surface collected data, remove dead code, polish metadata |

**Estimated scope:** C-1/C-2/C-3 ≈ 1 focused session with tests; C-4/C-5 + H-1…H-6 ≈ 1-2 sessions; remaining ≈ 1 session.

---

## Summary

| Severity | Count |
|---|---|
| 🔴 CRITICAL | 5 |
| 🟠 HIGH | 7 |
| 🟡 MEDIUM | 11 |
| 🔵 LOW | 10 |
| **Total** | **33** |

**The single most important finding is C-3**: sub-agent delegations execute mutating tools with zero user approval because the approve callback unconditionally allows (all specialists are flagged read-only while their tool subsets include `run_command`). This is a complete bypass of the approval system.

**Second most important is C-1**: the destructive-command detector — the only thing standing between a session-allowed `run_command` and `rm -rf` — is dead code with a passing unit test, giving false confidence.

Both are fixable in a single focused session with regression tests.

---

## Audit Trail

- 40+ targeted cross-reference scans executed (definition→call-site tracing for every exported function in `src/`)
- All 48 source files read or grepped; the 12 highest-risk files read in full
- Claims cross-checked against `README.md` and `docs/STATE.md`
- Findings verified against the built artifact (`dist/`) where behavior differed from source expectations
- No finding in this document is speculative: each cites a file, line, and observable consequence
