import { monsterStats } from "../../game-data/stats/monsterStats.js";
import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * Rules for `POST /worldmapv2/transferassets` (issue #27).
 *
 * The request is two **complete replacement** `monsters` blobs — one for the
 * source yard, one for the destination (`MapRoom.as:861-888`,
 * `docs/specs/monsters-and-hatchery.md` §9). Until now the server wrote both
 * verbatim, so a hand-made request could hand the destination a copy of the
 * source's army and leave the source untouched: monster duplication in one
 * request.
 *
 * Everything here is pure. The controller resolves the two saves, derives each
 * yard's housing capacity from its buildings, and asks {@link checkMonsterTransfer}
 * for a verdict.
 *
 * ## Why this is not a plain equality check
 *
 * The map ticks hatchery production locally: `MapRoomCell.Tick` replays the cell
 * forward from the stored blob's `saved` and **adds finished monsters to
 * `housed`** (`client/scripts/com/monsters/maproom_advanced/MapRoomCell.as:800-811`).
 * A yard last saved a year ago therefore shows the player more monsters than the
 * server stored, and an honest transfer of those monsters would fail a strict
 * `before === after` test.
 *
 * What bounds that replay is the hatchery work the stored blob already carries:
 * the map cannot enqueue anything, so a cell can only ever finish the monster in
 * production plus whatever sits in the per-hatchery queues and the shared
 * Hatchery Control Center queue. That finite set is the production allowance
 * below, capped again by how many of that type the yard could physically house.
 * Conservation is then enforced against `stored + allowance` instead of `stored`.
 *
 * The allowance is deliberate slack: the stored blob is itself client-written, so
 * a forged queue inflates it. It is bounded (never more than one yard-full of a
 * type per request) where today's hole is unbounded. Closing it completely needs
 * a server-side production replay, which is a separate piece of work.
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
export type TransferRule =
  | "endpoints"
  | "quantities"
  | "holdings"
  | "conservation"
  | "capacity";

export interface TransferYard {
  /** `Save.baseid`, for the refusal detail only. */
  baseid: string;
  /** `Save.type` — which endpoints may trade is decided from this. */
  type: string;
  /** The `monsters` blob as currently stored on the save. */
  stored: JsonObject | null | undefined;
  /** Housing capacity derived from this yard's own buildings. */
  capacity: number;
}

export interface TransferInput {
  /** The yard named by `frombaseid`. Monsters may only leave it. */
  from: TransferYard;
  /** The yard named by `tobaseid`. Its housing has to fit the result. */
  to: TransferYard;
  /** The replacement blob the client posted for `from`. */
  fromBlob: unknown;
  /** The replacement blob the client posted for `to`. */
  toBlob: unknown;
  /**
   * The caller's Monster Academy level per monster id. Only `C1`'s housing space
   * varies by level (10, 10, 10, 9, 8, 7), but it varies downwards, so reading
   * the real level keeps a maxed player's army from being over-measured.
   */
  monsterLevels?: Record<string, number>;
}

export type TransferVerdict =
  | { ok: true }
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
 * The production allowance for one yard: what its hatcheries can still finish,
 * capped by how many of that type its housing could hold at all. The cap is what
 * keeps a forged queue in a stored blob from becoming unlimited slack.
 *
 * @param {TransferYard} yard - The yard, with its stored blob and derived capacity
 * @param {Record<string, number> | undefined} levels - Academy level per monster id
 * @returns {Counts} Allowance per monster id
 */
export const productionAllowance = (
  yard: TransferYard,
  levels?: Record<string, number>
): Counts => {
  const allowance: Counts = {};

  for (const [id, queued] of Object.entries(queuedProduction(yard.stored))) {
    const storage = monsterStorage(id, levels);
    const housable = storage > 0 ? Math.floor(yard.capacity / storage) : 0;

    allowance[id] = Math.min(queued, housable);
  }

  return allowance;
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
 * @returns {number} Total housing capacity
 */
export const deriveHousingCapacity = ({
  buildingData,
  healthData,
  housingExpansionActive = false,
  inferno = false,
}: {
  buildingData: BuildingDataMap | null | undefined;
  healthData?: BuildingHealthData | null;
  housingExpansionActive?: boolean;
  inferno?: boolean;
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

    if (health !== undefined && Number(health) <= HOUSING_MIN_HEALTH) continue;

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
 * Every monster id mentioned by any of the four rosters, so each rule can walk
 * one list and miss nothing.
 *
 * @param {Counts[]} rosters - Any number of count maps
 * @returns {string[]} The union of their keys
 */
const allIds = (...rosters: Counts[]): string[] => [
  ...new Set(rosters.flatMap((roster) => Object.keys(roster))),
];

/**
 * Decides whether a monster transfer may be written.
 *
 * Ownership is checked by the controller before this runs — both yards already
 * belong to the caller. What is left is whether the two posted blobs describe a
 * move rather than a creation, and whether the destination can house the result.
 *
 * @param {TransferInput} input - The two yards, the two posted blobs and the caller's Academy levels
 * @returns {TransferVerdict} `{ ok: true }`, or the rule that refused with a player-readable message
 */
export const checkMonsterTransfer = ({
  from,
  to,
  fromBlob,
  toBlob,
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

  // 2. Quantities. Non-negative whole numbers only, on both blobs.
  const bad = [...badQuantities(fromBlob), ...badQuantities(toBlob)];

  if (bad.length > 0)
    return {
      ok: false,
      rule: "quantities",
      message: "that transfer is asking for a number of monsters that cannot exist.",
      detail: { monsters: [...new Set(bad)] },
    };

  const storedFrom = housedCounts(from.stored);
  const storedTo = housedCounts(to.stored);
  const nextFrom = housedCounts(fromBlob);
  const nextTo = housedCounts(toBlob);

  const allowFrom = productionAllowance(from, monsterLevels);
  const allowTo = productionAllowance(to, monsterLevels);

  const ids = allIds(storedFrom, storedTo, nextFrom, nextTo);

  // 3. Holdings. Monsters only ever leave the source in this flow
  //    (`MapRoom.as:839-841`), so the source may not end up holding more of a
  //    type than it could have had.
  for (const id of ids) {
    const held = (storedFrom[id] ?? 0) + (allowFrom[id] ?? 0);

    if ((nextFrom[id] ?? 0) > held)
      return {
        ok: false,
        rule: "holdings",
        message: "that yard does not have those monsters to send.",
        detail: { monster: id, claimed: nextFrom[id] ?? 0, held },
      };
  }

  // 4. Conservation. A transfer moves monsters; it never makes them.
  for (const id of ids) {
    const before =
      (storedFrom[id] ?? 0) + (storedTo[id] ?? 0) + (allowFrom[id] ?? 0) + (allowTo[id] ?? 0);
    const after = (nextFrom[id] ?? 0) + (nextTo[id] ?? 0);

    if (after > before)
      return {
        ok: false,
        rule: "conservation",
        message: "that transfer would create monsters out of nothing.",
        detail: { monster: id, before, after },
      };
  }

  // 5. Housing. The destination has to be able to house what it ends up with.
  const used = housingUsed(nextTo, monsterLevels);

  if (used > to.capacity)
    return {
      ok: false,
      rule: "capacity",
      message: "there is not enough Monster Housing at the destination.",
      detail: { used, capacity: to.capacity },
    };

  return { ok: true };
};
