import { spawn } from "node:child_process";
import type { Logger } from "./log.js";

/**
 * Ensure a local Ollama server is reachable, auto-starting `ollama serve`
 * if it isn't.
 *
 * Why this exists: klaude's Ollama backend just does `fetch(host/api/chat)`.
 * If the daemon isn't running, every translation throws `TypeError: fetch
 * failed`, the interceptor falls back to submitting the original Korean
 * untranslated — i.e. translation silently stops working. macOS users who
 * haven't launched Ollama.app, or anyone who rebooted, hit this constantly.
 *
 * Strategy:
 *   1. Ping `${host}/api/tags`. If it answers, we're done.
 *   2. Only for a LOCAL host (localhost / 127.0.0.1): spawn `ollama serve`
 *      detached so it outlives this process, then poll until it answers or
 *      we time out.
 *   3. For a remote host we can't start anything — just warn and continue;
 *      the caller's translator will surface the connection error per-prompt.
 *
 * Never throws: a failure here must not stop `claude` from launching. We log
 * and return false; translation degrades to pass-through, which is the
 * existing behavior.
 */
export async function ensureOllamaReady(
  host: string,
  logger: Logger,
  opts: { startupTimeoutMs?: number } = {},
): Promise<boolean> {
  if (await pingOllama(host)) {
    logger.log("ollama: already running", { host });
    return true;
  }

  if (!isLocalHost(host)) {
    logger.log("ollama: not reachable and host is remote — cannot auto-start", { host });
    return false;
  }

  logger.log("ollama: not running, starting `ollama serve`", { host });
  if (!spawnOllamaServe(logger)) return false;

  const timeoutMs = opts.startupTimeoutMs ?? 15_000;
  const ready = await waitForOllama(host, timeoutMs);
  logger.log(
    ready
      ? "ollama: server is up"
      : `ollama: server did not become ready within ${timeoutMs}ms`,
  );
  return ready;
}

/** Single reachability probe. Short timeout — the daemon answers instantly. */
async function pingOllama(host: string, timeoutMs = 1_500): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spawn `ollama serve` fully detached so the daemon survives klaude exiting
 * (Ollama is a shared system service — we don't want to tear it down when the
 * user quits one claude session). stdio is ignored; the daemon has its own
 * logs. Returns false if the binary can't be launched at all.
 */
function spawnOllamaServe(logger: Logger): boolean {
  try {
    const child = spawn("ollama", ["serve"], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", (err) => {
      // ENOENT etc. fires async — surface it so the failure isn't silent.
      logger.log("ollama: failed to spawn `ollama serve`", { error: String(err) });
    });
    child.unref();
    return true;
  } catch (err) {
    logger.log("ollama: failed to spawn `ollama serve`", { error: String(err) });
    return false;
  }
}

/** Poll until the server answers or the deadline passes. */
async function waitForOllama(host: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pingOllama(host)) return true;
    await sleep(300);
  }
  return false;
}

/**
 * Is this host one we can start a server for? `ollama serve` always binds
 * locally, so auto-start only makes sense when the configured host points at
 * this machine.
 */
export function isLocalHost(host: string): boolean {
  try {
    // URL.hostname keeps the brackets for IPv6 literals, e.g. "[::1]".
    const hostname = new URL(host).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
