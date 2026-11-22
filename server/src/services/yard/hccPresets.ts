import { byPercent } from "../alliance/allianceBonuses.js";
import { weekendBoost } from "../events/weekendBoosts.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { yardKindOf } from "../yardplanner/costs.js";
import { inRealm, monsterRealmOf, obtainableOrThrow } from "./locker.js";
import { levelOf, writeProduction } from "./production.js";
import {
  gooOf,
  handOut,
  hccLevel,
  hccLimits,
  HCC_MAX_LEVEL,
  modelOf,
  numberOf,
  push,
  STACK_SIZE,
  type HatcherySave,
} from "./hatchery.js";
import { monsterEntry } from "../../game-data/monsterCatalogue.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Hatchery Control Centre's presets and its level 3 "run your outposts
 * from home" (beta 9; owner, desk cards b9-hcc-r3..r6 and beta9-grill-1/2,
 * 21-22 Nov 2026).
 *
 * **A preset** is a numbered, saved sequence of stacks, `[monster, count]` in
 * the order they were added ("30 Pokey, then 40 Octo-ooze, then 30 Pokey
 * again"): the same monster may come back later and is never merged into a
 * total, only two stacks of the same monster side by side become one. Sending
 * it adds the stacks to the END of the HCC's shared queue in that order, by
 * the HCC's own rule (a monster merges only into the queue's last stack), as
 * far as the queue and the goo go; a monster locked by then is skipped.
 *
 * **Two lists**, both on the player's main row (`save.hccpresets`, a pool
 * field, `poolView.ts`): `home`, the main yard's, and `out`, ONE list every
 * outpost shares. A request on the main yard uses `home`, one on an outpost
 * `out`. How many presets a list offers is the HCC's in use: 2 at level 1, 4
 * at level 2, 6 at level 3 ({@link hccLimits}); presets past that are kept,
 * not deleted, and come back with the level. A preset holds what a queue
 * holds: on the main yard at most as many boxes (queue stacks) as its HCC's
 * queue, each box as big as its stacks; an outpost's at most 10 boxes of 20
 * (an outpost's HCC goes to level 2). The Inferno's Incubator Control Centre
 * has none (it stays at level 1, owner 22 Nov).
 *
 * **Remote** (`remote` on a request naming an outpost): the main yard's HCC
 * window runs that outpost's queue from home. Allowed only while the main
 * yard's HCC is at level 3 and the outpost has an HCC of its own
 * ({@link checkRemote}); the outpost's list then offers 6. Without `remote` a
 * request on an outpost is the player's own, in that outpost, as it always
 * was.
 */

/** One preset stack: a monster and how many, in the order sent. */
export type PresetStack = [id: string, count: number];

/** A preset: its stacks in order; empty for a slot never filled. */
export type Preset = PresetStack[];

/** The two lists. */
export type PresetList = "home" | "out";

/** Both lists, each indexed by slot. */
export interface HccPresets {
  home: Preset[];
  out: Preset[];
}

/** Slots one list can hold: level 3's. */
export const MAX_PRESETS = hccLimits(HCC_MAX_LEVEL).presets;

/** Boxes an outpost preset may fill, and how big each is: an outpost HCC at level 2. */
export const OUTPOST_PRESET_BOXES = 10;
export const OUTPOST_PRESET_SIZE = STACK_SIZE;

/** A monster id that is not a surface monster, or not a whole positive count, is dropped. */
const readPreset = (raw: unknown): Preset => {
  if (!Array.isArray(raw)) return [];
  const preset: Preset = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const id = typeof entry[0] === "string" ? entry[0] : "";
    const count = Math.floor(Number(entry[1]));
    if (!inRealm(id, "surface") || !monsterEntry(id) || !(count >= 1)) continue;
    const last = preset.at(-1);
    if (last && last[0] === id) last[1] += count;
    else preset.push([id, count]);
  }
  return preset;
};

/** `save.hccpresets`, normalised: both lists, up to {@link MAX_PRESETS} each. */
export const readPresets = (raw: JsonObject | null | undefined): HccPresets => {
  const list = (value: unknown): Preset[] =>
    Array.from({ length: MAX_PRESETS }, (_, at) => readPreset(Array.isArray(value) ? value[at] : undefined));
  return { home: list(raw?.home), out: list(raw?.out) };
};

