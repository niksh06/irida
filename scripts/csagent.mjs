#!/usr/bin/env node
/**
 * Deprecated `csagent` bin — kept as a transitional alias for `irida`.
 * Delegates to scripts/irida.mjs (which runs/rebuilds dist/cli.js).
 */
process.stderr.write("csagent: deprecated command name — use `irida` (this alias will be removed in a later release)\n");
await import("./irida.mjs");
