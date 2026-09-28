import type { BaseLoadResponse, BuildingData, StoreData } from "@/api/types";
import { maxHp } from "@/game/combat/rules";
import { timeCost } from "@/game/yard/buildingCosts";
import { acceleratedEnd, overdriveAt, savedAtOf } from "@/game/yard/jobs";
import { academyLevel, housingCapacity } from "./housingSummary";
import {
  hatchCost,
  hatchTime,
  housingSpace,
  LISTED_MONSTERS,
  monsterEntry,
  type MonsterEntry,
} from "./monsterCatalogue";

/**
 * What the Hatch tab shows, as data (`docs/design/yard-buildings.md` §4.4).
 *
 * The tab draws; this decides. It reads the hatcheries out of the save the
 * way the server's `readProduction` does (`server/src/services/yard/production.ts`)
 * and replays the server's add rules (`planHatcheryAdd`,
 * `server/src/services/yard/hatchery.ts`) to say how many monsters a queue
 * has room for, where they would go, and what Fill should put in the box.
 * Every number here is a preview: the routes charge and place by their own
 * copy of the rules, and the tab redraws from their answer.
 *
 * The rules replayed, all the original's:
 *
 * - A hatchery's queue holds `1 + level` stacks of 20 and puts a monster into
 *   its **first** non-full stack of the same monster; the HCC's shared queue
 *   holds 7 stacks and merges only into its **last** stack. Either way a stack
 *   merges only with one paid at the same academy level (§10 Q2).
 * - A batch goes in as clicks did: after each monster an idle hatchery starts
 *   the head of its queue, so an idle level 3 hatchery takes 81 (one in
 *   production and four stacks of 20); with an HCC, every idle hatchery that
 *   can work takes from the shared queue after each one.
 * - Goo is tested before the stack room.
 */

/** Hatchery and Hatchery Control Centre type ids (`client/scripts/YARD_PROPS.as`). */
export const HATCHERY_TYPE = 13;
export const HCC_TYPE = 16;

/** Monsters per stack, hatchery and HCC alike. */
export const STACK_SIZE = 20;

/** Stacks in the HCC's shared queue (`client/scripts/HATCHERYCCPOPUP.as:323`). */
export const HCC_STACKS = 7;

/** The most one add request may ask for (`MAX_ADD` on the server). */
export const MAX_ADD = 400;

/** An HCC at or below this health hands out nothing (`client/scripts/BUILDING16.as:107`). */
const HCC_MIN_HEALTH = 10;

/** The Hatchery Overdrives, one at a time (`server/src/game-data/store/storeItems.ts`, MH §5.5). */
export const HATCHERY_OVERDRIVES = [
  { item: "HOD", power: 4, price: 30 },
  { item: "HOD2", power: 6, price: 50 },
  { item: "HOD3", power: 10, price: 100 },
] as const;

export type OverdriveItem = (typeof HATCHERY_OVERDRIVES)[number]["item"];

/** A queue stack: monster id, how many, the academy level whose price was paid. */
export type QueueStack = [id: string, count: number, level: number];

/** A queue target: a hatchery's building id, or the HCC's shared queue. */
export type HatchTarget = number | "hcc";

/** What a hatchery chip says it is doing. */
export type HatcheryState =
  | "building"
  | "damaged"
  | "upgrading"
  | "stalled"
  | "producing"
  | "idle";

/** One hatchery as the tab draws it. */
export interface HatcheryView {
  readonly id: number;
  /** Its level; 0 while it is being built (unless it is a prefab). */
  readonly level: number;
  /** The monster in production, or null when idle. */
  monster: string | null;
  /** Academy level the monster in production was paid at; 0 when idle. */
  paidLevel: number;
  /** Seconds of 1x work left on it at `saved`; 0 when idle or stalled. */
  countdown: number;
  /** 0 idle, 1 producing, 2 finished and waiting for housing. */
  stage: 0 | 1 | 2;
  /** Its own queue; empty once an HCC runs the queue. */
  readonly queue: QueueStack[];
  /** Stacks its own queue may hold: `1 + level`. */
  readonly stackLimit: number;
  /** Built and at least half health: it takes work (the server's `hatcheryIdle`). */
  readonly canTake: boolean;
  /** It counts down now: it takes work and is not upgrading (the catch-up's rule). */
  readonly works: boolean;
  readonly state: HatcheryState;
  /** When the monster in production is done, server clock; null when nothing counts down. */
  readonly endsAt: number | null;
}

