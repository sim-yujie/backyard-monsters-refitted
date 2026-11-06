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

/**
 * While the Halloween pumpkin hunt is on (`season.ts`), the mushrooms grow as
 * pumpkins, one per this many seconds: about one an hour, under the same
 * {@link MUSHROOM_CAP}.
 */
export const PUMPKIN_RESPAWN_SECONDS = 3_600;

/** The respawn period: the pumpkin hunt's while it is on, else the usual. */
export const mushroomRespawnSeconds = (pumpkinHunt: boolean): number =>
  pumpkinHunt ? PUMPKIN_RESPAWN_SECONDS : MUSHROOM_RESPAWN_SECONDS;

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

/**
 * Yard units of open ground a new mushroom keeps between its footprint and
 * every building's, on all four sides (owner bug, 28 Oct 2026). A pumpkin
 * that grew with its footprint touching a wall's looked half sunk into the
 * block; with this gap it stands clear of it. A plot with no such spot left
 * still grows on any free one, as before, rather than not at all.
 */
export const MUSHROOM_CLEARANCE = 10;

/**
 * Tries to find a clear spot for a mushroom that is only too close to a
 * building ({@link moveMushroomsOffBuildings}). Fewer than
 * {@link SPAWN_ATTEMPTS}: one that finds none stays where it is, and this
 * runs on every load and every building change.
 */
export const NUDGE_ATTEMPTS = 200;

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

/** `rect` grown by `by` yard units on every side. */
const grown = (rect: FootprintRect, by: number): FootprintRect => ({
  x: rect.x - by,
  y: rect.y - by,
  w: rect.w + 2 * by,
  h: rect.h + 2 * by,
});

/**
 * Whether a mushroom's footprint keeps {@link MUSHROOM_CLEARANCE} from every
 * building's.
 */
const clearOf = (rect: FootprintRect, buildings: readonly FootprintRect[]): boolean => {
  const around = grown(rect, MUSHROOM_CLEARANCE);
  return !buildings.some((building) => overlaps(around, building));
};

/** What a new mushroom's footprint must keep off. */
interface Obstacles {
  buildings: readonly FootprintRect[];
  mushrooms: FootprintRect[];
}

/**
 * A free spot for one new mushroom: a random point in the plot whose 30 × 30
 * footprint lies inside it and overlaps no building and no other mushroom
 * (`MUSHROOMS.as:171-181`), or null after `attempts` misses.
 *
 * A spot {@link MUSHROOM_CLEARANCE} clear of every building wins. With
 * `loose`, the first spot that only misses them is the answer when no clear
 * one turns up, so a crowded plot still grows; without it, null.
 *
 * The original's loop also accepted any point that fell *outside* the plot
 * (the test at `:175` sets "found" for it) and replaced such a mushroom on the
 * next load (`:93-111`); here the point is drawn inside the plot to begin with.
 */
const freeSpot = (
  obstacles: Obstacles,
  expansion: number,
  random: Random,
  { attempts = SPAWN_ATTEMPTS, loose = true }: { attempts?: number; loose?: boolean } = {}
): [number, number] | null => {
  const [width, height] = yardSize(expansion);
  const { w, h } = rectOf(MUSHROOM_TYPE, 0, 0);
  const spanX = width - w;
  const spanY = height - h;
  let fallback: [number, number] | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const x = Math.floor(-width / 2 + random() * spanX);
    const y = Math.floor(-height / 2 + random() * spanY);
    const rect = rectOf(MUSHROOM_TYPE, x, y);
    if (obstacles.mushrooms.some((other) => overlaps(rect, other))) continue;
    if (clearOf(rect, obstacles.buildings)) return [x, y];
    if (loose && !fallback && !obstacles.buildings.some((other) => overlaps(rect, other))) {
      fallback = [x, y];
    }
  }
  return fallback;
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
  const obstacles: Obstacles = {
    buildings: buildingRects(save.buildingdata),
    mushrooms: list.map(mushroomRect),
  };
  const expansion = currentExpansion(save.storedata);

  for (let i = 0; i < count; i++) {
    const spot = freeSpot(obstacles, expansion, random);
    if (!spot) break;
    const entry: MushroomEntry = [Math.floor(random() * 5) + 1, spot[0], spot[1]];
    list.push(entry);
    obstacles.mushrooms.push(mushroomRect(entry));
  }
  return list;
};

