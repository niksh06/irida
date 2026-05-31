# Issue 039 — Unified memory root (dev ↔ gateway parity)

**Type:** AFK  
**Status:** Open  
**Priority:** P1  
**Depends on:** Phase 2 MCP (`csagent-memory`)  
**Ops checklist:** [MEMORY-DEV-ALIGNMENT.md](../MEMORY-DEV-ALIGNMENT.md)

## Problem

Telegram gateway and local dev see **different memory notes** when `CSAGENT_HOME`, PG, and repo `.agent/` diverge. MCP reads DB; `@memory:` reads files only.

## Goal

One resolved memory root when `CSAGENT_HOME` is set.

## Proposed design

- `resolveMemoryRoot()` for all read/write paths
- `@memory:` dual-read: DB then mirror file
- Doctor warnings for silo drift

## Acceptance criteria

- [ ] MCP, CLI, `@memory:` same body when env aligned
- [ ] Doctor warns on repo vs canonical drift
- [ ] Tests

## Related

- Incident: Telegram `tparser-workflow` vs dev `pilot-2026-06-01` (2026-06-01)
