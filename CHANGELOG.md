# Changelog

All notable changes to gRouter are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.3] — 2026-10-18

### Fixed — screenshot dokumentasi sekarang menampilkan fitur yang sebenarnya

Screenshot 0.4.1/0.4.2 diambil saat panel chat masih kosong: yang terekam hanya
status bar dan panel AI bawaan VS Code, bukan percakapan gRouter. Keempat gambar
diambil ulang dan sekarang benar-benar memuat output fitur:

- `shot-chat.png` — `/help` yang dijawab handler gRouter sendiri, ter-render
  rapi, lengkap dengan `26 tools registered`.
- `shot-verify.png` — tabel verify gate asli dengan alasan tiap pemeriksaan
  di-skip, bukan klaim palsu "semua hijau".
- `shot-ralph.png` — hasil `/ralph` sungguhan: 3 iterasi, stop reason
  "pekerjaan BELUM terverifikasi".
- `shot-hud.png` — HUD status bar dengan `sample.ts` terbuka.

Harness screenshot juga diperbaiki: registry tool diinisialisasi lebih dulu
(sebelumnya `0 tools registered`), preview Markdown tidak lagi memakai tab
basi, dan notifikasi Git dimatikan agar tidak menutupi frame.

## [0.4.2] — 2026-10-18

Documentation completeness release. No runtime changes.

### Added
- `docs/USER-GUIDE.md` now lists **all 26 built-in tools**, split into read-only,
  approval-required, and verification groups, with the `verify_work` tool and the
  manual `gRouter: Verify Work` command documented for the first time.
- Two more screenshots in the USER-GUIDE: the verify gate rejecting a claim on a
  test-less project, and the HUD in the real status bar.

### Verified
- 72/72 tests covering the 0.4.0 features (verifyGate, verifyTool, ralphLoop,
  hud) pass.
- End-to-end gate behaviour re-proven in all three directions: an empty project
  is rejected, a failing suite is rejected, a passing suite is allowed.
- All four screenshots regenerate successfully from a live VS Code host.

## [0.4.1] — 2026-10-18

Documentation and evidence release. No runtime behaviour changes from 0.4.0.

### Added
- **Real screenshots from a live VS Code instance.** The three previous README
  images were hand-drawn ASCII cards rendering a `curl` call — they documented
  the gateway, not the extension. `npm run shots` now boots VS Code 1.142.0,
  activates the packaged extension and photographs the workbench over the
  DevTools protocol:
  - `assets/shot-verify.png` — the gate rejecting a completion claim on a
    project with no test command (every check listed as `skipped`, not green)
  - `assets/shot-ralph.png` — `/ralph` stopping at the iteration limit and
    reporting the work as **not verified**
  - `assets/shot-hud.png` — HUD live in the status bar
  - `assets/shot-chat.png` — `@grouter` participant + ralph-mode HUD
- Screenshots wired into the README feature sections and into
  `docs/VERIFICATION.md` §3.

### Fixed
- `docs/VERIFICATION.md` §3 still claimed `146 passed`; it now reports the real
  counts (198 unit + 25 offline integration + 17 host = 223).
- README claimed the in-editor UI had "not yet been exercised in a packaged
  VS Code install". That stopped being true once the 17 host tests landed. The
  claim is replaced with what is actually verified — and it now says explicitly
  that approval prompts, the plan panel and the debugger UI remain uncovered.

### Notes
- OS-level screen capture returns pure black on a headless session; the harness
  uses CDP (`Page.captureScreenshot`) instead, which renders without a display.

## [0.4.0] — 2026-10-18

Tiga fitur yang menutup kelemahan paling fatal versi sebelumnya: agent bisa
mengakhiri turn dengan klaim "selesai" padahal test masih merah, dan tidak ada
cara bagi user untuk melihat apa yang sedang terjadi.

### Added