/** The jsonb written back: trailing empty slots trimmed. */
const writePresets = (presets: HccPresets): JsonObject => {
  const trim = (list: Preset[]): Preset[] => {
    const copy = list.map((preset) => preset.map(([id, count]): PresetStack => [id, count]));
    while (copy.length > 0 && copy.at(-1)!.length === 0) copy.pop();
    return copy;
  };
  return { home: trim(presets.home), out: trim(presets.out) } as unknown as JsonObject;
};

/** Boxes (queue stacks) a preset fills when each holds `size`. */
export const boxesOf = (preset: Preset, size: number): number =>
  preset.reduce((sum, [, count]) => sum + Math.ceil(count / size), 0);

/** The HCC a request uses and what it allows. */
export interface HccContext {
  /** The list the yard uses. */
  list: PresetList;
  /** The level of the HCC whose queue the request changes. */
  level: number;
  /** Presets the list offers here. */
  slots: number;
  /** The most boxes a preset may fill, and each box's size, when one is saved here. */
  boxes: number;
  size: number;
}

/** The main yard's HCC level, from the locked main row (0 without one). */
const homeLevel = (main: HatcherySave | undefined): number => (main ? hccLevel(main) : 0);

/**
 * Checks a `remote` request: it names an outpost, the main yard's HCC is at
 * level 3 and the outpost has an HCC of its own. A request without `remote`
 * passes untouched.
 *
 * Refusals: `400 badRequest` not on an outpost; `409 hccLevel { need, have }`;
 * `409 noOutpostHcc`.
 */
export const checkRemote = (save: HatcherySave, main: HatcherySave | undefined, remote: boolean): void => {
  if (!remote) return;
  if (yardKindOf(save) !== "outpost") {
    throw yardBadRequestErr("Only an outpost is run from home.", { field: "remote" });
  }
  const have = homeLevel(main);
  if (have < HCC_MAX_LEVEL) {
    throw yardRefusedErr(
      "hccLevel",
      "Upgrade your Hatchery Control Centre to level 3 to run your outposts from home.",
      { need: HCC_MAX_LEVEL, have }
    );
  }
  if (hccLevel(save) === 0) {
    throw yardRefusedErr("noOutpostHcc", "That outpost has no Hatchery Control Centre.");
  }
};

/**
 * The context of a preset request: `409 noHcc` without a finished HCC in the
 * yard, `409 notInInferno`-like refusal in the Inferno (the route is closed
 * there by the wrapper anyway), and {@link checkRemote}'s.
 */
export const hccContext = (save: HatcherySave, main: HatcherySave | undefined, remote: boolean): HccContext => {
  checkRemote(save, main, remote);
  const kind = yardKindOf(save);
  if (kind === "inferno") throw yardRefusedErr("noPresets", "The Incubator Control Centre has no presets.");
  const level = hccLevel(save);
  if (level === 0) throw yardRefusedErr("noHcc", "Build a Hatchery Control Centre first.");
  if (kind === "outpost") {
    const slots = hccLimits(remote ? homeLevel(main) : level).presets;
    return { list: "out", level, slots, boxes: OUTPOST_PRESET_BOXES, size: OUTPOST_PRESET_SIZE };
  }
  const limits = hccLimits(level);
  return { list: "home", level, slots: limits.presets, boxes: limits.stacks, size: limits.size };
};

/** `409 presetLocked { slot, slots }`: the slot is past what the HCC in use offers. */
const slotOrThrow = (context: HccContext, slot: number): void => {
  if (slot >= context.slots) {
    throw yardRefusedErr("presetLocked", "Upgrade your Hatchery Control Centre for more presets.", {
      slot,
      slots: context.slots,
    });
  }
};

/** `report` of `POST /bm/yard/hatchery/preset/save`. */
export interface PresetSaveReport {
  list: PresetList;
  slot: number;
  /** The preset as saved (side-by-side stacks of one monster joined). */
  preset: Preset;
}

/**
 * Saves `stacks` as the preset in `slot` of the yard's list; `[]` empties it.
 * Two stacks of the same monster side by side are joined (the editor adds to
 * the last stack); any other order is kept.
 *
 * Refusals: {@link hccContext}'s; `409 presetLocked`; `400 badRequest` a
 * monster that cannot be hatched, or more boxes than the queue holds.
 */
