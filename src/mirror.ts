import pkg from "@xterm/headless";
const { Terminal } = pkg;
type TerminalInstance = InstanceType<typeof Terminal>;

/**
 * Headless screen mirror. Receives the same byte stream that the user's
 * terminal sees, maintains a virtual screen, and lets us read what
 * Claude Code is currently rendering — including the actual contents
 * of the input box (with Tab-expanded @mentions, etc).
 */
export class ScreenMirror {
  private term: TerminalInstance;
  /**
   * Buffered bytes waiting to be fed to the terminal emulator. We defer
   * emulator parsing to keep it off the hot path between claude → user
   * stdout. The emulator only needs to be current at intercept time
   * (Enter pressed), and reads call `flush()` first.
   */
  private pendingBuf: string = "";
  private flushScheduled: boolean = false;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, allowProposedApi: true });
  }

  resize(cols: number, rows: number): void {
    // Drain anything pending into the old size before resizing so we
    // don't lose buffered state.
    this.flush();
    this.term.resize(cols, rows);
  }

  write(data: string | Uint8Array): void {
    const s = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    this.pendingBuf += s;
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setImmediate(() => this.flush());
    }
  }

  /**
   * Drain any buffered bytes into the terminal emulator immediately.
   * Read methods (extractInputBox, hasAutocompletePopup, snapshotRows,
   * dumpScreen) call this first so they see current state.
   */
  flush(): void {
    this.flushScheduled = false;
    if (this.pendingBuf.length === 0) return;
    const data = this.pendingBuf;
    this.pendingBuf = "";
    this.term.write(data);
  }

  /**
   * Snapshot the entire visible viewport as a string array (one entry per row).
   */
  snapshotRows(): string[] {
    this.flush();
    const buf = this.term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const line = buf.getLine(buf.viewportY + y);
      rows.push(line ? line.translateToString(true) : "");
    }
    return rows;
  }

  /**
   * Find the current input-box content.
   *
   * Claude Code's actual TUI structure (as of v2.1.x):
   *
   *   ──────────────────────────────────────────────
   *   ❯ user input text on first line
   *     continuation on second line (multi-line via Shift+Enter)
   *   ──────────────────────────────────────────────  ← divider below
   *   status hints (? for shortcuts, model, ctx bar)
   *
   * We find the LAST "❯ " row (active prompt), keep its text after the
   * marker, then collect continuation rows BELOW it until we hit a
   * divider / status bar / next prompt / blank row.
   */
  extractInputBox(): string | null {
    const rows = this.snapshotRows();

    let promptIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (PROMPT_LINE.test(rows[i])) {
        promptIdx = i;
        break;
      }
    }
    if (promptIdx === -1) return null;

    const firstLine = stripPromptMarker(rows[promptIdx]).trimEnd();

    // Collect continuation lines that follow the prompt (below it).
    const lines = [firstLine];
    for (let i = promptIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (isDividerLine(row)) break;
      if (PROMPT_LINE.test(row)) break; // another prompt below = done
      if (looksLikeStatusBar(row)) break;
      const stripped = row.replace(/^\s{0,4}/, "");
      if (stripped.trim().length === 0) {
        // Empty row: could be end of input OR an intermediate blank from
        // double Shift+Enter. Peek ahead — if the next non-blank within
        // 2 rows is a divider/status/prompt, the blank is end. Otherwise
        // include it as part of the input.
        if (isInputBoxEnd(rows, i)) break;
        lines.push("");
        continue;
      }
      lines.push(stripped.trimEnd());
    }

    const joined = lines.join("\n").trimEnd();
    return joined.length > 0 ? joined : null;
  }

  /**
   * Detect Claude Code's interactive checklist/form widget. These appear
   * when claude asks the user a structured multi-choice question and
   * render a top header containing a `✓ Submit` button along with
   * checkbox-style options (`[ ]` / `[x]`). The widget is NOT a normal
   * input box — Enter navigates/toggles within it rather than submitting
   * a text line, and our clear+retype+CR sequence would corrupt it.
   *
   * Signal: any visible row contains `✓ Submit` (the literal U+2713 check
   * mark followed by the word Submit). Matches even when the widget is
   * higher up in the viewport — once we see this signature anywhere on
   * screen we treat the whole turn as "owned by the widget".
   */
  hasSubmitFormWidget(): boolean {
    const rows = this.snapshotRows();
    for (const row of rows) {
      if (/✓\s*Submit\b/i.test(row)) return true;
    }
    return false;
  }

  /**
   * Is the active prompt row drawn inside a box border (`│ ❯ ...` rather
   * than bare `❯ ...`)? Claude Code uses boxed prompts for modal dialogs
   * — plan-mode "tell claude what to do differently" feedback, certain
   * settings inputs, etc. Those modal editors don't reliably honor our
   * bracketed-paste clear+retype sequence (DEL boundaries differ, paste
   * markers may not be recognized), causing visible artifacts like
   * Claude's question text getting submitted along with the user reply.
   * Callers should skip intercept and pass the Enter through when this
   * is true.
   */
  isPromptBoxed(): boolean {
    const rows = this.snapshotRows();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (PROMPT_LINE.test(rows[i])) {
        return /^\s*[│|]\s*❯\s/.test(rows[i]);
      }
    }
    return false;
  }

  /**
   * Heuristic: is an autocomplete popup currently visible?
   *
   * Claude Code shows file/command suggestions BELOW the prompt line.
   * When the popup is open, Enter selects from it instead of submitting,
   * so we must NOT intercept those Enters.
   *
   * Detection: scan rows after the prompt, stopping at status bar or
   * another prompt. We skip over dividers and blanks because in some TUI
   * states the popup floats below the input's bottom divider rather than
   * directly under the prompt. Count rows that match POPUP_ITEM_PATTERN
   * — require ≥ 2 to avoid a single stray file name in user continuation
   * text triggering a false positive.
   */
  hasAutocompletePopup(): boolean {
    const rows = this.snapshotRows();
    let promptIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (PROMPT_LINE.test(rows[i])) {
        promptIdx = i;
        break;
      }
    }
    if (promptIdx === -1) return false;

    const SCAN_LIMIT = 12; // popups are short; don't scan whole viewport
    let popupMatches = 0;
    let scanned = 0;
    for (let i = promptIdx + 1; i < rows.length && scanned < SCAN_LIMIT; i++) {
      const row = rows[i];
      const trimmed = row.trim();
      if (trimmed.length === 0) {
        scanned++;
        continue;
      }
      if (isDividerLine(row)) {
        scanned++;
        continue;
      }
      if (looksLikeStatusBar(row)) break;
      if (PROMPT_LINE.test(row)) break;
      scanned++;
      if (POPUP_ITEM_PATTERN.test(trimmed)) {
        popupMatches++;
      }
    }
    return popupMatches >= 2;
  }

  /**
   * Debug helper: return the full mirror viewport as a single string.
   */
  dumpScreen(): string {
    return this.snapshotRows()
      .map((r, i) => `${String(i).padStart(2, " ")}│${r}`)
      .join("\n");
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  dispose(): void {
    this.term.dispose();
  }
}