/** The yard's hatcheries, read once per draw. */
export interface HatchYard {
  /** In service order: `hid` first, then new ones by id. */
  readonly hatcheries: HatcheryView[];
  /** The finished HCC, or null: once it exists its queue replaces the hatcheries'. */
  readonly hcc: { readonly id: number; readonly works: boolean } | null;
  /** The HCC's shared queue. */
  readonly shared: QueueStack[];
  /** Housed monsters, whole counts. */
  readonly housed: Readonly<Record<string, number>>;
  /** Academy level per monster id. */
  readonly levels: Readonly<Record<string, number>>;
  /** Housing capacity now. */
  readonly capacity: number;
  /** Goo held. */
  readonly goo: number;
}

/** The legacy id the original rewrote on sight (`client/scripts/BUILDING13.as:225-227`). */
const LEGACY_IDS: Readonly<Record<string, string>> = { C100: "C12" };

const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return raw != null && Number.isFinite(value) ? value : null;
};

const whole = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

const monsterIdOf = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw === "") return null;
  const id = LEGACY_IDS[raw] ?? raw;
  return monsterEntry(id) ? id : null;
};

/** Academy level of `id` in a levels table, 1 when absent. */
const levelIn = (levels: Readonly<Record<string, number>>, id: string): number => levels[id] ?? 1;

/** Academy level per monster id, from the `academy` column. */
export const academyLevels = (save: Pick<BaseLoadResponse, "academy">): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const id of Object.keys(save.academy ?? {})) levels[id] = academyLevel(save.academy, id);
  return levels;
};

/** Goo one `id` costs at academy `level`. */
export const priceOf = (id: string, level: number): number => hatchCost(id, level) ?? 0;

/** Housing space one `id` takes at academy `level`. */
export const spaceOf = (id: string, level: number): number => housingSpace(id, level) ?? 0;

/** Seconds to hatch one `id` at academy `level`, at least 1 (as the server counts). */
export const secondsOf = (id: string, level: number): number =>
  Math.max(1, Math.ceil(hatchTime(id, level) ?? 1));

/** A queue, normalised as the server reads it: a two-element stack is paid at today's level. */
const readQueue = (raw: unknown, levels: Readonly<Record<string, number>>): QueueStack[] => {
  if (!Array.isArray(raw)) return [];
  const queue: QueueStack[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const id = monsterIdOf(entry[0]);
    const count = whole(entry[1]);
    if (!id || count === 0) continue;
    const paid = whole(entry[2]);
    queue.push([id, count, paid > 0 ? paid : levelIn(levels, id)]);
  }
  return queue;
};

const buildingsOfType = (save: BaseLoadResponse, type: number): [number, BuildingData][] =>
  Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === type)
    .map(([key, building]): [number, BuildingData] => [Number(building.id ?? key), building])
    .filter(([id]) => Number.isFinite(id));

const healthOf = (save: BaseLoadResponse, id: number, building: BuildingData): number | null =>
  finite(save.buildinghealthdata?.[String(id)] ?? building.hp);

const underConstruction = (building: BuildingData): boolean => (finite(building.cB) ?? 0) > 0;

/** The hatcheries in service order, as the server orders them: `hid` first, then new ones by id. */
const serviceOrder = (save: BaseLoadResponse): [number, BuildingData][] => {
  const all = buildingsOfType(save, HATCHERY_TYPE);
  const byId = new Map(all);
  const hid: unknown[] = Array.isArray(save.monsters?.hid) ? save.monsters.hid : [];
  const stored = hid
    .map(Number)
    .filter((id, i, list) => byId.has(id) && list.indexOf(id) === i);
  const rest = all
    .map(([id]) => id)
    .filter((id) => !stored.includes(id))
    .sort((a, b) => a - b);
  return [...stored, ...rest].map((id) => [id, byId.get(id)!]);
};

/**
 * The yard's hatcheries, HCC and queues, as the server reads them, with each
 * hatchery's state and the end of its countdown on the server clock.
 */
