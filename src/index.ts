#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resolveBackendFromEnv, saveConfig } from "./config.js";
import { installRules, maybePromptForRulesInstall, uninstallRules } from "./firstRun.js";
import { Interceptor } from "./intercept.js";
import { makeLogger } from "./log.js";
import { ScreenMirror } from "./mirror.js";
import { cmdModelBench, cmdModelList, cmdModelUse } from "./models.js";
import { ensureOllamaReady } from "./ollama.js";
import { spawnClaude } from "./pty.js";
import { makeTranslator } from "./translate.js";

function readPackageVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Subcommands: config, glossary, install-rules, uninstall-rules, version, --help
  if (args[0] === "config") return handleConfigCmd(args.slice(1));
  if (args[0] === "model") return handleModelCmd(args.slice(1));
  if (args[0] === "glossary") return handleGlossaryCmd(args.slice(1));
  if (args[0] === "install-rules") {
    const result = installRules();
    console.log(
      result === "installed"
        ? "✓ Added klaude token-discipline rules to ~/.claude/CLAUDE.md"
        : "Rules already present in ~/.claude/CLAUDE.md",
    );
    return;
  }
  if (args[0] === "uninstall-rules") {
    const result = uninstallRules();
    console.log(
      result === "removed"
        ? "✓ Removed klaude token-discipline rules from ~/.claude/CLAUDE.md"
        : "No klaude rules block found in ~/.claude/CLAUDE.md",
    );
    return;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(`klaude ${readPackageVersion()}`);
    return;
  }
  if (args[0] === "--help" || args[0] === "-h") return printHelp();

  // First-run prompt (no-op if already asked or non-TTY).
  await maybePromptForRulesInstall();

  // Otherwise: launch claude with intercept layer.
  await runClaude(args);
}

async function runClaude(claudeArgs: string[]) {
  const cfg = resolveBackendFromEnv(loadConfig());
  const translator = makeTranslator(cfg);
  const logger = makeLogger(cfg.debug || process.env.KLAUDE_DUMP_KEYS === "1");
  logger.log("session start", { backend: cfg.backend.kind });

  // Ollama backend needs a running daemon — auto-start it so translation
  // doesn't silently degrade to pass-through when the server is down. Best
  // effort: never blocks claude from launching (ensureOllamaReady never
  // throws). The first translation eats the cold-start latency anyway.
  if (cfg.backend.kind === "ollama") {
    await ensureOllamaReady(cfg.backend.host, logger);
  }

  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 30;
  const mirror = new ScreenMirror(cols, rows);
  const handle = spawnClaude(claudeArgs);

  // Forward claude → user, also feed mirror.
  handle.onData((data) => {
    process.stdout.write(data);
    mirror.write(data);
  });

  const interceptor = new Interceptor({
    pty: handle,
    mirror,
    translator,
    sourceLang: cfg.sourceLang,
    logger,
  });

  // Raw mode so we see every keystroke.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", async (chunk) => {
    const remaining = await interceptor.handleKeyInput(chunk.toString());
    if (remaining.length > 0) handle.write(remaining);
  });

  // Resize forwarding.
  process.stdout.on("resize", () => {
    const c = process.stdout.columns || 120;
    const r = process.stdout.rows || 30;
    handle.resize(c, r);
    mirror.resize(c, r);
  });

  handle.onExit((code) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    mirror.dispose();
    process.exit(code);
  });
}

function handleConfigCmd(args: string[]) {
  const cfg = loadConfig();
  if (args[0] === "get") {
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  if (args[0] === "set" && args.length >= 3) {
    const key = args[1];
    const value = args.slice(2).join(" ");
    if (key === "backend") {
      if (value.startsWith("ollama:")) {
        cfg.backend = {
          kind: "ollama",
          model: value.slice("ollama:".length),
          host: process.env.OLLAMA_HOST ?? "http://localhost:11434",
        };
      } else if (value.startsWith("haiku")) {
        cfg.backend = { kind: "haiku", model: "claude-haiku-4-5-20251001" };
      } else {
        console.error(`unknown backend: ${value}`);
        process.exit(1);
      }
    } else if (key === "sourceLang") cfg.sourceLang = value;
    else if (key === "targetLang") cfg.targetLang = value;
    else if (key === "debug") cfg.debug = value === "true";
    else {
      console.error(`unknown key: ${key}`);
      process.exit(1);
    }
    saveConfig(cfg);
    console.log("saved.");
    return;
  }
  printHelp();
}

async function handleModelCmd(args: string[]) {
  const sub = args[0];
  if (sub === "list" || sub === "ls" || sub === undefined) return cmdModelList();
  if (sub === "use") return cmdModelUse(args[1]);
  if (sub === "bench" || sub === "compare") return cmdModelBench(args.slice(1));
  console.log(`Usage:
  klaude model list                 List installed local (Ollama) models
  klaude model use <name>           Switch klaude to a local model
  klaude model bench [names...]     Compare models on ko→en translation`);
}

function handleGlossaryCmd(args: string[]) {
  const cfg = loadConfig();
  cfg.glossary ??= [];
  const sub = args[0];
  if (sub === "list") {
    if (cfg.glossary.length === 0) {
      console.log("(empty)");
      return;
    }
    for (const [ko, en] of cfg.glossary) console.log(`${ko} → ${en}`);
    return;
  }
  if (sub === "add" && args.length >= 3) {
    const ko = args[1];
    const en = args.slice(2).join(" ");
    cfg.glossary = cfg.glossary.filter(([k]) => k !== ko);
    cfg.glossary.push([ko, en]);
    saveConfig(cfg);
    console.log(`added: ${ko} → ${en}`);
    return;
  }
  if (sub === "remove" && args.length >= 2) {
    const ko = args[1];
    const before = cfg.glossary.length;
    cfg.glossary = cfg.glossary.filter(([k]) => k !== ko);
    saveConfig(cfg);
    console.log(cfg.glossary.length < before ? `removed: ${ko}` : `not found: ${ko}`);
    return;
  }
  console.log(`Usage:
  klaude glossary list
  klaude glossary add <korean> <english>
  klaude glossary remove <korean>`);
}

function printHelp() {
  console.log(`klaude — Korean-native wrapper for Claude Code

Usage:
  klaude [claude-args...]            Launch claude with Korean→English intercept
  klaude config get                  Show current config
  klaude config set backend haiku    Use Anthropic Haiku (default)
  klaude config set backend ollama:gemma3:4b   Use local Ollama
  klaude config set sourceLang ko    Source language (default: ko)
  klaude config set debug true       Verbose logs to ~/.klaude/debug.log
  klaude model list                  List installed local (Ollama) models
  klaude model use <name>            Switch klaude to a local model
  klaude model bench [names...]      Compare models on ko→en translation
  klaude glossary list                       Show user glossary
  klaude glossary add 베가베리 Vegavery     Add Korean → English mapping
  klaude glossary remove 베가베리           Remove an entry
  klaude install-rules               Add token-discipline rules to ~/.claude/CLAUDE.md
  klaude uninstall-rules             Remove klaude rules block from ~/.claude/CLAUDE.md
  klaude --version
  klaude --help

Env:
  KLAUDE_BACKEND=haiku | ollama:<model>
  OLLAMA_HOST=http://localhost:11434
  ANTHROPIC_API_KEY=<key>            For Haiku backend
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
