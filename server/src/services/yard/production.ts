import { hatchTime, housingSpace, monsterEntry } from "../../game-data/monsterCatalogue.js";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * Hatchery production, event by event (`docs/design/yard-buildings.md` §4.6,
 * `docs/specs/monsters-and-hatchery.md` §5.3, §5.6).
 *
 * `simulateProduction(input, from, to)` walks a yard's hatcheries from `from`
 * to `to` and returns the new `monsters` blob and what happened on the way. It
 * is pure: the caller (`catchUpMonsters.ts`, and the hatchery routes' finish-now
 * walk) decides which hatcheries can work, how much housing there is and when
 * an overdrive runs, and passes those in as a timeline of absolute times.
 *
 * The rules, from the original's per-second tick:
 *
 * - **Working.** A hatchery counts down only while the caller says it works
 *   (`workingFrom` reached): the original stops one that is still being built,
 *   is upgrading, or is below half health (`client/scripts/BUILDING13.as:262-267`,
 *   `:315`). The Hatchery Control Centre hands out work only while it works
 *   (`hccFrom` reached; built with health > 10, `BUILDING16.as:107`).
 * - **Countdown.** The monster in production takes `cTime` at its academy
 *   level, counted down by 1 a second, or by the overdrive's power while a
 *   `HOD*` runs (`BUILDING13.as:321-326`). Time is whole seconds: a monster
 *   whose countdown reaches zero part-way through a second is done at the end
 *   of that second, and what the last second overshot is not carried to the
 *   next monster, which starts from a full `cTime` (`:338-344`). So under a 4x
 *   overdrive a 15 s monster takes 4 s.
 * - **Housing.** A finished monster moves into housing if the free space is at
 *   least its `cStorage` (`client/scripts/HOUSING.as:92-125`); the next one
 *   starts at once, from the hatchery's own queue, or with a working HCC from
 *   the head of the shared queue. Otherwise the hatchery **stalls** (stage 2)
 *   and waits with the monster finished: nothing is lost and nothing is
 *   refunded (MH §12.1 rule 7). It tries again whenever the housing grows.
 * - **Order.** Hatcheries are served in `input.hatcheries` order, the `hid`
 *   order the HCC hands out in (`BUILDING16.as:96-137`): at one moment, the
 *   first hatchery in that order houses its monster and takes the next queued
 *   one first.
 *
 * The walk jumps from event to event (a monster finishing, or a change in the
 * timeline), so the result is the one a second-by-second tick would give, at
 * the cost of one step per monster. Walking `from → mid → to` gives the same
 * result as `from → to` when `mid` is a whole second, which is what makes the
 * catch-up idempotent.
 *
 * **Queue stacks** are `[id, count, level]`: the academy level whose price was
 * paid, so a refund gives back what was paid (owner decision, §10 Q2). A stack
 * saved before that (`[id, count]`) is read as paid at the current academy
 * level, and is written back with that level, so the reading happens once. The
 * monster in production carries its paid level as the fourth element of its
 * `h` entry: `[monster, countdown, queue, level]`.
 */

/** A queue stack: monster id, how many, the academy level whose price was paid. */
export type QueueStack = [id: string, count: number, level: number];

/** `hstage`: 0 idle, 1 producing, 2 finished and waiting for housing. */
export type HatcheryStage = 0 | 1 | 2;

/** One hatchery's production state, as read from `monsters.h` / `hid` / `hstage`. */
export interface HatcheryModel {
  /** Building id (`hid`). */
  id: number;
  /** The monster in production, `""` when idle. */
  monster: string;
  /** Seconds of work left on it at 1x; 0 when idle or waiting for housing. */
  countdown: number;
  stage: HatcheryStage;
  /** Academy level whose price was paid for the monster in production; 0 when idle. */
  paidLevel: number;
  /** The hatchery's own queue; empty once an HCC exists. */
  queue: QueueStack[];
}

/** A yard's production state, normalised. */
export interface ProductionModel {
  /** In `hid` order. */
  hatcheries: HatcheryModel[];
  /** The Hatchery Control Centre's shared queue (`monsters.hcc`). */
  hcc: QueueStack[];
  /** `monsters.housed`, whole positive counts only. */
  housed: Record<string, number>;
}