export const readHatchYard = (save: BaseLoadResponse, now: number): HatchYard => {
  const levels = academyLevels(save);
  const monsters = save.monsters;
  const h: unknown[] = Array.isArray(monsters?.h) ? monsters.h : [];
  const hid: unknown[] = Array.isArray(monsters?.hid) ? monsters.hid : [];
  const hstage: unknown[] = Array.isArray(monsters?.hstage) ? monsters.hstage : [];
  const stored = new Map<number, { entry: unknown[]; stage: number }>();
  for (let i = 0; i < Math.min(h.length, hid.length); i++) {
    const id = Number(hid[i]);
    const entry = h[i];
    if (!Number.isFinite(id) || stored.has(id)) continue;
    stored.set(id, { entry: Array.isArray(entry) ? entry : [], stage: Number(hstage[i] ?? 0) });
  }

  const from = finite(monsters?.saved) ?? savedAtOf(save);
  const overdrive = overdriveAt(save.storedata, from);

  const hatcheries = serviceOrder(save).map(([id, building]): HatcheryView => {
    const beingBuilt = underConstruction(building);
    const level = beingBuilt
      ? Math.max(0, Math.floor(finite(building["prefab"]) ?? 0))
      : Math.max(1, Math.floor(finite(building.l) ?? 1) || 1);
    const health = healthOf(save, id, building);
    const damaged = health !== null && health < maxHp(HATCHERY_TYPE, Math.max(1, level)) * 0.5;
    const canTake = !beingBuilt && !damaged;
    const upgrading = (finite(building.cU) ?? 0) > 0;
    const works = canTake && !upgrading;

    const found = stored.get(id);
    const queue = readQueue(found?.entry[2], levels);
    const monster = monsterIdOf(found?.entry[0]);
    let stage: 0 | 1 | 2 = 0;
    let countdown = 0;
    let paidLevel = 0;
    if (found && monster) {
      const paid = whole(found.entry[3]);
      paidLevel = paid > 0 ? paid : levelIn(levels, monster);
      const left = Math.ceil(Number(found.entry[1]));
      const counted = Number.isFinite(left) && left > 0 ? left : 0;
      if (found.stage === 2 || (found.stage === 1 && counted === 0)) stage = 2;
      else {
        stage = 1;
        countdown = found.stage === 1 ? counted : secondsOf(monster, levelIn(levels, monster));
      }
    }

    const state: HatcheryState = beingBuilt
      ? "building"
      : damaged
        ? "damaged"
        : !monster
          ? "idle"
          : stage === 2
            ? "stalled"
            : upgrading
              ? "upgrading"
              : "producing";
    const endsAt = stage === 1 && works ? acceleratedEnd(from, countdown, overdrive) : null;

    return {
      id,
      level,
      monster,
      paidLevel,
      countdown,
      stage,
      queue,
      stackLimit: 1 + level,
      canTake,
      works,
      state,
      endsAt,
    };
  });

  const hccBuilding = buildingsOfType(save, HCC_TYPE)[0] ?? null;
  const hcc =
    hccBuilding && !underConstruction(hccBuilding[1])
      ? {
          id: hccBuilding[0],
          works: (healthOf(save, hccBuilding[0], hccBuilding[1]) ?? Infinity) > HCC_MIN_HEALTH,
        }
      : null;

  const housed: Record<string, number> = {};
  for (const [key, raw] of Object.entries(monsters?.housed ?? {})) {
    const count = whole(raw);
    if (count === 0) continue;
    const id = LEGACY_IDS[key] ?? key;
    housed[id] = (housed[id] ?? 0) + count;
  }

  return {
    hatcheries,
    hcc,
    shared: readQueue(monsters?.hcc, levels),
    housed,
    levels,
    capacity: housingCapacity(save, now),
    goo: Math.floor(finite(save.resources?.r4) ?? 0),
  };
};

/** The queue a target adds to: the HCC's shared queue, or a hatchery's own. */
export const queueOf = (yard: HatchYard, target: HatchTarget): QueueStack[] | null =>
  target === "hcc" ? yard.shared : (yard.hatcheries.find((one) => one.id === target)?.queue ?? null);

/** Monsters waiting in a queue. */
export const queuedCount = (queue: readonly QueueStack[]): number =>
  queue.reduce((total, stack) => total + stack[1], 0);

