import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  currentExpansion,
  overlaps,
  rectOf,
  yardSize,
  type FootprintRect,
} from "../yardplanner/layoutGeometry.js";
import { busyWorkers, workerCount } from "../yardplanner/workers.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Yard mushrooms: where a new one grows, and what picking one gives
 * (`docs/design/yard-buildings.md` §5.6, decision D14).
 *
 * **The save shape** is the Flash client's, unchanged: `mushrooms` is
 * `{ l: [[frame, X, Y], ...], s }`, where `frame` is which of the five art
 * variants the mushroom shows, `X`/`Y` are yard units like a building's, and
 * `s` is the Unix second of the last spawn (`client/scripts/BASE.as:2749-2757`
 * writes it, `client/scripts/MUSHROOMS.as:84-90` reads it back). Mushrooms
 * have no stored id: the Flash client numbered them by their place in the list
 * on every load (`MUSHROOMS.as:89`), and so does the pick route.
 *
 * **Golden.** The original decided a golden mushroom from its position with a
 * seeded generator (`MUSHROOMS.as:223-224`) that nothing on the server
 * reproduces. The decision moves to a server roll at pick time with the same
 * odds, one in four, and the same variant roll after it (`:236-241`): 8 Shiny
 * with probability 1/3, 3 Shiny with 2/3. The original drew no difference
 * between a golden mushroom and any other, so nothing is lost by not knowing
 * in advance.
 *
 * Everything here is pure: the random source is a parameter, so tests pin it.
 */

/** One mushroom grows back per this many seconds since the last spawn (`MUSHROOMS.as:129`). */
export const MUSHROOM_RESPAWN_SECONDS = 17_280;

/** At most this many grow in one catch-up (`MUSHROOMS.as:132-134`). */
export const MUSHROOM_BURST = 10;

/**
 * New mushrooms grow only while the yard holds fewer than this many
 * (`MUSHROOMS.as:135-137`; owner decision 2026-09-28, design §5.6). A yard
 * already above it keeps what it has; it just grows no more.
 */
export const MUSHROOM_CAP = 10;

/**
 * A stored list is read up to this many (the Flash load cap,
 * `MUSHROOMS.as:84`, `:115-121`), so an older yard above
 * {@link MUSHROOM_CAP} loses none.
 */
export const MUSHROOM_STORED_CAP = 20;

/** Tries to find a free spot before giving up on one mushroom (`MUSHROOMS.as:171`). */
export const SPAWN_ATTEMPTS = 5000;

/** Shiny a golden mushroom gives: `MUSHROOM1` 3, `MUSHROOM2` 8 (`game-data/store/purchaseKeys.ts`). */
export const GOLDEN_SMALL = 3;
export const GOLDEN_BIG = 8;

/** A random number in `[0, 1)`, like `Math.random`. */
export type Random = () => number;

/** One stored mushroom: `[frame, X, Y]`. */
export type MushroomEntry = [frame: number, x: number, y: number];

/** The `mushrooms` column as this module reads and writes it. */
export interface MushroomSave {
  l: MushroomEntry[];
  s: number;
}

/** The parts of a save the mushroom rules read. */
export interface MushroomYardSave {
  buildingdata?: BuildingDataMap | null;
  storedata?: JsonObject | null;
  mushrooms?: JsonObject | null;
}

const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * One list entry as `[frame, X, Y]`, or null when it has no usable position.
 * An object `{ frame, X, Y }` is read too, so a hand-written row still loads.
 */
const entryOf = (raw: unknown): MushroomEntry | null => {
  const [frame, x, y] = Array.isArray(raw)
    ? [raw[0], raw[1], raw[2]]
    : raw && typeof raw === "object"
      ? [(raw as JsonObject).frame, (raw as JsonObject).X, (raw as JsonObject).Y]
      : [];
  const px = finite(x);
  const py = finite(y);
  if (px === null || py === null) return null;
  const f = finite(frame);
  return [f !== null && f >= 1 && f <= 5 ? Math.trunc(f) : 1, px, py];
};

/**
 * The stored mushrooms, cleaned: entries without a position are dropped and
 * the list is cut to {@link MUSHROOM_STORED_CAP}, as the Flash load did
 * (`MUSHROOMS.as:84`, `:115-121`). `s` is 0 when the yard never had a spawn.
 */
export const readMushrooms = (mushrooms: JsonObject | null | undefined): MushroomSave => {
  const list = Array.isArray(mushrooms?.l) ? (mushrooms.l as unknown[]) : [];
  const l: MushroomEntry[] = [];
  for (const raw of list) {
    const entry = entryOf(raw);
    if (entry) l.push(entry);
    if (l.length >= MUSHROOM_STORED_CAP) break;
  }
  const s = finite(mushrooms?.s);
  return { l, s: s !== null && s > 0 ? Math.trunc(s) : 0 };
};

/** A mushroom's 30 × 30 footprint (`client/scripts/BUILDING7.as:9-10`). */
const mushroomRect = ([, x, y]: MushroomEntry): FootprintRect => rectOf(MUSHROOM_TYPE, x, y);