/** When one hatchery can work. */
export interface HatcheryWork {
  /** Building id. */
  id: number;
  /** Unix seconds from which it works, or null when it does not work at all in the window. */
  workingFrom: number | null;
}

/** One step of a step function: `value` holds from `at` until the next step. */
export interface TimelineStep {
  at: number;
  value: number;
}

/** A hatchery overdrive (`HOD`, `HOD2`, `HOD3`) running over `[start, end)`. */
export interface OverdriveWindow {
  start: number;
  end: number;
  /** 4, 6 or 10. Overdrives do not stack: the highest running power counts. */
  power: number;
}

/** What the walk needs. Every time is absolute unix seconds. */
export interface ProductionInput {
  /** The stored `monsters` blob (Map Room 2 shape). Not mutated. */
  monsters: JsonObject | null | undefined;
  /**
   * Every hatchery on the yard, in service order. An `h` entry whose building
   * is not listed is dropped; a listed building without one starts idle.
   */
  hatcheries: readonly HatcheryWork[];
  /** When the HCC starts handing out its queue; null when there is none that works. */
  hccFrom: number | null;
  /**
   * Housing capacity: a number, or a step function (sorted by `at`). Before
   * the first step the first value holds.
   */
  capacity: number | readonly TimelineStep[];
  overdrive: readonly OverdriveWindow[];
  /** Academy level per monster id (1 when absent). */
  levels: Readonly<Record<string, number>>;
}

/** One thing the walk did. */
export type ProductionEvent =
  | { kind: "hatched"; at: number; hatchery: number; monster: string }
  | { kind: "stalled"; at: number; hatchery: number; monster: string };

export interface ProductionResult {
  /** The new `monsters` blob: `housed`, `h`, `hid`, `hstage`, `hcount`, `hcc`, `saved = to`. */
  monsters: JsonObject;
  /** In time order. */
  events: ProductionEvent[];
}

/** The legacy id the original rewrote on sight (`BUILDING13.as:225-227`). */
const LEGACY_IDS: Readonly<Record<string, string>> = { C100: "C12" };

/** A step cap far above anything a yard can reach, so a bad input cannot hang the walk. */
const MAX_STEPS = 100_000;

/** Academy level of `id`, 1 when absent or unusable. */
export const levelOf = (levels: Readonly<Record<string, number>>, id: string): number => {
  const level = Math.floor(Number(levels[id]));
  return Number.isFinite(level) && level >= 1 ? level : 1;
};

/** `id` with the legacy rename applied, or null when it is not a monster the catalogue knows. */
export const monsterIdOf = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw === "") return null;
  const id = LEGACY_IDS[raw] ?? raw;
  return monsterEntry(id) ? id : null;
};

/** A whole number ≥ 0 off a jsonb field, 0 otherwise. */
const whole = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/**
 * One queue, normalised: known monsters, positive whole counts, and a paid
 * level on every stack (the current academy level for a two-element stack).
 */
export const readQueue = (raw: unknown, levels: Readonly<Record<string, number>>): QueueStack[] => {
  if (!Array.isArray(raw)) return [];
  const queue: QueueStack[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const id = monsterIdOf(entry[0]);
    const count = whole(entry[1]);
    if (!id || count === 0) continue;
    const paid = whole(entry[2]);
    queue.push([id, count, paid > 0 ? paid : levelOf(levels, id)]);
  }
  return queue;
};

/** `monsters.housed`, whole positive counts, legacy ids merged. */
export const readHoused = (monsters: JsonObject | null | undefined): Record<string, number> => {
  const raw = monsters?.housed;
  const housed: Record<string, number> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return housed;
  for (const [key, value] of Object.entries(raw as JsonObject)) {
    const count = whole(value);
    if (count === 0) continue;
    const id = LEGACY_IDS[key] ?? key;
    housed[id] = (housed[id] ?? 0) + count;
  }
  return housed;
};

/** Seconds to hatch `id` at its academy level, at least 1. */
const hatchSeconds = (id: string, levels: Readonly<Record<string, number>>): number =>
  Math.max(1, Math.ceil(hatchTime(id, levelOf(levels, id)) ?? 1));

