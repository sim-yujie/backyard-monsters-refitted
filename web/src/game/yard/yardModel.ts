import type { BaseLoadResponse, BuildingData, Resources } from "@/api/types";
import { ArtState, buildingName, maxHealth, resolveArt } from "./buildingArt";
import {
  depthKey,
  footprintBox,
  footprintCentre,
  footprintOf,
  FOREIGN_YARD_MARGIN,
  YARD_MARGIN,
  yardBounds,
  yardToWorld,
  type Rect,
  type YardBounds,
} from "./YardGrid";
import { busyWorkers, sharperToolsMultiplier, workerCount } from "./workers";

/**
 * The yard, in the form the renderer and the panels want it.
 *
 * `/base/load` hands back a save row: a map of buildings keyed by id, a
 * separate health map, a mushroom list and a store-purchase blob. Turning that
 * into a draw list is one pass, done once when the yard opens, so nothing
 * downstream has to remember which fields are omitted at their default or which
 * of two places a building's health comes from.
 *
 * Everything is precomputed here — world position, footprint box, depth key,
 * art state — because it does not change while the yard is read-only, and a
 * render loop that recomputes 575 isometric projections a frame is a render
 * loop that drops frames for no reason.
 */

/** A building's visual state, from its health against its maximum. */
export const BuildingCondition = {
  HEALTHY: "healthy",
  DAMAGED: "damaged",
  DESTROYED: "destroyed",
} as const;
export type BuildingCondition = (typeof BuildingCondition)[keyof typeof BuildingCondition];

export interface YardBuilding {
  readonly id: number;
  readonly type: number;
  readonly name: string;
  /** Yard units. */
  readonly x: number;
  readonly y: number;
  /** Level; 0 while the initial build is still counting down. */
  readonly level: number;
  readonly fortification: number;
  /** Footprint in yard units. */
  readonly footprint: readonly [width: number, height: number];
  /** World pixels: the footprint's top corner, which is the art's anchor. */
  readonly worldX: number;
  readonly worldY: number;
  /** World pixels: the middle of the footprint diamond, for labels and outlines. */
  readonly centreX: number;
  readonly centreY: number;
  /** Axis-aligned world box of the footprint, for culling and hit testing. */
  readonly box: Rect;
  readonly depth: number;
  readonly condition: BuildingCondition;
  /** Current health, or null when the save says nothing (meaning full). */
  readonly hp: number | null;
  /** Maximum health at this level, or null for a type with no health ladder. */
  readonly maxHp: number | null;
  /** Seconds left, and what on, or null. Counted from `savetime`. */
  readonly countdown: YardCountdown | null;
  /** The raw record, so the inspector can show fields this does not model. */
  readonly raw: BuildingData;
}

export interface YardCountdown {
  readonly kind: "build" | "upgrade" | "fortify" | "rebuild";
  /** Unix seconds the countdown is expected to finish at, were it running. */
  readonly endsAt: number;
  /** Seconds left at `savetime`, as the save stores it. */
  readonly seconds: number;
  /**
   * The countdown is frozen: the building is damaged or repairing, and the
   * server does not advance its countdown until it is back to full health
   * (`server/src/services/base/advanceBuildingTimers.ts:90-91`,
   * `client/scripts/BFOUNDATION.as:1367-1394`). `endsAt` is then only what
   * it would be were it running from `savetime`; `seconds` is the time left.
   */
  readonly paused: boolean;
}

export interface YardMushroom {
  /**
   * Its place in `mushrooms.l`. Mushrooms have no stored id; the Flash client
   * numbered them the same way on every load (`client/scripts/MUSHROOMS.as:89`),
   * and the pick route takes this index (`POST /bm/yard/mushroom/pick`).
   */
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly worldX: number;
  readonly worldY: number;
  readonly depth: number;
  /**
   * Which of the five art variants this mushroom shows, 1..5, as the save
   * stores it (`client/scripts/BMUSHROOM.as:52-62`, generated at
   * `MUSHROOMS.as:62`). The art is an embedded Flash MovieClip and has no file
   * on the server, so this client draws one glyph for all five and carries the
   * field for when that art is recovered.
   */
  readonly variant: number;
}

/**
 * The yard's workers: how many it has, and how many are already on a job.
 *
 * Derived, never stored (spec `docs/specs/base-building.md:741-743`). The rules
 * live in `workers.ts` so that the planner's "2 free / 5" and the number the
 * server charges against are the same reading of the same save.
 */
export interface YardWorkers {
  /** `1 + storedata.BEW.q`, capped at five. */
  readonly total: number;
  /** Buildings with a build, upgrade or fortify countdown running. */
  readonly busy: number;
}