/** Every building's footprint; an entry without a usable position is skipped. */
const buildingRects = (buildingdata: BuildingDataMap | null | undefined): FootprintRect[] => {
  const rects: FootprintRect[] = [];
  for (const raw of Object.values(buildingdata ?? {})) {
    const building = raw as BuildingData;
    const x = finite(building.X);
    const y = finite(building.Y);
    const t = finite(building.t);
    if (x === null || y === null || t === null) continue;
    rects.push(rectOf(t, x, y));
  }
  return rects;
};

/**
 * A free spot for one new mushroom: a random point in the plot whose 30 × 30
 * footprint lies inside it and overlaps no building and no other mushroom
 * (`MUSHROOMS.as:171-181`), or null after {@link SPAWN_ATTEMPTS} misses.
 *
 * The original's loop also accepted any point that fell *outside* the plot
 * (the test at `:175` sets "found" for it) and replaced such a mushroom on the
 * next load (`:93-111`); here the point is drawn inside the plot to begin with.
 */
const freeSpot = (
  obstacles: readonly FootprintRect[],
  expansion: number,
  random: Random
): [number, number] | null => {
  const [width, height] = yardSize(expansion);
  const { w, h } = rectOf(MUSHROOM_TYPE, 0, 0);
  const spanX = width - w;
  const spanY = height - h;

  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = Math.floor(-width / 2 + random() * spanX);
    const y = Math.floor(-height / 2 + random() * spanY);
    const rect = rectOf(MUSHROOM_TYPE, x, y);
    if (!obstacles.some((other) => overlaps(rect, other))) return [x, y];
  }
  return null;
};

/**
 * Grows up to `count` new mushrooms on free spots, each with a random art
 * frame 1 to 5 (`MUSHROOMS.as:166`). Fewer grow when the plot has no room.
 *
 * @returns The new list: the old entries, then the new ones.
 */
export const spawnMushrooms = (
  save: MushroomYardSave,
  existing: readonly MushroomEntry[],
  count: number,
  random: Random
): MushroomEntry[] => {
  const list = [...existing];
  const obstacles = [...buildingRects(save.buildingdata), ...list.map(mushroomRect)];
  const expansion = currentExpansion(save.storedata);

  for (let i = 0; i < count; i++) {
    const spot = freeSpot(obstacles, expansion, random);
    if (!spot) break;
    const entry: MushroomEntry = [Math.floor(random() * 5) + 1, spot[0], spot[1]];
    list.push(entry);
    obstacles.push(mushroomRect(entry));
  }
  return list;
};

/** `report` of `POST /bm/yard/mushroom/pick`. */
export interface MushroomPickReport {
  /** The picked mushroom's place in the list it was picked from. */
  id: number;
  /** Where it stood, yard units. */
  x: number;
  y: number;
  /** One in four. */
  golden: boolean;
  /** Shiny it gave: 0, 3 or 8. */
  shiny: number;
}

/**
 * The server's reward roll: golden one time in four, then the original's
 * variant roll, `int(random × 3 + 1)` with 3 read as 1, so variant 2 (8 Shiny)
 * comes up one time in three (`MUSHROOMS.as:224`, `:236-241`).
 */
export const rollReward = (random: Random): { golden: boolean; shiny: number } => {
  if (Math.floor(random() * 4) !== 0) return { golden: false, shiny: 0 };
  const variant = Math.floor(random() * 3 + 1);
  return { golden: true, shiny: variant === 2 ? GOLDEN_BIG : GOLDEN_SMALL };
};

/**
 * Picks one mushroom: `POST /bm/yard/mushroom/pick`.
 *
 * The pick needs a free worker, as the original's did (`MUSHROOMS.PickWorker`,
 * `:197-206`, queues it like a build job); the job lasted a few seconds, so
 * the worker is not held afterwards. The mushroom goes at once and the reward
 * is rolled here.
 *
 * Refuses `400 badRequest` for an index the list does not have, `409 moved`
 * when the client named a position and the mushroom at that index is not
 * there (its copy of the list is stale), and `409 workers` when every worker
 * is busy.
 *
 * @param save - The caught-up main yard.
 * @param id - The mushroom's index in `mushrooms.l`.
 * @param at - Where the client saw it, to check the index still means the same mushroom.
 * @param random - The reward roll's source.
 * @returns The new `mushrooms` column, the Shiny to credit and the report.
 */
export const planMushroomPick = (
  save: MushroomYardSave,
  id: number,
  at: { x?: number | undefined; y?: number | undefined },
  random: Random
): { report: MushroomPickReport; mushrooms: MushroomSave; shiny: number } => {
  const { l, s } = readMushrooms(save.mushrooms);
  const entry = l[id];
  if (!entry) throw yardBadRequestErr("That mushroom is not in your yard.", { id });

  const [, x, y] = entry;
  if ((at.x !== undefined && at.x !== x) || (at.y !== undefined && at.y !== y)) {
    throw yardRefusedErr("moved", "That mushroom is not there any more. Try again.", {
      id,
      at: { x, y },
    });
  }

  const total = workerCount(save.storedata);
  const busy = busyWorkers(save.buildingdata);
  if (busy >= total) {
    throw yardRefusedErr("workers", "All your workers are busy.", { workers: { total, busy } });
  }

  const { golden, shiny } = rollReward(random);
  return {
    report: { id, x, y, golden, shiny },
    mushrooms: { l: l.filter((_, index) => index !== id), s },
    shiny,
  };
};