/** Housing space `id` takes at its academy level. */
const spaceOf = (id: string, levels: Readonly<Record<string, number>>): number =>
  housingSpace(id, levelOf(levels, id)) ?? 0;

/**
 * Reads a yard's production state out of its `monsters` blob, one hatchery per
 * id in `ids` (the order they are served in).
 *
 * `h[i]` is `[monster, countdown, queue?, level?]` for the hatchery `hid[i]`,
 * and `hstage[i]` its stage (`client/scripts/BASE.as:2656-2710`). Stages 3 and
 * 4 ("just started") read as producing with a full `cTime`; a producing
 * hatchery whose countdown has run out reads as finished, waiting to house.
 *
 * @param monsters - The stored blob.
 * @param ids - Building ids of the yard's hatcheries, in service order.
 * @param levels - Academy level per monster id.
 */
export const readProduction = (
  monsters: JsonObject | null | undefined,
  ids: readonly number[],
  levels: Readonly<Record<string, number>>
): ProductionModel => {
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

  const hatcheries = ids.map((id): HatcheryModel => {
    const found = stored.get(id);
    const queue = readQueue(found?.entry[2], levels);
    const monster = monsterIdOf(found?.entry[0]);
    if (!found || !monster) return { id, monster: "", countdown: 0, stage: 0, paidLevel: 0, queue };

    const paid = whole(found.entry[3]);
    const paidLevel = paid > 0 ? paid : levelOf(levels, monster);
    const left = Math.ceil(Number(found.entry[1]));
    const countdown = Number.isFinite(left) && left > 0 ? left : 0;

    // Waiting for housing, or producing with nothing left to do: finished.
    if (found.stage === 2 || (found.stage === 1 && countdown === 0)) {
      return { id, monster, countdown: 0, stage: 2, paidLevel, queue };
    }
    // Stage 1 keeps its countdown; 3/4 (and a stray 0 with a monster) start afresh.
    const fresh = found.stage === 1 ? countdown : hatchSeconds(monster, levels);
    return { id, monster, countdown: fresh, stage: 1, paidLevel, queue };
  });

  return { hatcheries, hcc: readQueue(monsters?.hcc, levels), housed: readHoused(monsters) };
};

/**
 * Writes a production state back into a copy of `monsters`: `housed`, `h`,
 * `hid`, `hstage`, `hcount`, `hcc` and `saved`. Every other key is kept.
 *
 * @param monsters - The blob to start from.
 * @param model - The state to write.
 * @param saved - The moment the state describes (unix seconds).
 */
export const writeProduction = (
  monsters: JsonObject | null | undefined,
  model: ProductionModel,
  saved: number
): JsonObject => ({
  ...(monsters ?? {}),
  saved,
  housed: { ...model.housed },
  hcount: model.hatcheries.length,
  hcc: model.hcc.map((stack) => [...stack]),
  h: model.hatcheries.map((hatchery) => {
    const queue = hatchery.queue.map((stack) => [...stack]);
    return hatchery.monster === ""
      ? ["", 0, queue]
      : [hatchery.monster, hatchery.countdown, queue, hatchery.paidLevel];
  }),
  hid: model.hatcheries.map((hatchery) => hatchery.id),
  hstage: model.hatcheries.map((hatchery) => hatchery.stage),
});

/** Takes one monster off the head of a queue, or null when it is empty. */
const takeHead = (queue: QueueStack[]): { id: string; level: number } | null => {
  const head = queue[0];
  if (!head) return null;
  head[1] -= 1;
  if (head[1] <= 0) queue.shift();
  return { id: head[0], level: head[2] };
};

/** The value of a step function at `t`. */
const stepAt = (steps: number | readonly TimelineStep[], t: number): number => {
  if (typeof steps === "number") return steps;
  let value = steps[0]?.value ?? 0;
  for (const step of steps) {
    if (step.at > t) break;
    value = step.value;
  }
  return value;
};

