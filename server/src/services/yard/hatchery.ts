import { hatchCost, hatchTime, housingSpace } from "../../game-data/monsterCatalogue.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap, type StorageCapSave } from "../base/economy/resourceBudget.js";
import {
  deriveHousingCapacity,
  HOUSING_EXPANSION_ITEMS,
  HOUSING_MIN_HEALTH,
} from "../monsters/transferRules.js";
import { obtainableOrThrow } from "./locker.js";
import {
  levelOf,
  readProduction,
  writeProduction,
  type HatcheryModel,
  type ProductionModel,
  type QueueStack,
} from "./production.js";
import { hatcheryFinishPrice } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Hatchery and Hatchery Control Centre routes: `POST /bm/yard/hatchery/add`,
 * `/remove`, `/finish` (`docs/design/yard-buildings.md` §4.4, issue #31;
 * `docs/specs/monsters-and-hatchery.md` §5).
 *
 * The queues live in `monsters` in production's format (`production.ts`):
 * each hatchery's own queue is `h[i][2]`, the HCC's shared queue `monsters.hcc`,
 * every stack `[id, count, paidLevel]`. This module reads them with
 * `readProduction`, changes the model and writes it back with
 * `writeProduction`, `saved = now` (the wrapper's catch-up has already walked
 * production up to `now`).
 *
 * The rules are the original popups', batched:
 *
 * - **Add** puts monsters in one at a time as `QueueAdd` did, until the count,
 *   the stack limit or the goo runs out. A hatchery's queue merges a monster
 *   into its **first** non-full stack of that monster, else opens a new stack
 *   while it has fewer than `1 + level` (`client/scripts/HATCHERYPOPUP.as:234-292`,
 *   MH §5.2 step 4). The HCC's queue merges only into its **last** stack, else
 *   opens a new one while it has fewer than 7 (`HATCHERYCCPOPUP.as:302-350`).
 *   Stacks hold 20. A stack also carries the academy level whose price was
 *   paid, and merges only with a stack paid at the same level (§10 Q2). Each
 *   monster costs `hatchCost(id, academy level)` goo.
 * - **Remove** takes monsters off one stack, or the one in production, for the
 *   goo paid (`HATCHERYPOPUP.as:300-326`; with an HCC, `HATCHERYCCPOPUP.as:405-459`).
 * - **Finish** houses what fits for `timeCost(total, false) × 4` Shiny
 *   (`BUILDING13.as:268-413`, `BUILDING16.as:96-237`).
 *
 * Once an HCC has finished building it replaces the hatchery queues
 * (`BUILDING16.as:238-255`, `BUILDINGINFO.as:192-194`): add and finish accept
 * only `hcc`, and a hatchery is named only to cancel its monster in production
 * (the × on its tile). Until then `hcc` is refused. A hatchery that is damaged
 * or still being built accepts queue changes, as the original popup did; it
 * just does not produce.
 *
 * Everything here is pure: it reads the caught-up save the yard action wrapper
 * hands it and returns what should change, or throws the refusal. The wrapper
 * charges the goo and the Shiny, clamps refunds to the cap and writes.
 */

/** Hatchery type id (`client/scripts/YARD_PROPS.as:1215`). */
export const HATCHERY_TYPE = 13;

/** Hatchery Control Centre type id (`YARD_PROPS.as:1663`). */
export const HCC_TYPE = 16;

/** Monsters per stack, hatchery and HCC alike (`HATCHERYPOPUP.as:255`, `HATCHERYCC.queueLimit`). */
export const STACK_SIZE = 20;

/** Stacks in the HCC's shared queue (`HATCHERYCCPOPUP.as:323`). */
export const HCC_STACKS = 7;

/** The most one add request may ask for: five level-3 hatcheries' worth (5 × 80). */
export const MAX_ADD = 400;

/** Goo is the fourth resource (`BASE.Charge(4, …)`). */
const GOO = "r4";

/** The overdrive store items, one at a time (MH §5.5). */
export const OVERDRIVE_ITEMS = ["HOD", "HOD2", "HOD3"] as const;

/** A hatchery, or the HCC's shared queue. */
export type HatcheryTarget = number | "hcc";

/** The slice of a save the hatchery routes read. */
export interface HatcherySave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  monsters?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
  storedata?: JsonObject | null;
}

