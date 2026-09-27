import { monsterEntry, type MonsterEntry } from "../../game-data/monsterCatalogue.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap, type StorageCapSave } from "../base/economy/resourceBudget.js";
import { levelOf } from "../yardplanner/costs.js";
import { instantUnlockPrice, timeCost } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Monster Locker's unlocks: `POST /bm/yard/locker/start`, `/cancel`,
 * `/finish`, `/instant`, and the Overdrive (`CLOD`) arithmetic the catch-up
 * applies (`docs/design/yard-buildings.md` §4.3; `docs/specs/monsters-and-hatchery.md` §3).
 *
 * The rules are `CREATURELOCKER.Start` (`client/scripts/CREATURELOCKER.as:961-1025`)
 * with the prices from the monster catalogue (`game-data/monsterCatalogue.ts`):
 * one unlock at a time, the full putty price up front,
 * `lockerdata[id] = { t: 1, s: now, e: now + time }`, a full refund on cancel,
 * completion on wall-clock time (`catchUpLocker.ts`).
 *
 * Everything here is pure: it reads the caught-up save the yard action wrapper
 * hands it and returns what should change, or throws the refusal. The wrapper
 * charges the putty and the Shiny, clamps the refund and writes.
 */

/** Monster Locker type id (`client/scripts/YARD_PROPS.as:901`). */
export const LOCKER_TYPE = 8;

/** Putty is the third resource (`BASE.Charge(3, …)`, `CREATURELOCKER.as:982`). */
const PUTTY = "r3";

/** The Monster Locker Overdrive store item. */
export const CLOD_ITEM = "CLOD";

/**
 * Seconds the Overdrive takes off the unlock for every real second it runs:
 * `_lockerData[_unlocking].e -= 4` once per client tick
 * (`client/scripts/CREATURELOCKER.as:905-907`), so the countdown runs 5x. The
 * store text says 4x; the arithmetic was 5x, and this keeps the arithmetic
 * (§4.3 "CLOD in catch-up").
 */
export const CLOD_EXTRA_SECONDS = 4;

/** One `lockerdata` entry: `t` 1 unlocking (with `s`/`e`), 2 unlocked. */
export interface LockerEntry {
  t: number;
  s?: number;
  e?: number;
}

/** The slice of a save the locker routes read. */
export interface LockerSave extends StorageCapSave {
  buildingdata?: BuildingDataMap | null;
  resources?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
  storedata?: JsonObject | null;
}

/** A finite number off a jsonb field, or null. */
const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return raw != null && Number.isFinite(value) ? value : null;
};

/**
 * The running surface unlock, or null. Like `CREATURELOCKER.Tick` it takes the
 * first `t: 1` entry of this realm (`:895-903`); the realm is always the
 * surface here, so an Inferno (`IC…`) entry never counts (D19).
 */
export const runningUnlock = (
  lockerdata: JsonObject | null | undefined
): { monster: string; entry: LockerEntry } | null => {
  for (const [monster, entry] of Object.entries(lockerdata ?? {})) {
    if (!monster.startsWith("C") || Number(entry?.t) !== 1) continue;
    return { monster, entry: entry as LockerEntry };
  }
  return null;
};

/**
 * The level of the yard's Monster Locker: the highest finished one, 0 when
 * there is none or it is still being built. One mid-upgrade counts at the
 * level it has (`levelOf`, as the Flash `_bLocker._lvl` read).
 */
export const lockerLevel = (buildingdata: BuildingDataMap | null | undefined): number => {
  let best = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    if (Number(building.t) === LOCKER_TYPE) best = Math.max(best, levelOf(building));
  }
  return best;
};

/**
 * The Overdrive's active period off `storedata.CLOD`, or null when none was
 * bought. `s` is written by the shop; an entry without one started `du`
 * before its end.
 */
export const overdriveWindow = (
  storedata: JsonObject | null | undefined
): { s: number; e: number } | null => {
  const entry = storedata?.[CLOD_ITEM];
  const e = finite(entry?.e);
  if (e === null) return null;
  const s = finite(entry?.s) ?? e - storeItems[CLOD_ITEM].du;
  return { s, e };
};

/** Seconds of `[from, to]` that fall inside the Overdrive's window. */
export const overdriveOverlap = (
  from: number,
  to: number,
  window: { s: number; e: number } | null
): number => (window ? Math.max(0, Math.min(to, window.e) - Math.max(from, window.s)) : 0);

/**
 * The moment an unlock ending at `e` (as stored at `from`) actually finishes,
 * the Overdrive counted from `from` on: `e` itself when it ends before the
 * Overdrive starts; inside the Overdrive when the 5x countdown runs out there;
 * otherwise `e` less 4 s for each Overdrive second.
 */
export const unlockFinishAt = (
  e: number,
  from: number,
  window: { s: number; e: number } | null
): number => {
  if (!window) return e;
  const start = Math.max(from, window.s);
  if (window.e <= start || e <= start) return e;

  const rate = CLOD_EXTRA_SECONDS + 1;
  const boosted = window.e - start;
  if (e - start <= rate * boosted) return start + Math.ceil((e - start) / rate);
  return e - CLOD_EXTRA_SECONDS * boosted;
};

/**
 * The catalogue entry for a monster a player may unlock, or `400 badRequest`:
 * an id not in the catalogue, a blocked one (C18, spawned by C17), or not a
 * surface `C` id (Inferno is out of scope, D19).
 */
export const obtainableOrThrow = (monster: string): MonsterEntry => {
  const entry = /^C\d+$/.test(monster) ? monsterEntry(monster) : undefined;
  if (!entry || entry.blocked) {
    throw yardBadRequestErr("That monster cannot be unlocked.", { monster });
  }
  return entry;
};