- **Verify gate (bukti, bukan klaim).** Sebelum turn ditutup, gRouter sekarang
  mendeteksi klaim selesai dari jawaban agent ("all tests pass", "sudah
  selesai", "done", "everything works") lalu menjalankan verifikasi sungguhan:
  test suite, typecheck, dan `git diff --stat`. Exit code dan output asli
  dikumpulkan. Kalau salah satu merah, turn **ditolak** sebagai `unverified`,
  output gagal dikutip ke chat, dan agent diberi tahu persis apa yang harus
  diperbaiki. Kalau tidak ada yang bisa dijalankan, klaim juga ditolak sebagai
  *unverifiable* — "tests pass" tanpa test suite tetap klaim tanpa bukti.
  Deteksi tidak naif: "tests still fail", "I could not verify", "should pass",
  dan kalimat bertanya **tidak** dianggap klaim.
- **Tool `verify_work` (26 tool, sebelumnya 25).** Agent bisa meminta bukti
  sendiri sebelum mengklaim selesai, sehingga tidak perlu ditolak dulu.
- **Mode `/ralph` — persistence sampai verified.** Loop luar
  `kerja → verifikasi → kalau merah, umpan balik kegagalan → kerja lagi`.
  Bukti dikumpulkan oleh **loop**, bukan oleh agent, jadi agent tidak bisa
  melewati pengecekan. Berhenti dengan status jujur:
  `verified` (hijau), `max-iterations` (**BELUM** terverifikasi),
  `no-progress` (kegagalan sama berulang), `canceled`, `aborted`.
- **HUD status bar.** Mode, iterasi ralph, plan step, jumlah tool call, token,
  dan status verifikasi terakhir tampil langsung di status bar VS Code.
  Sebelumnya extension sama sekali tidak punya status bar item.
- Command `gRouter: Verify Work (tests + typecheck)` dan
  `gRouter: Show Last Verification Report`.
- Setting baru: `grouter.verify.enabled`, `grouter.verify.blockOnUnverified`,
  `grouter.verify.testCommand`, `grouter.verify.typecheckCommand`,
  `grouter.verify.timeoutSeconds`, `grouter.ralph.maxIterations`,
  `grouter.ralph.stallLimit`, `grouter.hud.enabled`.
- Test baru: `test/unit/verifyGate.test.ts` (28),
  `test/unit/verifyTool.test.ts` (7), `test/unit/ralphLoop.test.ts` (16),
  `test/unit/hud.test.ts` (21). Total 198 unit + 25 integration + 17 host.

### Fixed (ditemukan di audit pra-rilis 2026-10-18)

Empat bug nyata yang lolos dari suite hijau. Masing-masing sekarang punya test
regresi yang gagal kalau bug itu kembali.

- **Project tanpa test command dilaporkan HIJAU.** Semua hasil `skipped` dulu
  dianggap `ok: true`, jadi "tidak ada yang bisa diperiksa" tampil sama persis
  dengan "semua lulus" — kebohongan yang justru ingin dicegah verify gate.
  Sekarang `ok = tidak ada kegagalan DAN minimal satu bukti benar-benar jalan`,
  dengan blocker eksplisit "Tidak ada bukti yang bisa dikumpulkan".
  Test lama yang mengharapkan `ok: true` justru **mengunci bug ini**, dan sudah
  dikoreksi.
- **HUD bisa nyangkut "thinking" selamanya.** Blok `try { … } finally { … }` di
  chat handler tidak punya `catch`, jadi error yang dilempar melewati semua
  pemanggilan `hud.*`. Sekarang `finally` memaksa HUD selesai kalau fasenya
  masih `thinking`, sehingga exception, abort, dan early return semuanya
  membersihkan status bar.
- **`reportStatusIcon` tidak pernah dipakai kode produksi.** "Verify Work" cuma
  membuka laporan tanpa sinyal lulus/gagal, jadi run merah terlihat seperti
  sukses. Sekarang muncul notifikasi hijau / merah / skipped sebelum laporan
  dibuka.
- **Status verifikasi terakhir bersifat global, bukan per workspace.** Run merah
  di workspace A membuat "Show Last Verification Report" di workspace B menulis
  REJECTED untuk pekerjaan yang tidak pernah dijalankan di sana. State kini
  disimpan per workspace.

- **`verify_work` sama sekali tidak punya test.** Tool ke-26 terdaftar di
  manifest dan ditawarkan ke model, tapi `execute()` tidak pernah dipanggil di
  test mana pun — tool yang rusak total akan tampak identik dengan yang sehat.
  `test/unit/verifyTool.test.ts` sekarang menjalankannya terhadap project
  sungguhan.

### Changed

- Deteksi test command menyatukan aturan dengan tool `run_tests`, termasuk
  mengabaikan placeholder `Error: no test specified` dari `npm init`.
- Status turn kini bisa bernilai `unverified`, sehingga riwayat sesi tidak
  menyimpan klaim sukses yang tidak terbukti.

### Notes

- Verify gate hanya aktif untuk mode yang mengubah kode (`agent`, `debug`,
  `plan`, `ralph`). Mode baca-saja (`ask`, `skills`, `mcp`, `help`) tidak
  digerbangi karena tidak pernah mengklaim perubahan kode.
- Semua setting baru benar-benar dibaca lewat `loadConfigWithSettings()`, bukan
  setting hiasan — dijaga oleh `test/unit/settingsContract.test.ts`.

## [0.3.4] — 2026-10-17

### Fixed

- **The user guide sent every new user to a page that does not exist.**
  Step 3 gave wrong instructions: sign up at prod.grouter.web.id, find API Keys in
  a dashboard, then click a key-creation button. There is no signup, no dashboard,
  and no self-service key creation. Keys are **bought from the Telegram bot**
  ([@grouteerbot](https://t.me/grouteerbot)) and paid via **QRIS**; the key is
  delivered automatically after payment and starts with `grx_`. Anyone following
  the old guide stalled at step 3 and could never get a key. The guide now spells
  out the real buy flow, and the README, PRD, architecture notes and runtime
  error messages point at the bot instead of a non-existent dashboard.
- **The documented API key prefix was wrong.** Docs and prompt text said
  `gRouter-...` / `gRoute...`; the real prefix is `grx_`. Corrected in the user
  guide, README, PRD, changelog and the `gRouter: Set API Key` input prompt.
- **Runtime errors gave no next step.** A missing key and a `401 invalid_api_key`
  now say where to get a key (the Telegram bot) instead of only naming the config
  file.

### Added

- `test/unit/apiKeyOnboarding.test.ts` — fails the build if any user-facing file
  reintroduces dashboard/signup wording or a wrong key prefix, or drops the
  Telegram buy link from the guide and runtime errors.

## [0.3.3] — 2026-10-16

### Fixed

- **Skill and sub-agent tools were never available to the model.** VS Code
  ignores `lm.registerTool(name, …)` when `name` is missing from
  `contributes.languageModelTools`. The manifest generator built the list from
  `createDefaultRegistry()` with no options, which yields 20 tools; the running
  extension supplies a skill engine and a delegation context, so it registers
  25. The five extra tools (`list_skills`, `read_skill`, `create_skill`,
  `delete_skill`, `delegate_to_specialist`) were therefore rejected by the host
  with `Tool "…" was not contributed.` The generator now passes inert stand-ins
  for those dependencies so the manifest always covers the full set, and it
  reports which entries it added or removed.
- **Four settings did nothing.** `grouter.baseUrl`, `grouter.model`,
  `grouter.reasoning.show` and `grouter.telemetry.enabled` appeared in the
  Settings UI but were never read; only `grouter.mcp.port` was wired up. They are
  now applied as an override layer on top of `~/.grouter/config.json`, so the
  editor settings take precedence over the file without clobbering values the
  user set there.
- Removed a dead `modeNotice()` helper whose body was `return undefined`, which
  made the code path calling it unreachable.

### Tests

- Added a real VS Code extension-host suite (`npm run test:host`) driven by
  `@vscode/test-electron`. It boots an actual editor and asserts against the
  live `vscode` module, which the mocked vitest suite could not do: that suite
  aliases `vscode` to `test/stubs/vscode.ts`, a hand-written stub missing 24 of
  the 41 APIs the extension uses — including `ChatResponseStream`, which is how
  the 0.3.1 chat crash escaped. 13 host tests, including activation, command
  registration, chat participant wiring and the response-stream contract.
- Added `test/unit/toolManifest.test.ts` and `test/unit/settingsContract.test.ts`
  so the declared-vs-registered tool and setting mismatches fail fast in CI
  rather than only in a live editor.

## [0.3.2] — 2026-10-16

### Fixed

- **Chat crashed on every message in 0.3.1** with
  `get on proxy: property 'markdown' is a read-only and non-configurable data
  property on the proxy target but the proxy did not return its actual value`.
  The response stream was wrapped in a `Proxy` to capture streamed text, but VS
  Code defines `markdown` as read-only and non-configurable, which the
  ECMAScript Proxy invariant forbids rerouting. The `Proxy` is gone — the agent
  now writes through a plain facade, so the real stream is never proxied.
  Locked down by `test/unit/streamCapture.test.ts`.

### Added

- **[docs/USER-GUIDE.md](docs/USER-GUIDE.md)** — a complete, plain-language user
  guide. It assumes nothing: installing VS Code, installing gRouter, obtaining an
  API key, connecting it, and a first working chat. Includes explanations of
  approvals, destructive-command protection, skills, sub-agents and MCP, plus a
  full command / setting / troubleshooting reference. Linked from the README.
- **[docs/VERIFICATION.md](docs/VERIFICATION.md)** — what was actually run against
  the live gateway and the published package, with raw output. Includes the
  `ChatResponseStream` bug write-up and a known-limitations section.

## [0.3.1] — 2026-10-16

### Fixed

- **Live reasoning-delta test was flaky under parallel load.** The shared gateway
  can truncate a streamed response when other tests hammer it concurrently, so a
  single attempt occasionally returned empty text and failed the assertion even
  though the feature works. The test now retries the stream, and the full suite
  is reproducibly **141/141 green** (21 files).
- **`LICENSE` carried a personal name.** The copyright line is now "gRouter",
  and the `author` field in `package.json` is the project rather than an
  individual with a personal address.
- **Stale documentation numbers.** `AUDIT.md` claimed a 10-file / 0.2.0-era
  package; it now matches the shipped artifact.

## [0.3.0] — 2026-10-16

### Changed

- **New publisher and extension identity.** Published under the `grouter` publisher
  as `grouter.grouter-code`; the display name is now **gRouter** (was gRouter.AI).
  Install with `code --install-extension grouter.grouter-code`.
- Repository moved to https://github.com/grouter-inc/grouter-vscode

## [0.2.2] — 2026-10-16

### Changed

- **New Marketplace gallery banner.** Replaced with the updated gRouter artwork.

## [0.2.1] — 2026-10-16

### Changed

- **Brand logo.** The extension icon and Marketplace gallery banner now use the
  official gRouter mark, and the README opens with the banner so the branding
  is consistent on both GitHub and the Marketplace.
- **Install docs match reality.** The README and CHANGELOG no longer describe the
  extension as "not yet published" — it is live on the VS Code Marketplace as
  `grouter.grouter-code`, and the Marketplace install path is now the
  recommended one (the VSIX is kept as the offline/pinned option).

### Fixed

- **Plan generation aborted on the first transport hiccup.** A single dropped
  request — or a response body truncated by a busy gateway — returned an error
  immediately instead of retrying. Plan generation now retries transport
  failures up to 3 attempts with backoff, not just malformed-JSON responses.
- **Live smoke tests were flaky under load.** The plan-generation integration
  test now retries once and allows a longer timeout, so a slow shared gateway
  no longer produces a false failure.

## [0.2.0] — 2026-10-16

**gRouter rebrand + gateway correctness release.** The extension is now
gRouter, wired to the live [gRouter gateway](https://prod.grouter.web.id),
with two real API-integration bugs fixed. Test suite is 133/133 green (including
7 tests that run against the live gateway).

### Added

- **gRouter rebrand**: package `grouter-code`, publisher `grouter`, all
  commands/settings/chat-participant IDs under `grouter.*`, storage moved to
  `~/.grouter/` (SQLite `grouter.db`). 575 occurrences across 53 files.
- **Marketplace-ready metadata**: `displayName`, `description`, `keywords`,
  `galleryBanner`, `icon`, `categories`, plus `author` and `repository` /
  `homepage` / `bugs` pointing at the gRouter repo and website.

### Fixed

- **Non-streaming calls corrupted by an SSE trailer (critical).** gRouter
  defaults to streaming when `stream` is omitted and appends a `data: [DONE]`
  line to the JSON body. The AI SDK's non-streaming path read that as JSON and
  failed with *"Invalid JSON response"*, which broke **plan generation** and
  **automatic skill learning**. Fixed with a fetch wrapper that pins
  `stream: false` on non-streaming `/chat/completions` calls and strips the
  stray SSE trailer.
- **Plan generation aborted on the first transport hiccup.** A single dropped
  request (or a body truncated by a busy gateway) returned an error immediately
  instead of retrying, even though the very next attempt usually succeeds. The
  attempt loop now covers transport failures too, with a short backoff, and only
  surfaces the gateway error once all attempts are exhausted.
- **`/v1/models` parsing used the wrong schema.** The gateway returns camelCase
  `contextWindow` and does **not** expose `max_output_tokens` or a
  `capabilities` block; the previous parser read the wrong fields, so
  model-aware context budgeting fell back to a hardcoded window.
- **API key format corrected to `grx_...`.** The pre-rebrand placeholder
  prefix was wrong. The key is sent as a plain `Authorization: Bearer <key>`
  header — no prefix munging.
- **README**: dead `/docs` links replaced with the live site, and the
  Marketplace install claim corrected. The extension is now published as
  `grouter.grouter-code`.

### Changed

- Default `baseUrl` → `https://prod.grouter.web.id/v1`; default model →
  `DeepSeek-V4-Flash`.
- Audit/state docs now state that **no version has ever been published** to the
  VS Code Marketplace; the 0.1.0 baseline was packaged locally only.

### Notes

- The standalone MCP server (`dist/mcp-server.js`) still auto-approves with a
  stderr warning — use the in-editor mode for interactive work, or standalone
  only in trusted workspaces.

---

## [0.1.0] — 2026-10-15

First release. All four modes, agent intelligence
layer, and MCP in both directions. **Packaged and published to the VS Code
Marketplace** as `grouter.grouter-code`.

### Added

**Chat (`@grouter`)**
- Streaming markdown answers with collapsible reasoning/thinking display (when the model supports it)
- Workspace context assembly: active file/selection, `#`-referenced files, diagnostics — with token budget and explicit omission notes
- 6-turn conversation history, follow-up suggestions, rate-limit status bar
- Full gateway error taxonomy (12 kinds) with actionable action buttons

**Coding Agent (`/agent`)**
- Autonomous tool loop: reads, edits, runs commands, verifies — bounded iterations, cancellation
- 20 built-in tools: file read/write/patch, search, git, terminal, diagnostics, debug state, tests, skills, delegation
- Approval gate on every mutation: Allow once / Always allow (session) / Deny
- Workspace-trust aware: all mutations disabled in untrusted workspaces

**Planning (`/plan`)**
- Durable plan artifacts (SQLite) with objective, files, and verification per step
- LangGraph execution graph with `interrupt()` per step: approve / approve-all / skip / abort
- In-session resume via checkpointing; `/plan list`, `/plan execute`

**Debug (`/debug`)**
- Real debugger state via DAP: threads, stack frames, scopes, variables at a breakpoint
- Breakpoint tools (list/set/remove) and `launch_debug` with launch-config discovery
- `run_tests`: auto-detects npm/pytest/cargo/go; parses vitest/jest, mocha, pytest, cargo output with failure extraction

**Agent Intelligence**
- 4 read-only sub-agent specialists: explorer, researcher, reviewer, tester — via `delegate_to_specialist`
- 25 built-in skills as markdown playbooks (`~/.grouter/skills/`) with objective + goals + triggers, auto-matched and injected into context
- Skill creator tools (`list/read/create/delete`); auto-learning of reusable procedures from completed sessions

**MCP — both directions**
- **Client**: consume external MCP servers from `.vscode/mcp.json`, `.mcp.json`, or `~/.grouter/mcp.json`; stdio + Streamable HTTP; namespaced tools; `/mcp` status
- **Server**: expose gRouter tools via `dist/mcp-server.js` (stdio); `gRouter: Start MCP Server`

**Storage**
- SQLite (`~/.grouter/grouter.db`): sessions, messages, memory, knowledge, tool usage, plans
- Per-session JSON memory state (`~/.grouter/sessions/<id>/state.json`)
- Session scratch workspaces in the OS temp dir

**Configuration**
- `~/.grouter/config.json` (home-basedir): API key, base URL, model, reasoning effort, agent limits, auto-approve list

### Notes
- Requires a gRouter API key (`grx_...`, bought from the Telegram bot) and VS Code 1.140+
- IPv4-first DNS resolution is applied automatically for gateway connectivity
- Standalone MCP server mode has no approval UI and auto-approves mutations — use only in trusted workspaces
