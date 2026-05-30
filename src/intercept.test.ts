import { describe, expect, it } from "vitest";
import {
  findBareCR,
  hasAttachmentMarker,
  isSelectionMenuPrompt,
  sanitizeForRetype,
} from "./intercept.js";

describe("findBareCR", () => {
  it("returns -1 when no CR present", () => {
    expect(findBareCR("hello")).toBe(-1);
    expect(findBareCR("")).toBe(-1);
    expect(findBareCR("abc\x1b[A")).toBe(-1);
  });

  it("returns the index of a bare CR", () => {
    expect(findBareCR("\r")).toBe(0);
    expect(findBareCR("abc\r")).toBe(3);
    expect(findBareCR("abc\rdef")).toBe(3);
  });

  it("skips ESC+CR (Shift+Enter for multi-line)", () => {
    expect(findBareCR("\x1b\r")).toBe(-1);
    expect(findBareCR("a\x1b\rb")).toBe(-1);
  });

  it("finds the FIRST bare CR even after an ESC+CR sequence", () => {
    // ESC+CR (Shift+Enter, skipped), then bare CR (submit)
    expect(findBareCR("a\x1b\rb\r")).toBe(4);
  });

  it("handles consecutive CRs", () => {
    expect(findBareCR("\r\r")).toBe(0);
  });
});

describe("isSelectionMenuPrompt", () => {
  it("matches Claude Code confirmation menus", () => {
    expect(isSelectionMenuPrompt("1. Yes")).toBe(true);
    expect(isSelectionMenuPrompt("1. Yes, and don't ask again")).toBe(true);
    expect(isSelectionMenuPrompt("1. Yes, and auto-accept")).toBe(true);
    expect(isSelectionMenuPrompt("  1. Yes")).toBe(true);
  });

  it("does not match arbitrary numbered text", () => {
    expect(isSelectionMenuPrompt("1. 이거 봐줘")).toBe(false);
    expect(isSelectionMenuPrompt("1. Hello")).toBe(false);
    expect(isSelectionMenuPrompt("2. Yes")).toBe(false);
    expect(isSelectionMenuPrompt("1. yesterday")).toBe(false);
  });

  it("does not match user typing 'Yes' as a value", () => {
    expect(isSelectionMenuPrompt("the answer is yes")).toBe(false);
    expect(isSelectionMenuPrompt("Yes — proceed")).toBe(false);
  });
});

describe("hasAttachmentMarker", () => {
  it("detects [Image #N] markers", () => {
    expect(hasAttachmentMarker("[Image #1] 봐줘")).toBe(true);
    expect(hasAttachmentMarker("이거 [Image #12] 어때?")).toBe(true);
  });

  it("detects [Pasted text #N] markers (with optional metadata)", () => {
    expect(hasAttachmentMarker("[Pasted text #2 +12 lines]")).toBe(true);
    expect(hasAttachmentMarker("[Pasted text #1]")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(hasAttachmentMarker("[image #1]")).toBe(true);
    expect(hasAttachmentMarker("[PASTED text #1]")).toBe(true);
  });

  it("does not match generic bracketed text", () => {
    expect(hasAttachmentMarker("[1, 2, 3]")).toBe(false);
    expect(hasAttachmentMarker("배열 [a, b]")).toBe(false);
    expect(hasAttachmentMarker("[INFO] something")).toBe(false);
  });
});

describe("sanitizeForRetype", () => {
  it("preserves plain text", () => {
    expect(sanitizeForRetype("hello world")).toBe("hello world");
  });

  it("normalizes CRLF to LF", () => {
    expect(sanitizeForRetype("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("preserves LF newlines", () => {
    expect(sanitizeForRetype("line1\nline2")).toBe("line1\nline2");
  });

  it("strips control characters that could inject ESC sequences", () => {
    expect(sanitizeForRetype("hello\x1b[31mred\x1b[0m")).toBe("hello[31mred[0m");
    expect(sanitizeForRetype("a\x07b")).toBe("ab"); // bell
    expect(sanitizeForRetype("\x00null\x01")).toBe("null");
  });

  it("preserves newlines (\\x0a) — only LF is whitelisted", () => {
    expect(sanitizeForRetype("a\nb")).toBe("a\nb");
    // Tabs are stripped along with other control chars
    expect(sanitizeForRetype("a\tb")).toBe("ab");
  });

  it("preserves Korean and other unicode text", () => {
    expect(sanitizeForRetype("안녕하세요 こんにちは 你好")).toBe(
      "안녕하세요 こんにちは 你好",
    );
  });
});
