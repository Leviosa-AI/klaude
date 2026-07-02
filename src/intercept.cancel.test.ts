import { describe, expect, it } from "vitest";
import type { InterceptDeps } from "./intercept.js";
import { Interceptor } from "./intercept.js";
import type { Translator } from "./translate.js";

/**
 * Integration tests for the ESC-cancel flow: a real Interceptor wired to a
 * fake PTY (captures writes), a fake mirror (always shows Korean input), and
 * a hanging translator that only resolves/rejects on command. Timing rides
 * the real RENDER_DELAY_MS (80ms) — slow enough to inject keys mid-flight,
 * fast enough for the suite.
 */

function makeHarness() {
  const writes: string[] = [];
  const pty = {
    proc: null as never,
    write: (d: string) => writes.push(d),
    resize: () => {},
    kill: () => {},
    onData: () => {},
    onExit: () => {},
  };

  const mirror = {
    hasAutocompletePopup: () => false,
    hasSubmitFormWidget: () => false,
    hasBashPrompt: () => false,
    isPromptBoxed: () => false,
    extractInputBox: () => "이 함수 고쳐줘",
    recentContext: () => null,
    dumpScreen: () => "",
  };

  let resolveTranslation: ((s: string) => void) | undefined;
  let sawAbort = false;
  const translator: Translator = {
    translate(_text, _context, signal) {
      return new Promise((resolve, reject) => {
        resolveTranslation = resolve;
        signal?.addEventListener("abort", () => {
          sawAbort = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  };

  const interceptor = new Interceptor({
    pty,
    mirror,
    translator,
    sourceLang: "ko",
    logger: { enabled: false, log: () => {} },
  } as unknown as InterceptDeps);

  return {
    writes,
    interceptor,
    finishTranslation: (s: string) => resolveTranslation?.(s),
    getSawAbort: () => sawAbort,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Past RENDER_DELAY_MS (80ms default) — translation is in flight by then. */
const MID_FLIGHT_MS = 150;

describe("Interceptor — ESC cancels in-flight translation", () => {
  it("aborts the translation, keeps input, and does not submit", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    const escReturn = await h.interceptor.handleKeyInput("\x1b");
    await enter;

    expect(h.getSawAbort()).toBe(true);
    // ESC is swallowed, never forwarded to claude.
    expect(escReturn).toBe("");
    // No CR reached the PTY — the input stays unsubmitted.
    expect(h.writes).not.toContain("\r");
    // The indicator was shown, then cleaned up with DELs.
    expect(h.writes.some((w) => w.includes("번역중"))).toBe(true);
    expect(h.writes.some((w) => w.includes("\x7f"))).toBe(true);
  });

  it("releases busy after cancel so the next Enter translates again", async () => {
    const h = makeHarness();

    const first = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    await h.interceptor.handleKeyInput("\x1b");
    await first;

    h.writes.length = 0;
    const second = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    h.finishTranslation("Fix this function");
    await second;

    // Second attempt ran the full slow path: indicator + translated submit.
    expect(h.writes.some((w) => w.includes("번역중"))).toBe(true);
    expect(h.writes.some((w) => w.includes("Fix this function"))).toBe(true);
    expect(h.writes).toContain("\r");
  });

  it("still drops ordinary keys while busy (only bare ESC cancels)", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    const typed = await h.interceptor.handleKeyInput("x");
    const arrow = await h.interceptor.handleKeyInput("\x1b[A");
    expect(typed).toBe("");
    expect(arrow).toBe("");
    expect(h.getSawAbort()).toBe(false); // arrow key must NOT cancel

    h.finishTranslation("Fix this function");
    await enter;
    expect(h.writes).toContain("\r"); // translation completed normally
  });
});
