import { costOf } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { stepAmounts } from "../base/economy/resourceBudget.js";
import { isShort, pointsForBuild, shortfall, yardKindOf, type ResourceAmounts } from "../yardplanner/costs.js";
import { buildGates, nextBuildingId, placementProblem, type BuildSave, type PlacementProblem } from "./build.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/build/walls`: a line or L of wall Blocks drawn in one go
 * (walls Option B, owner 8 Nov 2026). The client draws the line and shows a
 * guess of what will build; this decides.
 *
 * Every cell goes through the single build's own gates (`build.ts`), in the
 * order the client sent them, against the yard as the cells before it left
 * it:
 *
 * - `buildGates`: buildable type, the hall allows the type, the hall's limit
 *   (each Block built earlier in the line counts), requirements.
 * - The resources: what the yard holds, less what the earlier cells cost.
 * - `placementProblem`: inside the plot and clear of every building, the
 *   Blocks placed earlier in this line included.
 *
 * The owner's rules (8 Nov 2026):
 *
 * - A blocked cell (outside the yard, or on a building) is **skipped**; the
 *   rest still build.
 * - When the line is not fully affordable, or the hall's limit is reached,
 *   it **builds what it can** in order from the start; every cell after that
 *   is refused for the same reason.
 * - No cap but the hall's (`MAX_WALL_LINE_CELLS` only bounds the request).
 *
 * Only a type whose props `kind` is `wall` may be sent (`400 notWall`). When
 * no cell builds at all, the route refuses as the single build would, with
 * the reason that stopped the line (`limit`, `shortfall`, `townHall`,
 * `requirements`) or, when every cell was blocked, the first cell's
 * `placement`. Otherwise one charge for the lot, every Block written
 * finished at level 1 with its points now (D13), one write.
 */

/** A cell the line names: a Block's footprint origin. */
export interface WallCell {
  x: number;
  y: number;
}

export interface BuildWallsRequest {
  type: number;
  cells: readonly WallCell[];
}

/** One Block the line built. */
export interface BuiltWall {
  id: number;
  x: number;
  y: number;
}

/** One cell the line left out, and why: a refusal reason of the single build. */
export interface RefusedWall {
  x: number;
  y: number;
  reason: string;
  /** With `placement`: `outOfBounds` or `overlap`. */
  placement?: PlacementProblem["placement"];
  /** With an `overlap`: the building in the way. */
  with?: number;
}

/** `report` of `POST /bm/yard/build/walls`. */
export interface BuildWallsReport {
  t: number;
  /** The Blocks built, in line order. */
  built: BuiltWall[];
  /** The cells left out, in line order. */
  refused: RefusedWall[];
  /** The one charge: every built Block's `costs[0]`. */
  cost: ResourceAmounts;
  /** Empire points awarded now. */
  points: number;
}

const ZERO: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };

const add = (a: ResourceAmounts, b: ResourceAmounts): ResourceAmounts => ({
  r1: a.r1 + b.r1,
  r2: a.r2 + b.r2,
  r3: a.r3 + b.r3,
  r4: a.r4 + b.r4,
});

/** A refusal's reason, or null for anything that is not one. */
const reasonOf = (error: unknown): string | null => {
  if (!(error instanceof ClientSafeError)) return null;
  const reason = (error.data as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
};

/** The pool left once `spent` is taken out of `resources`. */
const poolAfter = (resources: BuildSave["resources"], spent: ResourceAmounts): Record<string, number> => {
  const held = (key: keyof ResourceAmounts) => Number((resources as Record<string, unknown> | null)?.[key] ?? 0) || 0;
  return {
    r1: held("r1") - spent.r1,
    r2: held("r2") - spent.r2,
    r3: held("r3") - spent.r3,
    r4: held("r4") - spent.r4,
  };
};

/**
 * Builds a line of wall Blocks; see the file comment.
 *
 * @param save - The caught-up yard (main, outpost or Inferno).
 * @param request - The wall type and its cells, in build order.
 * @returns The new `buildingdata`, the one debit, the points and the report.
 */
export const planBuildWalls = (save: BuildSave, request: BuildWallsRequest) => {
  const { type, cells } = request;
  const kind = yardKindOf(save);
  if (costOf(type, kind)?.kind !== "wall") {
    throw yardBadRequestErr("Only walls can be drawn in a line.", { type }, "notWall");
  }
  const seen = new Set<string>();
  for (const { x, y } of cells) {
    const key = `${x},${y}`;
    if (seen.has(key)) throw yardBadRequestErr("A cell is named twice.", { x, y });
    seen.add(key);
  }

  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  const working: BuildSave = { ...save, buildingdata };
  const built: BuiltWall[] = [];
  const refused: RefusedWall[] = [];
  let spent = ZERO;
  let points = 0;
  /** What stopped the line (hall limit, resources…): every later cell is refused the same. */
  let stop: { reason: string; error: unknown } | null = null;
  /** The first blocked cell's refusal, for a line of nothing but blocked cells. */
  let firstBlocked: ClientSafeError | null = null;

  for (const { x, y } of cells) {
    if (stop) {
      refused.push({ x, y, reason: stop.reason });
      continue;
    }
    const cell = { type, x, y };

    let step;
    try {
      step = buildGates(working, cell);
    } catch (error) {
      const reason = reasonOf(error);
      if (reason === null) throw error;
      stop = { reason, error };
      refused.push({ x, y, reason });
      continue;
    }

    const cost = stepAmounts(step);
    const missing = shortfall(poolAfter(save.resources, spent), cost);
    if (isShort(missing)) {
      stop = {
        reason: "shortfall",
        error: yardRefusedErr("shortfall", "You do not have enough resources for that.", { shortfall: missing }),
      };
      refused.push({ x, y, reason: "shortfall" });
      continue;
    }

    const problem = placementProblem(working, cell);
    if (problem) {
      firstBlocked ??= yardRefusedErr(
        "placement",
        problem.placement === "outOfBounds" ? "That spot is outside your yard." : "Something is already built there.",
        problem
      );
      refused.push({ x, y, reason: "placement", ...problem });
      continue;
    }

    const id = nextBuildingId(working);
    buildingdata[String(id)] = { id, t: type, X: x, Y: y } as unknown as BuildingData;
    spent = add(spent, cost);
    points += pointsForBuild(step);
    built.push({ id, x, y });
  }

  if (built.length === 0) throw stop?.error ?? firstBlocked ?? yardRefusedErr("placement", "Nothing was built.");

  const report: BuildWallsReport = { t: type, built, refused, cost: spent, points };
  return { report, slices: { buildingdata }, debit: spent, points };
};