/**
 * Moves every mushroom a building stands on to free ground (#263, owner
 * decision 2026-10-04): a mushroom never blocks a build, a move, a decoration
 * or an Apply, and pops up somewhere else instead.
 *
 * The new spot follows the growing rule ({@link spawnMushrooms}): inside the
 * plot, clear of every building and of every other mushroom, the ones moved
 * earlier in the same call included. A mushroom keeps its art frame and its
 * place in the list, so the pick route's index still names it; one with no
 * free spot left goes, as a growing one does not grow. `s` is kept.
 *
 * A mushroom no building stands on but one comes within
 * {@link MUSHROOM_CLEARANCE} of (a pumpkin that grew against a wall before
 * the gap was kept, 28 Oct 2026) moves too, but only to a clear spot: with
 * none in {@link NUDGE_ATTEMPTS} draws it stays where it is, untouched.
 *
 * Every route that changes `buildingdata` runs this before it writes, and so
 * does the catch-up (`catchUpMushrooms.ts`), so a saved yard never holds a
 * mushroom under a building. Nothing is written when none moves.
 *
 * @param save - The yard, mutated in place: `mushrooms` may change.
 * @param random - The spot source.
 * @returns How many mushrooms moved or, covered with no room, were removed.
 */
export const moveMushroomsOffBuildings = (
  save: MushroomYardSave,
  random: Random = Math.random
): number => {
  const { l, s } = readMushrooms(save.mushrooms);
  if (l.length === 0) return 0;

  const buildings = buildingRects(save.buildingdata);
  const rects = l.map(mushroomRect);
  const covered = rects.map((rect) => buildings.some((building) => overlaps(rect, building)));
  const crowded = rects.map((rect, index) => !covered[index] && !clearOf(rect, buildings));
  if (!covered.includes(true) && !crowded.includes(true)) return 0;

  const expansion = currentExpansion(save.storedata);
  // A crowded mushroom that cannot move keeps its ground, so it stays an
  // obstacle until it has found somewhere else.
  const obstacles: Obstacles = {
    buildings,
    mushrooms: rects.filter((_, index) => !covered[index]),
  };
  let changed = 0;
  const list: MushroomEntry[] = [];
  l.forEach((entry, index) => {
    if (!covered[index] && !crowded[index]) {
      list.push(entry);
      return;
    }
    if (crowded[index]) {
      const own = rects[index]!;
      const others = obstacles.mushrooms.filter((rect) => rect !== own);
      const spot = freeSpot({ buildings, mushrooms: others }, expansion, random, {
        attempts: NUDGE_ATTEMPTS,
        loose: false,
      });
      if (!spot) {
        list.push(entry);
        return;
      }
      const moved: MushroomEntry = [entry[0], spot[0], spot[1]];
      list.push(moved);
      obstacles.mushrooms = [...others, mushroomRect(moved)];
      changed++;
      return;
    }
    changed++;
    const spot = freeSpot(obstacles, expansion, random);
    if (!spot) return;
    const moved: MushroomEntry = [entry[0], spot[0], spot[1]];
    list.push(moved);
    obstacles.mushrooms.push(mushroomRect(moved));
  });

  if (changed === 0) return 0;
  save.mushrooms = { l: list, s };
  return changed;
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
  /**
   * During the Halloween pumpkin hunt (`season.ts`): the player's pumpkin
   * count for the event's ladder, this one included. Absent otherwise.
   */
  pumpkins?: number;
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
