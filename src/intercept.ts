import type { Logger } from "./log.js";
import type { PtyHandle } from "./pty.js";
import type { ScreenMirror } from "./mirror.js";
import type { Translator } from "./translate.js";
import { translatePrompt } from "./translate.js";
import { needsTranslation } from "./tokenize.js";

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
 * When KLAUDE_DUMP_POPUP=1 is set, dump screen + heuristic results on EVERY
 * Enter attempt (not just failures). Used to diagnose the autocomplete
 * popup detector by comparing dumps with popup open vs closed.
 */
const DUMP_EVERY_ENTER = process.env.KLAUDE_DUMP_POPUP === "1";

/**
 * How long to wait after the user presses Enter before reading the screen
 * mirror. Needed so claude's TUI finishes rendering the latest keystroke
 * (especially Tab-expansion of @mentions). Override via env var if the
 * default feels slow on a fast local machine.
 */
const RENDER_DELAY_MS = Number(process.env.KLAUDE_RENDER_DELAY) || 80;

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

export class Interceptor {
  private deps: InterceptDeps;
  private busy = false;

  constructor(deps: InterceptDeps) {
    this.deps = deps;
  }

  /**
   * Process a chunk of bytes from the user's keyboard. Returns the chunk
   * to forward to claude (may be empty if we're intercepting).
   *
   * Concurrency model:
   *   - this.busy is claimed SYNCHRONOUSLY when a CR is detected, before
   *     any await. Subsequent handleKeyInput invocations that see busy=true
   *     drop EVERYTHING (CRs and printable keys alike).
   *   - Why drop printable keys too: during translation (~1–4s) the input
   *     box is being manipulated (indicator shown, then cleared+rewritten).
   *     If the user types extra chars in that window, claude renders them
   *     into the editor and our DEL × measured-old-length wipe won't catch
   *     them — the residue prepends to our translated retype.
   *   - Trade-off: brief keystroke loss while translating. The on-screen
   *     "🔄 번역중..." indicator signals to stop typing.
   */
  async handleKeyInput(chunk: string): Promise<string> {
    if (this.busy) return this.dropAll(chunk, "busy");

    const crIdx = findBareCR(chunk);
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

    // FAST PATH 2: no Korean in current input. Covers plan-mode confirm
    // menus, slash-command navigation, empty Enter, English-only prompts.
    // The mirror is already accurate for normal keystrokes (only Tab
    // expansion needs the render-delay sleep) — so we can decide right
    // now without waiting. If null, the prompt area is showing a non-input
    // UI (confirm menu, etc), which also doesn't need translation.
    const preInput = this.deps.mirror.extractInputBox();
    if (!preInput || !needsTranslation(preInput)) {
      this.deps.logger.log(
        `fast-path: no Korean (input=${JSON.stringify(preInput?.slice(0, 60) ?? null)})`,
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
      this.deps.logger.log("fast-path: boxed prompt (modal dialog), skipping translation");
      return chunk;
    }

    // Slow path: Korean detected → pay 80ms render wait + translate.
    // Claim the lock synchronously before any await — closes the race
    // window so concurrent CRs from double-Enter get dropped.
    this.busy = true;
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
        this.deps.logger.log("screen dump:\n" + this.deps.mirror.dumpScreen());
      }
      return false;
    }
    if (!needsTranslation(input)) {
      this.deps.logger.log("skip: no CJK");
      return false;
    }

    // Show a "translating" indicator in the input box so the user gets
    // immediate visual feedback. The slow part is the translation call
    // itself (Ollama gemma3:4b ~1-4s); without this the user just sees
    // their input frozen with no response, easy to mistake for a hang.
    const indicator = " 🔄 번역중...";
    this.deps.pty.write(CTRL_E);
    await sleep(5);
    this.deps.pty.write(BPASTE_START + indicator + BPASTE_END);
    await sleep(10);

    let indicatorShown = true;
    const removeIndicator = () => {
      if (!indicatorShown) return;
      indicatorShown = false;
      this.deps.pty.write(CTRL_E);
      clearInput(this.deps.pty, indicator);
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
      );
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
      this.deps.logger.log("translation FAILED, submitting original:", String(err));
      removeIndicator();
      await sleep(20);
      // Original Korean is still in the editor (indicator was appended,
      // not replacing). Just submit it.
      this.deps.pty.write(CR);
      return true;
    }
  }
}

/**
 * Find a CR that signals "submit" — bare \r not preceded by ESC.
 * Returns -1 if no submit CR is in the chunk.
 */
function findBareCR(chunk: string): number {
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== CR) continue;
    if (i > 0 && chunk[i - 1] === ESC) continue; // Shift+Enter (ESC+CR)
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
function clearInput(pty: PtyHandle, input: string): void {
  const chars = Array.from(input);
  pty.write(DEL.repeat(chars.length + DEL_SAFETY_MARGIN));
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
function isSelectionMenuPrompt(text: string): boolean {
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
function hasAttachmentMarker(text: string): boolean {
  return /\[(?:Image|Pasted)\b[^\]]*\]/i.test(text);
}

function sanitizeForRetype(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\x00-\x09\x0b-\x1f]/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
