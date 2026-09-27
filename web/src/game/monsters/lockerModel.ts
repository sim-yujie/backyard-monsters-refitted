import type { LockerData, ResourceCaps, Resources, StoreData } from "@/api/types";
import { timeCost } from "@/game/yard/buildingCosts";
import { JobKind, type YardJob } from "@/game/yard/jobs";
import type { Yard } from "@/game/yard/yardModel";
import { LISTED_MONSTERS, monsterEntry, type MonsterEntry } from "./monsterCatalogue";

/**
 * What the Unlock tab shows, as data (`docs/design/yard-buildings.md` §4.3).
 *
 * The tab draws; this decides. Every row's state, the one reason Start (or
 * Instant) cannot be pressed, and every price come from here, in the order the
 * server checks them (`unlockGate`, `server/src/services/yard/locker.ts`):
 * already unlocked, another unlock running, no finished Monster Locker, the
 * locker's level, then putty. The first that fails is the one shown, worded as
 * §4.3 words it.
 *
 * Prices are the server's formulas, recomputed here for the label only: the
 * route charges its own figure (`server/src/services/yard/shiny.ts`).
 */

/** Monster Locker type id (`client/scripts/YARD_PROPS.as:901`). */
export const LOCKER_TYPE = 8;

/**
 * The Monster Locker Overdrive (`CLOD`, `server/src/game-data/store/storeItems.ts`):
 * 60 Shiny for four hours, during which the running unlock counts down five
 * times as fast (§4.3 "CLOD in catch-up").
 */
export const LOCKER_OVERDRIVE = { item: "CLOD", price: 60, seconds: 14_400 } as const;

/** What the tab reads: the store's read side, or anything shaped like it. */
export interface LockerContext {
  readonly yard: Yard;
  readonly save: {
    readonly lockerdata?: LockerData | null;
    readonly storedata?: StoreData | null;
  };
  readonly resources: Resources;
  readonly credits: number;
  readonly caps: ResourceCaps | null;
  now(): number;
  jobs(): readonly YardJob[];
}

/** One list row's state. */
export type LockerRowState =
  | { readonly kind: "unlocked" }
  | { readonly kind: "unlocking"; readonly endsAt: number }
  | { readonly kind: "available" }
  | { readonly kind: "locked"; readonly need: number };

export interface LockerRow {
  readonly monster: MonsterEntry;
  readonly state: LockerRowState;
}

/** Why Start or Instant cannot be pressed, under the server's refusal keys. */
export type UnlockGate =
  | { readonly reason: "alreadyUnlocked" }
  | { readonly reason: "unlockRunning"; readonly monster: string }
  | { readonly reason: "noLocker" }
  | { readonly reason: "lockerLevel"; readonly have: number; readonly need: number }
  | { readonly reason: "shortfall"; readonly need: number }
  | { readonly reason: "credits"; readonly need: number };

/** The unlock running now. */
export interface RunningUnlock {
  readonly monster: MonsterEntry;
  /** Unix seconds, server clock; a Locker Overdrive counted wherever the store's jobs count it. */
  readonly endsAt: number;
  /** Unix seconds the unlock started, when the save says. */
  readonly startedAt: number | null;
}

const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return raw != null && Number.isFinite(value) ? value : null;
};

/**
 * The yard's Monster Locker level: the highest one, 0 when there is none or it
 * is still being built. One part-way through an upgrade counts at the level it
 * has, as on the server (`lockerLevel`, `server/src/services/yard/locker.ts`).
 */
export const lockerLevel = (yard: Yard): number => {
  let best = 0;
  for (const building of yard.buildings) {
    if (building.type === LOCKER_TYPE) best = Math.max(best, building.level);
  }
  return best;
};

/**
 * The running surface unlock: the first `t: 1` entry with a `C` id, as the
 * server takes it. Its end is the store's unlock job when there is one, so an
 * Overdrive the job model counts is counted here too; otherwise the stored `e`.
 */
export const runningUnlock = (context: LockerContext): RunningUnlock | null => {
  for (const [id, entry] of Object.entries(context.save.lockerdata ?? {})) {
    if (!id.startsWith("C") || Number(entry?.t) !== 1) continue;
    const monster = monsterEntry(id);
    if (!monster) continue;
    const job = context.jobs().find((one) => one.kind === JobKind.UNLOCK && one.id === id);
    const endsAt = job?.endsAt ?? finite(entry?.e) ?? context.now();
    return { monster, endsAt, startedAt: finite(entry?.s) };
  }
  return null;
};

/** Putty held, whole. */
const puttyOf = (resources: Resources): number => {
  const value = Number(resources.r3);
  return Number.isFinite(value) ? Math.floor(value) : 0;
};

