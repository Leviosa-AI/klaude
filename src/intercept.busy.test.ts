import { describe, expect, it } from "vitest";
import type { InterceptDeps } from "./intercept.js";
import { filterBusyPassthrough, Interceptor } from "./intercept.js";
import type { Translator } from "./translate.js";

/**
 * Regression tests for input handling WHILE a translation is in flight.
 *
 * Bug: the busy branch dropped every stdin byte except the ESC cancel key.
 * Claude keeps mouse reporting enabled, so wheel-scroll and click events
 * arrive on stdin as escape sequences — dropping them froze scrolling,
 * clicking, and cursor movement for the whole 1–4s translation window.
 *
 * Fix: buffer-neutral sequences (mouse, focus, and — on single-line input —
 * horizontal cursor keys) are forwarded while busy; content-mutating input
 * (printables, CR, Up/Down) is still dropped.
 */

// SGR mouse encodings (what modern terminals send when the app enables
// mouse tracking): wheel up = button 64, wheel down = 65, left click
// press/release = 0 with trailing M/m.
const WHEEL_UP = "\x1b[<64;40;12M";
const WHEEL_DOWN = "\x1b[<65;40;12M";
const CLICK_PRESS = "\x1b[<0;10;5M";
const CLICK_RELEASE = "\x1b[<0;10;5m";
const X10_CLICK = "\x1b[M !!";
const FOCUS_IN = "\x1b[I";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

function makeHarness(input = "이 함수 고쳐줘") {
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
    extractInputBox: () => input,
    recentContext: () => null,
    dumpScreen: () => "",
  };

  let resolveTranslation: ((s: string) => void) | undefined;
  const translator: Translator = {
    translate(_text, _context, signal) {
      return new Promise((resolve, reject) => {
        resolveTranslation = resolve;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
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
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Past RENDER_DELAY_MS (80ms default) — translation is in flight by then. */
const MID_FLIGHT_MS = 150;

describe("filterBusyPassthrough", () => {
  it("forwards SGR mouse sequences (wheel + click)", () => {
    const chunk = WHEEL_UP + WHEEL_DOWN + CLICK_PRESS + CLICK_RELEASE;
    expect(filterBusyPassthrough(chunk, false)).toEqual({
      forward: chunk,
      dropped: 0,
    });
  });

  it("forwards legacy X10 mouse and focus events", () => {
    const chunk = X10_CLICK + FOCUS_IN;
    expect(filterBusyPassthrough(chunk, false)).toEqual({
      forward: chunk,
      dropped: 0,
    });
  });

  it("drops printable chars and CR while forwarding interleaved mouse events", () => {
    const { forward, dropped } = filterBusyPassthrough(
      `ab${WHEEL_UP}\r${CLICK_PRESS}c`,
      false,
    );
    expect(forward).toBe(WHEEL_UP + CLICK_PRESS);
    expect(dropped).toBe(4); // a, b, \r, c
  });

  it("forwards horizontal cursor keys only when allowed", () => {
    const keys = `${LEFT}${RIGHT}\x1bOC\x1b[H\x1b[F\x1b[1~\x1b[4~`;
    expect(filterBusyPassthrough(keys, true).forward).toBe(keys);
    expect(filterBusyPassthrough(keys, false).forward).toBe("");
  });

  it("never forwards Up/Down (history recall) even when cursor keys are allowed", () => {
    const { forward } = filterBusyPassthrough(UP + DOWN + LEFT, true);
    expect(forward).toBe(LEFT);
  });

  it("drops an unrecognized escape sequence without eating a following mouse event", () => {
    const { forward } = filterBusyPassthrough(`\x1b[5;7~${WHEEL_DOWN}`, false);
    expect(forward).toBe(WHEEL_DOWN);
  });
});

describe("Interceptor — terminal stays alive while translating", () => {
  it("forwards wheel scroll and clicks mid-translation", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(await h.interceptor.handleKeyInput(WHEEL_UP)).toBe(WHEEL_UP);
    expect(await h.interceptor.handleKeyInput(CLICK_PRESS + CLICK_RELEASE)).toBe(
      CLICK_PRESS + CLICK_RELEASE,
    );

    h.finishTranslation("Fix this function");
    await enter;
    // Translation still completed and submitted normally.
    expect(h.writes.some((w) => w.includes("Fix this function"))).toBe(true);
    expect(h.writes).toContain("\r");
  });

  it("forwards Left/Right mid-translation on single-line input", async () => {
    const h = makeHarness("이 함수 고쳐줘"); // no \n

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(await h.interceptor.handleKeyInput(LEFT)).toBe(LEFT);
    expect(await h.interceptor.handleKeyInput(RIGHT)).toBe(RIGHT);

    h.finishTranslation("Fix this function");
    await enter;
  });

  it("drops cursor keys mid-translation on multi-line input", async () => {
    const h = makeHarness("이 함수 고쳐줘\n그리고 테스트도");

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(await h.interceptor.handleKeyInput(LEFT)).toBe("");
    // Mouse events still pass — they never touch the editor buffer.
    expect(await h.interceptor.handleKeyInput(WHEEL_DOWN)).toBe(WHEEL_DOWN);

    h.finishTranslation("Fix this function and the tests");
    await enter;
  });

  it("still drops typed chars, Enter, and Up/Down mid-translation", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    expect(await h.interceptor.handleKeyInput("x")).toBe("");
    expect(await h.interceptor.handleKeyInput("\r")).toBe("");
    expect(await h.interceptor.handleKeyInput(UP)).toBe("");
    expect(await h.interceptor.handleKeyInput(DOWN)).toBe("");

    h.finishTranslation("Fix this function");
    await enter;
    // Exactly one CR reached the PTY (the submit), not the dropped one.
    expect(h.writes.filter((w) => w === "\r")).toHaveLength(1);
  });

  it("cursor-key allowance resets after the translation finishes", async () => {
    const h = makeHarness();

    const enter = h.interceptor.handleKeyInput("\r");
    await sleep(MID_FLIGHT_MS);
    h.finishTranslation("Fix this function");
    await enter;

    // Idle again: arrows pass through as normal input, untouched.
    expect(await h.interceptor.handleKeyInput(UP)).toBe(UP);
  });
});
