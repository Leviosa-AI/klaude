/**
 * Protect tokens that must NOT be translated:
 *   - ```fenced code blocks```
 *   - `inline code`
 *   - URLs (http/https)
 *   - @path/to/file (file mentions, optional leading whitespace anchor)
 *   - /slash-command (Claude Code commands, optional leading whitespace anchor)
 *
 * Strategy: replace each protected span with a unique placeholder of the
 * form {K0}, {K1}, ... before translation, then restore after. Brace-number
 * tokens look like template/i18n placeholders to LLMs so they're typically
 * preserved verbatim (more reliably than CJK-bracket variants which small
 * models like gemma3:4b tend to "fix").
 */

export interface ProtectResult {
  masked: string;
  tokens: string[];
}

interface Pattern {
  regex: RegExp;
  /**
   * If true, the first capture group is a leading-whitespace anchor that
   * should be preserved verbatim and NOT included in the protected token.
   */
  hasLeadAnchor: boolean;
}

// Unicode letter/number classes inside @path / /command bodies so paths
// with non-ASCII names (e.g. @문서/메모.md) are protected end-to-end.
const PATH_BODY = String.raw`[\p{L}\p{N}_./~\-]+`;
const CMD_BODY = String.raw`[\p{L}\p{N}_:\-]+`;

const FENCED_PATTERN: Pattern = { regex: /```[\s\S]*?```/g, hasLeadAnchor: false };
const SINGLE_LINE_PATTERNS: Pattern[] = [
  { regex: /`[^`\n]+`/g, hasLeadAnchor: false },
  { regex: /https?:\/\/\S+/g, hasLeadAnchor: false },
  { regex: new RegExp(`(^|\\s)@${PATH_BODY}`, "gu"), hasLeadAnchor: true },
  { regex: new RegExp(`(^|\\s)\\/${CMD_BODY}`, "gu"), hasLeadAnchor: true },
];

const CJK_RE = /[ㄱ-힝一-鿿぀-ヿ]/;

/**
 * Thresholds for line-level masking of pasted logs / code / stack traces.
 * Activates only when input is long AND has enough non-Korean lines worth
 * hiding from the translator. Tuned to avoid kicking in on normal-length
 * prompts (a typical Korean question is < 200 chars).
 */
const LINE_MASK_MIN_CHARS = Number(process.env.KLAUDE_LINE_MASK_MIN_CHARS) || 400;
const LINE_MASK_MIN_LINES = 5;
const LINE_MASK_MIN_NONKO_LINES = 3;

export function protect(input: string): ProtectResult {
  const tokens: string[] = [];
  let masked = input;

  // Phase 1: fenced code (multi-line). Must run before line-level masking
  // so a `\`\`\`` block isn't split apart by it.
  masked = applyPattern(masked, FENCED_PATTERN, tokens);

  // Phase 2: bulk-mask consecutive non-Korean lines when the input is
  // large. Lets the translator see only the Korean-bearing lines plus
  // {K\d+} stubs in place of the noise.
  if (shouldMaskNonKoreanLines(masked)) {
    masked = maskNonKoreanLineBlocks(masked, tokens);
  }

  // Phase 3: remaining single-line patterns inside the surviving Korean
  // text — inline code, URLs, @paths, /cmds.
  for (const pat of SINGLE_LINE_PATTERNS) {
    masked = applyPattern(masked, pat, tokens);
  }

  return { masked, tokens };
}

function applyPattern(text: string, { regex, hasLeadAnchor }: Pattern, tokens: string[]): string {
  return text.replace(regex, (...args) => {
    const match = args[0] as string;
    const lead = hasLeadAnchor ? ((args[1] as string) ?? "") : "";
    const body = hasLeadAnchor ? match.slice(lead.length) : match;
    const idx = tokens.length;
    tokens.push(body);
    return `${lead}{K${idx}}`;
  });
}

function shouldMaskNonKoreanLines(text: string): boolean {
  if (text.length < LINE_MASK_MIN_CHARS) return false;
  const lines = text.split("\n");
  if (lines.length < LINE_MASK_MIN_LINES) return false;
  let nonKo = 0;
  for (const l of lines) {
    if (l.trim().length === 0) continue;
    if (!CJK_RE.test(l)) nonKo++;
    if (nonKo >= LINE_MASK_MIN_NONKO_LINES) return true;
  }
  return false;
}

/**
 * Replace each consecutive run of non-Korean lines with one placeholder
 * holding the joined block. Blank lines stick with whichever run they
 * neighbor — they get absorbed into a non-Korean run if surrounded by
 * non-Korean, otherwise pass through as-is.
 */
function maskNonKoreanLineBlocks(text: string, tokens: string[]): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let buf: string[] = [];
  const flushBuf = () => {
    if (buf.length === 0) return;
    const idx = tokens.length;
    tokens.push(buf.join("\n"));
    out.push(`{K${idx}}`);
    buf = [];
  };
  for (const line of lines) {
    if (CJK_RE.test(line)) {
      flushBuf();
      out.push(line);
    } else {
      buf.push(line);
    }
  }
  flushBuf();
  return out.join("\n");
}

export function restore(translated: string, tokens: string[]): string {
  return translated.replace(/{K(\d+)}/g, (_, n) => {
    const i = Number(n);
    return tokens[i] ?? "";
  });
}

/**
 * Heuristic: should this input go through translation at all?
 * If the line has no CJK characters, assume English/code — skip.
 */
export function needsTranslation(input: string): boolean {
  return /[ㄱ-힝一-鿿぀-ヿ]/.test(input);
}
