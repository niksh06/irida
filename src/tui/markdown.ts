/**
 * Minimal, line-oriented markdown → styled segments for the TUI transcript
 * (I-156c). Agents emit markdown; showing it raw ("**bold**", "`code`", "# h")
 * misses UX expectations. This renders the common, low-ambiguity subset into
 * colored/bold Ink spans while keeping a plain-text projection for search/copy
 * and preserving the one-line-per-row scroll model (each MdLine = one row).
 *
 * Scope (deliberately conservative to avoid mangling agent output):
 *  - inline: `**bold**`, `` `code` ``, `_italic_` (underscore only — single `*`
 *    is too ambiguous with bullets/globs/multiplication in agent text)
 *  - block: fenced ``` code (verbatim, no inline parse), `#` headings,
 *    `-`/`*`/`+` and `N.` lists, `>` blockquotes
 * Everything is display-width wrapped; unclosed markup (mid-stream) stays literal.
 */
import stringWidth from "string-width";

export type MdStyle = "bold" | "italic" | "code" | "heading" | "bullet" | "quote" | "codeblock";

export interface MdSegment {
  text: string;
  style?: MdStyle;
}

export interface MdLine {
  segments: MdSegment[];
  /** Plain projection (segment text joined) — used for search/copy/measure. */
  plain: string;
}

/** Split any un-styled segment by a delimiter regex, tagging the capture. */
function applyDelim(segs: MdSegment[], re: RegExp, style: MdStyle): MdSegment[] {
  const out: MdSegment[] = [];
  for (const s of segs) {
    if (s.style) {
      out.push(s);
      continue;
    }
    let last = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(s.text))) {
      if (m.index > last) out.push({ text: s.text.slice(last, m.index) });
      out.push({ text: m[1]!, style });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width loops
    }
    if (last < s.text.length) out.push({ text: s.text.slice(last) });
  }
  return out.filter((x) => x.text.length > 0);
}

/** Inline markup → segments. Code spans win first (no nested formatting). */
export function parseInline(text: string): MdSegment[] {
  let segs: MdSegment[] = [{ text }];
  segs = applyDelim(segs, /`([^`]+)`/g, "code");
  segs = applyDelim(segs, /\*\*([^*]+)\*\*/g, "bold");
  segs = applyDelim(segs, /_([^_\s][^_]*?)_/g, "italic");
  return segs.length ? segs : [{ text }];
}

interface Block {
  segments: MdSegment[];
  /** Spaces prepended to wrapped continuation lines (hanging indent). */
  hang: string;
  /** When set, the whole line is this style and inline parsing is skipped. */
  verbatim?: boolean;
}

function classifyLine(line: string, inFence: boolean): Block {
  if (inFence) {
    return { segments: [{ text: line, style: "codeblock" }], hang: "", verbatim: true };
  }
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) return { segments: [{ text: heading[2]!, style: "heading" }], hang: "", verbatim: true };

  const quote = /^\s*>\s?(.*)$/.exec(line);
  if (quote) {
    return {
      segments: [{ text: "│ ", style: "quote" }, ...parseInline(quote[1]!)],
      hang: "  ",
    };
  }

  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    const indent = bullet[1] ?? "";
    return {
      segments: [{ text: `${indent}• `, style: "bullet" }, ...parseInline(bullet[2]!)],
      hang: `${indent}  `,
    };
  }

  const numbered = /^(\s*)(\d+[.)])\s+(.*)$/.exec(line);
  if (numbered) {
    const indent = numbered[1] ?? "";
    return {
      segments: [{ text: `${indent}${numbered[2]} `, style: "bullet" }, ...parseInline(numbered[3]!)],
      hang: `${indent}   `,
    };
  }

  return { segments: parseInline(line), hang: "" };
}

/** Greedily pack styled segments into display-width-bounded lines. */
function wrapBlock(block: Block, width: number): MdLine[] {
  const max = Math.max(16, width - 8);
  const lines: MdLine[] = [];
  let cur: MdSegment[] = [];
  let curW = 0;
  let started = false;

  const push = () => {
    const plain = cur.map((s) => s.text).join("").replace(/\s+$/, "");
    // Re-trim the trailing segment to match the plain projection.
    lines.push({ segments: trimTrailing(cur), plain });
    cur = [];
    curW = 0;
  };
  const hang = () => {
    if (block.hang) {
      cur.push({ text: block.hang });
      curW += stringWidth(block.hang);
    }
  };

  // Verbatim (code block line / heading): keep as-is, hard-wrap by cells.
  if (block.verbatim) {
    const seg = block.segments[0]!;
    const style = seg.style;
    let line = "";
    let w = 0;
    for (const ch of seg.text) {
      const cw = stringWidth(ch);
      if (w + cw > max && w > 0) {
        lines.push({ segments: [{ text: line, style }], plain: line });
        line = "";
        w = 0;
      }
      line += ch;
      w += cw;
    }
    lines.push({ segments: [{ text: line, style }], plain: line });
    return lines;
  }

  for (const seg of block.segments) {
    // Tokenize preserving whitespace so wrapping stays natural.
    for (const tok of seg.text.match(/\s+|\S+/g) ?? []) {
      const isSpace = /^\s+$/.test(tok);
      const tw = stringWidth(tok);
      if (isSpace && curW === 0) continue; // drop leading space on a fresh line
      if (curW + tw <= max) {
        cur.push({ text: tok, style: seg.style });
        curW += tw;
        started = true;
        continue;
      }
      if (isSpace) {
        push();
        hang();
        continue;
      }
      if (curW > 0 && tw <= max) {
        push();
        hang();
        cur.push({ text: tok, style: seg.style });
        curW += tw;
        continue;
      }
      // Hard-split an over-long token, carrying its style.
      for (const ch of tok) {
        const cw = stringWidth(ch);
        if (curW + cw > max && curW > 0) {
          push();
          hang();
        }
        cur.push({ text: ch, style: seg.style });
        curW += cw;
      }
      started = true;
    }
  }
  if (cur.length || !started) push();
  return lines;
}

function trimTrailing(segs: MdSegment[]): MdSegment[] {
  const out = segs.map((s) => ({ ...s }));
  for (let i = out.length - 1; i >= 0; i--) {
    out[i]!.text = out[i]!.text.replace(/\s+$/, "");
    if (out[i]!.text.length === 0) out.pop();
    else break;
  }
  return out.length ? out : [{ text: "" }];
}

/** Full render: markdown body → styled, width-wrapped lines (one row each). */
export function renderMarkdown(text: string, width: number): MdLine[] {
  if (!text) return [{ segments: [{ text: "" }], plain: "" }];
  const out: MdLine[] = [];
  let inFence = false;
  for (const raw of text.split("\n")) {
    if (/^\s*```/.test(raw)) {
      // Fence marker line itself renders as a dim rule, and toggles the state.
      inFence = !inFence;
      out.push({ segments: [{ text: raw.trim(), style: "codeblock" }], plain: raw.trim() });
      continue;
    }
    if (raw === "") {
      out.push({ segments: [{ text: "" }], plain: "" });
      continue;
    }
    out.push(...wrapBlock(classifyLine(raw, inFence), width));
  }
  return out.length ? out : [{ segments: [{ text: "" }], plain: "" }];
}
