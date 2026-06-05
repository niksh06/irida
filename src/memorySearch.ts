/**
 * Query helpers for memory note full-text search (SQLite FTS5 + Postgres tsvector).
 */

/** Sanitize user query for SQLite FTS5 MATCH (prefix terms with AND). */
export function sqliteFtsMatchQuery(query: string): string {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9_@-]/gi, ""))
    .filter((t) => t.length >= 2);
  if (terms.length === 0) return "";
  return terms.map((t) => `"${t}"*`).join(" AND ");
}

/** Postgres plainto_tsquery input — trim only; driver handles escaping. */
export function postgresFtsQuery(query: string): string {
  return query.trim();
}
