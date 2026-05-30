import { describe, expect, it, vi } from "vitest";
import type { Translator } from "./translate.js";
import { translatePrompt } from "./translate.js";

/**
 * Build a mock Translator with a script: the n-th call returns the n-th item.
 * Allows simulating first-attempt + retry behavior.
 */
function scriptedTranslator(responses: string[]): Translator & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async translate(text: string): Promise<string> {
      calls.push(text);
      const out = responses[Math.min(i, responses.length - 1)];
      i++;
      return out;
    },
  };
}

describe("translatePrompt — basic flow", () => {
  it("returns input unchanged when no CJK", async () => {
    const t = scriptedTranslator(["should not be called"]);
    const out = await translatePrompt("hello world", t, "ko");
    expect(out).toBe("hello world");
    expect(t.calls).toHaveLength(0);
  });

  it("translates Korean and appends Respond-in-lang instruction", async () => {
    const t = scriptedTranslator(["Hello"]);
    const out = await translatePrompt("안녕", t, "ko");
    expect(out).toContain("Hello");
    expect(out).toContain("Respond in Korean.");
  });

  it("appends Japanese instruction for ja source", async () => {
    const t = scriptedTranslator(["Hello"]);
    const out = await translatePrompt("こんにちは", t, "ja");
    expect(out).toContain("Respond in Japanese.");
  });

  it("falls back to generic 'Respond in <lang>' for unknown source", async () => {
    const t = scriptedTranslator(["Hello"]);
    const out = await translatePrompt("안녕", t, "xx");
    expect(out).toContain("Respond in xx.");
  });
});

describe("translatePrompt — placeholder restore", () => {
  it("restores @file mentions after translation", async () => {
    const t = scriptedTranslator(["Take a look at {K0}"]);
    const out = await translatePrompt("@src/index.ts 봐줘", t, "ko");
    expect(out).toContain("@src/index.ts");
    expect(out).not.toContain("{K0}");
  });

  it("restores URLs", async () => {
    const t = scriptedTranslator(["Check {K0}"]);
    const out = await translatePrompt("https://example.com 확인해줘", t, "ko");
    expect(out).toContain("https://example.com");
  });

  it("appends missing placeholders that translator dropped", async () => {
    const onMissing = vi.fn();
    // Translator drops {K1}
    const t = scriptedTranslator(["Run {K0} please"]);
    const out = await translatePrompt("이 `cmd1` 실행하고 `cmd2` 도", t, "ko", onMissing);
    expect(out).toContain("`cmd1`");
    expect(out).toContain("`cmd2`");
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it("normalizes mangled placeholder variants ({k0}, [K0], { K0 })", async () => {
    const t = scriptedTranslator(["Take a look at { K0 } and [K1]"]);
    const out = await translatePrompt("@a/b.ts 와 `code` 봐줘", t, "ko");
    expect(out).toContain("@a/b.ts");
    expect(out).toContain("`code`");
    expect(out).not.toContain("{K");
  });
});

describe("translatePrompt — failure detection + retry", () => {
  it("retries when output is still mostly Korean (CJK echo)", async () => {
    const onUntranslated = vi.fn();
    // First attempt: echoes Korean. Retry: proper English.
    const t = scriptedTranslator(["안녕하세요 그대로", "Hello stay as is"]);
    const out = await translatePrompt(
      "안녕하세요 그대로",
      t,
      "ko",
      undefined,
      onUntranslated,
    );
    expect(t.calls).toHaveLength(2);
    expect(onUntranslated).toHaveBeenCalledWith("first", "CJK echo");
    expect(out).toContain("Hello stay as is");
  });

  it("retries when output echoes a known few-shot example", async () => {
    const onUntranslated = vi.fn();
    // First attempt: copies the example output verbatim. Retry: real translation.
    const t = scriptedTranslator(["Create a React component", "Build me a Vue app"]);
    const out = await translatePrompt(
      "뷰 앱 만들어줘",
      t,
      "ko",
      undefined,
      onUntranslated,
    );
    expect(onUntranslated).toHaveBeenCalledWith("first", "example echo");
    expect(out).toContain("Build me a Vue app");
  });

  it("retries when output is implausibly short relative to long input", async () => {
    const onUntranslated = vi.fn();
    const longInput =
      "이것은 매우 매우 매우 매우 매우 매우 매우 긴 한국어 입력이고 충분한 길이입니다 정말로 충분히 길어요";
    const t = scriptedTranslator([
      "short",
      "this is a sufficiently long English translation",
    ]);
    const out = await translatePrompt(longInput, t, "ko", undefined, onUntranslated);
    expect(onUntranslated).toHaveBeenCalledWith("first", "length disproportionate");
    expect(out).toContain("sufficiently long");
  });

  it("retries when output is missing distinctive input tokens", async () => {
    const onUntranslated = vi.fn();
    // Input has PR2024 and useState which should appear in any real translation
    const t = scriptedTranslator([
      "Please explain what this code does in detail",
      "PR2024 already merged? Check useState in the file",
    ]);
    const out = await translatePrompt(
      "PR2024 머지된거지? useState 파일에서 확인해줘",
      t,
      "ko",
      undefined,
      onUntranslated,
    );
    expect(onUntranslated).toHaveBeenCalledWith("first", "missing input content");
    expect(out).toContain("PR2024");
    expect(out).toContain("useState");
  });

  it("falls back to original input when both attempts fail", async () => {
    const onUntranslated = vi.fn();
    // Both attempts return Korean — total failure
    const t = scriptedTranslator(["여전히 한국어", "또 한국어"]);
    const out = await translatePrompt("안녕", t, "ko", undefined, onUntranslated);
    expect(onUntranslated).toHaveBeenCalledTimes(2);
    expect(onUntranslated).toHaveBeenNthCalledWith(1, "first", expect.any(String));
    expect(onUntranslated).toHaveBeenNthCalledWith(2, "retry", expect.any(String));
    // Fallback: original Korean (with Respond-in-Korean appended)
    expect(out).toContain("안녕");
    expect(out).toContain("Respond in Korean.");
  });
});

describe("translatePrompt — edge cases", () => {
  it("handles input with only placeholders + Korean", async () => {
    const t = scriptedTranslator(["Look at {K0}"]);
    const out = await translatePrompt("@x.ts 봐", t, "ko");
    expect(out).toContain("@x.ts");
    expect(out).toContain("Look at");
  });

  it("preserves placeholder count when translator omits some", async () => {
    const t = scriptedTranslator(["{K0} only"]);
    const out = await translatePrompt("이 `a`, `b`, `c` 모두 봐줘", t, "ko");
    // All three tokens should still appear in output (appended at end)
    expect(out).toMatch(/`a`/);
    expect(out).toMatch(/`b`/);
    expect(out).toMatch(/`c`/);
  });
});
