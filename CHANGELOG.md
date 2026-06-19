# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-19

### Added

- **The local Ollama daemon now starts automatically.** When the backend is
  `ollama` and the server isn't already running, klaude spawns a detached
  `ollama serve` on session start and waits for it to come up. Previously, if
  the daemon was down every translation threw `TypeError: fetch failed` and the
  original Korean was submitted untranslated — translation silently stopped
  working. The auto-start is best-effort and never blocks `claude` from
  launching; it's a shared daemon, so it reuses the same `localhost:11434` as
  your other apps. A remote `OLLAMA_HOST` is never auto-started (klaude only
  warns), since `ollama serve` always binds locally.
- **`klaude model` subcommands for managing local models:**
  - `klaude model list` — list installed Ollama models with size, an
    `(embedding)` tag, and a `◄ current` marker for the configured one.
  - `klaude model use <name>` — switch the backend to a local model, validating
    it's installed first (otherwise it points you at `ollama pull`).
  - `klaude model bench [names...]` — compare models on ko→en translation,
    printing each model's output and average latency. Defaults to all installed
    chat-capable models; pass names to limit the set.

### Fixed

- **Translation failures no longer eat the last syllable of your input.** The
  "🔄 번역중..." indicator is appended after the Korean input and removed on the
  failure path before submitting the original. The removal reused the same
  delete helper as the full-box wipe, which over-deletes by a safety margin
  (+4 chars) — fine when clearing everything before a retype, but it chewed off
  the tail of the user's real input when only the indicator was meant to go.
  This bit on *every* failure, e.g. whenever the Ollama daemon was down. The
  indicator is now removed with an exact count, leaving the input intact.

## [0.1.5] - 2026-06-15

### Fixed

- The conversation-context hint (added in 0.1.4) could backfire on small local
  models: given a short input carrying mostly English identifiers (e.g.
  `아니 product.upload.single, product.upload.bulk 2개` — 3 Korean chars),
  gemma3:4b regurgitated the reference context as a fabricated Korean question
  instead of translating, and the result was submitted to Claude verbatim. Two
  independent guards now prevent this:
  - **Context is skipped when the input has too little Korean to translate**
    (fewer than `KLAUDE_CONTEXT_MIN_KO_CHARS`, default 8). A thin Korean signal
    can't anchor the model against a long reference block, so the hint is
    dropped — the few Korean words translate fine without it.
  - **The Korean-echo detector no longer misses identifier-diluted echoes.**
    It previously flagged output only above a 30% raw CJK-character ratio;
    embedded English identifiers (`product.upload.single`, …) dragged the ratio
    under the threshold so an all-Korean hallucination passed. It now strips the
    pass-through identifiers (tokens present in both input and output) before
    measuring, so the model's own prose is what's judged. A caught echo retries
    once **without** context, then falls back to the original input.

## [0.1.4] - 2026-06-15

### Fixed

- Pasting a few lines of English alongside a Korean question no longer drops the
  Korean. Small local models (gemma3:4b) tend to echo a multi-line English block
  verbatim and silently omit the Korean riding with it — and because the output
  is valid English, the failure detector missed it. Line-level masking now
  activates on any MIXED input (≥ 1 Korean line + ≥ 2 non-Korean lines) instead
  of only on long (≥ 400-char) inputs, so the English lines are collapsed into
  `{K…}` placeholders and only the Korean is translated; the English is restored
  verbatim. Tune the char floor (now 0 by default) via `KLAUDE_LINE_MASK_MIN_CHARS`.

### Added

- The translator now receives Claude's recent on-screen output as a
  terminology/disambiguation hint (reference only — never translated or echoed),
  improving consistency on domain terms. Skipped on the first prompt of a session
  (no prior Claude turn yet). Disable with `KLAUDE_NO_CONTEXT=1`; cap the hint
  size with `KLAUDE_CONTEXT_CHARS` (default 1200).

## [0.1.3] - 2026-06-02

### Added

- `Ctrl+Enter` submits the current input untranslated — the original Korean
  reaches Claude verbatim (no `Respond in Korean.` suffix either). Terminals
  encode `Ctrl+Enter` as a distinct CSI sequence (`\x1b[27;5;13~`, or
  `\x1b[13;5u` under the Kitty protocol) rather than a bare CR, so it's caught
  before the translate path with no collision against plain Enter / Shift+Enter.
  (`Cmd+Enter` and `fn+Enter` can't be used — terminals swallow them or emit the
  same bytes as plain Enter.)