/**
 * Claude Code prompt marker. The "❯" char (U+276F) followed by a space.
 * Anchored to the start of the row so a `❯ ` the user typed mid-input
 * doesn't get mistaken for a prompt. Tolerates leading whitespace and
 * the optional box-edge `│` that the TUI sometimes draws.
 */
const PROMPT_LINE = /^\s*(?:[│|]\s*)?❯\s/;

/**
 * Strip "❯ " from a prompt row. Uses a single replace with `❯ ` as the
 * literal anchor — avoids a greedy `^.*?❯ ` that could match a `❯` the
 * user typed mid-input (rare but possible).
 */
function stripPromptMarker(row: string): string {
  const idx = row.indexOf("❯ ");
  if (idx === -1) return row;
  return row.slice(idx + 2);
}

function isDividerLine(row: string): boolean {
  const trimmed = row.trim();
  if (trimmed.length < 5) return false;
  // Mostly horizontal dashes, but tolerate box corners (╰─╯ etc) since
  // the welcome banner uses them and other future TUI elements might.
  return /^[─━\-═╰╯╭╮│]+$/.test(trimmed) && /[─━\-═]/.test(trimmed);
}

/**
 * Pattern for a single popup-item row (trimmed). Alternatives:
 *   1. Leading selection marker: ▌ ▶ › ❯ > — Claude Code highlights one item.
 *   2. Slash command: starts with /<word>.
 *   3. Bare filename at row start: README.md, package.json, etc.
 *   4. Path with extension anywhere: src/intercept.ts, dist/foo.js, etc.
 *
 * Branches 3+4 alone are weak signals (a continuation line in user input
 * could contain a filename), so hasAutocompletePopup requires ≥ 2 matching
 * rows before declaring the popup open.
 */
const POPUP_ITEM_PATTERN =
  /^[▌▶›❯>]\s|^\/[\w:\-]+(?:\s|$)|^[\w][\w.\-]*\.[a-zA-Z]{1,6}(?:\s|$)|\/[\w.\-]+\.[a-zA-Z]{1,6}(?:\s|$)/;

/**
 * Claude Code renders a status bar / hint line below the input
 * (e.g. "? for shortcuts", model name, etc).
 */
function looksLikeStatusBar(row: string): boolean {
  return /\? for shortcuts|esc to interrupt|Bypassing Permissions|Esc to cancel|Tab to amend|ctrl\+e to explain/i.test(
    row,
  );
}

/**
 * Given that rows[i] is blank, decide whether this blank marks the end of
 * the input box (true) or is just an intermediate blank line inside a
 * multi-line input (false). We peek at the next non-blank row within a
 * small window — if it's a divider/status/prompt, the blank is end.
 */
function isInputBoxEnd(rows: string[], i: number): boolean {
  const LOOKAHEAD = 2;
  for (let j = i + 1; j <= i + LOOKAHEAD && j < rows.length; j++) {
    const row = rows[j];
    if (row.trim().length === 0) continue;
    if (isDividerLine(row)) return true;
    if (looksLikeStatusBar(row)) return true;
    if (PROMPT_LINE.test(row)) return true;
    // Found real content within the window → blank is intermediate.
    return false;
  }
  // Nothing but blanks ahead within the window → treat as end.
  return true;
}
