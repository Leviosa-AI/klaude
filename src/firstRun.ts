import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

const FLAG_PATH = join(homedir(), ".klaude", "rules-prompted");
const CLAUDE_MD_PATH = join(homedir(), ".claude", "CLAUDE.md");
const MARKER_START = "<!-- klaude:token-rules:start -->";
const MARKER_END = "<!-- klaude:token-rules:end -->";

const RULES_BODY = `## Token Discipline (added by klaude)

These guidelines reduce token usage for Claude Code conversations.
To remove them, delete this whole block (markers included) or run
\`klaude uninstall-rules\`.

- Locate symbols with \`Grep\` (ripgrep) before opening a file. When you do
  read, prefer \`Read\` with \`offset\` and \`limit\` to load just the
  relevant span instead of the whole file.
- For large command output (build logs, test runs, server logs), pipe
  through \`head\`, \`tail\`, or \`rg\` to keep only the relevant lines.
  Avoid dumping full output into context.
- For broad exploration that would span many files, delegate to an
  \`Agent\` (Explore) sub-agent so intermediate reads stay out of the
  parent context.
- Before re-reading a file you already loaded this session, run
  \`git diff <file>\` first. Only re-read in full if external
  modification is suspected.`;

const RULES_BLOCK = `${MARKER_START}\n${RULES_BODY}\n${MARKER_END}\n`;

function readClaudeMd(): string {
  return existsSync(CLAUDE_MD_PATH) ? readFileSync(CLAUDE_MD_PATH, "utf8") : "";
}

function writeClaudeMd(content: string): void {
  mkdirSync(dirname(CLAUDE_MD_PATH), { recursive: true });
  writeFileSync(CLAUDE_MD_PATH, content);
}

function markPrompted(): void {
  mkdirSync(dirname(FLAG_PATH), { recursive: true });
  writeFileSync(FLAG_PATH, new Date().toISOString());
}

export function rulesAreInstalled(): boolean {
  return readClaudeMd().includes(MARKER_START);
}

export function installRules(): "installed" | "already-present" {
  const existing = readClaudeMd();
  if (existing.includes(MARKER_START)) return "already-present";
  const separator = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const body = existing.length === 0 ? RULES_BLOCK : `${separator}\n${RULES_BLOCK}`;
  writeClaudeMd(existing + body);
  return "installed";
}

export function uninstallRules(): "removed" | "not-found" {
  const existing = readClaudeMd();
  const startIdx = existing.indexOf(MARKER_START);
  if (startIdx === -1) return "not-found";
  const endIdx = existing.indexOf(MARKER_END, startIdx);
  if (endIdx === -1) return "not-found";
  const afterEnd = endIdx + MARKER_END.length;
  // Also trim a single trailing newline left by the block.
  const trimmed =
    existing.slice(0, startIdx).replace(/\n+$/, "\n") +
    existing.slice(afterEnd).replace(/^\n+/, "");
  writeClaudeMd(trimmed);
  return "removed";
}

/**
 * On first run, ask the user whether to add the token-discipline rules to
 * ~/.claude/CLAUDE.md. Skips silently when stdin is not a TTY (CI, piped
 * input) and when the user has already been asked once.
 */
export async function maybePromptForRulesInstall(): Promise<void> {
  if (existsSync(FLAG_PATH)) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;
  if (rulesAreInstalled()) {
    markPrompted();
    return;
  }

  process.stdout.write(
    `\nklaude can add 4 token-discipline rules to your global Claude Code\n` +
      `config at ${CLAUDE_MD_PATH}. They tell Claude Code to prefer Grep\n` +
      `over full file reads, trim large command output, delegate broad\n` +
      `exploration to sub-agents, and check git diff before re-reading.\n\n` +
      `Scope: applies to every Claude Code project on this machine.\n` +
      `Remove later: \`klaude uninstall-rules\` (or delete the marked block).\n\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = (await rl.question("Add these rules now? [y/N] ")).trim().toLowerCase();
  } finally {
    rl.close();
  }

  markPrompted();

  if (answer === "y" || answer === "yes") {
    const result = installRules();
    if (result === "installed") {
      process.stdout.write(`✓ Added rules to ${CLAUDE_MD_PATH}\n\n`);
    } else {
      process.stdout.write(`Rules already present in ${CLAUDE_MD_PATH}\n\n`);
    }
  } else {
    process.stdout.write(`Skipped. Run \`klaude install-rules\` later to add them.\n\n`);
  }
}