- `KLAUDE_DUMP_KEYS=1` logs raw keyboard byte codes to the debug log (and enables
  logging on its own) — a diagnostic for discovering key-chord encodings.

### Changed

- README is now Korean-first (`README.md` Korean, `README.en.md` English), with
  the Korean body rewritten in polite 존댓말. Documented `--resume` (and other)
  claude flag passthrough, bash mode (`!`), and the debug env vars.

## [0.1.2] - 2026-06-02

### Fixed

- Bash-mode commands (input starting with `!`, e.g. `!git pull`) are no longer
  intercepted or translated. In bash mode Claude Code swaps the `❯` prompt
  marker for a `!`, which `PROMPT_LINE` didn't match — so `extractInputBox()`
  fell back to a stale `❯ <korean>` row in scrollback and mis-translated,
  clobbering the bash command. Added a `hasBashPrompt()` screen check plus an
  extracted-text `!`-prefix guard, both running before the translate path.

## [0.1.1] - 2026-06-02

### Fixed

- `build` script now sets the executable bit on `dist/index.js`
  (`tsc && chmod +x dist/index.js`). `tsc` strips the execute permission on
  compile, which left the `klaude` bin non-executable and caused
  `zsh: permission denied: klaude` when launching via the global symlink.

## [0.1.0] - 2026-05-30

First public release on npm.

### Added

- Korean → English Enter-time intercept for Claude Code via `node-pty`
  PTY spawn and `@xterm/headless` screen mirror.
- Two translation backends:
  - **Haiku** (default, requires `ANTHROPIC_API_KEY`)
  - **Ollama** (local, configurable host and model)
- Placeholder protection for `@mentions`, `/slash-commands`, inline /
  fenced code, and URLs; round-trip mask + restore around translation.
- Line-level masking for large pasted logs / code dumps (activates above
  400 chars with ≥ 3 non-Korean lines).
- Translation failure detection with one retry: CJK echo, few-shot example
  echo, length disproportion, and missing input content. On total failure,
  klaude falls back to submitting the original Korean (Claude is
  multilingual) rather than fabricated English.
- User glossary: `klaude glossary add/remove/list` for Korean → English
  proper-noun mappings that take priority over the built-in jargon list.
- Smart pass-through: autocomplete popups, `1. Yes`-anchored confirmation
  menus, `✓ Submit` form widgets, boxed modal dialogs, and editor
  attachment markers (`[Image #N]` / `[Pasted text #N]`) all bypass
  translation so the underlying Claude Code TUI behaves natively.
- Token-discipline rules install/uninstall (`klaude install-rules` /
  `klaude uninstall-rules`) — four rules added to `~/.claude/CLAUDE.md`
  to reduce token usage globally.
- Debug log at `~/.klaude/debug.log` with 10 MB rotation
  (override via `KLAUDE_LOG_MAX_BYTES`). Disabled by default.
- Subcommands: `config get/set`, `glossary list/add/remove`,
  `install-rules`, `uninstall-rules`, `--version`, `--help`. All other
  flags pass through to `claude` unchanged (`--resume`, `--continue`,
  `--model`, etc.).
- Privacy section in README documenting backend transmission behavior
  and the on-disk debug log.
- Platform support table: macOS validated, Linux/Windows experimental.
- Build-tools prerequisite notes for `node-pty` native module compilation.

### Infrastructure

- vitest test suite: 76 tests across `tokenize`, `mirror`, `translate`,
  `intercept`, `log`.
- Biome lint + format configuration; `npm run check / format / lint`.
- GitHub Actions CI on macOS-latest with Node 20 and 22 matrix:
  Biome check → tsc typecheck → vitest → tsc build → install/uninstall
  smoke test.
- Community files: `CONTRIBUTING.md`, `SECURITY.md`, bug-report and
  feature-request issue templates, and a PR template.

[Unreleased]: https://github.com/Leviosa-AI/klaude/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Leviosa-AI/klaude/releases/tag/v0.1.0
