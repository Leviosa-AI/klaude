import type { Logger } from "./log.js";
import type { ScreenMirror } from "./mirror.js";
import type { PtyHandle } from "./pty.js";
import { cjkCharCount, needsTranslation } from "./tokenize.js";
import type { Translator } from "./translate.js";
import { MAX_CONTEXT_CHARS, translatePrompt } from "./translate.js";

/**
 * Enter-time interception flow.
 *
 * Behavior matrix:
 *
 *   bare CR (\r)                       → candidate submit, try intercept
 *   ESC + CR (\x1b\r) = Shift+Enter    → pass through unchanged (multi-line insert)
 *   autocomplete popup is open         → pass through (Enter selects from popup)
 *   extracted input has no CJK         → pass through (English/code, no translation)
 *   extraction failed (null)           → pass through (be safe)
 *
 * When we DO intercept:
 *   1. Read the current input-box content from the screen mirror.
 *   2. Translate (Haiku or Ollama) with placeholder protection for @/+/code/URLs.
 *   3. Clear claude's input by sending DEL keys × length (multi-line safe).
 *   4. Type the translated text.
 *   5. Send a CR to submit.
 */

const CR = "\r";
const ESC = "\x1b";
const DEL = "\x7f";
const CTRL_E = "\x05";
/** Bracketed paste mode markers. Wrapping retyped text in these tells the
 *  receiving editor "this is a paste" so it disables interactive keystroke
 *  features like @-autocomplete and slash-command popups while inserting. */
const BPASTE_START = "\x1b[200~";
const BPASTE_END = "\x1b[201~";

/**
 * Ctrl+Enter "raw submit" chord — submit the current Korean input AS-IS,
 * bypassing translation so the original Korean reaches Claude untouched.
 *
 * Why a chord works here when Cmd/Option/fn+Enter don't: terminals encode
 * Ctrl+Enter as a CSI escape sequence, NOT a bare CR. So it's unambiguously
 * distinct from plain Enter (`\r`), Shift+Enter (`\x1b\r`), and everything
 * findBareCR inspects — no collision, reliably delivered to the PTY. Two
 * encodings are accepted so it survives claude toggling keyboard modes:
 *   - modifyOtherKeys (xterm):  ESC [ 27 ; 5 ; 13 ~   → \x1b[27;5;13~
 *   - Kitty keyboard protocol:  ESC [ 13 ; 5 u        → \x1b[13;5u
 * In both, modifier `5` = Ctrl (1 + Ctrl-bit 4) and key `13` = Enter.
 */
