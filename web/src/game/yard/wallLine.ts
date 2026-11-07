import type { Resources, UpgradeCost } from "@/api/types";
import type { SpotCheck, SpotProblem } from "./BuildPlacement";
import type { Point } from "./YardGrid";

/**
 * Drawing a line of wall Blocks (walls Option B, owner 8 Nov 2026): the
 * arithmetic, without Pixi or a DOM.
 *
 * The player picks a start Block and an end Block. {@link linePath} lays the
 * Blocks between them edge to edge along the yard's two axes: a straight line
 * when the ends share a row or column, otherwise an L whose longer leg comes
 * first (the drag's main direction), turning once at the corner.
 *
 * {@link planLine} then says what each Block will come to, the way the server
 * will decide it (`server/src/services/yard/buildWalls.ts`), so the preview is
 * a fair guess and nothing more:
 *
 * - **build** (green): free, affordable and inside the hall's limit;
 * - **blocked** (red): outside the yard or on a building. It is skipped and the
 *   rest still build (owner: skip);
 * - **short** (grey): past what the resources pay for, or past the Town Hall's
 *   Block limit. The line builds what it can in order from the start (owner:
 *   build what you can), so every Block after the first short one is short too.
 */

/** What one Block of the line will come to. */
export type LineCellState = "build" | "blocked" | "short";

/** Why the grey Blocks are grey: the hall's limit or the resources, whichever ran out first. */
export type ShortReason = "limit" | "resources";

/** Which leg of an L is laid first: the longer one (`auto`), or the one asked for. */
export type LineBend = "auto" | "xFirst" | "yFirst";

/** One Block of a planned line. */
export interface PlannedCell {
  readonly x: number;
  readonly y: number;
  readonly state: LineCellState;
  /** With `blocked`, why. */
  readonly problem: SpotProblem | null;
  /** With an `overlap`, the building in the way, when it is a real one. */
  readonly blockedBy: number | null;
}

/** A line, Block by Block, and what the bar says about it. */
export interface LinePlan {
  readonly cells: readonly PlannedCell[];
  /** The green Blocks, in build order: what ✓ sends. */
  readonly build: readonly Point[];
  readonly blocked: number;
  readonly short: number;
  /** Null when nothing is short. */
  readonly shortReason: ShortReason | null;
  /** What the green Blocks cost together. */
  readonly cost: UpgradeCost;
}

/** What the line may spend: Blocks the resources pay for, and Blocks the hall still allows. */
export interface LineBudget {
  readonly afford: number;
  readonly room: number;
}

const sign = (value: number): number => (value > 0 ? 1 : value < 0 ? -1 : 0);

/**
 * The Blocks from `start` to `end`, both footprint origins, laid `step` yard
 * units apart (a Block's own width, so they touch). `end` is rounded to the
 * nearest Block along each axis, so the line always starts exactly on
 * `start`. Never empty: equal ends give the one Block.
 */
export const linePath = (start: Point, end: Point, step: number, bend: LineBend = "auto"): Point[] => {
  const nx = Math.round((end.x - start.x) / step);
  const ny = Math.round((end.y - start.y) / step);
  const xFirst = bend === "xFirst" || (bend === "auto" && Math.abs(nx) >= Math.abs(ny));
  const cells: Point[] = [{ x: start.x, y: start.y }];
  let x = start.x;
  let y = start.y;
  const legs: [axis: "x" | "y", count: number][] = xFirst
    ? [
        ["x", nx],
        ["y", ny],
      ]
    : [
        ["y", ny],
        ["x", nx],
      ];
  for (const [axis, count] of legs) {
    const direction = sign(count);
    for (let i = 0; i < Math.abs(count); i++) {
      if (axis === "x") x += direction * step;
      else y += direction * step;
      cells.push({ x, y });
    }
  }
  return cells;
};

/**
 * How many Blocks of `cost` the resources pay for: the fewest any one
 * resource covers. A free Block is limited by nothing here.
 */
export const affordableCount = (cost: UpgradeCost, resources: Resources): number => {
  let count = Number.POSITIVE_INFINITY;
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const each = cost[key];
    if (each <= 0) continue;
    count = Math.min(count, Math.floor(Math.max(0, resources[key] ?? 0) / each));
  }
  return count;
};

/** The parts of a build tile the budget reads (`buildCatalogue.ts` `BuildOffer`). */
export interface LineOfferLike {
  readonly cost: UpgradeCost;
  readonly owned: number;
  readonly allowed: number;
  readonly gate: { readonly reason: string } | null;
}

/**
 * What a line may spend now: Blocks the resources pay for, and Blocks the
 * hall still allows. A gate other than the resources (the hall allows none
 * yet, the limit, requirements) leaves no room at all. No tile, no budget.
 */
export const lineBudgetOf = (offer: LineOfferLike | null, resources: Resources): LineBudget => {
  if (!offer) return { afford: 0, room: 0 };
  const gated = offer.gate !== null && offer.gate.reason !== "shortfall";
  return {
    afford: affordableCount(offer.cost, resources),
    room: gated ? 0 : Math.max(0, offer.allowed - offer.owned),
  };
};

const LINE_MODE_KEY = "bymr.wallLineMode";

/**
 * Whether line mode starts on for this player: on unless they turned it off
 * last time (kept in this browser only). Storage that throws reads as on.
 */
export const readLineModePreference = (storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean => {
  try {
    return storage?.getItem(LINE_MODE_KEY) !== "off";
  } catch {
    return true;
  }
};

/** Remembers the player's Line toggle for the next wall placement. */
export const writeLineModePreference = (on: boolean, storage: Pick<Storage, "setItem"> | null = safeStorage()): void => {
  try {
    storage?.setItem(LINE_MODE_KEY, on ? "on" : "off");
  } catch {
    // A private window or blocked storage: the toggle still works for this placement.
  }
};

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * What each Block of `path` comes to: blocked ones skipped, the rest green
 * until the budget runs out, grey after that. See the file comment.
 */
export const planLine = (
  path: readonly Point[],
  check: (x: number, y: number) => SpotCheck,
  budget: LineBudget,
  unitCost: UpgradeCost,
): LinePlan => {
  const limit = Math.max(0, Math.min(budget.afford, budget.room));
  // The hall's limit counts first when both run out on the same Block, as the server's gates do.
  const reason: ShortReason = budget.room <= budget.afford ? "limit" : "resources";
  const cells: PlannedCell[] = [];
  const build: Point[] = [];
  let blocked = 0;
  let short = 0;
  for (const { x, y } of path) {
    const spot = check(x, y);
    if (spot.problem) {
      blocked++;
      cells.push({ x, y, state: "blocked", problem: spot.problem, blockedBy: spot.blockedBy });
    } else if (build.length < limit) {
      build.push({ x, y });
      cells.push({ x, y, state: "build", problem: null, blockedBy: null });
    } else {
      short++;
      cells.push({ x, y, state: "short", problem: null, blockedBy: null });
    }
  }
  const n = build.length;
  return {
    cells,
    build,
    blocked,
    short,
    shortReason: short > 0 ? reason : null,
    cost: { r1: unitCost.r1 * n, r2: unitCost.r2 * n, r3: unitCost.r3 * n, r4: unitCost.r4 * n },
  };
};
