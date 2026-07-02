import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Backend =
  | { kind: "haiku"; model: string }
  | { kind: "ollama"; model: string; host: string };

export interface Config {
  backend: Backend;
  sourceLang: string;
  targetLang: string;
  debug: boolean;
  /**
   * Optional user-defined glossary. Each entry maps a Korean form (or
   * transliteration / nickname) to its canonical English target.
   * Highest priority in the translation prompt — wins over the built-in
   * jargon list.
   */
  glossary?: Array<[string, string]>;
}

const CONFIG_PATH = join(homedir(), ".klaude", "config.json");

/** Canonical Haiku model id — single source for default config, env
 *  resolution, and the `config set backend haiku` command. */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const DEFAULT_CONFIG: Config = {
  backend: { kind: "haiku", model: HAIKU_MODEL },
  sourceLang: "ko",
  targetLang: "en",
  debug: false,
  glossary: [],
};

export function loadConfig(): Config {
  // structuredClone so callers that mutate (glossary add/remove) never
  // write through into the shared DEFAULT_CONFIG object.
  if (!existsSync(CONFIG_PATH)) return structuredClone(DEFAULT_CONFIG);
  const raw = readFileSync(CONFIG_PATH, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `klaude: ${CONFIG_PATH} is not valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
        `Fix the file, or delete it to reset to defaults.`,
    );
  }
  return validateConfig({ ...structuredClone(DEFAULT_CONFIG), ...(parsed as object) });
}

/**
 * Validate a merged config object, throwing a message that names the bad
 * key and how to recover. A hand-edited ~/.klaude/config.json with e.g. a
 * typo'd backend kind used to surface only as a confusing runtime crash
 * deep inside makeTranslator.
 */
export function validateConfig(cfg: unknown): Config {
  const fail = (field: string, why: string): never => {
    throw new Error(
      `klaude: invalid config at ${CONFIG_PATH} — "${field}" ${why}. ` +
        `Fix the file, or delete it to reset to defaults.`,
    );
  };
  const c = cfg as Config;
  const b = c.backend as unknown;
  if (typeof b !== "object" || b === null) fail("backend", "must be an object");
  const kind = (b as { kind?: unknown }).kind;
  if (kind !== "haiku" && kind !== "ollama") {
    fail("backend.kind", `must be "haiku" or "ollama" (got ${JSON.stringify(kind)})`);
  }
  const model = (b as { model?: unknown }).model;
  if (typeof model !== "string" || model.length === 0) {
    fail("backend.model", "must be a non-empty string");
  }
  if (kind === "ollama") {
    const host = (b as { host?: unknown }).host;
    if (typeof host !== "string" || host.length === 0) {
      fail("backend.host", "must be a non-empty string (e.g. http://localhost:11434)");
    }
  }
  if (typeof c.sourceLang !== "string" || c.sourceLang.length === 0) {
    fail("sourceLang", "must be a non-empty string");
  }
  if (typeof c.targetLang !== "string" || c.targetLang.length === 0) {
    fail("targetLang", "must be a non-empty string");
  }
  if (typeof c.debug !== "boolean") fail("debug", "must be true or false");
  if (c.glossary !== undefined) {
    if (!Array.isArray(c.glossary)) {
      fail("glossary", "must be an array of [korean, english] pairs");
    }
    for (const entry of c.glossary as unknown[]) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        typeof entry[1] !== "string"
      ) {
        fail(
          "glossary",
          `entries must be [korean, english] string pairs (got ${JSON.stringify(entry)})`,
        );
      }
    }
  }
  return c;
}

export function saveConfig(cfg: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function resolveBackendFromEnv(cfg: Config): Config {
  const env = process.env.KLAUDE_BACKEND;
  if (!env) return cfg;
  if (env.startsWith("ollama:")) {
    return {
      ...cfg,
      backend: {
        kind: "ollama",
        model: env.slice("ollama:".length),
        host: process.env.OLLAMA_HOST ?? "http://localhost:11434",
      },
    };
  }
  if (env === "haiku") {
    return {
      ...cfg,
      backend: { kind: "haiku", model: HAIKU_MODEL },
    };
  }
  return cfg;
}
