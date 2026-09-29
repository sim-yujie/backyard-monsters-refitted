import { BaseMode, type BaseLoadResponse } from "@/api/types";
import type { OffsetCell } from "@/game/HexGrid";
import type { TakeoverKind } from "@/game/maproom/takeover";
import { OUTPOST_CORE_TYPE, type YardKind } from "./buildingCostData";
import type { Yard } from "./yardModel";

/**
 * The player's own yards, and which one the yard screen opens (outposts WP5,
 * issue #146).
 *
 * A player owns a main yard and, on Map Room 2, any number of outposts. The
 * yard screen opens one of them at a time, named by an {@link OwnYardTarget}:
 * the main yard, or an outpost by its `baseid`. The map's "View yard" on an
 * own outpost, the HUD's yard switcher and a takeover all hand the yard screen
 * a target through {@link setOwnYardTarget}; with none, it opens the main yard,
 * as it always has.
 *
 * The list of outposts is the main yard's `outposts`, `[x, y, baseid]` per
 * outpost, which every load of an own yard carries (`mapSaveData.ts`). Flash
 * walked it with one "next" arrow, main, outpost 1, …, main
 * (`client/scripts/BASE.as:4658-4697`); the switcher lists it instead.
 */

/** Which of the player's own yards to open. */
export interface OwnYardTarget {
  /**
   * The yard's `baseid`. The main yard's is `BaseMode.DEFAULT` ("0"), the
   * sentinel its build-mode load and the yard routes both read as "the main
   * yard", so the client never needs the real one.
   */
  readonly baseid: string;
  readonly kind: YardKind;
  /** An outpost's Map Room 2 cell: its title, and where the map opens from it. */
  readonly cell?: OffsetCell;
  /**
   * Set when the outpost has just been taken over: it opens with Flash's
   * first-open "Veni, Vidi, Vici!" (`client/scripts/BASE.as:2292-2319`).
   */
  readonly takenOver?: { readonly kind: TakeoverKind; readonly name: string };
}

/** The main yard. */
export const MAIN_YARD: OwnYardTarget = { baseid: BaseMode.DEFAULT, kind: "main" };

/** An outpost, by the `baseid` the main yard lists it under. */
export const outpostTarget = (baseid: string, cell?: OffsetCell): OwnYardTarget =>
  cell ? { baseid, kind: "outpost", cell } : { baseid, kind: "outpost" };

/**
 * The `baseid` a yard route sends for this yard: the outpost's, and none for
 * the main yard, which the server reads a missing `baseid` as.
 */
export const outpostBaseid = (target: OwnYardTarget): string | undefined =>
  target.kind === "outpost" ? target.baseid : undefined;

/** Whether two targets are the same yard. */
export const sameYard = (a: OwnYardTarget, b: OwnYardTarget): boolean =>
  a.kind === b.kind && (a.kind === "main" || a.baseid === b.baseid);

/** One outpost of the main yard's `outposts`. */
export interface OwnOutpost {
  readonly baseid: string;
  readonly cell: OffsetCell;
}

/**
 * The outposts a load lists, in its order. Entries that do not read as
 * `[x, y, baseid]` are skipped, and a `baseid` listed twice counts once.
 */
export const outpostsOf = (save: Pick<BaseLoadResponse, "outposts">): OwnOutpost[] => {
  const list: unknown = save.outposts;
  if (!Array.isArray(list)) return [];
  const outposts: OwnOutpost[] = [];
  const seen = new Set<string>();
  for (const entry of list as unknown[]) {
    if (!Array.isArray(entry)) continue;
    const col = Number(entry[0]);
    const row = Number(entry[1]);
    const id: unknown = entry[2];
    if (!Number.isInteger(col) || !Number.isInteger(row)) continue;
    if (typeof id !== "string" && typeof id !== "number") continue;
    const baseid = String(id);
    if (baseid === "" || baseid === BaseMode.DEFAULT || seen.has(baseid)) continue;
    seen.add(baseid);
    outposts.push({ baseid, cell: { col, row } });
  }
  return outposts;
};

/** What the switcher and the HUD call the main yard. */
export const MAIN_YARD_TITLE = "Main yard";

/** "Outpost (241, 208)", or "Outpost" when its cell is not known. */
export const outpostTitle = (cell: OffsetCell | null | undefined): string =>
  cell ? `Outpost (${cell.col}, ${cell.row})` : "Outpost";

/** The yard's title: "Main yard" or "Outpost (x, y)". */
export const yardTitle = (target: OwnYardTarget): string =>
  target.kind === "main" ? MAIN_YARD_TITLE : outpostTitle(target.cell);

/** "No outposts", "1 outpost", "3 outposts". */
export const outpostCountText = (count: number): string =>
  count <= 0 ? "No outposts" : count === 1 ? "1 outpost" : `${count} outposts`;

/**
 * The target with the outpost's cell filled in from the load's list, for an
 * opener that knew only the `baseid`.
 */
export const withCell = (
  target: OwnYardTarget,
  save: Pick<BaseLoadResponse, "outposts">,
): OwnYardTarget => {
  if (target.kind !== "outpost" || target.cell) return target;
  const listed = outpostsOf(save).find((one) => one.baseid === target.baseid);
  return listed ? { ...target, cell: listed.cell } : target;
};

/** One line of the yard switcher. */
export interface OwnYardEntry {
  readonly target: OwnYardTarget;
  readonly title: string;
  /** The yard open now. */
  readonly current: boolean;
}

/**
 * Every yard the player owns, for the switcher: the main yard first, then each
 * outpost in the main yard's order, the one open now marked.
 */
export const ownYardsOf = (
  save: Pick<BaseLoadResponse, "outposts">,
  current: OwnYardTarget,
): OwnYardEntry[] => [
  { target: MAIN_YARD, title: MAIN_YARD_TITLE, current: current.kind === "main" },
  ...outpostsOf(save).map((outpost) => {
    const target = outpostTarget(outpost.baseid, outpost.cell);
    return { target, title: outpostTitle(outpost.cell), current: sameYard(target, current) };
  }),
];

/**
 * Whether an outpost holds nothing but its core, as one just taken from a
 * wild camp does. Flash showed its Starter Kit popup then
 * (`client/scripts/BASE.as:2321-2324`).
 */
export const isEmptyOutpost = (yard: Pick<Yard, "kind" | "buildings">): boolean =>
  yard.kind === "outpost" && yard.buildings.every((one) => one.type === OUTPOST_CORE_TYPE);

/* ── The handoff to the yard screen ─────────────────────────────────────── */

/*
 * The same one-shot handoff as `yardIntent.ts`: `goTo` takes a scene name and
 * nothing else, so the yard to open rides in a module variable and the yard
 * screen takes it as it enters.
 */
let pending: OwnYardTarget | null = null;

/** Asks the next yard screen to open this yard. */
export const setOwnYardTarget = (target: OwnYardTarget): void => {
  pending = target;
};

/** Takes the pending yard, clearing it. Null when none was asked for. */
export const consumeOwnYardTarget = (): OwnYardTarget | null => {
  const target = pending;
  pending = null;
  return target;
};
