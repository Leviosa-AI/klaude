import type { Config } from "./config.js";
import { loadConfig, saveConfig } from "./config.js";
import { makeLogger } from "./log.js";
import { ensureOllamaReady } from "./ollama.js";
import { makeTranslator, translatePrompt } from "./translate.js";

const DEFAULT_HOST = "http://localhost:11434";

export interface OllamaModel {
  name: string;
  sizeBytes: number;
}

/** Where to reach Ollama: the configured backend host, else the default. */
export function resolveHost(cfg: Config): string {
  return cfg.backend.kind === "ollama" ? cfg.backend.host : DEFAULT_HOST;
}

/** The model klaude is currently configured to use, or null on Haiku. */
function currentModel(cfg: Config): string | null {
  return cfg.backend.kind === "ollama" ? cfg.backend.model : null;
}

/** List installed Ollama models via /api/tags. */
export async function listOllamaModels(host: string): Promise<OllamaModel[]> {
  const res = await fetch(`${host}/api/tags`);
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const json = (await res.json()) as {
    models?: Array<{ name?: unknown; size?: unknown }>;
  };
  if (json.models !== undefined && !Array.isArray(json.models)) {
    throw new Error(
      `ollama: unexpected /api/tags response shape: ${JSON.stringify(json)?.slice(0, 200)}`,
    );
  }
  return (json.models ?? [])
    .filter((m) => typeof m?.name === "string")
    .map((m) => ({
      name: m.name as string,
      sizeBytes: typeof m.size === "number" ? m.size : 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Embedding-only models can't translate or chat. We exclude them from the
 * default benchmark set. Heuristic on the name — good enough for the common
 * `*-embed*` / `*embedding*` naming.
 */
function isEmbeddingModel(name: string): boolean {
  return /embed/i.test(name);
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

/** Ensure the local daemon is up before any model command that needs it. */
async function ready(cfg: Config): Promise<string> {
  const host = resolveHost(cfg);
  const logger = makeLogger(false);
  await ensureOllamaReady(host, logger);
  return host;
}

// ── `klaude model list` ──────────────────────────────────────────────────
export async function cmdModelList(): Promise<void> {
  const cfg = loadConfig();
  const host = await ready(cfg);
  const cur = currentModel(cfg);
  let models: OllamaModel[];
  try {
    models = await listOllamaModels(host);
  } catch (err) {
    console.error(`klaude: could not reach Ollama at ${host} (${String(err)})`);
    console.error("Is Ollama installed? Try: ollama serve");
    process.exit(1);
  }
  if (models.length === 0) {
    console.log("No local models installed. Pull one, e.g.: ollama pull qwen2.5:7b");
    return;
  }
  console.log(`Local Ollama models @ ${host}:\n`);
  const width = Math.max(...models.map((m) => m.name.length));
  for (const m of models) {
    const mark = m.name === cur ? " ◄ current" : "";
    const tag = isEmbeddingModel(m.name) ? "  (embedding)" : "";
    console.log(`  ${m.name.padEnd(width)}  ${gb(m.sizeBytes).padStart(7)}${tag}${mark}`);
  }
  if (cfg.backend.kind === "haiku") {
    console.log(`\nCurrent backend: haiku (${cfg.backend.model}) — not a local model.`);
  }
  console.log(`\nSwitch with:  klaude model use <name>`);
}

// ── `klaude model use <name>` ────────────────────────────────────────────
export async function cmdModelUse(name?: string): Promise<void> {
  if (!name) {
    console.error("Usage: klaude model use <model>   (e.g. qwen2.5:7b)");
    process.exit(1);
  }
  const cfg = loadConfig();
  const host = await ready(cfg);
  let installed: string[] = [];
  try {
    installed = (await listOllamaModels(host)).map((m) => m.name);
  } catch {
    // Daemon unreachable — allow the switch anyway; the next session's
    // auto-start will try to bring it up. Just warn.
    console.warn(`(warning) couldn't verify installed models at ${host}`);
  }
  if (installed.length > 0 && !installed.includes(name)) {
    console.error(`klaude: '${name}' is not installed. Pull it first:`);
    console.error(`  ollama pull ${name}`);
    console.error(`Installed: ${installed.join(", ")}`);
    process.exit(1);
  }
  cfg.backend = { kind: "ollama", model: name, host };
  saveConfig(cfg);
  console.log(`✓ Backend set to ollama:${name}`);
  console.log("Restart klaude for it to take effect.");
}

// ── `klaude model bench [models...]` ─────────────────────────────────────
const BENCH_TRANSLATIONS = [
  "야 우리 지금 판다랭크 api 호출하잖아. 근데 이거 분당 10회 제한 버킷 만들어뒀지?",
  "리액트 컴포넌트에서 useState 훅 쓸 때 비동기로 상태 업데이트하면 왜 안 돼?",
  "그 프론트 설정에서 네이버 커머스 API 연동용 판매자 ID 담는 기능 어디에 저장돼?",
];

export async function cmdModelBench(picked: string[]): Promise<void> {
  const cfg = loadConfig();
  const host = await ready(cfg);

  let candidates: string[];
  if (picked.length > 0) {
    candidates = picked;
  } else {
    try {
      candidates = (await listOllamaModels(host))
        .map((m) => m.name)
        .filter((n) => !isEmbeddingModel(n));
    } catch (err) {
      console.error(`klaude: could not reach Ollama at ${host} (${String(err)})`);
      process.exit(1);
    }
  }
  if (candidates.length === 0) {
    console.log("No chat-capable models to benchmark.");
    return;
  }

  console.log(`Benchmarking ${candidates.length} model(s) on ko→en translation.`);
  console.log("(first call per model includes cold-load latency)\n");

  const latency: Record<string, number[]> = {};
  for (const [i, input] of BENCH_TRANSLATIONS.entries()) {
    console.log(`\n■ Input ${i + 1}: ${input}`);
    for (const model of candidates) {
      const translator = makeTranslator({
        ...cfg,
        backend: { kind: "ollama", model, host },
      });
      const t0 = Date.now();
      let out: string;
      try {
        const full = await translatePrompt(input, translator, cfg.sourceLang);
        out = full.replace(/\n+Respond in [A-Za-z]+\.\s*$/, "").trim();
      } catch (err) {
        out = `⚠️ failed: ${String(err)}`;
      }
      const ms = Date.now() - t0;
      latency[model] ??= [];
      latency[model].push(ms);
      console.log(`  ${model.padEnd(22)} ${out}  [${ms}ms]`);
    }
  }

  console.log(`\n── latency summary (avg over ${BENCH_TRANSLATIONS.length} inputs) ──`);
  const width = Math.max(...candidates.map((m) => m.length));
  for (const model of candidates) {
    const xs = latency[model] ?? [];
    const avg = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
    console.log(`  ${model.padEnd(width)}  ${String(avg).padStart(6)}ms avg`);
  }
  console.log(`\nQuality is yours to judge from the outputs above.`);
  console.log(`Set your pick with:  klaude model use <name>`);
}
