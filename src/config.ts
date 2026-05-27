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

const DEFAULT_CONFIG: Config = {
  backend: { kind: "haiku", model: "claude-haiku-4-5-20251001" },
  sourceLang: "ko",
  targetLang: "en",
  debug: false,
  glossary: [],
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  const raw = readFileSync(CONFIG_PATH, "utf8");
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
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
      backend: { kind: "haiku", model: "claude-haiku-4-5-20251001" },
    };
  }
  return cfg;
}
