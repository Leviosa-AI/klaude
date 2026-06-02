<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/flag-south-korea_1f1f0-1f1f7.png" width="120" />
</p>

<h1 align="center">klaude</h1>

<p align="center">
  <strong>Type Korean. Claude reads English. Replies in Korean. Zero cognitive overhead.</strong>
</p>

<p align="center">
  <em>한국어로 편하게 코딩하세요. Claude는 영어로 읽고, 한국어로 답합니다.</em>
</p>

<p align="center">
  <a href="README.md">한국어</a> ·
  <a href="README.en.md"><strong>English</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@leviosa-ai/klaude"><img src="https://img.shields.io/npm/v/@leviosa-ai/klaude.svg?color=red" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@leviosa-ai/klaude"><img src="https://img.shields.io/npm/dm/@leviosa-ai/klaude.svg" alt="npm downloads"></a>
  <a href="https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml"><img src="https://github.com/Leviosa-AI/klaude/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg" alt="Node">
  <img src="https://img.shields.io/badge/claude--code-compatible-orange.svg" alt="Claude Code">
</p>

<p align="center">
  <a href="#before--after">Before/After</a> •
  <a href="#install">Install</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#token-discipline-rules">Token discipline</a> •
  <a href="#commands">Commands</a>
</p>

---

Claude reasons most accurately in English. But Korean developers think in Korean.
Writing English prompts burns mental energy you'd rather spend on the actual problem —
and writing in Korean wastes tokens on a tokenizer that wasn't built for it, with
worse output to show for it.

**klaude sits between you and Claude Code.** Type Korean naturally; the moment you
hit Enter, klaude translates your prompt to English on the wire, sends it to Claude
Code, and Claude reasons in English while replying in Korean. The TUI is untouched,
the translation latency hits once per prompt, and the answer quality is the same as
if you'd written perfect English yourself.

> 🐕 **Dogfooded:** klaude itself was built with klaude — developed in Korean,
> reasoned in English.

## Before / After

<table>
<tr>
<td width="50%">

### 🤔 Raw Claude Code

```
> Make a React component that fetches
  user data from /api/users and shows
  it in a table with pagination
```

- Spends willpower composing English
- "fetches"? "retrieves"? — hesitation
- Inefficient phrasing burns extra tokens
- Reply is in English → translate in your head

</td>
<td width="50%">

### 🇰🇷 klaude

```
> /api/users 에서 유저 데이터 받아와서
  페이지네이션 있는 테이블로 보여주는
  React 컴포넌트 만들어줘
```

- Type Korean the way you think
- `@path`, `/command`, code stay verbatim
- Translated to English on Enter
- **`Ctrl+Enter` sends your Korean as-is**, untranslated
- Claude **replies in Korean**

</td>
</tr>
</table>

```
┌──────────────────────────────────────────────────┐
│  Native TUI preserved   ████████████  100%       │
│  Code/paths/cmds kept   ████████████  100%       │
│  Reasoning quality      ████████████  English    │
│  Mental overhead        ░░░░░░░░░░░░  ~0         │
└──────────────────────────────────────────────────┘
```

## Platform support

| Platform | Status |
|----------|--------|
| **macOS** | ✅ Tested, primary development target |
| Linux | ⚠️ Experimental — not yet verified end-to-end |
| Windows | ⚠️ Experimental — install path documented but TUI interaction untested |

klaude is built on `node-pty` and `@xterm/headless`. Both support all three
platforms in principle, but the screen-mirror heuristics (autocomplete popup
detection, prompt box detection, divider parsing) have only been validated
against Claude Code's macOS TUI. Linux/Windows users are welcome to file
issues with screen dumps from `KLAUDE_DUMP_POPUP=1`.

## Install

```bash
npm install -g @leviosa-ai/klaude
```

The published package is scoped under the Leviosa AI org, but the binary
it installs is still called `klaude`. Run it wherever you would normally
run `claude`:

```bash
klaude                  # Launches Claude Code with the intercept layer
klaude --resume         # Resume a previous session (any claude flag is forwarded)
klaude --help
```

Any flag klaude doesn't own is forwarded verbatim to `claude` — so session
flags like `--resume` / `--continue`, `-p "<prompt>"`, and model selectors all
work with the translation layer active. klaude only intercepts its own
subcommands (`config`, `glossary`, `install-rules`, `uninstall-rules`,
`--version`, `--help`).

> **First run:** klaude will offer to add four token-discipline rules to your
> global `~/.claude/CLAUDE.md`. The prompt defaults to **No** and klaude works
> fine if you decline. ([details](#token-discipline-rules))

### Build-tools prerequisites

klaude depends on `node-pty`, a **native module** that ships prebuilt binaries
for common platforms. If `npm install` falls through to a source build (you'll
see `node-gyp` running), install the platform's C/C++ toolchain first:

| Platform | Command |
|----------|---------|
| macOS | `xcode-select --install` |
| Debian / Ubuntu | `sudo apt-get install -y python3 make g++` |
| Fedora / RHEL | `sudo dnf install -y python3 make gcc-c++` |
| Windows | Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + Python 3 |

`@xterm/headless` is pure JavaScript and has no build prerequisites.

## How it works

```
user keystrokes ──→ node-pty ──→ claude (upstream UI, untouched)
claude output  ←─── node-pty ────────┘
                  │
                  ↓
            xterm-headless (screen mirror)
                  │
   Enter detected → extract input box → protect tokens → Haiku / Ollama
                                                            │
                  clear box → paste English translation → Enter ←
```

Key properties:

- **TUI untouched.** Claude Code's terminal UI is exactly upstream.
- **Keystroke passthrough.** `@` mentions, `/` slash commands, autocomplete all
  work natively because every keystroke is forwarded to the real `claude` process.
- **Intercept only at Enter.** `xterm-headless` reads the actually-rendered input
  box (so Tab-expanded `@path` mentions are captured correctly).
- **Selective translation.** Only Korean spans are translated; English text, code,
  paths, and URLs are masked with placeholders before translation and restored
  afterward.
- **Korean responses.** klaude quietly appends `Respond in Korean.` to the
  translated prompt.
- **Flags forwarded.** Any flag klaude doesn't own (`--resume`, `--continue`,
  `-p`, model selectors) passes straight through to the real `claude` process.
- **Bash mode respected.** Input starting with `!` runs as a Claude Code shell
  command and is never translated (see [Smart pass-through](#smart-pass-through)).
- **Ctrl+Enter submits raw.** Press `Ctrl+Enter` to skip translation and send your
  Korean through as-is (see [Submit raw](#submit-raw-ctrlenter)).

## Token preservation

The following are **never translated** and pass through verbatim:

| Protected | Example |
|---|---|
| Fenced code blocks | <code>```python ... ```</code> |
| Inline code | `` `useState()` `` |
| URLs | `https://example.com` |
| File mentions | `@src/index.ts` |
| Slash commands | `/review`, `/plan` |
| English identifiers | `React`, `useState`, `npm`, `Docker` |
| Korean transliterations of tech terms | `리액트` → `React`, `타입스크립트` → `TypeScript` |

Internally the translation engine (Haiku/Ollama) only sees `{K0}`, `{K1}` style
placeholders for the protected spans. Restoration happens client-side — so even
small local models like `gemma3:4b` cannot accidentally "fix" your code.

## Smart pass-through

klaude only translates input that's *yours to translate*. For everything else —
Claude Code's confirmation menus, autocomplete popups, modal dialogs, image
attachments — the Enter key passes through untouched, keeping the native UX
intact.

| Scenario | Detection | Behavior |
|---|---|---|
| Autocomplete popup open (`@`, `/`) | 2+ popup-item rows below the prompt | Pass-through (Enter selects from popup) |
| Interactive form widget | `✓ Submit` header visible on screen | Pass-through (widget owns Enter for navigation/toggle) |
| No Korean in input | No CJK chars in extracted text | Pass-through immediately (no render-delay) |
| Confirmation menu (`1. Yes` …) | Prompt content starts with `1. Yes` | Pass-through (CR selects the menu item) |
| Image / pasted-text attachment | `[Image #N]` / `[Pasted text #N]` marker present | Pass-through (clear+retype would destroy the attached object) |
| Modal dialog (pickers, etc.) | Prompt rendered inside box border (`│ ❯ …`) | Pass-through (modal editors don't honor our retype) |
| Bash mode (`!cmd`) | Input's first char is `!` — Claude Code swaps the `❯` marker for `!` | Pass-through (Claude Code runs it as a shell command — never translated) |

The `1. Yes` anchor covers every confirmation/permission menu we found in
Claude Code's compiled binary — option 1 has eight variants (`Yes`,
`Yes, auto-accept edits`, `Yes, manually approve edits`,
`Yes, and don't ask again for ...`,
`Yes, and allow Claude to edit its own settings ...`,
`Yes, and bypass permissions`, `Yes, and use auto mode`, `Yes, run it`),
all starting with the literal word `Yes`. Picker dialogs (ModelPicker,
ThemePicker, settings) use `borderStyle: "single"`, so they're caught by the
boxed-prompt branch. Claude Code's TUI is English-only as of writing, so
these anchors are stable.

**Bash mode** is handled the same way. When `!` is the first character of the
input box, Claude Code enters bash mode and swaps the `❯` prompt marker for a
`!`. klaude detects that swapped marker (and, as a fallback, a `!`-prefix on the
extracted text) and passes the Enter through untouched — so `!git pull` and
other shell commands run exactly as they would under raw Claude Code, even when
they contain Korean (e.g. `!echo 안녕`).

## Submit raw (Ctrl+Enter)

Sometimes the translation reads awkwardly, or you deliberately want Claude to see
the original Korean. For that, press **`Ctrl+Enter`** instead of plain `Enter` —
klaude skips translation and submits your Korean **verbatim** (it doesn't even
append `Respond in Korean.`).

```
Plain Enter:  이 변수 이름 그대로 둬   →   Keep this variable name as-is   (translated)
Ctrl+Enter:   이 변수 이름 그대로 둬   →   이 변수 이름 그대로 둬           (verbatim)
```

Terminals send `Ctrl+Enter` not as a plain Enter (`\r`) but as a distinct escape
sequence (`\x1b[27;5;13~`, or `\x1b[13;5u` under the Kitty protocol), which lets
klaude tell it apart from plain Enter and Shift+Enter with no collision. For the
record, `Cmd+Enter` and `fn+Enter` can't be used as triggers — the terminal
either swallows them or sends bytes identical to plain Enter — which is why
`Ctrl+Enter` is the chosen chord.

## Privacy

**klaude transmits your prompt to a translation backend on every Enter.**

- **Haiku backend** (default): the prompt is sent to the Anthropic API over TLS.
  Subject to Anthropic's data handling policy.
- **Ollama backend**: the prompt is sent to your local Ollama host (default
  `localhost:11434`). Nothing leaves your machine.

klaude does **not** transmit anything else: file contents, environment
variables (except `ANTHROPIC_API_KEY` used for Haiku auth), or text outside the
visible input box. The only on-disk artifact klaude writes is the optional
debug log at `~/.klaude/debug.log` (created only when `debug: true`, rotated at
10 MB to `debug.log.old` — disable with `klaude config set debug false`).

Before pressing Enter, review your prompt for secrets, PII, and confidential
code. Once submitted, klaude has no way to recall the transmission. For
fully local operation, use the Ollama backend.

## Backends

| Backend | Cost | Latency | Setup |
|---|---|---|---|
| **Haiku** (default) | ~$0.25 / $1.25 per MTok | API round-trip (~hundreds of ms) | requires `ANTHROPIC_API_KEY` |
| **Ollama** (local) | Free, offline | depends on local GPU/CPU | `ollama serve` + `ollama pull gemma3:4b` |

```bash
klaude config set backend haiku                  # default
klaude config set backend ollama:gemma3:4b       # local
klaude config set backend ollama:qwen2.5:7b      # any other model
```

Or override per invocation via env:

```bash
KLAUDE_BACKEND=ollama:gemma3:4b klaude
```

## Glossary

Register project-specific proper nouns to translate them consistently. User
entries take priority over the built-in jargon list.

```bash
klaude glossary add 베가베리 Vegavery
klaude glossary add 옴니버스 Omniverse
klaude glossary list
klaude glossary remove 베가베리
```

## Token economics

klaude saves tokens in two stages — a fixed per-prompt win from translation,
and a much larger optional win from tool-result discipline.

### 1. Korean → English: ~50% reduction on the user prompt itself

Korean encodes to roughly **2× the tokens of equivalent English** for the same
semantic content. Measured with OpenAI's `cl100k_base` tokenizer (a close proxy
— Anthropic's exact BPE differs slightly in absolute counts, but the relative
KO/EN ratio is consistent across modern subword tokenizers):

| Sample prompt (semantics) | KO tokens | EN tokens | KO/EN |
|---|---:|---:|---:|
| "Make a React component" | 17 | 4 | 4.25× |
| "Why isn't this useState hook working? Console shows undefined…" | 45 | 19 | 2.37× |
| "Fetch from `/api/users` and render paginated table in TypeScript" | 47 | 25 | 1.88× |
| "docker-compose for Postgres + Redis, read env from `.env`" | 55 | 20 | 2.75× |
| "Async handling looks off — race condition?" | 34 | 23 | 1.48× |
| "Refactor `handleKeyInput` to consolidate fast paths" | 42 | 28 | 1.50× |
| **Aggregate (6 prompts, 338/567 chars)** | **240** | **119** | **2.02×** |

So the prompt itself shrinks by ~50% per turn. Session-level impact depends on
how much of your context is user prompts vs. tool results vs. system prompt —
the prompt portion is typically modest **but it persists in the cached
conversation context for every subsequent turn**, so savings compound across
long sessions. Realistic effect: low single digits to ~10% of total session
cost, with no quality loss.

Anthropic's model cards note Claude is trained on a predominantly
English-language corpus, so English prompts tend to score better on
benchmarks. klaude lets you keep thinking in Korean while the model reads
English.

### 2. Tool-result waste: the bigger lever

A typical Claude Code session's token usage is dominated by tool output, not
user prompts. A single 2,000-line `Read` produces more tokens than dozens of
human turns. That's the lever where the real savings live — covered by the
opt-in discipline rules below.

## Token discipline rules

Most token waste in Claude Code happens on the **input side** — accumulated tool
results, full file reads, dumped logs. Output-only compression tricks like
[caveman](https://github.com/JuliusBrussee/caveman) only address 5–15% of the
total bill. The real win is restraining input.

On first run, klaude offers to install four short rules into your global
`~/.claude/CLAUDE.md`:

| Rule | What it does |
|---|---|
| **Grep first, Read narrow** | Locate symbols with `Grep` (ripgrep), then `Read` with `offset`/`limit` instead of full files |
| **Trim large output** | Pipe build/test/server logs through `head`/`tail`/`rg` instead of dumping into context |
| **Delegate exploration** | Multi-file exploration goes to an `Agent` (Explore) sub-agent — intermediate reads stay out of the parent context |
| **Diff before re-read** | Run `git diff <file>` before re-reading a file already loaded this session; full re-read only on suspected external modification |

**Safety:**
- Prompt defaults to **No** and is shown only once (tracked via `~/.klaude/rules-prompted`)
- Skipped entirely when stdin is not a TTY (CI, piped input)
- Block is wrapped in `<!-- klaude:token-rules:start -->` / `<!-- klaude:token-rules:end -->` markers
- Re-installs are idempotent; uninstall preserves the rest of your CLAUDE.md

**Manual control:**

```bash
klaude install-rules     # add the marked block (idempotent)
klaude uninstall-rules   # remove just the marked block
```

## Commands

```bash
klaude                              # Launch Claude Code (intercept ON)
klaude --version
klaude --help

# Passthrough — any flag klaude doesn't own goes straight to claude
klaude --resume                     # resume a previous session
klaude --continue                   # continue the most recent session
klaude -p "fix the failing build"   # headless / print mode

# Config
klaude config get
klaude config set backend haiku
klaude config set backend ollama:gemma3:4b
klaude config set sourceLang ko
klaude config set debug true        # → ~/.klaude/debug.log

# User glossary
klaude glossary list
klaude glossary add 베가베리 Vegavery
klaude glossary remove 베가베리

# Token-discipline rules
klaude install-rules
klaude uninstall-rules
```

## Architecture

| Module | Responsibility |
|---|---|
| `src/index.ts` | CLI entry, subcommand dispatch, lifecycle |
| `src/pty.ts` | Spawn `claude` in a pseudo-terminal, bidirectional I/O |
| `src/mirror.ts` | `xterm-headless` screen mirror — extracts rendered input box |
| `src/intercept.ts` | Enter detection, input extraction, clear+replay flow |
| `src/tokenize.ts` | Protect/restore placeholders for `@path`, `/cmd`, code, URLs |
| `src/translate.ts` | Translation backends: Haiku, Ollama |
| `src/config.ts` | Load/save `~/.klaude/config.json` |
| `src/firstRun.ts` | First-run prompt + install/uninstall of token-discipline rules |
| `src/log.ts` | Debug logger (`~/.klaude/debug.log`) |

## Configuration files

| Path | Purpose |
|---|---|
| `~/.klaude/config.json` | Backend, languages, glossary, debug flag |
| `~/.klaude/rules-prompted` | First-run prompt acknowledgment flag |
| `~/.klaude/debug.log` | Verbose log when `debug=true` |
| `~/.claude/CLAUDE.md` | (Optional) target for token-discipline rules |

## Environment

| Var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Required for the Haiku backend |
| `KLAUDE_BACKEND` | `haiku` or `ollama:<model>` — overrides config file |
| `OLLAMA_HOST` | Defaults to `http://localhost:11434` |
| `KLAUDE_RENDER_DELAY` | Milliseconds to wait after Enter before reading the screen. Default `80` |
| `KLAUDE_DUMP_KEYS` | `=1` logs raw keyboard byte codes to the debug log (also enables logging on its own). Diagnoses key-chord encodings — e.g. Ctrl+Enter |
| `KLAUDE_DUMP_POPUP` | `=1` dumps the screen on every Enter. Diagnoses the autocomplete-popup detector |

## Development

```bash
git clone https://github.com/<your-fork>/klaude
cd klaude
npm install
npm run dev          # tsx src/index.ts
npm run build        # tsc → dist/
node dist/index.js   # run the built artifact
```

Smoke-test the install/uninstall flow without touching your real `~/.claude/CLAUDE.md`:

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" node dist/index.js install-rules
cat "$TMPHOME/.claude/CLAUDE.md"
HOME="$TMPHOME" node dist/index.js uninstall-rules
rm -rf "$TMPHOME"
```

## Status

✅ **Working.** PTY intercept, Korean→English translation, token preservation,
Haiku/Ollama backends, glossary, and token-discipline rule install/uninstall
all functional.

🚧 Planned: more backends (Bedrock, Vertex), optional confirm-before-send UI for
translated text, feedback loop for learning from bad translations.

## License

MIT — see [LICENSE](LICENSE).

Author: **Max Kim (Dindb-dong)**