/* ── Housing ───────────────────────────────────────────────────────────── */

/** Space the housed army takes. */
export const housedSpace = (yard: HatchYard): number =>
  Object.entries(yard.housed).reduce(
    (total, [id, count]) => total + spaceOf(id, levelIn(yard.levels, id)) * count,
    0,
  );

/**
 * Space everything already on its way takes: each hatchery's monster in
 * production (stalled ones too) and every queued monster, own queues and the
 * shared one.
 */
export const pendingSpace = (yard: HatchYard): number => {
  const of = (id: string) => spaceOf(id, levelIn(yard.levels, id));
  let total = 0;
  for (const hatchery of yard.hatcheries) {
    if (hatchery.monster) total += of(hatchery.monster);
    for (const stack of hatchery.queue) total += of(stack[0]) * stack[1];
  }
  for (const stack of yard.shared) total += of(stack[0]) * stack[1];
  return total;
};

/** Housing left once the army and everything on its way is in; never below 0. */
export const freeHousing = (yard: HatchYard): number =>
  Math.max(0, yard.capacity - housedSpace(yard) - pendingSpace(yard));

/** How many more of `monster` housing takes once everything on its way is in. */
export const housingFits = (yard: HatchYard, monster: string): number => {
  const space = spaceOf(monster, levelIn(yard.levels, monster));
  return space > 0 ? Math.floor(freeHousing(yard) / space) : MAX_ADD;
};

/* ── Add ───────────────────────────────────────────────────────────────── */

/** Where an add would put its monsters, and how far it would get. */
export interface AddPreview {
  readonly added: number;
  /** Why it would stop short: no stack room, not enough goo, or null. */
  readonly stoppedBy: null | "queue" | "goo";
  /** Goo it would charge. */
  readonly cost: number;
  /** How many go straight into production on idle hatcheries. */
  readonly started: number;
  /** Which idle hatchery takes which monster at once, in the order they start. */
  readonly starts: readonly { readonly hatchery: number; readonly monster: string }[];
  /** Monsters topping up stacks already in the queue: 1-based slot and how many. */
  readonly merged: readonly { readonly slot: number; readonly count: number }[];
  /** New stacks it opens, and the monsters in them. */
  readonly newStacks: number;
  readonly inNewStacks: number;
  /** How many go into each new stack, in queue order (the Hatch tab's dashed slots). */
  readonly fresh: readonly number[];
}

/** A deep copy of the parts an add changes, so a preview never touches the yard. */
const cloneForAdd = (yard: HatchYard) => ({
  hatcheries: yard.hatcheries.map((one) => ({
    ...one,
    queue: one.queue.map((stack): QueueStack => [...stack]),
  })),
  shared: yard.shared.map((stack): QueueStack => [...stack]),
});

