import { monsterStats } from "../../game-data/stats/monsterStats.js";
import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * Rules for `POST /worldmapv2/transferassets` (issue #27).
 *
 * A transfer is **the counts moved** (`moved`, #196), applied as a delta onto
 * both yards' rosters as the server has them now: the source loses exactly
 * those monsters and the destination gains them, and every other monster on
 * either yard stays where it is. Flash posted two complete replacement
 * `monsters` blobs instead (`MapRoom.as:861-888`,
 * `docs/specs/monsters-and-hatchery.md` §9), and writing them — first verbatim,
 * which let a hand-made request duplicate an army (#27), then as whole
 * `housed` rosters — dropped any monster that hatched between the player's map
 * read and the transfer. Such a request is still accepted and turned into the
 * counts it moves ({@link movedFromBlobs}).
 *
 * Everything here is pure. The controller resolves the two saves, derives each
 * yard's housing capacity from its buildings, and asks {@link planMonsterTransfer}
 * for the two rosters to write, or the rule that refuses.
 *
 * ## Against the rosters as they are now
 *
 * The Flash map ticked hatchery production locally (`MapRoomCell.Tick` added
 * finished monsters to `housed`, `client/scripts/com/monsters/maproom_advanced/MapRoomCell.as:800-811`),
 * so a transfer could honestly claim monsters the server had not stored yet, and
 * the rules used to allow the stored hatchery queues on top of `housed`. The
 * server now replays production itself: the controller catches both yards up to
 * the moment of the transfer (`catchUpTransferYards`, `services/yard/armies.ts`)
 * before these rules read them, and the map shows rosters caught up the same way
 * (`monstersForMap`). Every monster the player can see is therefore in the
 * stored `housed`, a monster still in a hatchery is not housed anywhere, and
 * what may leave is checked against the stored rosters alone (#131,
 * `docs/design/yard-buildings.md` §11). A delta cannot create a monster, so
 * conservation holds by construction.
 */

/** Monster Housing, `#b_housing#` (`client/scripts/YARD_PROPS.as:1553-1662`). */
export const HOUSING_BUILDING_TYPE = 15;

/**
 * Housing Bunker, the Inferno yard's housing (`client/scripts/HOUSINGBUNKER.as`,
 * `INFERNOYARDPROPS.as:5995-6070`). `HOUSING` swaps to it wherever
 * `BASE.isInfernoMainYardOrOutpost` is true (`HOUSING.as:65`).
 */
export const HOUSING_BUNKER_BUILDING_TYPE = 128;

/**
 * Map Room 2 housing capacity by level, 1..6.
 *
 * Map Room 2 overrides the `YARD_PROPS` table at runtime — `_buildingProps[14]`
 * is building id 15, the array being zero-based (`client/scripts/GLOBAL.as:682`).
 * `getEffectiveLevel()` caps housing at 6 outside Map Room 3
 * (`client/scripts/BFOUNDATION.as:835-843`), which is why this table stops at six
 * entries while the Map Room 3 table runs to ten.
 *
 * Kept here rather than in `game-data/buildingCosts.ts`: that file is generated
 * from the cost tables and carries no capacity stats.
 */
export const MR2_HOUSING_CAPACITY = [200, 260, 320, 380, 450, 540];

/**
 * Housing Bunker capacity by level, 1..6
 * (`client/scripts/INFERNOYARDPROPS.as:6067`). Map Room 2 does not override it.
 */
export const HOUSING_BUNKER_CAPACITY = [200, 300, 520, 780, 1140, 1820];

/**
 * The "Housing Expansion" store item (`EXH`, `EXHI` in the Inferno) multiplies
 * each housing building's capacity while it is running
 * (`client/scripts/STORE.as:2423-2431`, `HOUSING.as:69-71`).
 */
export const HOUSING_EXPANSION_MULTIPLIER = 1.25;

/** `EXH` on the surface, `EXHI` in the Inferno (`STORE.as:2423-2431`). */
export const HOUSING_EXPANSION_ITEMS = ["EXH", "EXHI"];

/**
 * A housing building at or below this health is not counted towards capacity
 * (`client/scripts/HOUSING.as:66-67`).
 */
export const HOUSING_MIN_HEALTH = 10;

/** Which rule refused a transfer. Travels in `data.rule`, not in the message. */
export type TransferRule = "endpoints" | "quantities" | "holdings" | "capacity";

export interface TransferYard {
  /** `Save.baseid`, for the refusal detail only. */
  baseid: string;
  /** `Save.type` — which endpoints may trade is decided from this. */
  type: string;
  /** The `monsters` blob as stored on the save, caught up to now. */
  stored: JsonObject | null | undefined;
  /** Housing capacity derived from this yard's own buildings. */
  capacity: number;
}

export interface TransferInput {
  /** The yard named by `frombaseid`. Monsters may only leave it. */
  from: TransferYard;
  /** The yard named by `tobaseid`. Its housing has to fit the result. */
  to: TransferYard;
  /** The counts to move, `{ C1: 5 }`, as the client posted them. */
  moved: unknown;
  /**
   * The caller's Monster Academy level per monster id. Only `C1`'s housing space
   * varies by level (10, 10, 10, 9, 8, 7), but it varies downwards, so reading
   * the real level keeps a maxed player's army from being over-measured.
   */
  monsterLevels?: Record<string, number>;
}

export type TransferVerdict =
  | {
      ok: true;
      /** The source's `housed` after the move: its roster now, less what moved. */
      fromHoused: Record<string, number>;
      /** The destination's `housed` after the move: its roster now, plus what moved. */
      toHoused: Record<string, number>;
    }
  | { ok: false; rule: TransferRule; message: string; detail: Record<string, unknown> };

/** Counts keyed by monster id. */
type Counts = Record<string, number>;

/**
 * Housing space one of this monster costs, at the caller's Academy level
 * (`cStorage`, `docs/specs/monsters-and-hatchery.md` §2.2). Unknown ids cost
 * nothing, matching `CREATURES.GetProperty`'s catch-all return of 0.
 *
 * @param {string} id - Monster id, e.g. `C1`
 * @param {Record<string, number> | undefined} levels - Academy level per monster id
 * @returns {number} Housing space per monster
 */
export const monsterStorage = (id: string, levels?: Record<string, number>): number => {
  const table = monsterStats[id]?.props.cStorage;

  if (!table || table.length === 0) return 0;

  const level = Math.floor(Number(levels?.[id] ?? 1));
  const index = Math.min(Math.max(Number.isFinite(level) ? level : 1, 1), table.length) - 1;

  return table[index] ?? 0;
};

/**
 * Total housing space a roster occupies — `sum(cStorage × count)`, the same sum
 * `HOUSING.HousingSpace()` runs (`client/scripts/HOUSING.as:79-85`).
 *
 * @param {Counts} counts - Monster counts keyed by id
 * @param {Record<string, number> | undefined} levels - Academy level per monster id
 * @returns {number} Housing space used
 */
export const housingUsed = (counts: Counts, levels?: Record<string, number>): number =>
  Object.entries(counts).reduce(
    (total, [id, count]) => total + monsterStorage(id, levels) * count,
    0
  );

/**
 * Reads a yard's `housed` map out of a `monsters` blob.
 *
 * @param {unknown} blob - A `monsters` blob, stored or posted
 * @returns {Counts} Monster counts keyed by id; `{}` when the blob has no usable `housed`
 */
export const housedCounts = (blob: unknown): Counts => {
  const housed = (blob as JsonObject | null)?.housed;

  if (!housed || typeof housed !== "object" || Array.isArray(housed)) return {};

  const counts: Counts = {};

  for (const [id, value] of Object.entries(housed as JsonObject)) {
    const count = Number(value);

    if (Number.isFinite(count) && count !== 0) counts[id] = count;
  }

  return counts;
};

/**
 * The ids in a posted `housed` map whose count is not a non-negative integer.
 * Fractional and negative counts are the cheapest way to fake conservation, so
 * they are refused before any arithmetic runs.
 *
 * @param {unknown} blob - A posted `monsters` blob
 * @returns {string[]} Offending monster ids, empty when every count is sound
 */
export const badQuantities = (blob: unknown): string[] => {
  const housed = (blob as JsonObject | null)?.housed;

  if (housed === undefined || housed === null) return [];
  if (typeof housed !== "object" || Array.isArray(housed)) return ["housed"];

  const bad: string[] = [];

  for (const [id, value] of Object.entries(housed as JsonObject)) {
    const count = Number(value);

    if (!Number.isInteger(count) || count < 0) bad.push(id);
  }

  return bad;
};

/**
 * How many monsters of each type a cell can still finish without another save —
 * the monster in production on each hatchery, that hatchery's own queue, and the
 * shared Hatchery Control Center queue.
 *
 * `h` is one entry per hatchery, `[inProduction, countdownProduce]` with the
 * hatchery's own queue appended as a third element when non-empty; `hcc` is the
 * HCC's shared queue, as `[creatureId, count]` pairs
 * (`docs/specs/monsters-and-hatchery.md` §10, `client/scripts/BASE.as:2670-2685`).
 *
 * @param {unknown} blob - The `monsters` blob as stored on the save
 * @returns {Counts} Upper bound on monsters of each type the cell can still produce
 */
export const queuedProduction = (blob: unknown): Counts => {
  const monsters = blob as JsonObject | null;
  const queued: Counts = {};

  const add = (id: unknown, count: number) => {
    if (typeof id !== "string" || id === "") return;
    if (!Number.isFinite(count) || count <= 0) return;

    queued[id] = (queued[id] ?? 0) + Math.floor(count);
  };

  const addQueue = (queue: unknown) => {
    if (!Array.isArray(queue)) return;

    for (const entry of queue) {
      if (Array.isArray(entry)) add(entry[0], Number(entry[1]));
    }
  };

  if (Array.isArray(monsters?.h)) {
    for (const hatchery of monsters.h) {
      if (!Array.isArray(hatchery) || hatchery.length === 0) continue;

      add(hatchery[0], 1);
      addQueue(hatchery[2]);
    }
  }

  addQueue(monsters?.hcc);

  return queued;
};

/**
 * Housing capacity for one yard, derived from its own buildings rather than from
 * the client-written `space` field on its `monsters` blob.
 *
 * Mirrors `HOUSING.HousingSpace()` (`client/scripts/HOUSING.as:55-86`): every
 * housing building that has finished building and is above
 * {@link HOUSING_MIN_HEALTH}, at its effective level, times the Housing Expansion
 * multiplier when that power-up is running. Monster Bunkers do not count —
 * bunker space is a separate pool (`docs/specs/monsters-and-hatchery.md` §6.3) —
 * and neither do champions, which live in their own `champion` column.
 *
 * @param {object} yard - The yard's stored building state
 * @param {BuildingDataMap | null | undefined} yard.buildingData - `Save.buildingdata`
 * @param {BuildingHealthData | null | undefined} yard.healthData - `Save.buildinghealthdata`
 * @param {boolean} yard.housingExpansionActive - Whether `EXH`/`EXHI` is running
 * @param {boolean} yard.inferno - Whether this is an Inferno yard
 * @param {number} yard.minHealth - A building at or below this health counts nothing;
 *   {@link HOUSING_MIN_HEALTH} by default. The overflow cull counts every building
 *   still standing (health above 0, `client/scripts/HOUSING.as:167`).
 * @returns {number} Total housing capacity
 */
export const deriveHousingCapacity = ({
  buildingData,
  healthData,
  housingExpansionActive = false,
  inferno = false,
  minHealth = HOUSING_MIN_HEALTH,
}: {
  buildingData: BuildingDataMap | null | undefined;
  healthData?: BuildingHealthData | null;
  housingExpansionActive?: boolean;
  inferno?: boolean;
  minHealth?: number;
}): number => {
  if (!buildingData) return 0;

  const type = inferno ? HOUSING_BUNKER_BUILDING_TYPE : HOUSING_BUILDING_TYPE;
  const table = inferno ? HOUSING_BUNKER_CAPACITY : MR2_HOUSING_CAPACITY;

  let capacity = 0;

  for (const [key, building] of Object.entries(buildingData)) {
    if (!building || Number(building.t) !== type) continue;

    // Still under construction: the client skips it until `cB` runs out.
    if (Number(building.cB ?? 0) > 0) continue;

    const id = String(building.id ?? key);
    const health = healthData?.[id] ?? (building.hp as number | undefined);

    if (health !== undefined && Number(health) <= minHealth) continue;

    // `l` is only bumped when an upgrade finishes, so a building part-way through
    // one still houses at its old level, which is what the client counts too.
    const level = Math.min(Math.max(Math.floor(Number(building.l ?? 1)) || 1, 1), table.length);
    const perBuilding = table[level - 1] ?? 0;

    capacity += housingExpansionActive
      ? Math.trunc(perBuilding * HOUSING_EXPANSION_MULTIPLIER)
      : perBuilding;
  }

  return capacity;
};

/** Which base types may appear at either end of a transfer. */
const TRADEABLE_TYPES = new Set<string>([BaseType.MAIN, BaseType.OUTPOST]);

/**
 * The counts a pair of Flash-style replacement blobs moves, for a request that
 * posts `monsters` rather than `moved`: what the destination's posted roster
 * holds above its roster now. Where the destination hatched monsters after the
 * player's read, the gain reads short by them, so such a request can move
 * fewer than the player picked, never more, and loses nothing (#196).
 *
 * @param {TransferYard} to - The destination, caught up to now
 * @param {unknown} fromBlob - The posted source blob, checked for sound counts only
 * @param {unknown} toBlob - The posted destination blob
 * @returns {{ moved: Counts } | { bad: string[] }} The counts moved, or the ids whose counts are not sound
 */
export const movedFromBlobs = (
  to: TransferYard,
  fromBlob: unknown,
  toBlob: unknown
): { moved: Counts } | { bad: string[] } => {
  const bad = [...new Set([...badQuantities(fromBlob), ...badQuantities(toBlob)])];
  if (bad.length > 0) return { bad };

  const now = housedCounts(to.stored);
  const moved: Counts = {};
  for (const [id, count] of Object.entries(housedCounts(toBlob))) {
    const gain = count - (now[id] ?? 0);
    if (gain > 0) moved[id] = gain;
  }
  return { moved };
};

/**
 * Decides a monster transfer and works out what to write (#196).
 *
 * Ownership is checked by the controller before this runs — both yards already
 * belong to the caller. The move is `moved`, applied onto the two caught-up
 * rosters: the source must hold every monster it sends, and the destination
 * must be able to house what it ends up with, counting any monster that
 * reached it since the player looked.
 *
 * @param {TransferInput} input - The two yards, the counts to move and the caller's Academy levels
 * @returns {TransferVerdict} The two rosters to write, or the rule that refused with a player-readable message
 */
export const planMonsterTransfer = ({
  from,
  to,
  moved,
  monsterLevels,
}: TransferInput): TransferVerdict => {
  // 1. Endpoints. A yard cannot trade with itself, wild-monster and Inferno
  //    cells are not transfer endpoints, and the client only offers the flow to
  //    a player holding at least one outpost, so one end is always an outpost
  //    (`PopupInfoMine.as:80-84`, `docs/specs/monsters-and-hatchery.md` §9).
  if (from.baseid === to.baseid)
    return {
      ok: false,
      rule: "endpoints",
      message: "a yard cannot send monsters to itself.",
      detail: { baseid: from.baseid },
    };

  if (!TRADEABLE_TYPES.has(from.type) || !TRADEABLE_TYPES.has(to.type))
    return {
      ok: false,
      rule: "endpoints",
      message: "monsters can only move between your main yard and your outposts.",
      detail: { from: from.type, to: to.type },
    };

  if (from.type !== BaseType.OUTPOST && to.type !== BaseType.OUTPOST)
    return {
      ok: false,
      rule: "endpoints",
      message: "one end of a transfer has to be an outpost.",
      detail: { from: from.type, to: to.type },
    };

  // 2. Quantities. Non-negative whole numbers, and at least one monster.
  const bad = badQuantities({ housed: moved });

  if (bad.length > 0)
    return {
      ok: false,
      rule: "quantities",
      message: "that transfer is asking for a number of monsters that cannot exist.",
      detail: { monsters: bad },
    };

  const counts = housedCounts({ housed: moved });

  if (Object.keys(counts).length === 0)
    return {
      ok: false,
      rule: "quantities",
      message: "there are no monsters in that transfer.",
      detail: { monsters: [] },
    };

  // 3. Holdings. The source sends only what it houses now.
  const fromHoused = housedCounts(from.stored);
  const toHoused = housedCounts(to.stored);

  for (const [id, count] of Object.entries(counts)) {
    const held = fromHoused[id] ?? 0;

    if (count > held)
      return {
        ok: false,
        rule: "holdings",
        message: "that yard does not have those monsters to send.",
        detail: { monster: id, claimed: count, held },
      };
  }

  for (const [id, count] of Object.entries(counts)) {
    fromHoused[id] = (fromHoused[id] ?? 0) - count;
    if (fromHoused[id] === 0) delete fromHoused[id];
    toHoused[id] = (toHoused[id] ?? 0) + count;
  }

  // 4. Housing. The destination has to be able to house what it ends up with.
  const used = housingUsed(toHoused, monsterLevels);

  if (used > to.capacity)
    return {
      ok: false,
      rule: "capacity",
      message: "there is not enough Monster Housing at the destination.",
      detail: { used, capacity: to.capacity },
    };

  return { ok: true, fromHoused, toHoused };
};
