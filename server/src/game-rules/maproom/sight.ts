/**
 * The Map Room 2 fog of war sight rule (issue #329), shared by the server and
 * the web client.
 *
 * A cell is visible to a player when either holds:
 *
 * 1. It sits inside one of their sight circles (their own flingers', or an
 *    ally's under the same alliance-union rule) — the same hex-ring reach the
 *    attack range rule measures with (`range.ts`), Declare War's bonus
 *    already folded into each circle's `reach` by the caller.
 * 2. It is named once in `revealed`: the player's own bases (visible however
 *    short their flingers' reach) and the bases of anyone who has ever
 *    attacked them, each a single lit cell regardless of range
 *    (`docs/design/fog-of-war.md` §3).
 *
 * Built on the shared range rule, so sight can never disagree with what a
 * flinger can actually hit. Kept as one source here and one byte-for-byte
 * copy at `server/src/game-rules/maproom/` by
 * `web/tools/sync-combat-rules.mjs`, the same way the range rule is shared.
 *
 * Pure: no imports besides `range.ts`, no clock, nothing from either tree.
 */

import { type RangeCell, inReach } from "./range.js";

/**
 * One sight circle: a flinger's own cell and its final reach (Declare War's
 * +2 already added by the caller when it applies). A reach of 0 gives the
 * circle no cells at all, not even its own (`inReach`); seeing the flinging
 * cell itself, when nothing else reaches it, comes from `revealed` instead.
 */
export interface SightSource extends RangeCell {
  reach: number;
}

/** A single cell visible regardless of range: an own base, or an attacker's. */
export type RevealedCell = RangeCell;

const sameCell = (a: RangeCell, b: RangeCell): boolean => a.x === b.x && a.y === b.y;

/**
 * Whether `cell` is visible under the sight rule.
 *
 * @param cell - The cell being tested.
 * @param sources - Every sight circle the rule allows (own and, for an ally
 *   union, every member's), Declare War already folded in.
 * @param revealed - Every cell visible on its own: the player's own bases and
 *   the bases of anyone who has ever attacked them.
 * @returns True when `cell` is visible.
 */
export const isVisible = (
  cell: RangeCell,
  sources: readonly SightSource[],
  revealed: readonly RevealedCell[],
): boolean =>
  revealed.some((r) => sameCell(r, cell)) ||
  sources.some((source) => inReach(source, cell, source.reach));
