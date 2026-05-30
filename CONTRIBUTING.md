# Contributing to klaude

Thanks for your interest in klaude! This document covers how to develop,
test, and submit changes.

> Currently klaude is only verified on **macOS**. Linux/Windows contributions
> that broaden platform coverage are particularly welcome — see
> [Platform support](README.md#platform-support) for what needs validating.

## Development setup

```bash
git clone https://github.com/Leviosa-AI/klaude.git
cd klaude
npm install
```

Available scripts:

| Script | What it does |
|--------|--------------|
| `npm run dev` | Run the TypeScript source directly via `tsx` (no build step) |
| `npm run build` | Compile `src/` → `dist/` with `tsc` |
| `npm test` | Run the vitest suite once |
| `npm run test:watch` | Re-run tests on file change |
| `npm run test:coverage` | Test + v8 coverage report |
| `npm run check` | Biome lint + format check (read-only) |
| `npm run format` | Biome format `src/` in place |
| `npm run lint` | Biome lint only |
| `npm run typecheck` | `tsc --noEmit` |

Smoke-test the install/uninstall flow without touching your real
`~/.claude/CLAUDE.md`:

```bash
TMPHOME=$(mktemp -d)
HOME="$TMPHOME" node dist/index.js install-rules
HOME="$TMPHOME" node dist/index.js uninstall-rules
rm -rf "$TMPHOME"
```

## Before submitting a PR

- [ ] `npm run check` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` succeeds
- [ ] Manual smoke test: in `npm run dev` mode, type Korean and verify the
      translation is sent to Claude (you'll see the original Korean briefly,
      then the English replacement before the prompt fires).
- [ ] If you changed translator / mirror / intercept logic: add a unit test.
- [ ] If you changed user-visible behavior: update `README.md` (and
      `README.ko.md` if applicable).
- [ ] Add an entry under `## [Unreleased]` in `CHANGELOG.md`.

## Commit message format

Conventional-style prefix, lowercase, imperative mood:

```
type: short summary in lowercase

Optional body explaining why, wrapped at ~72 chars.
```

Types we use: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
`perf`, `style`.

## Branch naming

```
type/short-content
```

Examples: `feat/bedrock-backend`, `fix/popup-detect-korean-filename`,
`docs/contributing-guide`.

## Reporting bugs

Open an issue using the **Bug report** template. Useful info to include:

- OS and `node --version`
- klaude version (`klaude --version`)
- Backend in use (`klaude config get` — feel free to redact API keys)
- Relevant excerpt of `~/.klaude/debug.log` (rotated at 10 MB,
  written only when `debug: true`). **Redact any prompt text that may
  contain secrets before sharing.**
- For TUI / popup detection bugs: a screen dump with
  `KLAUDE_DUMP_POPUP=1 klaude` reproducing the issue.

## Areas where help is especially welcome

- **Linux / Windows validation** — verifying the screen-mirror heuristics
  in `src/mirror.ts` against Claude Code's TUI on those platforms.
- **Additional translation backends** — Bedrock, Vertex, OpenAI-compatible
  endpoints. The `Translator` interface in `src/translate.ts` is the
  extension point.
- **New popup / widget detectors** — when Claude Code ships a new TUI
  element that klaude doesn't recognize, add a heuristic to
  `src/mirror.ts` with a regression test in `src/mirror.test.ts`.
- **Localization** — error messages and the first-run prompt are currently
  English-only.

## Security issues

Do not open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for the private disclosure channel.