/**
 * The checks `start` and `instant` share, in the original's order
 * (`CREATURELOCKER.as:967-981`), plus the locker itself: `400 badRequest` not
 * obtainable; `409 alreadyUnlocked` already in `lockerdata`;
 * `409 unlockRunning {monster}` another unlock (or this one) is running;
 * `409 noLocker` no finished Monster Locker; `409 lockerLevel {have, need}`.
 * Putty is the wrapper's `409 shortfall` (start only).
 */
export const unlockGate = (save: LockerSave, monster: string): MonsterEntry => {
  const entry = obtainableOrThrow(monster);

  const running = runningUnlock(save.lockerdata);
  const existing = save.lockerdata?.[monster];
  if (existing && running?.monster !== monster) {
    throw yardRefusedErr("alreadyUnlocked", "That monster is already unlocked.", { monster });
  }
  if (running) {
    throw yardRefusedErr("unlockRunning", "Another unlock is already running.", {
      monster: running.monster,
    });
  }

  const have = lockerLevel(save.buildingdata);
  if (have < 1) throw yardRefusedErr("noLocker", "Build a Monster Locker first.");
  if (have < entry.level) {
    throw yardRefusedErr("lockerLevel", `Needs Monster Locker level ${entry.level}.`, {
      have,
      need: entry.level,
    });
  }

  return entry;
};

/** `409 notUnlocking`: no unlock is running. */
const notUnlockingErr = () => yardRefusedErr("notUnlocking", "No unlock is running.");

/** The running unlock, or `409 notUnlocking`. */
export const runningOrThrow = (save: LockerSave) => {
  const running = runningUnlock(save.lockerdata);
  if (!running) throw notUnlockingErr();
  return running;
};

/**
 * `lockerdata` and `academy` with `monster` unlocked: `t: 2`, `s`/`e` gone,
 * `academy[monster] ??= { level: 1 }` (`CREATURELOCKER.as:908-913`). The same
 * change the catch-up makes at completion.
 */
export const unlockedSlices = (save: LockerSave, monster: string) => ({
  lockerdata: { ...(save.lockerdata ?? {}), [monster]: { t: 2 } },
  academy: { ...(save.academy ?? {}), [monster]: save.academy?.[monster] ?? { level: 1 } },
});

/** What a putty credit actually adds once the storage cap has had its say (the wrapper's clamp, T3). */
const creditedPutty = (save: LockerSave, amount: number): number => {
  const held = finite(save.resources?.[PUTTY]) ?? 0;
  return Math.max(held, Math.min(held + amount, storageCap(save))) - held;
};

/** `report` of `POST /bm/yard/locker/start`. */
export interface LockerStartReport {
  monster: string;
  /** When the unlock ends (unix s), before any Overdrive. */
  endsAt: number;
  /** Putty charged. */
  cost: { r3: number };
}

/** `report` of `POST /bm/yard/locker/cancel`. */
export interface LockerCancelReport {
  monster: string;
  /** Putty actually returned, after the storage cap. */
  refund: { r3: number };
}

/** `report` of `POST /bm/yard/locker/finish` and `/instant`. */
export interface LockerShinyReport {
  monster: string;
  /** Shiny charged. */
  credits: number;
}

/** Starts unlocking `monster`: the full putty price now, the countdown from `now`. */
export const planLockerStart = (save: LockerSave, monster: string, now: number) => {
  const entry = unlockGate(save, monster);
  const endsAt = now + entry.time;
  const report: LockerStartReport = { monster, endsAt, cost: { r3: entry.resource } };

  return {
    report,
    slices: {
      lockerdata: { ...(save.lockerdata ?? {}), [monster]: { t: 1, s: now, e: endsAt } },
    },
    debit: { r3: entry.resource },
  };
};

/**
 * Cancels the running unlock: the entry goes and the catalogue's full putty
 * price comes back, clamped to the storage cap (`CREATURELOCKER.Cancel`,
 * `:1027-1035`). Progress is lost; Shiny spent on an Overdrive is not refunded.
 */
export const planLockerCancel = (save: LockerSave) => {
  const { monster } = runningOrThrow(save);
  const refund = monsterEntry(monster)?.resource ?? 0;
  const { [monster]: _cancelled, ...lockerdata } = save.lockerdata ?? {};
  const report: LockerCancelReport = { monster, refund: { r3: creditedPutty(save, refund) } };

  return { report, slices: { lockerdata }, credit: { r3: refund } };
};

/**
 * Finishes the running unlock now for `timeCost(e − now)` Shiny, free at five
 * minutes or less: the locker's Speed Up is the generic `SP4`
 * (`client/scripts/CREATURELOCKERPOPUP.as:352-354`). The catch-up has already
 * taken any Overdrive off `e`.
 */
export const planLockerFinish = (save: LockerSave, now: number) => {
  const { monster, entry } = runningOrThrow(save);
  const credits = timeCost((finite(entry.e) ?? now) - now);
  const report: LockerShinyReport = { monster, credits };

  return { report, slices: unlockedSlices(save, monster), shiny: credits };
};

/**
 * Unlocks `monster` at once for `timeCost(time) + ceil(sqrt(putty / 2)^0.75)`
 * Shiny and no putty (`CREATURELOCKERPOPUP.InstantUnlock`, `:365-443`). The
 * `start` checks apply except putty.
 */
export const planLockerInstant = (save: LockerSave, monster: string) => {
  const entry = unlockGate(save, monster);
  const credits = instantUnlockPrice(entry.time, entry.resource);
  const report: LockerShinyReport = { monster, credits };

  return { report, slices: unlockedSlices(save, monster), shiny: credits };
};
