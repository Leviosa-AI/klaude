import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOG_PATH = join(homedir(), ".klaude", "debug.log");
let initialized = false;

function init(): void {
  if (initialized) return;
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  initialized = true;
}

export interface Logger {
  enabled: boolean;
  log(...parts: unknown[]): void;
  path: string;
}

export function makeLogger(enabled: boolean): Logger {
  return {
    enabled,
    path: LOG_PATH,
    log(...parts: unknown[]) {
      if (!enabled) return;
      init();
      const ts = new Date().toISOString();
      const line = parts
        .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
        .join(" ");
      appendFileSync(LOG_PATH, `[${ts}] ${line}\n`);
    },
  };
}