export interface Yard {
  readonly bounds: YardBounds;
  readonly expansionLevel: number;
  /**
   * Somebody else's yard — an attack target or a visit — rather than the
   * player's own. Drawn on open grass with no plot edge, the way the Flash
   * client drew every yard outside BUILD mode (`client/scripts/MAP.as:362-365`
   * draws the edge only there), and with `FOREIGN_YARD_MARGIN` of ground
   * around the plot. A wild monster camp is always foreign.
   */
  readonly foreign: boolean;
  /** Depth-sorted, so the renderer can draw straight down the list. */
  readonly buildings: readonly YardBuilding[];
  readonly mushrooms: readonly YardMushroom[];
  readonly resources: Resources;
  readonly credits: number;
  readonly baseName: string;
  readonly baseLevel: number;
  /** The town hall, if this yard has one. The camera opens on it. */
  readonly townHall: YardBuilding | null;
  /**
   * Workers, counted off the store purchases and the running countdowns. The
   * planner needs both numbers to say how many planned upgrades can start.
   */
  readonly workers: YardWorkers;
  /**
   * What an upgrade's table time is multiplied by to get its countdown: 0.8
   * while Sharper Tools is running, otherwise 1 (`GLOBAL._buildTime`,
   * `client/scripts/BFOUNDATION.as:2295`).
   *
   * Read once at load, from the same `storedata.BST.e` the server reads when
   * Apply writes `cU`, so the planner's "15m 0s" and the countdown the yard
   * comes back with are the same number.
   */
  readonly buildTime: number;
  /** Unix seconds the save was taken at; countdowns are measured from it. */
  readonly savedAt: number;
}

/** Town hall type id, `client/scripts/YARD_PROPS.as:1299`. */
export const TOWN_HALL_TYPE = 14;

/**
 * Health below this fraction of maximum shows the damaged art
 * (`client/scripts/BFOUNDATION.as:495-497`, applied at `:2875-2884`).
 */
const DAMAGED_AT = 0.5;

/**
 * The visual state for a health reading.
 *
 * Zero or less is destroyed; below half of maximum is damaged; anything else,
 * including a building the save says nothing about, is healthy. A save only
 * writes `hp` when the building is below full health
 * (`client/scripts/BFOUNDATION.as:3025`), so a missing reading is not missing
 * information.
 *
 * When the props table has no health ladder for the type — every decoration —
 * any reading at all is treated as damage, because the alternative is showing
 * a wrecked building as intact.
 */
const conditionOf = (hp: number | null, max: number | null): BuildingCondition => {
  if (hp === null) return BuildingCondition.HEALTHY;
  if (hp <= 0) return BuildingCondition.DESTROYED;
  if (max === null || max <= 0) return BuildingCondition.DAMAGED;
  return hp < max * DAMAGED_AT ? BuildingCondition.DAMAGED : BuildingCondition.HEALTHY;
};

/** The art state for a condition. */
export const artStateFor = (condition: BuildingCondition): ArtState =>
  condition === BuildingCondition.DESTROYED
    ? ArtState.DESTROYED
    : condition === BuildingCondition.DAMAGED
      ? ArtState.DAMAGED
      : ArtState.DEFAULT;

/**
 * Whether a building's countdown is frozen: it is repairing, or the save
 * holds a health reading for it, which the save only writes below full
 * health. The server's own test, word for word
 * (`server/src/services/base/advanceBuildingTimers.ts:90-91`).
 */
export const isCountdownPaused = (
  building: BuildingData,
  health: BaseLoadResponse["buildinghealthdata"],
): boolean =>
  Boolean(building.rE) ||
  building.hp != null ||
  (health != null && String(building.id) in health);

/**
 * The countdown a building is running, measured from `savedAt`.
 *
 * Exported for `jobs.ts`, which turns every timer in the yard into a job with
 * an end time; this is its building half. `health` is the save's
 * `buildinghealthdata`, for the paused test.
 */
export const countdownOf = (
  building: BuildingData,
  savedAt: number,
  health: BaseLoadResponse["buildinghealthdata"] = null,
): YardCountdown | null => {
  const pairs: readonly [YardCountdown["kind"], number | undefined][] = [
    ["build", building.cB],
    ["upgrade", building.cU],
    ["fortify", building.cF],
    ["rebuild", building.cR],
  ];
  for (const [kind, seconds] of pairs) {
    if (typeof seconds === "number" && seconds > 0) {
      return {
        kind,
        endsAt: savedAt + seconds,
        seconds,
        paused: isCountdownPaused(building, health),
      };
    }
  }
  return null;
};

/**
 * One `mushrooms.l` entry as `[frame, X, Y]`: the save's own shape
 * (`client/scripts/BASE.as:2749-2757`), or an older object `{ frame, X, Y }`.
 *
 * Whether a mushroom is golden is not known until it is picked: the server
 * rolls it then (`docs/design/yard-buildings.md` §5.6), and the original drew
 * no difference either, so every mushroom looks the same.
 */
