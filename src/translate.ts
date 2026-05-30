import Anthropic from "@anthropic-ai/sdk";
import type { Backend, Config } from "./config.js";
import { needsTranslation, protect, restore } from "./tokenize.js";

export interface Glossary {
  /** Ordered pairs: [koreanForm, canonicalEnglish]. */
  entries: Array<[string, string]>;
}

const SYSTEM_PROMPT = (sourceLang: string, targetLang: string, glossary: Glossary) =>
  `You are a translation engine for a software developer. Translate the user's message from ${sourceLang} to ${targetLang}.

CRITICAL RULES (must be followed):

1. Output ONLY the translation. No preamble, no explanation, no quotes.

2. Tokens of the form {K0}, {K1}, {K2}, ... are PLACEHOLDERS. Copy them VERBATIM into the output. Do NOT translate, drop, renumber, or reformat them. They MUST all appear in the output.

3. Preserve any ENGLISH words/identifiers in the input AS-IS. Do NOT translate them. This includes:
   - Library / framework / language names (React, Node.js, TypeScript, Django, ...)
   - API / function / class names (useState, fetch, JSON.stringify, ...)
   - Tool / command names (npm, git, docker, ...)
   - Variable / identifier names from code

4. Korean transliterations of English technical terms MUST be converted back to the canonical English form:
   - 리액트 → React
   - 노드제이에스 / 노드 → Node.js
   - 타입스크립트 → TypeScript
   - 자바스크립트 → JavaScript
   - 파이썬 → Python
   - 도커 → Docker
   - 깃 → Git, 깃허브 → GitHub
   - 데이터베이스 → database, 컴포넌트 → component, 라이브러리 → library, 모듈 → module
   - 훅 → hook, 콜백 → callback, 비동기 → async, 동기 → sync
   - 함수 → function, 변수 → variable, 객체 → object, 배열 → array
${glossary.entries.length > 0 ? renderGlossary(glossary) : ""}
5. Tone: neutral, direct, developer prompt context. No politeness padding.

Examples:

  Input:  리액트 컴포넌트 만들어줘
  Output: Create a React component

  Input:  useState 어떻게 써?
  Output: How do I use useState?

  Input:  이 fetch 가 왜 안돼?
  Output: Why isn't this fetch working?

  Input:  타입스크립트로 노드제이에스 서버 만들어줘
  Output: Build a Node.js server in TypeScript

  Input:  {K0} 좀 봐줘
  Output: Take a look at {K0}`;

function renderGlossary(g: Glossary): string {
  const lines = g.entries.map(([ko, en]) => `   - ${ko} → ${en}`).join("\n");
  return `\n   User glossary (highest priority):\n${lines}\n`;
}

export interface Translator {
  translate(text: string): Promise<string>;
}

export function makeTranslator(cfg: Config): Translator {
  const glossary: Glossary = { entries: cfg.glossary ?? [] };
  switch (cfg.backend.kind) {
    case "haiku":
      return new HaikuTranslator(cfg.backend, cfg.sourceLang, cfg.targetLang, glossary);
    case "ollama":
      return new OllamaTranslator(cfg.backend, cfg.sourceLang, cfg.targetLang, glossary);
  }
}

class HaikuTranslator implements Translator {
  private client: Anthropic;
  private model: string;
  private system: string;

  constructor(
    backend: Extract<Backend, { kind: "haiku" }>,
    src: string,
    tgt: string,
    glossary: Glossary,
  ) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "klaude: Haiku backend requires ANTHROPIC_API_KEY. " +
          "Set it in your shell, or switch backend: " +
          "`klaude config set backend ollama:gemma3:4b`",
      );
    }
    this.client = new Anthropic();
    this.model = backend.model;
    this.system = SYSTEM_PROMPT(src, tgt, glossary);
  }

  async translate(text: string): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.system,
      messages: [{ role: "user", content: text }],
    });
    const block = res.content.find((b) => b.type === "text");
    if (block?.type !== "text") {
      throw new Error("no text block in response");
    }
    return block.text.trim();
  }
}