const RAW_SUBMIT_CHORD = /\x1b\[27;5;13~|\x1b\[13;5u/;

/**
 * Sequences that stay LIVE while a translation is in flight. The busy path
 * drops keystrokes to protect the clear-and-retype dance, but claude keeps
 * mouse reporting enabled — so wheel scroll and clicks arrive on stdin as
 * escape sequences too. Dropping them made the whole terminal feel dead
 * during the 1–4s translation (no scrolling, no clicking). None of these
 * touch the editor BUFFER, so forwarding them is safe:
 *   - SGR mouse (wheel/click/drag):  ESC [ < b ; x ; y M|m
 *   - Legacy X10 mouse:              ESC [ M <3 bytes>
 *   - Focus in/out:                  ESC [ I  /  ESC [ O
 */
const SGR_MOUSE_RE = /^\x1b\[<\d+;\d+;\d+[Mm]/;
const X10_MOUSE_PREFIX = "\x1b[M";
const X10_MOUSE_LEN = X10_MOUSE_PREFIX.length + 3;
const FOCUS_RE = /^\x1b\[[IO]/;

/**
 * Horizontal cursor motion — Left/Right/Home/End in their CSI, SS3, and
 * vt220 encodings. Forwarded while busy ONLY when the intercepted input is
 * single-line: the post-translation wipe sends Ctrl+E (end of LINE, not
 * buffer) before its DELs, so on one line any horizontal drift is undone,
 * but in a multi-line input a Left at column 0 crosses to the previous line
 * and the wipe would eat the wrong region. Up/Down are NEVER forwarded —
 * at the buffer edge they recall prompt history, swapping the editor
 * content out from under the measured-length wipe.
 */
const CURSOR_KEY_RE = /^(?:\x1b\[(?:[CDHF]|1~|4~)|\x1bO[CDHF])/;

/**
 * When KLAUDE_DUMP_POPUP=1 is set, dump screen + heuristic results on EVERY
 * Enter attempt (not just failures). Used to diagnose the autocomplete
 * popup detector by comparing dumps with popup open vs closed.
 */
const DUMP_EVERY_ENTER = process.env.KLAUDE_DUMP_POPUP === "1";

/**
 * When KLAUDE_DUMP_KEYS=1 is set, log the raw byte codes of EVERY keyboard
 * chunk before any handling. Used to discover the exact escape sequence a
 * given key chord (e.g. Ctrl+Enter) emits in a real klaude session, where
 * the running `claude` may have switched the terminal's keyboard mode and
 * changed the encoding from what a bare probe shows.
 */
const DUMP_KEYS = process.env.KLAUDE_DUMP_KEYS === "1";

/**
 * How long to wait after the user presses Enter before reading the screen
 * mirror. Needed so claude's TUI finishes rendering the latest keystroke
 * (especially Tab-expansion of @mentions). Override via env var if the
 * default feels slow on a fast local machine.
 */
const RENDER_DELAY_MS = Number(process.env.KLAUDE_RENDER_DELAY) || 80;

/**
 * How long an ESC at the tail of one chunk stays "armed" as the possible
 * first half of a split Shift+Enter (ESC in one stdin chunk, CR at the head
 * of the next — happens on SSH / high-latency links). Split halves arrive
 * back-to-back (sub-10ms); a deliberate ESC-then-Enter as two keypresses is
 * far slower, so a short window disambiguates the two without misreading a
 * real submit after a standalone ESC.
 */
const SPLIT_ESC_WINDOW_MS = 100;

/**
 * Extra DEL keystrokes beyond the measured char count, in case claude's
 * editor counts graphemes differently than Array.from(input).length. A
 * harmless over-delete: if too many DELs hit an empty editor, claude
 * ignores them. Better to over-delete than to strand stale chars that
 * would prepend to our retyped translation.
 */
const DEL_SAFETY_MARGIN = 4;

export interface InterceptDeps {
  pty: PtyHandle;
  mirror: ScreenMirror;
  translator: Translator;
  sourceLang: string;
  logger: Logger;
}

/** Opt out of passing Claude's recent output as a translation hint. */
const CONTEXT_DISABLED = process.env.KLAUDE_NO_CONTEXT === "1";

/**
 * Minimum Korean characters in the input before the recent-output context
 * hint is attached. The hint helps terminology consistency, but on inputs
 * with only a few Korean chars the translation signal is thin and a small
 * local model (gemma3:4b) will REGURGITATE the reference context instead of
 * translating — e.g. "아니 product.upload.single, product.upload.bulk 2개"
 * (3 Korean chars riding English identifiers) came back as a fabricated
 * Korean question lifted from the context. Below this floor we skip the hint
 * entirely; the few Korean words translate fine without it. Tunable via env.
 */
const CONTEXT_MIN_KO_CHARS = Number(process.env.KLAUDE_CONTEXT_MIN_KO_CHARS ?? 8);

/**
 * Is there enough Korean in this input to safely attach the context hint?
 * See CONTEXT_MIN_KO_CHARS for why thin-Korean inputs are excluded.
 */
export function contextHintEligible(input: string): boolean {
  return cjkCharCount(input) >= CONTEXT_MIN_KO_CHARS;
}

export class Interceptor {
  private deps: InterceptDeps;
  private busy = false;
  /**
   * Cancel handle for the in-flight translation. Non-null exactly while the
   * slow path holds `busy`. Aborted ONLY by the user pressing ESC — the
   * Ollama request timeout uses its own internal controller, so an aborted
   * signal here always means "user cancelled", never "timed out".
   */
  private cancelCtrl: AbortController | null = null;
  /**
   * While busy: may horizontal cursor keys (Left/Right/Home/End) be
   * forwarded? True only when the intercepted input is single-line — see
   * CURSOR_KEY_RE for why multi-line cursor drift breaks the wipe. Mouse
   * and focus sequences are forwarded regardless of this flag.
   */
  private busyCursorKeysSafe = false;
  /**
   * How many Korean prompts we've translated this session. Used to gate the
   * conversation-context hint: the FIRST translated prompt has no prior
   * Claude turn to learn from (the screen shows only the welcome banner), so
   * we skip context then and attach it from the second prompt onward — the
   * "except for the very first time" behavior the user asked for.
   */
  private translatedCount = 0;

  constructor(deps: InterceptDeps) {
    this.deps = deps;
  }

  /**
   * Did the LAST bytes forwarded to claude end with a lone ESC, and when?
   * Tracked on the wrapper's return value (what index.ts actually forwards)
   * so a swallowed ESC — e.g. the translation-cancel key — never arms the
   * flag. Used to recognize a Shift+Enter split across two stdin chunks.
   */
  private forwardedTailEsc = false;
  private forwardedTailEscAt = 0;

  /**
   * Process a chunk of bytes from the user's keyboard. Returns the chunk
   * to forward to claude (may be empty if we're intercepting).
   *
   * This wrapper adds cross-chunk Shift+Enter context around the real
   * handler: a CR at the head of this chunk is NOT a submit if the
   * previously FORWARDED chunk ended with ESC moments ago (split
   * Shift+Enter — see SPLIT_ESC_WINDOW_MS).
   */
  async handleKeyInput(chunk: string): Promise<string> {
    const prevEndedWithEsc =
      this.forwardedTailEsc &&
      Date.now() - this.forwardedTailEscAt <= SPLIT_ESC_WINDOW_MS;
    const out = await this.processKeyInput(chunk, prevEndedWithEsc);
    this.forwardedTailEsc = out.endsWith(ESC);
    if (this.forwardedTailEsc) this.forwardedTailEscAt = Date.now();
    return out;
  }

  /**
   * Concurrency model:
   *   - this.busy is claimed SYNCHRONOUSLY when a CR is detected, before
   *     any await. Subsequent handleKeyInput invocations that see busy=true
   *     drop anything that could mutate the editor buffer (CRs and
   *     printable keys alike).
   *   - Why drop printable keys: during translation (~1–4s) the input
   *     box is being manipulated (indicator shown, then cleared+rewritten).
   *     If the user types extra chars in that window, claude renders them
   *     into the editor and our DEL × measured-old-length wipe won't catch
   *     them — the residue prepends to our translated retype.
   *   - Trade-off: brief keystroke loss while translating. The on-screen
   *     "🔄 번역중..." indicator signals to stop typing.
   *   - EXCEPTION 1: the ESC key while busy (bare \x1b or its kitty CSI-u
   *     encodings) is the cancel signal — it aborts the in-flight
   *     translation instead of being dropped (see isEscCancel).
   *   - EXCEPTION 2: buffer-neutral sequences stay live — mouse events
   *     (wheel scroll, clicks) and focus in/out always, horizontal cursor
   *     keys when the input is single-line. Dropping these made the whole
   *     terminal feel frozen while translating. See filterBusyPassthrough.
   */
  private async processKeyInput(
    chunk: string,
    prevEndedWithEsc: boolean,
  ): Promise<string> {
    if (DUMP_KEYS) {
      this.deps.logger.log(
        `raw key bytes: ${JSON.stringify(Array.from(chunk, (c) => c.charCodeAt(0)))}`,
      );
    }

    if (this.busy) {
      // ESC while translating = cancel. Abort the in-flight translation;
      // the slow path's catch removes the indicator and leaves the user's
      // original Korean in the editor, unsubmitted. The ESC itself is NOT
      // forwarded to claude (it would interrupt/clear claude's own state).
      if (isEscCancel(chunk) && this.cancelCtrl) {
        this.deps.logger.log("ESC during translation — cancelling");
        this.cancelCtrl.abort();
        return "";
      }
      // Keep the terminal alive: forward buffer-neutral sequences (mouse
      // scroll/click, focus, single-line cursor keys), drop the rest.
      const { forward, dropped } = filterBusyPassthrough(chunk, this.busyCursorKeysSafe);
      if (dropped > 0) {
        this.deps.logger.log(`dropped ${dropped} byte(s) of input — busy`);
      }
      return forward;
    }

    // RAW SUBMIT (Ctrl+Enter): submit the current input untranslated. The
    // chord arrives as a CSI sequence, not a bare CR, so findBareCR below
    // would see "no submit" and forward the raw escape to claude (which
    // ignores it). Catch it HERE and turn it into a real submit that skips
    // the translate path — the Korean already in the editor goes as-is.
    if (isRawSubmitChord(chunk)) {
      this.deps.logger.log(
        "raw-submit chord (Ctrl+Enter): submitting input untranslated",
      );
      this.deps.pty.write(CR);
      return "";
    }

    const crIdx = findBareCR(chunk, prevEndedWithEsc);
    if (crIdx === -1) return chunk;

    // FAST PATH 1: autocomplete popup open — Enter selects from it, not
    // submit. Don't lock, don't sleep, don't translate.
    if (this.deps.mirror.hasAutocompletePopup()) {
      this.deps.logger.log("fast-path: popup open, passing through CR");
      return chunk;
    }

    // FAST PATH 1b: claude's interactive checklist/form widget is on
    // screen (the one with a `✓ Submit` header bar). Enter navigates
    // inside the widget; our DEL+retype+CR would corrupt it. Skip.
    if (this.deps.mirror.hasSubmitFormWidget()) {
      this.deps.logger.log("fast-path: ✓ Submit form widget visible, passing through CR");
      return chunk;
    }

    // FAST PATH 1c: bash mode. When the input box's first char is `!`,
    // Claude Code enters bash mode and swaps the `❯` marker for a magenta
    // `!`. A `!` first-char ALWAYS means bash — a normal prompt can never
    // begin with `!` — so this is an unambiguous, safe pass-through signal.
    // We check the SCREEN here (not extracted text) because in bash-mode
    // rendering the active row no longer matches PROMPT_LINE, so
    // extractInputBox() would fall back to a stale `❯ <korean>` scrollback
    // row and wrongly trigger translation. Must run BEFORE FAST PATH 2.
    if (this.deps.mirror.hasBashPrompt()) {
      this.deps.logger.log("fast-path: bash mode (! prompt), passing through CR");
      return chunk;
    }

    // FAST PATH 2: no Korean in current input. Covers plan-mode confirm
    // menus, slash-command navigation, empty Enter, English-only prompts.
    // The mirror is already accurate for normal keystrokes (only Tab
    // expansion needs the render-delay sleep) — so we can decide right
    // now without waiting. If null, the prompt area is showing a non-input
    // UI (confirm menu, etc), which also doesn't need translation.
    //
    // The `isBashPrefix` check is a belt-and-suspenders guard for a
    // rendering where the `❯` marker is RETAINED and `!` is typed text
    // (`❯ !git pull`): there hasBashPrompt() is false, but the extracted
    // text begins with `!`, which still unambiguously means bash mode.
    const preInput = this.deps.mirror.extractInputBox();
    if (!preInput || isBashPrefix(preInput) || !needsTranslation(preInput)) {
      this.deps.logger.log(
        `fast-path: no Korean / bash-prefix (input=${JSON.stringify(preInput?.slice(0, 60) ?? null)})`,
      );
      return chunk;
    }

    // FAST PATH 2b: prompt content is a numbered selection menu item
    // (e.g. tool-permission confirmation "❯ 1. Yes", plan-mode "❯ 1. ..."),
    // not a real user input. Our PROMPT_LINE regex matches the `❯`
    // selection cursor, so extractInputBox over-collects the menu options
    // and any Korean task list below — which trips needsTranslation. The
    // menu widget ignores DEL/paste anyway, so the CR alone is what
    // selects. Skip translation, pass through.
    if (isSelectionMenuPrompt(preInput)) {
      this.deps.logger.log("fast-path: numbered selection menu, passing through CR");
      return chunk;
    }

    // FAST PATH 3: input contains a claude-editor attachment marker
    // ([Image #N], [Pasted text #N]). These are NOT plain text — they
    // reference an attached object in claude's editor. Our clear-and-retype
    // would DEL through the marker, destroying the underlying attachment
    // (image bytes / pasted text store), and our retyped "[Image #1]"
    // would be inert text. Safer: skip translation, submit original.
    // Claude is multilingual; the Korean prompt with the real attachment
    // still works.
    if (hasAttachmentMarker(preInput)) {
      this.deps.logger.log("fast-path: attachment marker present, skipping translation");
      return chunk;
    }

    // FAST PATH 4: prompt is rendered inside a box border (│ ❯ ...) —
    // this is a modal dialog (plan-mode "tell claude what to do
    // differently", certain settings inputs). Modal editors don't
    // reliably honor our DEL+paste+CR retype sequence; we've seen the
    // dialog's own question text get swept into the submitted reply.
    // Skip intercept and let claude handle the Korean directly.
    if (this.deps.mirror.isPromptBoxed()) {
      this.deps.logger.log(
        "fast-path: boxed prompt (modal dialog), skipping translation",
      );
      return chunk;
    }

    // Slow path: Korean detected → pay 80ms render wait + translate.
    // Claim the lock synchronously before any await — closes the race
    // window so concurrent CRs from double-Enter get dropped.
    this.busy = true;
    this.cancelCtrl = new AbortController();
    // Single-line input → horizontal cursor keys can't cross a line
    // boundary, so they may stay live during the translation wait.
    this.busyCursorKeysSafe = !preInput.includes("\n");
    try {
      const before = chunk.slice(0, crIdx);
      const after = chunk.slice(crIdx + 1);

      if (before.length > 0) this.deps.pty.write(before);

      // Wait for claude's TUI to render the latest keystrokes (Tab expansion).
      await sleep(RENDER_DELAY_MS);

      const handled = await this.tryIntercept();

      if (!handled) {
        this.deps.pty.write(CR);
      }

      // Drop everything that came after the CR in this same chunk — same
      // race protection as the busy-branch above.
      if (after.length > 0) return this.dropAll(after, "tail of submit chunk");
      return "";
    } finally {
      this.busy = false;
      this.cancelCtrl = null;
      this.busyCursorKeysSafe = false;
    }
  }

  private dropAll(chunk: string, reason: string): string {
    if (chunk.length > 0) {
      this.deps.logger.log(`dropped ${chunk.length} byte(s) of input — ${reason}`);
    }
    return "";
  }

  private async tryIntercept(): Promise<boolean> {
    const hasPopup = this.deps.mirror.hasAutocompletePopup();
    const input = this.deps.mirror.extractInputBox();

    if (DUMP_EVERY_ENTER) {
      this.deps.logger.log(
        `popup=${hasPopup} extract=${JSON.stringify(input)}\nscreen:\n` +
          this.deps.mirror.dumpScreen(),
      );
    }

    if (hasPopup) {
      this.deps.logger.log("skip: autocomplete popup open");
      return false;
    }

    this.deps.logger.log("extracted input:", input);
    if (!input) {
      if (this.deps.logger.enabled && !DUMP_EVERY_ENTER) {
        this.deps.logger.log(`screen dump:\n${this.deps.mirror.dumpScreen()}`);
      }
      return false;
    }
    if (!needsTranslation(input)) {
      this.deps.logger.log("skip: no CJK");
      return false;
    }

    // Grab Claude's recent output as a terminology hint BEFORE we mutate
    // the input box (indicator/clear). Skipped on the first translated
    // prompt (no prior Claude turn), when disabled via env, and when the
    // input has too little Korean to anchor the translation (context would
    // otherwise hijack a small model — see contextHintEligible).
    // maxChars rides the same KLAUDE_CONTEXT_CHARS knob as the translator's
    // own clipping (contextSection) — previously the mirror capped at a
    // hardcoded 1200, silently defeating env values above that.
    const context =
      CONTEXT_DISABLED || this.translatedCount === 0 || !contextHintEligible(input)
        ? undefined
        : (this.deps.mirror.recentContext(undefined, MAX_CONTEXT_CHARS) ?? undefined);
    this.translatedCount++;

    // Show a "translating" indicator in the input box so the user gets
    // immediate visual feedback. The slow part is the translation call
    // itself (Ollama gemma3:4b ~1-4s); without this the user just sees
    // their input frozen with no response, easy to mistake for a hang.
    const indicator = " 🔄 번역중... (esc 취소)";
    this.deps.pty.write(CTRL_E);
    await sleep(5);
    this.deps.pty.write(BPASTE_START + indicator + BPASTE_END);
    await sleep(10);

    let indicatorShown = true;
    const removeIndicator = () => {
      if (!indicatorShown) return;
      indicatorShown = false;
      this.deps.pty.write(CTRL_E);
      // Delete EXACTLY the indicator — no safety margin. The user's original
      // Korean sits to the left of the indicator and must survive untouched
      // so we can submit it (the error fallback path). An over-delete here
      // eats the last syllable(s) of the real input — observed as "마지막
      // 음절이 짤린다" whenever translation failed (e.g. Ollama daemon down).
      clearInput(this.deps.pty, indicator, 0);
    };

    try {
      const translated = await translatePrompt(
        input,
        this.deps.translator,
        this.deps.sourceLang,
        (missing) => {
          this.deps.logger.log("repaired missing placeholders:", missing);
        },
        (stage, reason) => {
          this.deps.logger.log(
            stage === "first"
              ? `translation failed (${reason}) — retrying with stricter directive`
              : `translation failed AGAIN (${reason}) after retry — submitting original input (Claude is multilingual)`,
          );
        },
        context,
        this.cancelCtrl?.signal,
      );

      // ESC landed in the last moments while the translation was resolving —
      // honor the cancel: keep the original input, don't clear, don't submit.
      if (this.cancelCtrl?.signal.aborted) {
        this.deps.logger.log("translation cancelled (ESC) — keeping original input");
        removeIndicator();
        return true;
      }
      if (context) this.deps.logger.log("context hint chars:", String(context.length));
      this.deps.logger.log("translated:", translated);

      // Wipe the indicator and the original Korean in one shot.
      this.deps.pty.write(CTRL_E);
      await sleep(5);
      clearInput(this.deps.pty, input + indicator);
      indicatorShown = false;
      await sleep(30);

      // Insert translated text via BRACKETED PASTE so claude's editor
      // treats it as a paste rather than per-key input. Prevents `@`/`/`
      // from triggering autocomplete popups during retype.
      const sanitized = sanitizeForRetype(translated);
      this.deps.pty.write(BPASTE_START + sanitized + BPASTE_END);
      await sleep(20);
      this.deps.pty.write(CR);
      return true;
    } catch (err) {
      removeIndicator();
      await sleep(20);
      // User cancelled with ESC: keep the original Korean in the editor
      // (indicator was appended, not replacing) and do NOT submit — the
      // user can edit it or press Enter again. Note: an Ollama TIMEOUT
      // abort throws the same AbortError but does not abort cancelCtrl,
      // so it correctly falls through to the submit-original path below.
      if (this.cancelCtrl?.signal.aborted) {
        this.deps.logger.log("translation cancelled (ESC) — keeping original input");
        return true;
      }
      this.deps.logger.log("translation FAILED, submitting original:", String(err));
      // Original Korean is still in the editor. Just submit it.
      this.deps.pty.write(CR);
      return true;
    }
  }
}

/**
 * Find a CR that signals "submit" — bare \r not preceded by ESC.
 * Returns -1 if no submit CR is in the chunk.
 *
 * `prevChunkEndedWithEsc` covers the cross-chunk split: on slow links
 * (SSH, high-latency terminals) a Shift+Enter's two bytes can arrive as
 * separate stdin chunks — ESC at the tail of one, CR at the head of the
 * next. Without the flag the CR looks bare and would wrongly trigger a
 * translate+submit mid-compose.
 */
export function findBareCR(chunk: string, prevChunkEndedWithEsc = false): number {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== CR) continue;
    if (i > 0 && chunk[i - 1] === ESC) continue; // Shift+Enter (ESC+CR)
    if (i === 0 && prevChunkEndedWithEsc) continue; // split Shift+Enter
    return i;
  }
  return -1;
}

/**
 * Send enough DEL keystrokes to clear the input box. Assumes cursor is at
 * the end of input (caller should send Ctrl+E first).
 *
 * Multi-line inputs: each '\n' is one position in the editor's buffer,
 * so DEL × total-char-count handles it. Array.from() counts code points
 * correctly (Korean chars are still 1 each).
 */
function clearInput(
  pty: PtyHandle,
  input: string,
  margin: number = DEL_SAFETY_MARGIN,
): void {
  const chars = Array.from(input);
  pty.write(DEL.repeat(chars.length + margin));
}

/**
 * Strip control chars from translator output before retyping. Newlines
 * are preserved. Anything else in the \x00–\x1f range is removed so a
 * misbehaving translator can't inject ESC sequences into claude's PTY.
 */
/**
 * Detect a Claude Code confirmation menu — tool-permission dialogs and
 * plan-mode prompts always start the first option with literal "1. Yes"
 * ("1. Yes" / "1. Yes, and don't ask again..." / "1. Yes, and auto-accept..."
 * across the menu types we've seen). Our PROMPT_LINE regex matches the
 * `❯` selection cursor as if it were a user input prompt, which then
 * over-extracts the menu.
 *
 * Why not match any `^\d+\.\s`: users frequently write numbered prompts
 * ("1. 이거 봐줘 / 2. 저거 봐줘") and a loose match would skip translation
 * on legitimate input. The literal "1. Yes" anchor avoids that.
 *
 * Claude Code's TUI is English-only as of writing (no locale flag), so
 * "Yes" is stable. If localization ever lands this will need updating.
 */
export function isSelectionMenuPrompt(text: string): boolean {
  return /^\s*1\.\s+Yes\b/.test(text);
}

/**
 * Detect claude-editor attachment markers in the input box. These are
 * placeholders for objects (images, large pasted text blocks) that claude
 * is tracking out-of-band — the displayed `[...]` token is just a
 * reference, and deleting it removes the underlying attachment.
 *
 * Matches: `[Image #1]`, `[Pasted text #2 +12 lines]`, etc.
 * Case-insensitive against future TUI tweaks.
 */
export function hasAttachmentMarker(text: string): boolean {
  return /\[(?:Image|Pasted)\b[^\]]*\]/i.test(text);
}

/**
 * Does the extracted input box content start with `!`? In Claude Code a `!`
 * first char ALWAYS means bash mode — a normal prompt can never begin with
 * `!` — so this is an exact, safe pass-through signal. Note: no space is
 * required after `!` because in the marker-retained rendering the typed
 * text is `!git pull` (no space).
 */
export function isBashPrefix(text: string): boolean {
  return text.startsWith("!");
}

/**
 * Does this keyboard chunk carry the Ctrl+Enter "raw submit" chord? When it
 * does, klaude submits the current input untranslated (the original Korean
 * reaches Claude verbatim) instead of running the translate path. See
 * RAW_SUBMIT_CHORD for the accepted CSI encodings.
 */
export function isRawSubmitChord(chunk: string): boolean {
  return RAW_SUBMIT_CHORD.test(chunk);
}

/**
 * Is this keyboard chunk an ESC key press (translation-cancel signal)?
 *
 * Three encodings, depending on the keyboard mode claude has switched the
 * terminal into (same reason RAW_SUBMIT_CHORD accepts two):
 *   - legacy:         a standalone \x1b byte
 *   - Kitty keyboard protocol (disambiguate flag): ESC [ 27 u, some
 *     terminals with the modifier field → ESC [ 27 ; 1 u  (modifier 1 =
 *     none). Under this mode a bare \x1b is NEVER sent for the ESC key —
 *     observed live as 5-byte "dropped … busy" chunks while a user mashed
 *     ESC against a slow translation, with the cancel not firing.
 *
 * Multi-byte chunks that merely START with \x1b are other escape SEQUENCES
 * (arrow keys `\x1b[A`, Shift+Enter `\x1b\r`, kitty Ctrl+Enter
 * `\x1b[13;5u`, ...) — not a cancel — so the match is exact, and only
 * modifier-less ESC (`;1`) qualifies. One asymmetry: a bare \x1b must be
 * ALONE in its chunk (\x1b\x1b could be Alt+ESC or a sequence fragment),
 * but kitty ESC encodings are unambiguous, so a chunk of several — mashed
 * ESC presses coalesced into one stdin read — still cancels.
 */
const ESC_CANCEL_RE = /^\x1b$|^(?:\x1b\[27(?:;1)?u)+$/;

export function isEscCancel(chunk: string): boolean {
  return ESC_CANCEL_RE.test(chunk);
}

/**
 * Split a while-busy keyboard chunk into bytes safe to forward and bytes to
 * drop. Safe = sequences that never mutate the editor buffer: mouse events
 * (wheel scroll, click, drag — SGR and X10 encodings), focus in/out, and —
 * only when `allowCursorKeys` — horizontal cursor keys (Left/Right/Home/
 * End). Everything else (printable chars, CR, Up/Down, unrecognized escape
 * sequences) is dropped, preserving the clear-and-retype guarantees.
 *
 * A safe sequence split across two stdin chunks won't match and gets
 * dropped — no worse than the drop-everything behavior this replaces.
 */
export function filterBusyPassthrough(
  chunk: string,
  allowCursorKeys: boolean,
): { forward: string; dropped: number } {
  let forward = "";
  let dropped = 0;
  for (let i = 0; i < chunk.length; ) {
    const rest = chunk.slice(i);
    let match = SGR_MOUSE_RE.exec(rest)?.[0] ?? FOCUS_RE.exec(rest)?.[0] ?? null;
    if (!match && rest.startsWith(X10_MOUSE_PREFIX) && rest.length >= X10_MOUSE_LEN) {
      match = rest.slice(0, X10_MOUSE_LEN);
    }
    if (!match && allowCursorKeys) {
      match = CURSOR_KEY_RE.exec(rest)?.[0] ?? null;
    }
    if (match) {
      forward += match;
      i += match.length;
    } else {
      dropped++;
      i++;
    }
  }
  return { forward, dropped };
}

export function sanitizeForRetype(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[\x00-\x09\x0b-\x1f]/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
