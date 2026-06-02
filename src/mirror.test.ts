import { describe, expect, it } from "vitest";
import { ScreenMirror } from "./mirror.js";

/**
 * Helper: feed an array of rows to the mirror as if claude rendered them.
 * xterm-headless processes writes asynchronously, so we await two event-loop
 * turns to ensure the emulator has consumed the buffer before reads.
 */
async function paint(mirror: ScreenMirror, rows: string[]): Promise<void> {
  mirror.write("\x1b[2J\x1b[H");
  for (let i = 0; i < rows.length; i++) {
    mirror.write(rows[i]);
    if (i < rows.length - 1) mirror.write("\r\n");
  }
  mirror.flush();
  // xterm-headless parses asynchronously — give the event loop time
  // to drain the parser queue before reads see the new state.
  await new Promise((r) => setTimeout(r, 50));
}

describe("ScreenMirror.extractInputBox", () => {
  it("returns null on empty screen", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [""]);
    expect(m.extractInputBox()).toBeNull();
    m.dispose();
  });

  it("extracts a single-line prompt after the ❯ marker", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [
      "─────────────────────────────────────",
      "❯ 안녕하세요",
      "─────────────────────────────────────",
      "? for shortcuts",
    ]);
    expect(m.extractInputBox()).toBe("안녕하세요");
    m.dispose();
  });

  it("extracts multi-line input (continuation lines below prompt)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [
      "─────────────────────────────────────",
      "❯ first line",
      "  second line",
      "  third line",
      "─────────────────────────────────────",
      "? for shortcuts",
    ]);
    expect(m.extractInputBox()).toBe("first line\nsecond line\nthird line");
    m.dispose();
  });

  it("stops collecting at a divider", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ hello", "─────────────", "should not appear"]);
    expect(m.extractInputBox()).toBe("hello");
    m.dispose();
  });

  it("stops at status-bar line", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ 한글 입력", "? for shortcuts · esc to interrupt"]);
    expect(m.extractInputBox()).toBe("한글 입력");
    m.dispose();
  });

  it("picks the LAST ❯ when multiple are present", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ stale earlier prompt", "...", "❯ current input", "─────────"]);
    expect(m.extractInputBox()).toBe("current input");
    m.dispose();
  });
});

describe("ScreenMirror.hasAutocompletePopup", () => {
  it("returns false on bare input (no popup)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ ", "─────────────", "? for shortcuts"]);
    expect(m.hasAutocompletePopup()).toBe(false);
    m.dispose();
  });

  it("detects a popup with ≥2 file-name items below prompt", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ src/i", "src/index.ts", "src/intercept.ts", "src/init.ts"]);
    expect(m.hasAutocompletePopup()).toBe(true);
    m.dispose();
  });

  it("detects a popup with /command items", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ /", "/help    show commands", "/config  show config"]);
    expect(m.hasAutocompletePopup()).toBe(true);
    m.dispose();
  });

  it("does not false-positive on a single stray filename in user text", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ check README.md", "─────────────"]);
    expect(m.hasAutocompletePopup()).toBe(false);
    m.dispose();
  });
});

describe("ScreenMirror.hasSubmitFormWidget", () => {
  it("detects ✓ Submit header", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [
      "  ┌──────────────────────┐",
      "  │ ✓ Submit · ⎋ Cancel  │",
      "  └──────────────────────┘",
      "  [ ] option 1",
      "  [x] option 2",
    ]);
    expect(m.hasSubmitFormWidget()).toBe(true);
    m.dispose();
  });

  it("returns false when no ✓ Submit anywhere", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ normal input", "─────────────"]);
    expect(m.hasSubmitFormWidget()).toBe(false);
    m.dispose();
  });
});

describe("ScreenMirror.isPromptBoxed", () => {
  it("detects boxed modal prompt (│ ❯ ...)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [
      "╭─────────────────────────────────╮",
      "│ ❯ user typing into a modal      │",
      "╰─────────────────────────────────╯",
    ]);
    expect(m.isPromptBoxed()).toBe(true);
    m.dispose();
  });

  it("returns false for bare prompt", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ bare input", "─────────────"]);
    expect(m.isPromptBoxed()).toBe(false);
    m.dispose();
  });
});

describe("ScreenMirror.hasBashPrompt", () => {
  it("detects bash mode active row even with a stale ❯ Korean prompt above", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, [
      "❯ 이전 한국어 메시지",
      "─────────────",
      "(claude's earlier response)",
      "! git pull",
      "─────────────",
      "? for shortcuts",
    ]);
    expect(m.hasBashPrompt()).toBe(true);
    // Documents the bug hasBashPrompt guards against: the bash row doesn't
    // match PROMPT_LINE, so extractInputBox falls back to the stale Korean.
    expect(m.extractInputBox()).toBe("이전 한국어 메시지");
    m.dispose();
  });

  it("returns false for a normal ❯ Korean prompt (no regression)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ 안녕하세요", "─────────────", "? for shortcuts"]);
    expect(m.hasBashPrompt()).toBe(false);
    m.dispose();
  });

  it("returns false for a bare empty prompt", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ ", "─────────────", "? for shortcuts"]);
    expect(m.hasBashPrompt()).toBe(false);
    m.dispose();
  });

  it("does not false-positive on an indented '! ' continuation line", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ 첫 줄", "  ! 둘째 줄", "─────────────"]);
    expect(m.hasBashPrompt()).toBe(false);
    m.dispose();
  });

  it("detects bash mode rendered inside a box edge (│ ! ...)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["│ ! echo hi", "─────────────"]);
    expect(m.hasBashPrompt()).toBe(true);
    m.dispose();
  });

  it("picks the bottom-most marker (bash row below an earlier ❯)", async () => {
    const m = new ScreenMirror(80, 24);
    await paint(m, ["❯ 위쪽", "...", "! ls", "─────────────"]);
    expect(m.hasBashPrompt()).toBe(true);
    m.dispose();
  });
});

describe("ScreenMirror.resize", () => {
  it("updates cols/rows getters", () => {
    const m = new ScreenMirror(80, 24);
    expect(m.cols).toBe(80);
    expect(m.rows).toBe(24);
    m.resize(120, 40);
    expect(m.cols).toBe(120);
    expect(m.rows).toBe(40);
    m.dispose();
  });
});
