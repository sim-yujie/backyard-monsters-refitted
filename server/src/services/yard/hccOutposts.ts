import type { JsonObject } from "../../types/JsonObject.js";
import { HCC_MAX_LEVEL, hccLevel, numberOf, type HatcherySave } from "./hatchery.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * The main yard's level 3 HCC's yard list (beta 9, `POST
 * /bm/yard/hatchery/outposts`): each of the player's outposts, whether it has
 * an HCC of its own (only those are run from home, owner 21 Nov) and how many
 * monsters its queue and its hatcheries hold, as the outpost was last saved
 * (its catch-up runs when it is opened).
 */

/** One outpost on the list. */
export interface HccOutpost {
  baseid: string;
  /** Its HCC's level, 0 without a finished one. */
  hcc: number;
  /** Monsters waiting in its HCC's queue plus those in its hatcheries, as last saved. */
  queued: number;
}

/** `report` of `POST /bm/yard/hatchery/outposts`. */
export interface HccOutpostsReport {
  yards: HccOutpost[];
}

/** Monsters a `monsters` blob holds in queues and hatcheries. */
const queuedIn = (monsters: JsonObject | null | undefined): number => {
  const stacks = (raw: unknown): number =>
    Array.isArray(raw) ? raw.reduce((sum: number, stack) => sum + (Array.isArray(stack) ? Math.max(0, numberOf(stack[1])) : 0), 0) : 0;
  let total = stacks(monsters?.hcc);
  const h: unknown[] = Array.isArray(monsters?.h) ? monsters.h : [];
  for (const entry of h) {
    if (!Array.isArray(entry)) continue;
    if (typeof entry[0] === "string" && entry[0] !== "") total += 1;
    total += stacks(entry[2]);
  }
  return Math.floor(total);
};

/**
 * The list, in the main yard's `outposts` order. `409 hccLevel` unless the
 * main yard's HCC is at level 3.
 */
export const planHccOutposts = (
  main: HatcherySave & { outposts?: [number, number, string][] | null },
  rows: readonly (HatcherySave & { baseid?: string | number | bigint })[]
): HccOutpostsReport => {
  const have = hccLevel(main);
  if (have < HCC_MAX_LEVEL) {
    throw yardRefusedErr(
      "hccLevel",
      "Upgrade your Hatchery Control Centre to level 3 to run your outposts from home.",
      { need: HCC_MAX_LEVEL, have }
    );
  }
  const byId = new Map(rows.map((row) => [String(row.baseid), row]));
  const yards: HccOutpost[] = [];
  for (const [, , id] of main.outposts ?? []) {
    const row = byId.get(String(id));
    if (!row) continue;
    yards.push({ baseid: String(id), hcc: hccLevel(row), queued: queuedIn(row.monsters) });
  }
  return { yards };
};
