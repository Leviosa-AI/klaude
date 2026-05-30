import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Max bytes for the active debug.log before it rotates. The current file is
 * renamed to debug.log.old (overwriting any previous .old) and a fresh file
 * starts at the next write. Read at each rotation check so tests can override
 * via `KLAUDE_LOG_MAX_BYTES`.
 */
function maxLogBytes(): number {
  return Number(process.env.KLAUDE_LOG_MAX_BYTES) || 10 * 1024 * 1024;
}

/**
 * Resolve the log path lazily so tests can redirect via `KLAUDE_LOG_PATH`
 * (preferred) or by overriding `HOME` before invoking. Production callers
 * pass nothing and get `~/.klaude/debug.log`.
 */
function defaultLogPath(): string {
  return process.env.KLAUDE_LOG_PATH ?? join(homedir(), ".klaude", "debug.log");
}

export interface Logger {
  enabled: boolean;
  log(...parts: unknown[]): void;
  path: string;
}

export function makeLogger(enabled: boolean, pathOverride?: string): Logger {
  const path = pathOverride ?? defaultLogPath();
  let dirEnsured = false;

  const ensureDir = () => {
    if (dirEnsured) return;
    mkdirSync(dirname(path), { recursive: true });
    dirEnsured = true;
  };

  const maybeRotate = () => {
    try {
      const stat = statSync(path);
      if (stat.size < maxLogBytes()) return;
      // Rotate: rename current → .old (overwriting any previous .old).
      // renameSync atomically replaces an existing destination on POSIX,
      // which is the behavior we want. On Windows, renameSync fails if
      // the destination exists, so we'd need an unlink-first dance — not
      // wired up yet since CI is macOS-only.
      renameSync(path, `${path}.old`);
    } catch (err: unknown) {
      // ENOENT just means no log file yet — first write of this process.
      // Any other error: log it nowhere (we're the logger), swallow.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
  };

  return {
    enabled,
    path,
    log(...parts: unknown[]) {
      if (!enabled) return;
      ensureDir();
      maybeRotate();
      const ts = new Date().toISOString();
      const line = parts
        .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
        .join(" ");
      appendFileSync(path, `[${ts}] ${line}\n`);
    },
  };
}
