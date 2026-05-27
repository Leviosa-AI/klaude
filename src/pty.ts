import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

const IS_WINDOWS = process.platform === "win32";

export interface PtyHandle {
  proc: IPty;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (code: number) => void): void;
}

function resolveClaudePathWindows(): string | null {
  // 1) where.exe — first match wins, may return multiple lines.
  try {
    const out = execSync(`where.exe claude`, { encoding: "utf8" }).trim();
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0);
    if (first) {
      // Prefer the underlying cli.js next to a .cmd shim, since node-pty
      // through cmd.exe drops some signals. Probe the npm-global layout.
      if (first.toLowerCase().endsWith(".cmd")) {
        const cliJs = join(
          first.replace(/\\claude\.cmd$/i, ""),
          "node_modules",
          "@anthropic-ai",
          "claude-code",
          "cli.js",
        );
        if (existsSync(cliJs)) return cliJs;
      }
      return first;
    }
  } catch {
    // fall through to npm-global probe
  }

  // 2) Probe %APPDATA%\npm — default global install location.
  const appData = process.env.APPDATA;
  if (appData) {
    const cliJs = join(
      appData,
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "cli.js",
    );
    if (existsSync(cliJs)) return cliJs;
    const cmd = join(appData, "npm", "claude.cmd");
    if (existsSync(cmd)) return cmd;
  }

  return null;
}

function resolveClaudePathPosix(): string | null {
  try {
    // Use login shell so PATH includes nvm / cmux / homebrew shims.
    const out = execSync(`/bin/sh -lc 'command -v claude'`, {
      encoding: "utf8",
    }).trim();
    if (out.length > 0) return out;
  } catch {
    // fall through
  }
  // Common manual install location.
  const fallback = join(homedir(), ".claude", "local", "claude");
  if (existsSync(fallback)) return fallback;
  return null;
}

function resolveClaudePath(): string {
  if (process.env.KLAUDE_CLAUDE_BIN) return process.env.KLAUDE_CLAUDE_BIN;
  const found = IS_WINDOWS ? resolveClaudePathWindows() : resolveClaudePathPosix();
  if (found) return found;
  throw new Error(
    `klaude: could not locate 'claude' binary on PATH. Set KLAUDE_CLAUDE_BIN to its absolute path.`,
  );
}

export function spawnClaude(args: string[] = []): PtyHandle {
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;
  const resolved = resolveClaudePath();

  // node-pty's env type wants Record<string, string>; process.env has
  // (string | undefined) values. Filter undefined explicitly instead of
  // casting away the truth.
  const env: Record<string, string> = { KLAUDE: "1" };
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }

  // If we resolved to a raw .js entrypoint (preferred on Windows to avoid the
  // .cmd shim eating signals), run it through node. Otherwise spawn directly.
  const isJsEntry = /\.[cm]?js$/i.test(resolved);
  const bin = isJsEntry ? (IS_WINDOWS ? "node.exe" : "node") : resolved;
  const spawnArgs = isJsEntry ? [resolved, ...args] : args;

  const proc = pty.spawn(bin, spawnArgs, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: process.cwd(),
    env,
  });

  return {
    proc,
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => proc.kill(),
    onData: (cb) => {
      proc.onData(cb);
    },
    onExit: (cb) => {
      proc.onExit(({ exitCode }) => cb(exitCode));
    },
  };
}
