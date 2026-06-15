import { describe, expect, it } from "vitest";
import { needsTranslation, protect, restore } from "./tokenize.js";

describe("needsTranslation", () => {
  it("detects Hangul", () => {
    expect(needsTranslation("안녕하세요")).toBe(true);
    expect(needsTranslation("hello 코드")).toBe(true);
  });

  it("detects Hangul jamo", () => {
    expect(needsTranslation("ㅎㅎ")).toBe(true);
    expect(needsTranslation("ㄱㄴㄷ")).toBe(true);
  });

  it("detects Hiragana / Katakana / CJK ideographs", () => {
    expect(needsTranslation("こんにちは")).toBe(true);
    expect(needsTranslation("カタカナ")).toBe(true);
    expect(needsTranslation("中文")).toBe(true);
  });

  it("returns false for pure English / code / symbols", () => {
    expect(needsTranslation("hello world")).toBe(false);
    expect(needsTranslation("const x = 42;")).toBe(false);
    expect(needsTranslation("git push origin main")).toBe(false);
    expect(needsTranslation("")).toBe(false);
    expect(needsTranslation("!@#$%^&*()")).toBe(false);
  });
});

describe("protect — placeholder masking", () => {
  it("replaces inline code with {K0}", () => {
    const { masked, tokens } = protect("이거 `useState` 어떻게 써?");
    expect(masked).toBe("이거 {K0} 어떻게 써?");
    expect(tokens).toEqual(["`useState`"]);
  });

  it("replaces fenced code blocks", () => {
    const input = "이거 봐줘\n```ts\nconst x = 1;\n```\n어때?";
    const { masked, tokens } = protect(input);
    expect(masked).toContain("{K0}");
    expect(masked).not.toContain("const x");
    expect(tokens[0]).toContain("```ts");
  });

  it("replaces http/https URLs", () => {
    const { masked, tokens } = protect("https://github.com/foo/bar 확인해줘");
    expect(masked).toMatch(/^\{K0\}/);
    expect(tokens[0]).toBe("https://github.com/foo/bar");
  });

  it("protects @file mentions with leading whitespace preserved", () => {
    const { masked, tokens } = protect("@src/index.ts 봐줘");
    expect(masked).toBe("{K0} 봐줘");
    expect(tokens[0]).toBe("@src/index.ts");
  });

  it("protects /slash-commands", () => {
    const { masked, tokens } = protect("/help 알려줘");
    expect(masked).toBe("{K0} 알려줘");
    expect(tokens[0]).toBe("/help");
  });

  it("protects @path containing non-ASCII characters", () => {
    const { masked, tokens } = protect("@문서/메모.md 정리해줘");
    expect(masked).toBe("{K0} 정리해줘");
    expect(tokens[0]).toBe("@문서/메모.md");
  });

  it("indexes multiple placeholders independently", () => {
    const { masked, tokens } = protect(
      "이 `func` 가 https://example.com 에 요청 보내는데 @src/api.ts 봐줘",
    );
    expect(tokens).toHaveLength(3);
    expect(masked).toContain("{K0}");
    expect(masked).toContain("{K1}");
    expect(masked).toContain("{K2}");
  });

  it("leaves pure Korean text untouched", () => {
    const { masked, tokens } = protect("안녕하세요 이거 봐주세요");
    expect(masked).toBe("안녕하세요 이거 봐주세요");
    expect(tokens).toEqual([]);
  });

  it("does NOT protect @ when not at word boundary", () => {
    // @ in the middle of a word shouldn't trigger (no leading whitespace or start)
    const { masked, tokens } = protect("이메일은 foo@bar.com 인데");
    // tokens may or may not include `foo@bar.com` — current pattern needs ^|whitespace before @
    // so foo@bar.com should NOT be protected.
    expect(tokens.length).toBe(0);
    expect(masked).toContain("foo@bar.com");
  });
});

describe("restore — placeholder substitution", () => {
  it("substitutes {K\\d+} back to original tokens", () => {
    const restored = restore("Take a look at {K0}", ["@src/index.ts"]);
    expect(restored).toBe("Take a look at @src/index.ts");
  });

  it("substitutes multiple placeholders", () => {
    const restored = restore("Run {K0} then check {K1}", ["`npm test`", "@logs/out.txt"]);
    expect(restored).toBe("Run `npm test` then check @logs/out.txt");
  });

  it("leaves unknown placeholder indices as empty string", () => {
    const restored = restore("missing: {K9}", []);
    expect(restored).toBe("missing: ");
  });

  it("round-trip: protect → restore yields original", () => {
    const original = "이 `func` 보고 https://x.com 에 @src/a.ts 가져와";
    const { masked, tokens } = protect(original);
    const restored = restore(masked, tokens);
    expect(restored).toBe(original);
  });
});

describe("protect — large input line-level masking", () => {
  it("bulk-masks consecutive non-Korean lines in long inputs", () => {
    // Build input > LINE_MASK_MIN_CHARS (400) with a Korean question +
    // long English/code dump that should get collapsed into a single
    // placeholder.
    const codeDump = Array(20).fill("const x = someFunction(arg1, arg2);").join("\n");
    const input = `이 코드 봐줘\n${codeDump}\n뭐가 문제야?`;
    const { masked, tokens } = protect(input);
    // The bulk-masked block should be one of the tokens
    const hasCodeToken = tokens.some((t) => t.includes("const x = someFunction"));
    expect(hasCodeToken).toBe(true);
    // The Korean lines remain in masked output
    expect(masked).toContain("이 코드 봐줘");
    expect(masked).toContain("뭐가 문제야?");
  });

  it("does NOT activate line-masking for a single stray non-Korean line", () => {
    const { tokens } = protect("이거 보고\nconst x = 1;\n어때?");
    // Only ONE non-Korean line (< MIN_NONKO_LINES) — masking shouldn't fire.
    // const x = 1; is not in a code fence, so it should appear raw.
    expect(tokens.some((t) => t === "const x = 1;")).toBe(false);
  });

  it("masks a SHORT pasted English block riding alongside a Korean line", () => {
    // Regression: 2-3 lines of pasted English + a Korean question, well
    // under the old 400-char floor. Previously this went to the translator
    // whole, and small models echoed the English and dropped the Korean.
    // Now the English block is masked so only the Korean is translated.
    const input = [
      "The approval is stored keyed by supabase_user_id (during dry_run)",
      "but looked up by seller_id, so the lookup misses for some sellers.",
      "",
      "라고 팀원이 얘기하네. 이거 우리 서버 문제야 카페24 문제야?",
    ].join("\n");
    const { masked, tokens } = protect(input);
    // English block collapsed into a placeholder, Korean preserved inline.
    const hasEnglishToken = tokens.some((t) => t.includes("supabase_user_id"));
    expect(hasEnglishToken).toBe(true);
    expect(masked).toContain("우리 서버 문제야");
    expect(masked).not.toContain("supabase_user_id");
  });

  it("does NOT mask when every line already contains Korean", () => {
    // All lines have Korean → nothing to protect, masking is a no-op.
    const input = "첫 줄 봐줘\n둘째 줄도 봐줘\n셋째 줄 고쳐줘";
    const { masked, tokens } = protect(input);
    expect(tokens).toEqual([]);
    expect(masked).toBe(input);
  });
});
