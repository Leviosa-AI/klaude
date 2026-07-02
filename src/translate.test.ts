import { afterEach, describe, expect, it, vi } from "vitest";
import type { Translator } from "./translate.js";
import { makeTranslator, translatePrompt } from "./translate.js";

/**
 * Build a mock Translator with a script: the n-th call returns the n-th item.
 * Allows simulating first-attempt + retry behavior.
 */
function scriptedTranslator(
  responses: string[],
): Translator & { calls: string[]; contexts: Array<string | undefined> } {
  const calls: string[] = [];
  const contexts: Array<string | undefined> = [];
  let i = 0;
  return {
    calls,
    contexts,
    async translate(text: string, context?: string): Promise<string> {
      calls.push(text);
      contexts.push(context);
      const out = responses[Math.min(i, responses.length - 1)];
      i++;
      return out;
    },
  };
}

describe("OllamaTranslator — response shape validation", () => {
  const ollamaCfg = {
    backend: {
      kind: "ollama" as const,
      model: "gemma3:4b",
      host: "http://localhost:11434",
    },
    sourceLang: "ko",
    targetLang: "en",
    debug: false,
    glossary: [],
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchJson(body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("returns the trimmed content on the expected shape", async () => {
    stubFetchJson({ message: { content: "  Hello  " } });
    const t = makeTranslator(ollamaCfg);
    await expect(t.translate("안녕")).resolves.toBe("Hello");
  });

  it("throws a descriptive error when message.content is missing", async () => {
    stubFetchJson({ error: "model not found" });
    const t = makeTranslator(ollamaCfg);
    await expect(t.translate("안녕")).rejects.toThrow(
      /unexpected \/api\/chat response shape/,
    );
  });

  it("throws a descriptive error when content is not a string", async () => {
    stubFetchJson({ message: { content: 42 } });
    const t = makeTranslator(ollamaCfg);
    await expect(t.translate("안녕")).rejects.toThrow(
      /unexpected \/api\/chat response shape/,
    );
  });
});

describe("translatePrompt — cancel signal", () => {
  it("threads the AbortSignal through to the translator", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const t: Translator = {
      async translate(_text, _context, signal) {
        seen.push(signal);
        return "Hello";
      },
    };
    const ctrl = new AbortController();
    await translatePrompt("안녕", t, "ko", undefined, undefined, undefined, ctrl.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(ctrl.signal);
  });

  it("propagates the translator's abort rejection (no swallow, no retry)", async () => {
    let calls = 0;
    const t: Translator = {
      async translate() {
        calls++;
        throw new DOMException("aborted", "AbortError");
      },
    };
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      translatePrompt("안녕", t, "ko", undefined, undefined, undefined, ctrl.signal),
    ).rejects.toThrow();
    expect(calls).toBe(1); // abort must NOT trigger the stricter-prompt retry
  });
});

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

  it("catches a Korean echo even when English identifiers dilute the CJK ratio", async () => {
    // Regression (0.1.5): the context-hint feature led gemma3:4b to
    // regurgitate the reference text as a Korean question instead of
    // translating "아니 product.upload.single, product.upload.bulk 2개".
    // The English identifiers kept the raw CJK ratio under the old 30%
    // threshold, so the all-Korean echo slipped through and was submitted.
    const onUntranslated = vi.fn();
    const t = scriptedTranslator([
      "이 product.upload.single, product.upload.bulk 2개를 만들면 어떤 문제가 발생할까요?",
      "No, just the two: product.upload.single, product.upload.bulk",
    ]);
    const out = await translatePrompt(
      "아니 product.upload.single, product.upload.bulk 2개",
      t,
      "ko",
      undefined,
      onUntranslated,
      "recent conversation about renaming product.upload",
    );
    expect(onUntranslated).toHaveBeenCalledWith("first", "CJK echo");
    // Retry must drop the context that caused the regurgitation.
    expect(t.contexts[1]).toBeUndefined();
    expect(out).toContain("product.upload.single");
    expect(out).toContain("product.upload.bulk");
    expect(out).not.toContain("어떤 문제");
  });

  it("does NOT flag a mostly-English translation that keeps one Korean proper noun", async () => {
    // The echo guard must not over-trigger: a real English translation that
    // legitimately retains an untranslatable Korean name should pass.
    const onUntranslated = vi.fn();
    const t = scriptedTranslator(["What did 김민수 say about the deploy?"]);
    const out = await translatePrompt(
      "김민수가 배포에 대해 뭐래?",
      t,
      "ko",
      undefined,
      onUntranslated,
    );
    expect(onUntranslated).not.toHaveBeenCalled();
    expect(out).toContain("What did 김민수 say");
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

describe("translatePrompt — conversation context hint", () => {
  it("forwards context to the translator on the first attempt", async () => {
    const t = scriptedTranslator(["Check the seller_id lookup"]);
    await translatePrompt(
      "seller_id 조회 확인해줘",
      t,
      "ko",
      undefined,
      undefined,
      "We look up the approval by seller_id, not supabase_user_id.",
    );
    expect(t.contexts[0]).toContain("seller_id");
  });

  it("passes undefined context when none is provided", async () => {
    const t = scriptedTranslator(["Hello"]);
    await translatePrompt("안녕", t, "ko");
    expect(t.contexts[0]).toBeUndefined();
  });

  it("does NOT forward context on the stricter retry", async () => {
    // First attempt fails (CJK echo) → retry. Retry must omit context.
    const t = scriptedTranslator(["여전히 한국어", "Proper English translation"]);
    await translatePrompt(
      "안녕하세요 그대로",
      t,
      "ko",
      undefined,
      undefined,
      "some recent conversation context",
    );
    expect(t.calls).toHaveLength(2);
    expect(t.contexts[0]).toContain("recent conversation");
    expect(t.contexts[1]).toBeUndefined();
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