/** The countdown speed at `t`: the highest running overdrive, or 1. */
const rateAt = (overdrive: readonly OverdriveWindow[], t: number): number =>
  overdrive.reduce(
    (rate, window) => (window.start <= t && t < window.end ? Math.max(rate, window.power) : rate),
    1
  );

/**
 * Walks production from `from` to `to`.
 *
 * FROZEN (2026-09-27): `simulateProduction(input, from, to) → { monsters, events }`;
 * the hatchery routes (WP2.4) build on it.
 *
 * @param input - The blob and the timeline (see {@link ProductionInput}).
 * @param from - Unix seconds the stored state describes.
 * @param to - Unix seconds to walk to. Nothing happens when `to <= from`
 *   apart from housing what is already finished.
 */
export const simulateProduction = (
  input: ProductionInput,
  from: number,
  to: number
): ProductionResult => {
  const { levels, overdrive, capacity } = input;
  const start = Math.floor(from);
  const end = Math.max(start, Math.floor(to));
  const model = readProduction(
    input.monsters,
    input.hatcheries.map((hatchery) => hatchery.id),
    levels
  );
  const workingFrom = input.hatcheries.map((hatchery) => hatchery.workingFrom);
  const events: ProductionEvent[] = [];

  let used = Object.entries(model.housed).reduce(
    (total, [id, count]) => total + spaceOf(id, levels) * count,
    0
  );

  const works = (index: number, t: number): boolean => {
    const from = workingFrom[index];
    return from !== null && from !== undefined && from <= t;
  };
  const hccWorks = (t: number): boolean => input.hccFrom !== null && input.hccFrom <= t;

  // Every moment the rules can change: the walk never steps over one.
  const breaks = [
    ...workingFrom,
    input.hccFrom,
    ...(typeof capacity === "number" ? [] : capacity.map((step) => step.at)),
    ...overdrive.flatMap((window) => [window.start, window.end]),
  ]
    .filter((t): t is number => t !== null && t !== undefined && t > start && t < end)
    .sort((a, b) => a - b);

  /** Houses what is finished and starts what can start, hatchery by hatchery. */
  const settle = (t: number) => {
    model.hatcheries.forEach((hatchery, index) => {
      if (!works(index, t)) return;

      if (hatchery.monster !== "" && hatchery.countdown <= 0) {
        const space = spaceOf(hatchery.monster, levels);
        if (stepAt(capacity, t) - used < space) {
          if (hatchery.stage !== 2) {
            events.push({ kind: "stalled", at: t, hatchery: hatchery.id, monster: hatchery.monster });
          }
          hatchery.stage = 2;
          hatchery.countdown = 0;
          return;
        }
        model.housed[hatchery.monster] = (model.housed[hatchery.monster] ?? 0) + 1;
        used += space;
        events.push({ kind: "hatched", at: t, hatchery: hatchery.id, monster: hatchery.monster });
        hatchery.monster = "";
      }

      if (hatchery.monster === "") {
        const next = takeHead(hatchery.queue) ?? (hccWorks(t) ? takeHead(model.hcc) : null);
        if (!next) {
          Object.assign(hatchery, { stage: 0, countdown: 0, paidLevel: 0 });
          return;
        }
        Object.assign(hatchery, {
          monster: next.id,
          paidLevel: next.level,
          countdown: hatchSeconds(next.id, levels),
          stage: 1,
        });
      }
    });
  };

  let t = start;
  settle(t);

  for (let steps = 0; t < end && steps < MAX_STEPS; steps++) {
    const rate = rateAt(overdrive, t);
    let next = breaks.find((at) => at > t) ?? end;

    model.hatcheries.forEach((hatchery, index) => {
      if (!works(index, t) || hatchery.stage !== 1 || hatchery.countdown <= 0) return;
      next = Math.min(next, t + Math.max(1, Math.ceil(hatchery.countdown / rate)));
    });

    const elapsed = next - t;
    model.hatcheries.forEach((hatchery, index) => {
      if (!works(index, t) || hatchery.stage !== 1) return;
      hatchery.countdown = Math.max(0, hatchery.countdown - elapsed * rate);
    });

    t = next;
    settle(t);
  }

  return { monsters: writeProduction(input.monsters, model, end), events };
};