/** A finite number off a jsonb field, 0 otherwise. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** Academy level per monster id, from the `academy` column. */
export const academyLevels = (academy: JsonObject | null | undefined): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(academy ?? {})) {
    const level = Math.floor(Number((entry as JsonObject | null)?.level));
    if (Number.isFinite(level) && level >= 1) levels[id] = level;
  }
  return levels;
};

/** Every building of `type`, keyed by building id. */
const buildingsOfType = (save: HatcherySave, type: number): [number, BuildingData][] =>
  Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === type)
    .map(([key, building]): [number, BuildingData] => [Number(building.id ?? key), building])
    .filter(([id]) => Number.isFinite(id));

/** A building's health: `buildinghealthdata` first, then its own `hp`; undefined at full. */
const healthOf = (save: HatcherySave, id: number, building: BuildingData): number | undefined => {
  const health = save.buildinghealthdata?.[String(id)] ?? building.hp;
  return health === undefined || health === null ? undefined : Number(health);
};

const underConstruction = (building: BuildingData): boolean => numberOf(building.cB) > 0;

/**
 * The hatcheries in service order, the order the HCC hands out in
 * (`BUILDING16.as:96-137`): the stored `hid` order first, then any new ones
 * by id, as the catch-up orders them.
 */
export const hatcheryIds = (save: HatcherySave): number[] => {
  const ids = buildingsOfType(save, HATCHERY_TYPE).map(([id]) => id);
  const present = new Set(ids);
  const hid: unknown[] = Array.isArray(save.monsters?.hid) ? save.monsters.hid : [];
  const stored = hid.map(Number).filter((id, i, all) => present.has(id) && all.indexOf(id) === i);
  const rest = ids.filter((id) => !stored.includes(id)).sort((a, b) => a - b);
  return [...stored, ...rest];
};

/** The yard's HCC building, or null. */
const hccOf = (save: HatcherySave): [number, BuildingData] | null =>
  buildingsOfType(save, HCC_TYPE)[0] ?? null;

/** True once an HCC has finished building: it has replaced the hatchery queues (`BUILDING16.as:287-294`). */
export const hccPresent = (save: HatcherySave): boolean => {
  const hcc = hccOf(save);
  return hcc !== null && !underConstruction(hcc[1]);
};

/** The HCC hands out work while built with health above 10 (`BUILDING16.as:107`). */
const hccWorks = (save: HatcherySave): boolean => {
  const hcc = hccOf(save);
  if (!hcc || underConstruction(hcc[1])) return false;
  const health = healthOf(save, hcc[0], hcc[1]);
  return health === undefined || health > HOUSING_MIN_HEALTH;
};

/** A hatchery's building, or undefined. */
const hatcheryBuilding = (save: HatcherySave, id: number): BuildingData | undefined =>
  buildingsOfType(save, HATCHERY_TYPE).find(([found]) => found === id)?.[1];

/**
 * Why a hatchery cannot work right now, or null when it can: the original's
 * `_canFunction`, built and at least half health (`BUILDING13.as:262-267`).
 * An upgrade does not stop it taking work or finishing now; the countdown
 * pauses during one, which is the catch-up's business.
 */
const hatcheryIdle = (save: HatcherySave, id: number): "busy" | "damaged" | null => {
  const building = hatcheryBuilding(save, id);
  if (!building || underConstruction(building)) return "busy";
  const health = healthOf(save, id, building);
  const level = Math.max(1, Math.floor(numberOf(building.l)) || 1);
  if (health !== undefined && health < maxHp(HATCHERY_TYPE, level) * 0.5) return "damaged";
  return null;
};

/**
 * Stacks a hatchery's queue may hold: `1 + level` (`HATCHERYPOPUP.as:241`). A
 * hatchery still being built is level 0 unless it is a prefab
 * (`client/scripts/BFOUNDATION.as:3053-3057`, `:3121-3123`), so it takes one stack.
 */
const stackLimit = (building: BuildingData): number => {
  const level = underConstruction(building)
    ? Math.floor(numberOf(building.prefab))
    : Math.floor(numberOf(building.l)) || 1;
  return 1 + Math.max(0, level);
};

/** Seconds to hatch `id` at its academy level, at least 1 (as `production.ts` counts). */
const hatchSeconds = (id: string, levels: Readonly<Record<string, number>>): number =>
  Math.max(1, Math.ceil(hatchTime(id, levelOf(levels, id)) ?? 1));