/** Puts one monster into a queue by the building's rule; false when there is no room. */
const push = (queue: QueueStack[], id: string, level: number, limit: number, hcc: boolean): boolean => {
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

/** Takes the head of a queue into an idle hatchery: the monster it took, or null when the queue is empty. */
const startNext = (hatchery: { monster: string | null }, queue: QueueStack[]): string | null => {
  const head = queue[0];
  if (!head) return null;
  head[1] -= 1;
  if (head[1] <= 0) queue.shift();
  hatchery.monster = head[0];
  return head[0];
};

/**
 * What adding `count` of `monster` to `target` would do, by the server's
 * rules, with `goo` to spend (the yard's own by default). Null for a target
 * the yard does not have.
 */
export const previewAdd = (
  yard: HatchYard,
  target: HatchTarget,
  monster: string,
  count: number,
  goo: number = yard.goo,
): AddPreview | null => {
  const copy = cloneForAdd(yard);
  const hcc = target === "hcc";
  const hatchery = hcc ? null : copy.hatcheries.find((one) => one.id === target);
  if (!hcc && !hatchery) return null;
  const queue = hcc ? copy.shared : hatchery!.queue;
  const limit = hcc ? HCC_STACKS : hatchery!.stackLimit;
  const before = new Map(queue.map((stack) => [stack, stack[1]]));
  const level = levelIn(yard.levels, monster);
  const price = priceOf(monster, level);
  const requested = Math.max(0, Math.min(MAX_ADD, Math.floor(count)));

  let added = 0;
  const starts: { hatchery: number; monster: string }[] = [];
  let stoppedBy: AddPreview["stoppedBy"] = null;
  while (added < requested) {
    if ((added + 1) * price > goo) {
      stoppedBy = "goo";
      break;
    }
    if (!push(queue, monster, level, limit, hcc)) {
      stoppedBy = "queue";
      break;
    }
    added += 1;
    if (hcc) {
      if (!yard.hcc?.works) continue;
      for (const one of copy.hatcheries) {
        const took = one.monster === null && one.canTake ? startNext(one, copy.shared) : null;
        if (took) starts.push({ hatchery: one.id, monster: took });
      }
    } else {
      const took = hatchery!.monster === null ? startNext(hatchery!, queue) : null;
      if (took) starts.push({ hatchery: hatchery!.id, monster: took });
    }
  }

  const merged: { slot: number; count: number }[] = [];
  const fresh: number[] = [];
  let newStacks = 0;
  let inNewStacks = 0;
  queue.forEach((stack, index) => {
    const was = before.get(stack);
    if (was === undefined) {
      newStacks += 1;
      inNewStacks += stack[1];
      fresh.push(stack[1]);
    } else if (stack[1] > was) {
      merged.push({ slot: index + 1, count: stack[1] - was });
    }
  });

  return {
    added,
    stoppedBy,
    cost: added * price,
    started: starts.length,
    starts,
    merged,
    newStacks,
    inNewStacks,
    fresh,
  };
};

/** How many of `monster` the target's queue can still take, goo aside (idle hatcheries included). */
export const queueRoom = (yard: HatchYard, target: HatchTarget, monster: string): number =>
  previewAdd(yard, target, monster, MAX_ADD, Number.POSITIVE_INFINITY)?.added ?? 0;

/** The three limits Fill weighs, and the smallest. */
export interface FillLimits {
  readonly queue: number;
  readonly goo: number;
  readonly housing: number;
  /** `min(queue, goo, housing)`: what Fill puts in the box. */
  readonly fill: number;
  /** Which limit Fill stopped at (the first of queue, goo, housing that is smallest). */
  readonly limitedBy: "queue" | "goo" | "housing";
  /** The most the box takes: `min(queue, goo)`, housing aside (the queue may outgrow housing). */
  readonly max: number;
}

/**
 * Fill for `monster` on `target`: `min(queue room, goo ÷ price, free housing ÷
 * space)`, where free housing counts what every hatchery already holds or
 * queues (§4.4).
 */
export const fillLimits = (yard: HatchYard, target: HatchTarget, monster: string): FillLimits => {
  const level = levelIn(yard.levels, monster);
  const price = priceOf(monster, level);
  const queue = queueRoom(yard, target, monster);
  const goo = price > 0 ? Math.min(MAX_ADD, Math.floor(yard.goo / price)) : MAX_ADD;
  const housing = Math.min(MAX_ADD, housingFits(yard, monster));
  const fill = Math.max(0, Math.min(queue, goo, housing));
  const limitedBy = fill === queue ? "queue" : fill === goo ? "goo" : "housing";
  return { queue, goo, housing, fill, limitedBy, max: Math.max(0, Math.min(queue, goo)) };
};

/**
 * The line under the box when the count is more than housing takes, or null:
 * "Housing fits 12 of these; the rest will wait".
 */
export const housingWarning = (yard: HatchYard, monster: string, count: number): string | null => {
  const fits = housingFits(yard, monster);
  if (count <= fits) return null;
  if (fits === 0) return "Housing is full; these will wait for space.";
  return `Housing fits ${fits.toLocaleString("en-US")} of these; the rest will wait.`;
};

/* ── Finish now ────────────────────────────────────────────────────────── */

/** Why Finish now cannot be pressed, under the server's refusal keys. */
export type FinishBlock = "busy" | "damaged" | "nothingToFinish" | "housingFull";

export interface FinishPreview {
  readonly blocked: FinishBlock | null;
  /** Monsters it would house, by id. */
  readonly housed: Readonly<Record<string, number>>;
  /** Seconds of production it would skip. */
  readonly seconds: number;
  /** `timeCost(seconds, false) × 4` Shiny. */
  readonly price: number;
  /** False when housing would run out before everything is done. */
  readonly finishedAll: boolean;
}

/**
 * Seconds of 1x work left at `now` on a countdown of `seconds` at `from`, with
 * the overdrive running at `from` counted (`acceleratedEnd` run backwards).
 */
const workLeft = (
  seconds: number,
  from: number,
  now: number,
  overdrive: { power: number; until: number } | null,
): number => {
  const elapsed = Math.max(0, now - from);
  if (!overdrive || overdrive.until <= from) return Math.max(0, seconds - elapsed);
  const fast = Math.max(0, Math.min(now, overdrive.until) - from);
  return Math.max(0, seconds - fast * overdrive.power - Math.max(0, elapsed - fast));
};

/**
 * What Finish now on `target` would do and cost, by the server's walk
 * (`planHatcheryFinish`): a hatchery houses its monster in production first
 * (if that does not fit, nothing does), then its queue from the head, whole
 * stacks then as many of the next as fit; `hcc` does every working
 * hatchery's monster in production, then the shared queue. Free housing is
 * capacity less the army. Priced at today's academy levels; a monster already
 * waiting for housing costs nothing.
 */
export const previewFinish = (
  yard: HatchYard,
  target: HatchTarget,
  save: Pick<BaseLoadResponse, "monsters" | "storedata" | "savetime" | "currenttime">,
  now: number,
): FinishPreview => {
  const from = finite(save.monsters?.saved) ?? savedAtOf(save);
  const overdrive = overdriveAt(save.storedata, from);
  const room = { free: yard.capacity - housedSpace(yard) };
  const housed: Record<string, number> = {};
  let seconds = 0;
  const of = (id: string) => levelIn(yard.levels, id);
  const blocked = (reason: FinishBlock): FinishPreview => ({
    blocked: reason,
    housed: {},
    seconds: 0,
    price: 0,
    finishedAll: false,
  });

  const houseProducing = (hatchery: HatcheryView, fresh = false): boolean => {
    const id = hatchery.monster!;
    const space = spaceOf(id, of(id));
    if (room.free < space) return false;
    housed[id] = (housed[id] ?? 0) + 1;
    room.free -= space;
    if (fresh) seconds += secondsOf(id, of(id));
    else if (hatchery.stage !== 2) seconds += workLeft(hatchery.countdown, from, now, overdrive);
    return true;
  };

  /** Houses from the head of a queue; returns what is left in it. */
  const houseQueue = (queue: readonly QueueStack[]): number => {
    let left = queuedCount(queue);
    for (const [id, count] of queue) {
      const space = spaceOf(id, of(id));
      const fits = space > 0 ? Math.min(count, Math.floor(room.free / space)) : count;
      if (fits > 0) {
        housed[id] = (housed[id] ?? 0) + fits;
        room.free -= fits * space;
        seconds += fits * secondsOf(id, of(id));
        left -= fits;
      }
      if (fits < count) break;
    }
    return left;
  };

  let finishedAll: boolean;
  if (target === "hcc") {
    if (!yard.hcc) return blocked("nothingToFinish");
    if (!yard.hcc.works) return blocked("damaged");
    const working = yard.hatcheries.filter((one) => one.canTake);
    const producing = working.filter((one) => one.monster !== null);
    if (yard.shared.length === 0 && producing.length === 0) return blocked("nothingToFinish");
    let unhoused = 0;
    for (const hatchery of producing) if (!houseProducing(hatchery)) unhoused += 1;
    finishedAll = houseQueue(yard.shared) === 0 && unhoused === 0;
  } else {
    const hatchery = yard.hatcheries.find((one) => one.id === target);
    if (!hatchery) return blocked("nothingToFinish");
    if (hatchery.state === "building") return blocked("busy");
    if (hatchery.state === "damaged") return blocked("damaged");
    if (hatchery.monster !== null) {
      if (!houseProducing(hatchery)) return blocked("housingFull");
      finishedAll = houseQueue(hatchery.queue) === 0;
    } else {
      const [head, ...rest] = hatchery.queue;
      if (!head) return blocked("nothingToFinish");
      // A queue behind an idle hatchery starts first, from a full countdown.
      const queue: QueueStack[] = head[1] > 1 ? [[head[0], head[1] - 1, head[2]], ...rest] : rest;
      if (!houseProducing({ ...hatchery, monster: head[0], stage: 1 }, true)) {
        return blocked("housingFull");
      }
      finishedAll = houseQueue(queue) === 0;
    }
  }

  if (Object.keys(housed).length === 0) return blocked("housingFull");
  return {
    blocked: null,
    housed,
    seconds,
    price: timeCost(Math.trunc(seconds), false) * 4,
    finishedAll,
  };
};

/* ── How long a line takes ─────────────────────────────────────────────── */

/**
 * Seconds from `now` until everything on `target`'s line has hatched, housing
 * aside: a hatchery's monster in production, then its queue from the head.
 * With the HCC, each working hatchery takes the next monster of the shared
 * queue as it comes free, the first in service order on a tie (the order the
 * catch-up hands them out). An Overdrive running at `now` counts. Null when
 * the line is empty or nothing can work it (paused, damaged, being built).
 */
export const lineSeconds = (
  yard: HatchYard,
  target: HatchTarget,
  storedata: StoreData | null | undefined,
  now: number,
): number | null => {
  const overdrive = overdriveAt(storedata, now);
  const seconds = (id: string) => secondsOf(id, levelIn(yard.levels, id));
  /** When a working hatchery is next free: its monster's end, or now. */
  const freeAt = (hatchery: HatcheryView) => Math.max(now, hatchery.endsAt ?? now);

  let end: number;
  if (target === "hcc") {
    if (!yard.hcc?.works) return null;
    const free = yard.hatcheries.filter((one) => one.works).map(freeAt);
    if (free.length === 0) return null;
    for (const [id, count] of yard.shared) {
      for (let i = 0; i < count; i++) {
        const next = free.indexOf(Math.min(...free));
        free[next] = acceleratedEnd(free[next]!, seconds(id), overdrive);
      }
    }
    end = Math.max(...free);
  } else {
    const hatchery = yard.hatcheries.find((one) => one.id === target);
    if (!hatchery?.works) return null;
    end = freeAt(hatchery);
    for (const [id, count] of hatchery.queue) end = acceleratedEnd(end, seconds(id) * count, overdrive);
  }
  return end > now ? end - now : null;
};

/* ── Overdrive ─────────────────────────────────────────────────────────── */

/** The Hatchery Overdrive running now: which, how strong, until when; or null. */
export const activeOverdrive = (
  storedata: StoreData | null | undefined,
  now: number,
): { readonly item: OverdriveItem; readonly power: number; readonly endsAt: number } | null => {
  for (const { item, power } of HATCHERY_OVERDRIVES) {
    const endsAt = finite(storedata?.[item]?.e);
    if (endsAt !== null && endsAt > now) return { item, power, endsAt };
  }
  return null;
};

/* ── The monster grid ──────────────────────────────────────────────────── */

/** Whether a monster can be hatched, or why not. */
export type HatchMonsterState =
  | { readonly kind: "ready" }
  | { readonly kind: "unlocking" }
  | { readonly kind: "locked" };

export interface HatchMonster {
  readonly monster: MonsterEntry;
  readonly state: HatchMonsterState;
  /** At its academy level: goo, seconds, space. */
  readonly level: number;
  readonly price: number;
  readonly seconds: number;
  readonly space: number;
}

/**
 * Every listed monster in list order, each saying whether it can be hatched:
 * unlocked (`lockerdata[id].t == 2`, the add route's rule), unlocking, or
 * locked.
 */
export const hatchMonsters = (save: Pick<BaseLoadResponse, "lockerdata" | "academy">): HatchMonster[] =>
  LISTED_MONSTERS.map((monster) => {
    const t = Number(save.lockerdata?.[monster.id]?.t);
    const state: HatchMonsterState =
      t === 2 ? { kind: "ready" } : t === 1 ? { kind: "unlocking" } : { kind: "locked" };
    const level = academyLevel(save.academy, monster.id);
    return {
      monster,
      state,
      level,
      price: priceOf(monster.id, level),
      seconds: secondsOf(monster.id, level),
      space: spaceOf(monster.id, level),
    };
  });