/** A row's state: unlocked, unlocking, available, or behind a locker level. */
export const rowState = (
  monster: MonsterEntry,
  context: LockerContext,
  running: RunningUnlock | null = runningUnlock(context),
  level: number = lockerLevel(context.yard),
): LockerRowState => {
  if (running?.monster.id === monster.id) return { kind: "unlocking", endsAt: running.endsAt };
  const entry = context.save.lockerdata?.[monster.id];
  if (entry && Number(entry.t) !== 1) return { kind: "unlocked" };
  if (level < monster.level) return { kind: "locked", need: monster.level };
  return { kind: "available" };
};

/** Every listed monster in list order (never C18), each with its state. */
export const lockerRows = (context: LockerContext): LockerRow[] => {
  const running = runningUnlock(context);
  const level = lockerLevel(context.yard);
  return LISTED_MONSTERS.map((monster) => ({
    monster,
    state: rowState(monster, context, running, level),
  }));
};

/** The gates Start and Instant share, in the server's order, or null. */
const commonGate = (monster: MonsterEntry, context: LockerContext): UnlockGate | null => {
  const running = runningUnlock(context);
  const entry = context.save.lockerdata?.[monster.id];
  if (entry && running?.monster.id !== monster.id) return { reason: "alreadyUnlocked" };
  if (running) return { reason: "unlockRunning", monster: running.monster.id };
  const have = lockerLevel(context.yard);
  if (have < 1) return { reason: "noLocker" };
  if (have < monster.level) return { reason: "lockerLevel", have, need: monster.level };
  return null;
};

/** Why Start cannot be pressed for `monster`, or null. Putty comes last, as on the server. */
export const startGate = (monster: MonsterEntry, context: LockerContext): UnlockGate | null => {
  const common = commonGate(monster, context);
  if (common) return common;
  const missing = monster.resource - puttyOf(context.resources);
  return missing > 0 ? { reason: "shortfall", need: missing } : null;
};

/**
 * Instant's Shiny price: `timeCost(time) + ceil(sqrt(putty / 2)^0.75)`, no
 * putty charged (`client/scripts/CREATURELOCKERPOPUP.as:326-331`, `:365-443`;
 * `instantUnlockPrice`, `server/src/services/yard/shiny.ts`).
 */
export const instantPrice = (monster: MonsterEntry): number =>
  timeCost(monster.time) + Math.ceil(Math.sqrt(monster.resource / 2) ** 0.75);

/** Why Instant cannot be pressed: Start's gates without putty, then Shiny. */
export const instantGate = (monster: MonsterEntry, context: LockerContext): UnlockGate | null => {
  const common = commonGate(monster, context);
  if (common) return common;
  const price = instantPrice(monster);
  return context.credits < price ? { reason: "credits", need: price - context.credits } : null;
};

/**
 * Finish now on the running unlock: `timeCost(e − now)`, free at five minutes
 * or less (the locker's Speed Up is the generic `SP4`,
 * `client/scripts/CREATURELOCKERPOPUP.as:352-354`). The price only falls as the
 * unlock runs, so the server never charges more than the button says.
 */
export const finishPrice = (running: RunningUnlock, now: number): number =>
  timeCost(Math.max(0, running.endsAt - now));

/**
 * What Cancel gives back: the monster's full putty price, less what the
 * storage cap turns away, as the server clamps it (T3). A pool already over
 * its cap takes nothing and loses nothing.
 */
export const cancelRefund = (
  running: RunningUnlock,
  context: LockerContext,
): { readonly refund: number; readonly lost: number } => {
  const price = running.monster.resource;
  const have = puttyOf(context.resources);
  const cap = context.caps?.r3;
  const refund =
    typeof cap === "number" ? Math.max(have, Math.min(have + price, cap)) - have : price;
  return { refund, lost: price - refund };
};

/** Unix seconds the Locker Overdrive runs until, or null when none is running. */
export const overdriveEndsAt = (context: LockerContext): number | null => {
  const ends = finite(context.save.storedata?.[LOCKER_OVERDRIVE.item]?.e);
  return ends !== null && ends > context.now() ? ends : null;
};

/**
 * Why the Overdrive cannot be bought, or null: nothing to speed up (the
 * shop's `notUnlocking`), one already running (`alreadyActive`), not enough Shiny.
 */
export const overdriveBlocked = (context: LockerContext): string | null => {
  if (!runningUnlock(context)) return "Nothing is unlocking.";
  if (overdriveEndsAt(context) !== null) return "An overdrive is already running.";
  if (context.credits < LOCKER_OVERDRIVE.price) return "Not enough Shiny.";
  return null;
};

/** A gate as its §4.3 reason line: "Needs Monster Locker level 3". */
export const gateText = (gate: UnlockGate): string => {
  switch (gate.reason) {
    case "alreadyUnlocked":
      return "Already unlocked";
    case "unlockRunning":
      return "Another unlock is running";
    case "noLocker":
      return "Build a Monster Locker";
    case "lockerLevel":
      return `Needs Monster Locker level ${gate.need}`;
    case "shortfall":
      return `Need ${gate.need.toLocaleString("en-US")} more putty`;
    case "credits":
      return "Not enough Shiny";
  }
};