const mushroomEntry = (
  entry: unknown,
): { frame: number; x: number; y: number } => {
  if (Array.isArray(entry)) {
    return { frame: Number(entry[0]), x: Number(entry[1]) || 0, y: Number(entry[2]) || 0 };
  }
  const object = (entry ?? {}) as { frame?: unknown; X?: unknown; Y?: unknown };
  return { frame: Number(object.frame), x: Number(object.X) || 0, y: Number(object.Y) || 0 };
};

export interface ReadYardOptions {
  /**
   * The yard belongs to somebody else (a visit or an attack). Only the caller
   * knows: the response for a visit looks like the response for one's own
   * yard. A `type: "tribe"` response is foreign whether or not this is set.
   */
  readonly foreign?: boolean;
}

/** The `type` a wild monster camp's save carries (`server/src/enums/Base.ts`). */
const TRIBE_TYPE = "tribe";

/** Builds the draw list from a `/base/load` response. */
export const readYard = (response: BaseLoadResponse, options: ReadYardOptions = {}): Yard => {
  const expansionLevel = response.storedata?.["ENL"]?.q ?? 0;
  // A wild monster camp's save has no store purchases, so the store's rule
  // would put it on the smallest plot; its buildings were laid out for the
  // plot `WMBASE.Setup` grows it to. See `wildYardSize`.
  const wild = response.type === TRIBE_TYPE;
  const foreign = wild || options.foreign === true;
  const bounds = yardBounds(expansionLevel, {
    wild,
    margin: foreign ? FOREIGN_YARD_MARGIN : YARD_MARGIN,
  });

  // A yard that has never been saved reports savetime 0, which would put every
  // countdown decades in the past. The server's own clock is the honest
  // fallback: it is what the original replays forward from.
  const savedAt =
    typeof response.savetime === "number" && response.savetime > 0
      ? response.savetime
      : response.currenttime;

  const health = response.buildinghealthdata ?? {};
  const buildings: YardBuilding[] = [];

  for (const [key, raw] of Object.entries(response.buildingdata ?? {})) {
    if (!raw || typeof raw.t !== "number") continue;

    const id = typeof raw.id === "number" ? raw.id : Number(key);
    const x = Number(raw.X) || 0;
    const y = Number(raw.Y) || 0;

    // Absent level means 1; a running build countdown means 0.
    const stored = typeof raw.l === "number" ? raw.l : 1;
    const level = typeof raw.cB === "number" && raw.cB > 0 ? 0 : stored;

    const hp = raw.hp ?? health[String(id)] ?? null;
    const maxHp = maxHealth(raw.t, level);
    const condition = conditionOf(hp, maxHp);

    const world = yardToWorld(bounds, x, y);
    const centre = footprintCentre(bounds, raw.t, x, y);

    buildings.push({
      id,
      type: raw.t,
      name: buildingName(raw.t) ?? `Type ${raw.t}`,
      x,
      y,
      level,
      fortification: typeof raw.fort === "number" ? raw.fort : 0,
      footprint: footprintOf(raw.t),
      worldX: world.x,
      worldY: world.y,
      centreX: centre.x,
      centreY: centre.y,
      box: footprintBox(bounds, raw.t, x, y),
      depth: depthKey(world.x, world.y, id),
      condition,
      hp,
      maxHp,
      countdown: countdownOf(raw, savedAt, response.buildinghealthdata),
      raw,
    });
  }

  buildings.sort((a, b) => a.depth - b.depth);

  const mushrooms: YardMushroom[] = (response.mushrooms?.l ?? []).map((entry, index) => {
    const { frame, x, y } = mushroomEntry(entry);
    const world = yardToWorld(bounds, x, y);
    return {
      id: index,
      x,
      y,
      worldX: world.x,
      worldY: world.y,
      depth: depthKey(world.x, world.y, index),
      variant: Number.isInteger(frame) && frame >= 1 && frame <= 5 ? frame : 1,
    };
  });

  return {
    bounds,
    expansionLevel,
    foreign,
    buildings,
    mushrooms,
    resources: response.resources ?? {},
    credits: response.credits ?? 0,
    baseName: response.basename ?? "Your yard",
    baseLevel: typeof response.level === "number" ? response.level : 0,
    townHall: buildings.find((one) => one.type === TOWN_HALL_TYPE) ?? null,
    workers: {
      total: workerCount(response.storedata),
      busy: busyWorkers({ buildings }),
    },
    // Against the server's clock rather than the browser's: a buff that has
    // seconds left on one and not the other is the server's call to make.
    buildTime: sharperToolsMultiplier(response.storedata, response.currenttime ?? savedAt),
    savedAt,
  };
};

/** The art for a building in its current condition, or null when unmapped. */
export const artFor = (building: YardBuilding) =>
  resolveArt(building.type, building.level, artStateFor(building.condition));
