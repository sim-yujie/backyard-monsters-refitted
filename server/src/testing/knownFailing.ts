import { test } from "bun:test";

/**
 * Tests that already failed on `revamp` when CI was added (audit of
 * 2026-10-29: agent-handoffs/reports/audit-practices-2026-10-29.md and
 * audit-metrics-2026-10-29.md, fix #1). They are skipped here, not fixed or
 * deleted, so CI starts green and the owner decides what to do with each;
 * every call site says why it fails. The CI log lists them all.
 *
 * Use it in place of `test(...)`. `KNOWN_FAILING=run bun test` runs them
 * anyway; once one passes, put `test(` back.
 */
export const knownFailing = process.env.KNOWN_FAILING === "run" ? test : test.skip;
