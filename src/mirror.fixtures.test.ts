import { describe, expect, it } from "vitest";
import { hasAttachmentMarker, isSelectionMenuPrompt } from "./intercept.js";
import { ScreenMirror } from "./mirror.js";

/**
 * TUI regression fixtures: full-screen renderings modeled on real Claude
 * Code output, each asserting EVERY screen heuristic at once. When a Claude
 * Code release changes its TUI, update/extend a fixture here and the failing
 * assertions point straight at the heuristic that needs work.
 *
 * Capturing a real screen: run `KLAUDE_DUMP_POPUP=1 klaude` (with debug on),
 * press Enter in the state you care about, and copy the screen dump from
 * ~/.klaude/debug.log into a new fixture below (strip the `NN│` row prefix).
 */

async function paintScreen(rows: string[]): Promise<ScreenMirror> {
  const m = new ScreenMirror(80, 24);
  m.write("\x1b[2J\x1b[H");
  for (let i = 0; i < rows.length; i++) {
    m.write(rows[i]);
    if (i < rows.length - 1) m.write("\r\n");
  }
  m.flush();
  // xterm-headless parses asynchronously — let the parser queue drain.
  await new Promise((r) => setTimeout(r, 50));
  return m;
}

/** Assert the full heuristic profile of a screen in one place. */
interface Profile {
  input: string | null;
  popup: boolean;
  submitWidget: boolean;
  bash: boolean;
  boxed: boolean;
}

function profile(m: ScreenMirror): Profile {
  return {
    input: m.extractInputBox(),
    popup: m.hasAutocompletePopup(),
    submitWidget: m.hasSubmitFormWidget(),
    bash: m.hasBashPrompt(),
    boxed: m.isPromptBoxed(),
  };
}

describe("TUI fixtures — screen-level heuristic profiles", () => {
  it("welcome screen with empty prompt", async () => {
    const m = await paintScreen([
      "╭──────────────────────────────────────────╮",
      "│ ✻ Welcome to Claude Code!                │",
      "│                                          │",
      "│   /help for help, /status for your setup │",
      "╰──────────────────────────────────────────╯",
      "",
      "❯ ",
      "──────────────────────────────────────────────",
      "? for shortcuts",
    ]);
    expect(profile(m)).toEqual({
      input: null, // nothing typed yet
      popup: false,
      submitWidget: false,
      bash: false,
      boxed: false,
    });
    m.dispose();
  });

  it("normal Korean input with conversation above", async () => {
    const m = await paintScreen([
      "⏺ I fixed the seller_id mapping in the upload handler.",
      "",
      "  The bulk path now reuses product.upload.single.",
      "",
      "❯ 그럼 벌크 쪽 테스트도 고쳐줘",
      "──────────────────────────────────────────────",
      "? for shortcuts · esc to interrupt",
    ]);
    expect(profile(m)).toEqual({
      input: "그럼 벌크 쪽 테스트도 고쳐줘",
      popup: false,
      submitWidget: false,
      bash: false,
      boxed: false,
    });
    // Claude's latest output is available as translation context.
    expect(m.recentContext()).toContain("seller_id");
    m.dispose();
  });

  it("file autocomplete popup under an @mention", async () => {
    const m = await paintScreen([
      "❯ @src/int 이 파일 봐줘",
      "──────────────────────────────────────────────",
      "▌ src/intercept.ts",
      "  src/intercept.test.ts",
      "  src/index.ts",
      "? for shortcuts",
    ]);
    const p = profile(m);
    expect(p.popup).toBe(true); // Enter selects — must NOT intercept
    expect(p.submitWidget).toBe(false);
    m.dispose();
  });

  it("slash-command autocomplete popup", async () => {
    const m = await paintScreen([
      "❯ /mo",
      "──────────────────────────────────────────────",
      "▌ /model      Change the AI model",
      "  /mobile     Connect your phone",
      "? for shortcuts",
    ]);
    expect(profile(m).popup).toBe(true);
    m.dispose();
  });

  it("tool-permission confirmation menu", async () => {
    const m = await paintScreen([
      "⏺ Bash(git push origin main)",
      "",
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. Yes, and don't ask again for git push commands",
      "  3. No, and tell Claude what to do differently (esc)",
      "",
      "──────────────────────────────────────────────",
    ]);
    const p = profile(m);
    // PROMPT_LINE matches the ❯ selection cursor, so extraction over-collects
    // the menu — isSelectionMenuPrompt is the guard that catches it.
    expect(p.input).not.toBeNull();
    expect(isSelectionMenuPrompt(p.input as string)).toBe(true);
    expect(p.submitWidget).toBe(false);
    m.dispose();
  });

  it("interactive question widget — header visible", async () => {
    const m = await paintScreen([
      "□ Callback  □ Polotno  ✓ Submit  →",
      "",
      "Which option should the pipeline use?",
      "❯ 1. Callback-based flow",
      "  2. Polotno renderer",
      "  3. Type something.",
      "──────────────────────────────────────────────",
    ]);
    expect(profile(m).submitWidget).toBe(true);
    m.dispose();
  });

  it("interactive question widget — header scrolled off, escape-hatch rows visible", async () => {
    const m = await paintScreen([
      "  2. Polotno renderer — 긴 한국어 설명이 여러 줄로 이어져서",
      "     위젯이 터미널보다 커진 상태",
      "❯ 3. Type something.",
      "  4. Chat about this",
      "──────────────────────────────────────────────",
    ]);
    expect(profile(m).submitWidget).toBe(true);
    m.dispose();
  });

  it("bash mode (! replaces the ❯ marker)", async () => {
    const m = await paintScreen([
      "❯ 이전에 제출한 한국어 프롬프트",
      "",
      "! git pull",
      "──────────────────────────────────────────────",
      "? for shortcuts",
    ]);
    const p = profile(m);
    expect(p.bash).toBe(true); // stale ❯ in scrollback must not win
    m.dispose();
  });

  it("boxed modal prompt (plan-mode feedback dialog)", async () => {
    const m = await paintScreen([
      "╭──────────────────────────────────────────╮",
      "│ Tell Claude what to do differently        │",
      "│                                          │",
      "│ ❯ 다르게 해줘                             │",
      "╰──────────────────────────────────────────╯",
    ]);
    expect(profile(m).boxed).toBe(true);
    m.dispose();
  });

  it("Remote Control footer pill (/rc active) is treated as status bar", async () => {
    const m = await paintScreen(["❯ 한글 입력", "  /rc active · ? for shortcuts"]);
    // The footer row must stop input collection, not ride along as a
    // continuation line of the prompt.
    expect(profile(m).input).toBe("한글 입력");
    m.dispose();
  });

  it("attachment marker input is extracted intact for the skip-guard", async () => {
    const m = await paintScreen([
      "❯ [Image #1] 이 스크린샷 봐줘",
      "──────────────────────────────────────────────",
      "? for shortcuts",
    ]);
    const input = m.extractInputBox();
    expect(input).toBe("[Image #1] 이 스크린샷 봐줘");
    expect(hasAttachmentMarker(input as string)).toBe(true);
    m.dispose();
  });
});
