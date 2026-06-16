/**
 * Split mined cursor-ide markdown for map-phase distill (I-65b).
 * Budget ~120k chars per chunk — leaves headroom in ~200k context windows.
 */
export const DEFAULT_DISTILL_CHUNK_CHARS = 120_000;

export interface TranscriptChunk {
  index: number;
  total: number;
  text: string;
}

/** Split body on ## User / ## Assistant section boundaries. */
export function splitTranscriptForDistill(
  body: string,
  maxChars: number = DEFAULT_DISTILL_CHUNK_CHARS
): TranscriptChunk[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  if (Buffer.byteLength(trimmed, "utf8") <= maxChars) {
    return [{ index: 0, total: 1, text: trimmed }];
  }

  const sections = splitIntoSections(trimmed);
  if (!sections.length) {
    return chunkByBytes(trimmed, maxChars);
  }

  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const candidate = current ? `${current}\n\n${section}` : section;
    if (Buffer.byteLength(candidate, "utf8") <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (Buffer.byteLength(section, "utf8") <= maxChars) {
      current = section;
      continue;
    }
    for (const part of chunkByBytes(section, maxChars)) {
      chunks.push(part.text);
    }
    current = "";
  }
  if (current) chunks.push(current);

  const total = chunks.length;
  return chunks.map((text, index) => ({ index, total, text }));
}

function splitIntoSections(body: string): string[] {
  const lines = body.split("\n");
  const sections: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (!buf.length) return;
    sections.push(buf.join("\n").trimEnd());
    buf = [];
  };

  for (const line of lines) {
    if (/^## (User|Assistant)\s*$/.test(line)) {
      flush();
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();
  return sections.filter(Boolean);
}

function chunkByBytes(text: string, maxChars: number): TranscriptChunk[] {
  const out: TranscriptChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + maxChars * 0.5) end = nl;
    }
    const slice = text.slice(start, end).trim();
    if (slice) out.push({ index: out.length, total: 0, text: slice });
    start = end;
  }
  const total = out.length;
  return out.map((c, i) => ({ ...c, index: i, total }));
}