/** Housing space `id` takes at its academy level. */
const spaceOf = (id: string, levels: Readonly<Record<string, number>>): number =>
  housingSpace(id, levelOf(levels, id)) ?? 0;

/** Goo one `id` cost at the paid academy `level`. */
const gooOf = (id: string, level: number): number => hatchCost(id, level) ?? 0;

/** Starts the head of `queue` on an idle hatchery; false when the queue is empty. */
const startNext = (
  hatchery: HatcheryModel,
  queue: QueueStack[],
  levels: Readonly<Record<string, number>>
): boolean => {
  const head = queue[0];
  if (!head) return false;
  head[1] -= 1;
  if (head[1] <= 0) queue.shift();
  Object.assign(hatchery, {
    monster: head[0],
    paidLevel: head[2],
    countdown: hatchSeconds(head[0], levels),
    stage: 1,
  });
  return true;
};

/** Leaves a hatchery idle. */
const clear = (hatchery: HatcheryModel) =>
  Object.assign(hatchery, { monster: "", countdown: 0, stage: 0, paidLevel: 0 });

/**
 * The HCC's hand-out: every idle hatchery that can work takes the head of the
 * shared queue, in service order (`BUILDING16.as:107-134`).
 */
const handOut = (
  save: HatcherySave,
  model: ProductionModel,
  levels: Readonly<Record<string, number>>
) => {
  if (!hccWorks(save)) return;
  for (const hatchery of model.hatcheries) {
    if (hatchery.monster === "" && hatcheryIdle(save, hatchery.id) === null) {
      startNext(hatchery, model.hcc, levels);
    }
  }
};

/** What a goo credit actually adds once the storage cap has had its say (the wrapper's clamp, T3). */
const creditedGoo = (save: HatcherySave, amount: number): number => {
  const held = numberOf(save.resources?.[GOO]);
  return Math.max(held, Math.min(held + amount, storageCap(save))) - held;
};

/**
 * True for a Map Room 3 `monsters` blob (per-creep arrays under monster ids,
 * MH §10), which the Map Room 2 queue format must not overwrite.
 */
const isMapRoom3Monsters = (monsters: JsonObject | null | undefined): boolean =>
  Array.isArray(monsters?.Q) ||
  Object.entries(monsters ?? {}).some(
    ([key, value]) => /^I?C\d+$/.test(key) && Array.isArray(value)
  );

/** The state every route starts from. */
const modelOf = (save: HatcherySave) => {
  if (isMapRoom3Monsters(save.monsters)) {
    throw yardRefusedErr("mapRoom3", "Hatcheries on a Map Room 3 yard are not supported yet.");
  }
  const levels = academyLevels(save.academy);
  const model = readProduction(save.monsters, hatcheryIds(save), levels);
  return { levels, model };
};

/** `409 noHatchery { id }`: the yard has no hatchery with that id. */
const noHatcheryErr = (id: number) =>
  yardRefusedErr("noHatchery", "There is no hatchery there.", { id });

/**
 * Resolves the route's `hatchery` field against the yard: `409 noHcc` for
 * `hcc` without a finished HCC; `409 noHatchery { id }` for an id that is not
 * a hatchery; `409 useHcc` for a hatchery once an HCC has replaced the queues,
 * unless `hatcheryWithHcc` (cancelling its monster in production).
 */
const targetOf = (
  save: HatcherySave,
  model: ProductionModel,
  target: HatcheryTarget,
  hatcheryWithHcc = false
): { hcc: true } | { hcc: false; hatchery: HatcheryModel; building: BuildingData } => {
  const hcc = hccPresent(save);
  if (target === "hcc") {
    if (!hcc) throw yardRefusedErr("noHcc", "Build a Hatchery Control Centre first.");
    return { hcc: true };
  }

  const building = hatcheryBuilding(save, target);
  const hatchery = model.hatcheries.find((found) => found.id === target);
  if (!building || !hatchery) throw noHatcheryErr(target);
  if (hcc && !hatcheryWithHcc) {
    throw yardRefusedErr(
      "useHcc",
      "Your Hatchery Control Centre runs the queue for every hatchery.",
      { id: target }
    );
  }
  return { hcc: false, hatchery, building };
};