class OllamaTranslator implements Translator {
  private host: string;
  private model: string;
  private system: string;

  constructor(
    backend: Extract<Backend, { kind: "ollama" }>,
    src: string,
    tgt: string,
    glossary: Glossary,
  ) {
    this.host = backend.host;
    this.model = backend.model;
    this.system = SYSTEM_PROMPT(src, tgt, glossary);
  }

  async translate(text: string): Promise<string> {
    const ctrl = new AbortController();
    const timeoutMs = Number(process.env.KLAUDE_OLLAMA_TIMEOUT_MS) || 30_000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: this.system },
            { role: "user", content: text },
          ],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { message: { content: string } };
      return json.message.content.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * High-level: translate a user prompt with token protection and the
 * "respond in source language" instruction appended.
 *
 * Repair step: if the translation dropped any placeholders (small models
 * sometimes do), append the missing original tokens to the end so the
 * information isn't lost. Better an awkward sentence than a silent
 * @mention being deleted.
 */
export async function translatePrompt(
  text: string,
  translator: Translator,
  sourceLang: string,
  onMissing?: (missing: string[]) => void,
  onUntranslated?: (stage: "first" | "retry", reason: string) => void,
): Promise<string> {
  if (!needsTranslation(text)) return text;
  const { masked, tokens } = protect(text);
  let translated = await translator.translate(masked);

  // Validate the translation against multiple failure modes that small
  // local models (gemma3:4b) routinely hit. Retry once with a stricter
  // prompt if any check fails. After retry, accept whatever we get —
  // submitting Korean-with-Respond-in-Korean still works (Claude is
  // multilingual), it just loses the English-reasoning benefit.
  const failure = detectTranslationFailure(masked, translated);
  if (failure) {
    onUntranslated?.("first", failure);
    const stricterInput =
      `TRANSLATE THE FOLLOWING TO ENGLISH. ` +
      `Do NOT include any Korean characters in your response. ` +
      `Do NOT copy from any prior examples — translate the actual input below. ` +
      `Preserve {K\\d+} tokens verbatim.\n\n${masked}`;
    translated = await translator.translate(stricterInput);
    const retryFailure = detectTranslationFailure(masked, translated);
    if (retryFailure) {
      onUntranslated?.("retry", retryFailure);
      // Both attempts failed. Fall back to the original (masked) input
      // — Claude is multilingual and will handle Korean fine, whereas
      // the translator's fabricated English (e.g. echoing an example
      // output) would silently replace the user's real question. Loss
      // of English-reasoning benefit > loss of the user's actual prompt.
      translated = masked;
    }
  }

  const repaired = repairMissingPlaceholders(translated, tokens, onMissing);
  const restored = restore(repaired, tokens);
  const instruction = respondInLangInstruction(sourceLang);
  return `${restored}\n\n${instruction}`;
}

/**
 * Canonical example outputs from the SYSTEM_PROMPT few-shot block. Small
 * models will sometimes regurgitate one of these verbatim instead of
 * translating an unfamiliar input — observed with gemma3:4b. Keep this
 * list in sync with the Examples block in SYSTEM_PROMPT above.
 */
const KNOWN_EXAMPLE_OUTPUTS = new Set([
  "Create a React component",
  "How do I use useState?",
  "Why isn't this fetch working?",
  "Build a Node.js server in TypeScript",
]);

/**
 * Multi-check translation validator. Returns a short reason string on
 * failure (for logging), or null if the translation looks plausible.
 *
 * Checks (any of which fails the translation):
 *   1. CJK echo — output is still mostly Korean (model echoed the input).
 *   2. Example echo — output is verbatim one of our few-shot example
 *      outputs (small model copied from the prompt's Examples block).
 *   3. Length disproportion — output is implausibly short relative to
 *      input. English/Korean char ratio is ~1.5-2× for real translations;
 *      <0.4× signals the model collapsed content.
 *   4. Missing input content — distinctive English/numeric tokens from
 *      the input (PR numbers, identifiers, keywords) don't appear in the
 *      output. Catches the case where the model hallucinates output of
 *      similar length but unrelated topic (e.g. "Please explain what
 *      {K0} does" when the user asked "{K0} PR 202 머지된거지?"). This
 *      complements check 2 — example echoes that the model paraphrased
 *      instead of copying verbatim still get caught here, because the
 *      paraphrase drops the input's specific tokens.
 */
