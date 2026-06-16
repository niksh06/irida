/** Reject CLI/MCP flags accidentally stored as fact fields (I-69). */
export class MemoryFactValidationError extends Error {
  readonly code = "MEMORY_FACT_VALIDATION";

  constructor(message: string) {
    super(message);
    this.name = "MemoryFactValidationError";
  }
}

const MALFORMED_FIELD_RE = /^--/;

export function isMalformedFactField(value: string): boolean {
  return MALFORMED_FIELD_RE.test(value.trim());
}

export function validateFactTriple(subject: string, predicate: string, object: string): void {
  for (const [label, value] of [
    ["subject", subject],
    ["predicate", predicate],
    ["object", object],
  ] as const) {
    if (isMalformedFactField(value)) {
      throw new MemoryFactValidationError(
        `${label} must not start with "--" (got ${JSON.stringify(value.trim())})`
      );
    }
  }
}

/** SQL fragment for current rows with flag-like subject or predicate. */
export const MALFORMED_FACT_WHERE =
  `(valid_to IS NULL OR valid_to = '') AND (subject LIKE '--%' OR predicate LIKE '--%')`;