export const planPresetSave = (
  save: HatcherySave & { hccpresets?: JsonObject | null },
  main: HatcherySave | undefined,
  slot: number,
  stacks: readonly (readonly [string, number])[],
  remote: boolean
) => {
  const context = hccContext(save, main, remote);
  slotOrThrow(context, slot);
  const preset: Preset = [];
  for (const [id, count] of stacks) {
    obtainableOrThrow(id, monsterRealmOf(save));
    const last = preset.at(-1);
    if (last && last[0] === id) last[1] += count;
    else preset.push([id, count]);
  }
  const boxes = boxesOf(preset, context.size);
  if (boxes > context.boxes) {
    throw yardBadRequestErr(
      `A preset holds at most ${context.boxes} stacks of ${context.size}.`,
      { boxes, most: context.boxes, size: context.size }
    );
  }
  const presets = readPresets(save.hccpresets);
  presets[context.list][slot] = preset;
  const report: PresetSaveReport = { list: context.list, slot, preset };
  return { report, slices: { hccpresets: writePresets(presets) } };
};

/** `report` of `POST /bm/yard/hatchery/preset/send`. */
export interface PresetSendReport {
  list: PresetList;
  slot: number;
  /** How many went into the queue. */
  added: number;
  /** How many the preset holds, the skipped monsters included. */
  requested: number;
  /** Why it stopped short: `queue` (no stack room), `goo`, or null when everything it could add went in. */
  stoppedBy: null | "queue" | "goo";
  /** Monsters left out because they are locked now, in preset order, each once. */
  skipped: string[];
  /** Goo charged. */
  cost: { r4: number };
}

/**
 * Adds the preset in `slot` to the end of the HCC's shared queue, stack by
 * stack in order, one monster at a time as `hatchery/add` does (the goo before
 * the room; after each, the idle hatcheries take from the queue), until it is
 * all in or the queue or the goo runs out; partial by design. On an outpost a
 * Midas Council's dearer hatching applies, as on an add.
 *
 * Refusals: {@link hccContext}'s; `409 presetLocked`; `409 emptyPreset`.
 */
export const planPresetSend = (
  save: HatcherySave & { hccpresets?: JsonObject | null },
  main: HatcherySave | undefined,
  slot: number,
  remote: boolean,
  now: number,
  outpostPercent = 0
) => {
  const context = hccContext(save, main, remote);
  slotOrThrow(context, slot);
  const preset = readPresets(save.hccpresets)[context.list][slot] ?? [];
  if (preset.length === 0) throw yardRefusedErr("emptyPreset", "That preset is empty.", { slot });

  const { levels, model } = modelOf(save);
  const queueAt = hccLimits(context.level);
  const extra = yardKindOf(save) === "outpost" ? Math.max(0, outpostPercent) : 0;
  const goo = numberOf(save.resources?.r4);
  const rush = weekendBoost("hatch", now);

  let added = 0;
  let cost = 0;
  let stoppedBy: PresetSendReport["stoppedBy"] = null;
  const skipped: string[] = [];
  outer: for (const [id, count] of preset) {
    if (Number(save.lockerdata?.[id]?.t) !== 2) {
      if (!skipped.includes(id)) skipped.push(id);
      continue;
    }
    const level = levelOf(levels, id);
    const price = byPercent(gooOf(id, level), extra);
    for (let n = 0; n < count; n += 1) {
      if (cost + price > goo) {
        stoppedBy = "goo";
        break outer;
      }
      if (!push(model.hcc, id, level, queueAt.stacks, true, queueAt.size)) {
        stoppedBy = "queue";
        break outer;
      }
      cost += price;
      added += 1;
      handOut(save, model, levels, rush);
    }
  }

  const report: PresetSendReport = {
    list: context.list,
    slot,
    added,
    requested: preset.reduce((sum, [, count]) => sum + count, 0),
    stoppedBy,
    skipped,
    cost: { r4: cost },
  };
  if (added === 0) return { report };
  return {
    report,
    slices: { monsters: writeProduction(save.monsters, model, now) },
    debit: { r4: cost },
  };
};
