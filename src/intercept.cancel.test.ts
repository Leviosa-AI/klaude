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

  it("cancels on the Kitty-protocol ESC encoding (\\x1b[27u)", async () => {
    // Claude switches the terminal into the kitty keyboard protocol, where
    // the ESC key arrives as CSI 27u — never as a bare \x1b. Regression:
    // 0.3.x only matched the bare byte, so ESC mashing was dropped as
    // "busy" and the translation could not be cancelled.
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    const escReturn = await h.interceptor.handleKeyInput("\x1b[27u");
    await enter;

    expect(h.getSawAbort()).toBe(true);
    expect(escReturn).toBe("");
    expect(h.writes).not.toContain("\r");
  });

  it("cancels on the modifier-field variant (\\x1b[27;1u)", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    await h.interceptor.handleKeyInput("\x1b[27;1u");
    await enter;

    expect(h.getSawAbort()).toBe(true);
    expect(h.writes).not.toContain("\r");
  });

  it("does not cancel on other kitty CSI-u keys (Ctrl+Enter, modified ESC)", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(await h.interceptor.handleKeyInput("\x1b[13;5u")).toBe(""); // Ctrl+Enter
    expect(await h.interceptor.handleKeyInput("\x1b[27;5u")).toBe(""); // Ctrl+ESC
    expect(h.getSawAbort()).toBe(false);

    h.finishTranslation("Fix this function");
    await enter;
    expect(h.writes).toContain("\r"); // translation completed normally
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

  it("does not treat a CR as submit right after a forwarded ESC (split Shift+Enter)", async () => {
    const h = makeHarness();

    // ESC passes through while idle (claude handles it), arming the tracker…
    const escOut = await h.interceptor.handleKeyInput("\x1b");
    expect(escOut).toBe("\x1b");
    // …so a CR arriving immediately after is the second half of a split
    // Shift+Enter: forwarded verbatim, no translation started.
    const crOut = await h.interceptor.handleKeyInput("\r");
    expect(crOut).toBe("\r");
    expect(h.writes.some((w) => w.includes("번역중"))).toBe(false);
  });

  it("a CR long after a forwarded ESC is a normal submit again", async () => {
    const h = makeHarness();

    await h.interceptor.handleKeyInput("\x1b");
    await sleep(150); // past SPLIT_ESC_WINDOW_MS — the ESC was a lone keypress
    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(h.writes.some((w) => w.includes("번역중"))).toBe(true);
    h.finishTranslation("Fix this function");
    await enter;
  });

  it("a swallowed cancel-ESC does not arm the split tracker", async () => {
    const h = makeHarness();

    // Cancel a translation with ESC (swallowed, never forwarded)…
    const first = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    await h.interceptor.handleKeyInput("\x1b");
    await first;

    // …then an immediate Enter must still be a real submit.
    h.writes.length = 0;
    const second = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(h.writes.some((w) => w.includes("번역중"))).toBe(true);
    h.finishTranslation("Fix this function");
    await second;
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