function detectTranslationFailure(input: string, output: string): string | null {
  if (looksUntranslated(output)) return "CJK echo";
  if (KNOWN_EXAMPLE_OUTPUTS.has(output.trim())) return "example echo";
  if (isLengthDisproportionate(input, output)) return "length disproportionate";
  if (isMissingInputContent(input, output)) return "missing input content";
  return null;
}

function isLengthDisproportionate(input: string, output: string): boolean {
  // Only check substantial inputs — short prompts (e.g. "ㅎㅎ") have too
  // much noise in the char ratio to judge reliably.
  if (input.length < 40) return false;
  return output.length < input.length * 0.4;
}

function isMissingInputContent(input: string, output: string): boolean {
  // Strip {K\d+} placeholders — they're token preservation, not content.
  const stripPlaceholders = (s: string) => s.replace(/\{K\d+\}/g, " ");
  const inputBody = stripPlaceholders(input);
  const outputBody = stripPlaceholders(output);

  // Distinctive alphanumeric tokens (length ≥ 2) from the input —
  // identifiers, PR numbers, framework names, etc. Rule 3 in the prompt
  // says these should be preserved verbatim, so they MUST appear in a
  // real translation.
  const tokens = [...inputBody.matchAll(/[A-Za-z0-9]{2,}/g)].map((m) => m[0]);
  // Need at least 2 tokens for a meaningful signal — single-token input
  // could legitimately be dropped/transformed.
  if (tokens.length < 2) return false;

  // Match on whole-token equality (case-insensitive), not substring —
  // otherwise "PR" would falsely match inside "Please", masking the
  // hallucination we're trying to detect.
  const outputTokens = new Set(
    [...outputBody.matchAll(/[A-Za-z0-9]{2,}/g)].map((m) => m[0].toLowerCase()),
  );
  let present = 0;
  for (const t of tokens) {
    if (outputTokens.has(t.toLowerCase())) present++;
  }
  return present / tokens.length < 0.5;
}

/**
 * Heuristic: a translation that's >30% CJK chars almost certainly didn't
 * actually translate. Placeholders restored to @paths and URLs are ASCII,
 * so a real English translation should land near 0% CJK.
 */
function looksUntranslated(text: string): boolean {
  const cjk = text.match(/[ㄱ-힝一-鿿぀-ヿ]/g)?.length ?? 0;
  const nonWs = text.replace(/\s/g, "").length;
  if (nonWs === 0) return false;
  return cjk / nonWs > 0.3;
}

function repairMissingPlaceholders(
  translated: string,
  tokens: string[],
  onMissing?: (missing: string[]) => void,
): string {
  // Normalize common LLM-mangled placeholder variants back to {K\d+}.
  //   { K0 }, {k0}, ｛K0｝, [K0], ﹛K0﹜  →  {K0}
  const normalized = translated.replace(/[｛{﹛[]\s*[Kk]\s*(\d+)\s*[｝}﹜\]]/g, "{K$1}");

  const present = new Set(
    Array.from(normalized.matchAll(/{K(\d+)}/g)).map((m) => Number(m[1])),
  );
  const missing: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!present.has(i)) missing.push(i);
  }
  if (missing.length === 0) return normalized;
  onMissing?.(missing.map((i) => tokens[i]));
  const appendix = missing.map((i) => `{K${i}}`).join(" ");
  return `${normalized.trimEnd()} ${appendix}`;
}

function respondInLangInstruction(lang: string): string {
  const map: Record<string, string> = {
    ko: "Respond in Korean.",
    ja: "Respond in Japanese.",
    zh: "Respond in Chinese.",
  };
  return map[lang] ?? `Respond in ${lang}.`;
}
