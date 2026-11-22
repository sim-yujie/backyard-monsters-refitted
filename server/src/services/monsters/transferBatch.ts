import type { JsonObject } from "../../types/JsonObject.js";
import {
  housedCounts,
  planMonsterTransfer,
  type TransferRule,
  type TransferYard,
} from "./transferRules.js";

/**
 * Rules for `POST /worldmapv2/transferbatch` (beta 9 #7, the world map's
 * move tray, owner 22 Nov 2026): one move that sends monsters between
 * several pairs of the player's yards at once — the main yard to its five
 * nearest outposts, or every outpost home.
 *
 * Every pair is one {@link planMonsterTransfer} (#27, #196), checked in the
 * order sent against the rosters the pairs before it left: a source cannot
 * send the same monster twice, and an outpost that two pairs fill is measured
 * with both. Nothing the client says about room or what a yard houses is
 * read; the counts it asks for are the only input, and one refused pair
 * refuses the whole move, so nothing is half written.
 *
 * Pure, like `transferRules.ts`: the controller loads, locks and catches up
 * the yards, then writes the rosters this returns.
 */

/** The most pairs one move may carry: every outpost a big empire holds, and then some. */
export const MAX_BATCH_PAIRS = 400;

/** One pair as the client posts it. */
export interface BatchPair {
  readonly from: string;
  readonly to: string;
  readonly moved: unknown;
}

export type BatchRule = TransferRule | "batch";

export type BatchVerdict =
  | {
      ok: true;
      /** Each yard a pair touched, by `baseid`: its `housed` after the whole move. */
      housed: Record<string, Record<string, number>>;
      /** Monsters moved in all. */
      total: number;
    }
  | {
      ok: false;
      rule: BatchRule;
      message: string;
      /** The pair that was refused (0-based), or -1 for the move as a whole. */
      pair: number;
      detail: Record<string, unknown>;
    };

/**
 * Reads the posted `moves` into pairs, or says why it cannot: not a list,
 * empty, too long, or a pair without two yard ids.
 */
export const readBatchPairs = (
  moves: unknown
): { pairs: BatchPair[] } | { refused: string } => {
  if (!Array.isArray(moves)) return { refused: "that move was not a list of pairs." };
  if (moves.length === 0) return { refused: "there are no monsters in that move." };
  if (moves.length > MAX_BATCH_PAIRS)
    return { refused: `one move can send to at most ${MAX_BATCH_PAIRS} yards.` };

  const pairs: BatchPair[] = [];
  for (const raw of moves) {
    const entry = raw as { from?: unknown; to?: unknown; moved?: unknown } | null;
    if (!entry || typeof entry !== "object") return { refused: "a pair in that move is not readable." };
    const from = typeof entry.from === "string" || typeof entry.from === "number" ? String(entry.from) : "";
    const to = typeof entry.to === "string" || typeof entry.to === "number" ? String(entry.to) : "";
    if (!from || !to) return { refused: "a pair in that move does not name both yards." };
    pairs.push({ from, to, moved: entry.moved });
  }
  return { pairs };
};

/**
 * Checks a whole move and works out every roster it leaves.
 *
 * @param yards - Every yard the pairs name, caught up to now, by `baseid`.
 *   A pair naming a yard not in here is refused (the controller only puts the
 *   caller's own yards in).
 * @param pairs - The pairs, in the order the client sent them.
 * @param monsterLevels - The player's Monster Academy levels, for housing sizes.
 */
export const planBatchTransfer = ({
  yards,
  pairs,
  monsterLevels,
}: {
  yards: ReadonlyMap<string, TransferYard>;
  pairs: readonly BatchPair[];
  monsterLevels?: Record<string, number>;
}): BatchVerdict => {
  if (pairs.length === 0)
    return { ok: false, rule: "quantities", message: "there are no monsters in that move.", pair: -1, detail: {} };
  if (pairs.length > MAX_BATCH_PAIRS)
    return {
      ok: false,
      rule: "batch",
      message: `one move can send to at most ${MAX_BATCH_PAIRS} yards.`,
      pair: -1,
      detail: { pairs: pairs.length },
    };

  // The rosters as the pairs leave them, starting from the stored ones.
  const now = new Map<string, Record<string, number>>();
  const rosterOf = (yard: TransferYard): Record<string, number> => {
    const known = now.get(yard.baseid);
    if (known) return known;
    const counts = housedCounts(yard.stored);
    now.set(yard.baseid, counts);
    return counts;
  };
  // The same yard pair twice would be one pair split in two; refusing it keeps a
  // move's pairs one per route, which is all the client ever sends.
  const seen = new Set<string>();
  let total = 0;

  for (const [index, pair] of pairs.entries()) {
    const from = yards.get(pair.from);
    const to = yards.get(pair.to);
    if (!from || !to)
      return {
        ok: false,
        rule: "endpoints",
        message: "monsters can only move between your own yards.",
        pair: index,
        detail: { baseid: !from ? pair.from : pair.to },
      };

    const route = `${pair.from}>${pair.to}`;
    if (seen.has(route))
      return {
        ok: false,
        rule: "batch",
        message: "that move names the same two yards twice.",
        pair: index,
        detail: { from: pair.from, to: pair.to },
      };
    seen.add(route);

    const verdict = planMonsterTransfer({
      from: { ...from, stored: { housed: rosterOf(from) } as JsonObject },
      to: { ...to, stored: { housed: rosterOf(to) } as JsonObject },
      moved: pair.moved,
      ...(monsterLevels ? { monsterLevels } : {}),
    });
    if (!verdict.ok)
      return { ok: false, rule: verdict.rule, message: verdict.message, pair: index, detail: verdict.detail };

    total += Object.values(housedCounts({ housed: pair.moved })).reduce((sum, count) => sum + count, 0);
    now.set(from.baseid, verdict.fromHoused);
    now.set(to.baseid, verdict.toHoused);
  }

  return { ok: true, housed: Object.fromEntries(now), total };
};