/** `report` of `POST /bm/yard/hatchery/add`. */
export interface HatcheryAddReport {
  hatchery: HatcheryTarget;
  monster: string;
  /** How many went into the queue. */
  added: number;
  /** How many were asked for. */
  requested: number;
  /** Why it stopped short: `queue` (no stack room), `goo`, or null when all were added. */
  stoppedBy: null | "queue" | "goo";
  /** Goo charged. */
  cost: { r4: number };
}

/** `report` of `POST /bm/yard/hatchery/remove`. */
export interface HatcheryRemoveReport {
  hatchery: HatcheryTarget;
  slot: number;
  monster: string;
  removed: number;
  /** Goo actually returned, after the storage cap. */
  refund: { r4: number };
}

/** `report` of `POST /bm/yard/hatchery/finish`. */
export interface HatcheryFinishReport {
  hatchery: HatcheryTarget;
  /** Monsters moved into housing, by id. */
  housed: Record<string, number>;
  /** Shiny charged. */
  credits: number;
  /** True when nothing the finish covers is left waiting; false when housing ran out first. */
  finishedAll: boolean;
}

/**
 * Puts one monster into a queue by the building's rule, or returns false when
 * there is no room. A hatchery's queue fills its first non-full stack of the
 * same monster and paid level; the HCC's only its last stack.
 */
const push = (
  queue: QueueStack[],
  id: string,
  level: number,
  limit: number,
  hcc: boolean
): boolean => {
  const same = (stack: QueueStack | undefined) =>
    stack !== undefined && stack[0] === id && stack[2] === level && stack[1] < STACK_SIZE;
  const stack = hcc ? (same(queue.at(-1)) ? queue.at(-1) : undefined) : queue.find(same);
  if (stack) {
    stack[1] += 1;
    return true;
  }
  if (queue.length >= limit) return false;
  queue.push([id, 1, level]);
  return true;
};

/**
 * Adds up to `count` of `monster` to a hatchery's queue or the HCC's, one at a
 * time, until the count, the stack room or the goo runs out; partial by
 * design. Each costs `hatchCost(monster, academy level)`, stored on its stack
 * as the paid level. After each one, as after each click, an idle hatchery
 * starts the head of its queue (`HATCHERYPOPUP.as:284-286`), or with an HCC
 * the idle hatcheries that can work take from the shared queue
 * (`HATCHERYCCPOPUP.as:349`), so an idle level 3 hatchery takes 81: one in
 * production and four stacks of 20.
 *
 * Refusals: `400 badRequest` not an obtainable monster; `409 locked` not
 * unlocked (`lockerdata[id].t != 2`); then the target's (see `targetOf`).
 */
export const planHatcheryAdd = (
  save: HatcherySave,
  target: HatcheryTarget,
  monster: string,
  count: number,
  now: number
) => {
  obtainableOrThrow(monster);
  if (Number(save.lockerdata?.[monster]?.t) !== 2) {
    throw yardRefusedErr("locked", "Unlock that monster in the Monster Locker first.", {
      monster,
    });
  }
  const requested = Math.floor(count);
  if (!(requested >= 1 && requested <= MAX_ADD)) {
    throw yardBadRequestErr(`Add between 1 and ${MAX_ADD} at a time.`, { count });
  }

  const { levels, model } = modelOf(save);
  const resolved = targetOf(save, model, target);
  const queue = resolved.hcc ? model.hcc : resolved.hatchery.queue;
  const limit = resolved.hcc ? HCC_STACKS : stackLimit(resolved.building);

  const level = levelOf(levels, monster);
  const price = gooOf(monster, level);
  const goo = numberOf(save.resources?.[GOO]);

  let added = 0;
  let stoppedBy: HatcheryAddReport["stoppedBy"] = null;
  while (added < requested) {
    // The goo is tested before the queue, as `QueueAdd` did.
    if ((added + 1) * price > goo) {
      stoppedBy = "goo";
      break;
    }
    if (!push(queue, monster, level, limit, resolved.hcc)) {
      stoppedBy = "queue";
      break;
    }
    added += 1;
    // What each single add did next, so a batch fills exactly as clicks did.
    if (resolved.hcc) handOut(save, model, levels);
    else if (resolved.hatchery.monster === "") startNext(resolved.hatchery, queue, levels);
  }

  const cost = added * price;
  const report: HatcheryAddReport = {
    hatchery: target,
    monster,
    added,
    requested,
    stoppedBy,
    cost: { r4: cost },
  };
  if (added === 0) return { report };

  return {
    report,
    slices: { monsters: writeProduction(save.monsters, model, now) },
    debit: { r4: cost },
  };
};

