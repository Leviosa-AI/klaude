# Security Policy

## Supported versions

klaude is pre-1.0; only the latest published `0.x` release receives
security fixes.

| Version | Supported |
|---------|-----------|
| Latest `0.x` | ✅ |
| Older `0.x` | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Use one of these channels instead:

- **Preferred:** open a [private security advisory](https://github.com/Leviosa-AI/klaude/security/advisories/new)
  on GitHub. This keeps the report private until we agree on a disclosure
  timeline.
- **Fallback:** email security@leviosa.ai (subject: `[klaude security]`).

Include: affected version, reproduction steps, impact, and whether a
public CVE should be requested.

We aim to acknowledge reports within 3 business days and ship a fix or
mitigation for confirmed vulnerabilities within 14 days. Coordinated
disclosure timelines are negotiable for complex issues.

## What klaude sees

To help you triage what is and isn't in scope:

| Data | Where it goes | Stored on disk? |
|------|---------------|-----------------|
| Your prompt text (every Enter) | Translation backend over TLS — Anthropic API (Haiku) or your local Ollama host | Only if `debug: true` → `~/.klaude/debug.log` (rotated at 10 MB) |
| `ANTHROPIC_API_KEY` | Anthropic API auth header (Haiku backend only) | No |
| `~/.klaude/config.json` | Your machine | Yes (backend + glossary, no secrets by default) |
| File contents, env vars, shell history | Not transmitted by klaude itself | No |

Claude Code (the underlying CLI that klaude wraps) may transmit additional
data; that is governed by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy)
and is out of scope for this policy.

## Known security considerations (not bugs)

These are documented behaviors users should be aware of:

- **Debug log contains prompt text in plaintext.** When `debug: true`,
  every translation input/output is written to `~/.klaude/debug.log`.
  Disable with `klaude config set debug false`. The log rotates at 10 MB
  but the rotated `.old` file persists until the next rotation.
- **Prompt-injection by translator.** The translator output is sanitized
  to strip control characters (`src/intercept.ts` `sanitizeForRetype`)
  before being typed into Claude's PTY. A compromised translator backend
  cannot inject ESC sequences, but it could still substitute the
  translation with arbitrary English text. Use a backend you trust.
- **No prompt-content scrubbing.** klaude does not detect or redact
  secrets / PII in your prompt before sending. Review prompts before
  pressing Enter, or use the Ollama backend for fully local operation.

## Scope

In scope:

- Code execution, privilege escalation, or auth bypass triggered by
  hostile input to klaude (prompt text, translator response, screen
  bytes from a malicious PTY).
- Inadvertent network egress beyond the configured backend.
- Sensitive data written to disk in places not documented above.

Out of scope:

- Vulnerabilities in `claude` itself (report to Anthropic).
- Vulnerabilities in dependencies (`node-pty`, `@xterm/headless`,
  `@anthropic-ai/sdk`) — report upstream. We'll bump our dep range
  promptly once a fix is available.
- Social-engineering attacks on contributor accounts (covered by
  GitHub's policy).