/**
 * Takes monsters out: `slot` 0 is the monster in production (one, whatever
 * `count` says), `slot` n ≥ 1 the n-th stack of the queue, `count` of it or
 * `all`. The goo paid comes back (the stack's paid level), clamped to the
 * cap. Removing the monster in production starts the next one: from the
 * hatchery's own queue, or with an HCC from the shared queue
 * (`HATCHERYPOPUP.as:320-323`, `HATCHERYCCPOPUP.as:440-459`).
 *
 * `hatchery` = `hcc` names the shared queue (slot ≥ 1); a hatchery id with an
 * HCC present names only its slot 0. Refusals: the target's, then
 * `409 noSlot { slot }` for an empty slot.
 */
export const planHatcheryRemove = (
  save: HatcherySave,
  target: HatcheryTarget,
  slot: number,
  count: number | "all",
  now: number
) => {
  const { levels, model } = modelOf(save);
  const resolved = targetOf(save, model, target, slot === 0);
  const noSlot = () => yardRefusedErr("noSlot", "There is nothing in that slot.", { slot });

  let monster: string;
  let removed: number;
  let goo: number;

  if (slot === 0) {
    if (resolved.hcc || resolved.hatchery.monster === "") throw noSlot();
    const { hatchery } = resolved;
    monster = hatchery.monster;
    removed = 1;
    goo = gooOf(monster, hatchery.paidLevel);
    clear(hatchery);
    if (!startNext(hatchery, hatchery.queue, levels)) handOut(save, model, levels);
  } else {
    const queue = resolved.hcc ? model.hcc : resolved.hatchery.queue;
    const stack = queue[slot - 1];
    if (!stack) throw noSlot();
    monster = stack[0];
    removed = count === "all" ? stack[1] : Math.min(Math.floor(count), stack[1]);
    goo = removed * gooOf(monster, stack[2]);
    stack[1] -= removed;
    if (stack[1] <= 0) queue.splice(slot - 1, 1);
  }

  const report: HatcheryRemoveReport = {
    hatchery: target,
    slot,
    monster,
    removed,
    refund: { r4: creditedGoo(save, goo) },
  };
  return {
    report,
    slices: { monsters: writeProduction(save.monsters, model, now) },
    credit: { r4: goo },
  };
};

/** Free housing space right now (`HOUSING._housingSpace`): capacity, EXH included, less the army. */
export const freeHousing = (
  save: HatcherySave,
  housed: Readonly<Record<string, number>>,
  levels: Readonly<Record<string, number>>,
  now: number
): number => {
  const capacity = deriveHousingCapacity({
    buildingData: save.buildingdata,
    healthData: save.buildinghealthdata,
    housingExpansionActive: HOUSING_EXPANSION_ITEMS.some(
      (item) => numberOf(save.storedata?.[item]?.e) > now
    ),
  });
  const used = Object.entries(housed).reduce(
    (total, [id, count]) => total + spaceOf(id, levels) * count,
    0
  );
  return capacity - used;
};

/**
 * Houses whole stacks from the head of `queue` while they fit, then as many
 * of the next as fit, and stops there (`BUILDING13.as:363-382`). Returns the
 * seconds of production skipped.
 */
const houseQueue = (
  queue: QueueStack[],
  room: { free: number },
  housed: Record<string, number>,
  moved: Record<string, number>,
  levels: Readonly<Record<string, number>>
): number => {
  let seconds = 0;
  while (queue.length > 0) {
    const head = queue[0]!;
    const space = spaceOf(head[0], levels);
    const fits = space > 0 ? Math.min(head[1], Math.floor(room.free / space)) : head[1];
    if (fits > 0) {
      housed[head[0]] = (housed[head[0]] ?? 0) + fits;
      moved[head[0]] = (moved[head[0]] ?? 0) + fits;
      room.free -= fits * space;
      seconds += fits * hatchSeconds(head[0], levels);
      head[1] -= fits;
    }
    if (head[1] > 0) break;
    queue.shift();
  }
  return seconds;
};

/**
 * Finishes production now, housing what fits (`FinishNow`, `BUILDING13.as:349-413`;
 * with an HCC `BUILDING16.as:179-237`), for `timeCost(total, false) × 4`
 * Shiny, `total` being the seconds skipped: what was left on each monster in
 * production that is housed plus `cTime` for each queued monster housed.
 *
 * - A hatchery: its monster in production first (if that does not fit,
 *   nothing does), then its queue from the head; the next queued monster then
 *   starts. It must be able to work.
 * - `hcc`: every working hatchery's monster in production, in service order,
 *   then the shared queue from the head; idle hatcheries then take the next.
 *
 * Refusals: the target's; `409 busy { id }` / `409 damaged { id }` for a
 * hatchery being built or below half health (for `hcc`, `409 damaged` below
 * 11 health); `409 nothingToFinish`; `409 housingFull { free }` when nothing
 * fits; then the wrapper's `shinyLocked` / `credits`.
 */
export const planHatcheryFinish = (save: HatcherySave, target: HatcheryTarget, now: number) => {
  const { levels, model } = modelOf(save);
  const resolved = targetOf(save, model, target);
  const housed = { ...model.housed };
  const moved: Record<string, number> = {};
  const room = { free: freeHousing(save, housed, levels, now) };
  const free = room.free;
  let seconds = 0;

  /** Houses a hatchery's monster in production if it fits. */
  const houseProducing = (hatchery: HatcheryModel): boolean => {
    const space = spaceOf(hatchery.monster, levels);
    if (room.free < space) return false;
    housed[hatchery.monster] = (housed[hatchery.monster] ?? 0) + 1;
    moved[hatchery.monster] = (moved[hatchery.monster] ?? 0) + 1;
    room.free -= space;
    seconds += hatchery.stage === 2 ? 0 : hatchery.countdown;
    clear(hatchery);
    return true;
  };

  let finishedAll: boolean;
  let waiting: boolean;

  if (resolved.hcc) {
    if (!hccWorks(save)) {
      throw yardRefusedErr("damaged", "Repair the Hatchery Control Centre first.", {
        id: hccOf(save)?.[0],
      });
    }
    const working = model.hatcheries.filter((hatchery) => hatcheryIdle(save, hatchery.id) === null);
    waiting = model.hcc.length > 0 || working.some((hatchery) => hatchery.monster !== "");
    for (const hatchery of working) if (hatchery.monster !== "") houseProducing(hatchery);
    seconds += houseQueue(model.hcc, room, housed, moved, levels);
    finishedAll = model.hcc.length === 0 && working.every((hatchery) => hatchery.monster === "");
    handOut(save, model, levels);
  } else {
    const { hatchery } = resolved;
    const why = hatcheryIdle(save, hatchery.id);
    if (why === "busy") {
      throw yardRefusedErr("busy", "This hatchery is still being built.", { id: hatchery.id });
    }
    if (why === "damaged") {
      throw yardRefusedErr("damaged", "Repair this hatchery first.", { id: hatchery.id });
    }
    // A queue behind an idle hatchery starts first, as adding to it would have.
    if (hatchery.monster === "") startNext(hatchery, hatchery.queue, levels);
    waiting = hatchery.monster !== "";
    if (waiting && houseProducing(hatchery)) {
      seconds += houseQueue(hatchery.queue, room, housed, moved, levels);
      startNext(hatchery, hatchery.queue, levels);
    }
    finishedAll = hatchery.monster === "" && hatchery.queue.length === 0;
  }

  if (!waiting) throw yardRefusedErr("nothingToFinish", "Nothing is being hatched there.");
  if (Object.keys(moved).length === 0) {
    throw yardRefusedErr("housingFull", "Your housing is full.", { free });
  }

  model.housed = housed;
  const credits = hatcheryFinishPrice(seconds);
  const report: HatcheryFinishReport = { hatchery: target, housed: moved, credits, finishedAll };
  return {
    report,
    slices: { monsters: writeProduction(save.monsters, model, now) },
    shiny: credits,
  };
};

/**
 * The shop's extra rule for `HOD`/`HOD2`/`HOD3`: one hatchery overdrive at a
 * time (they do not stack, MH §5.5). `409 alreadyActive { item, endsAt }`
 * names the one running.
 */
export const overdriveGate = (storedata: JsonObject | null | undefined, now: number): void => {
  for (const item of OVERDRIVE_ITEMS) {
    const endsAt = numberOf(storedata?.[item]?.e);
    if (endsAt > now) {
      throw yardRefusedErr("alreadyActive", "A Hatchery Overdrive is already running.", {
        item,
        endsAt,
      });
    }
  }
};
