import {
  isInfernoMonster,
  monsterEntry,
  type MonsterEntry,
} from "../../game-data/monsterCatalogue.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { StorageCapSave } from "../base/economy/resourceBudget.js";
import { levelOf, yardKindOf } from "../yardplanner/costs.js";
import { fitCredit } from "./credit.js";
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
 *
 * **The Inferno yard** (`docs/design/inferno.md` §2.6, WP 2.2) has its own
 * Locker, `lockerdata` and `academy` on the Inferno row. The same rules run
 * there for the Inferno roster (`IC1`..`IC8`) only, priced from the
 * catalogue's `INFERNO_MONSTER_CATALOGUE`; `r3` is then Sulfur, paid from the
 * Inferno purse (`infernoView`). Spurtz (`IC1`) is always unlocked there, as
 * the Pokey is on the surface (`CREATURELOCKER.getFirstCreatureID`, `:58-66`).
 * Each yard only ever sees its own realm's unlock (`CREATURELOCKER.Tick`,
 * `:895-903`).
 */

/**
 * Which roster a yard's Locker, Academy and Hatcheries serve: the surface
 * monsters (`C…`) on a main yard or outpost, the Inferno ones (`IC…`) on the
 * Inferno yard (`BASE.isInfernoMainYardOrOutpost`).
 */
export type MonsterRealm = "surface" | "inferno";

/** The realm of the yard `save` is. */
export const monsterRealmOf = (save: { type?: string | null } | null | undefined): MonsterRealm =>
  yardKindOf(save) === "inferno" ? "inferno" : "surface";

/** True when `id` belongs to `realm`'s roster: `C<n>` on the surface, `IC<n>` in the Inferno. */
export const inRealm = (id: string, realm: MonsterRealm): boolean =>
  realm === "inferno" ? isInfernoMonster(id) : /^C\d+$/.test(id);

/** Monster Locker type id (`client/scripts/YARD_PROPS.as:901`). */
export const LOCKER_TYPE = 8;

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

/**
 * The monster every player has from the start: the Pokey. Flash set
 * `_lockerData.C1 = { t: 2 }` on every load (`CREATURELOCKER.as:63-65`), so a
 * new player could hatch Pokeys from their first Hatchery, long before a
 * Monster Locker (issue #218).
 */
export const STARTER_MONSTER = "C1";

/** The Inferno's always-unlocked monster, Spurtz (`CREATURELOCKER.as:58-60`). */
export const INFERNO_STARTER_MONSTER = "IC1";

/** The monster `realm`'s yards always have unlocked. */
export const starterMonsterOf = (realm: MonsterRealm): string =>
  realm === "inferno" ? INFERNO_STARTER_MONSTER : STARTER_MONSTER;

/**
 * `lockerdata` with the Pokey unlocked, as Flash's load made it: the same
 * object when it already is, otherwise a copy with `C1: { t: 2 }`. Like Flash
 * it replaces a running Pokey unlock, which a save from before #218 may hold.
 * On the Inferno yard (`realm` `inferno`) the monster is Spurtz.
 */
export const withStarterUnlocked = (
  lockerdata: JsonObject | null | undefined,
  realm: MonsterRealm = "surface"
): JsonObject => {
  const starter = starterMonsterOf(realm);
  if (lockerdata && Number((lockerdata[starter] as JsonObject | undefined)?.t) === 2) {
    return lockerdata;
  }
  return { ...(lockerdata ?? {}), [starter]: { t: 2 } };
};

/** One `lockerdata` entry: `t` 1 unlocking (with `s`/`e`), 2 unlocked. */
export interface LockerEntry {
  t: number;
  s?: number;
  e?: number;
}

/** The slice of a save the locker routes read. */
export interface LockerSave extends StorageCapSave {
  /** `BaseType`: the Inferno yard unlocks the Inferno roster ({@link monsterRealmOf}). */
  type?: string;
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
 * The running unlock of `realm`, or null. Like `CREATURELOCKER.Tick` it takes
 * the first `t: 1` entry of the yard's realm (`:895-903`), so a surface yard
 * never counts an Inferno (`IC…`) entry and the Inferno yard never a surface one.
 */
export const runningUnlock = (
  lockerdata: JsonObject | null | undefined,
  realm: MonsterRealm = "surface"
): { monster: string; entry: LockerEntry } | null => {
  for (const [monster, entry] of Object.entries(lockerdata ?? {})) {
    if (!inRealm(monster, realm) || Number(entry?.t) !== 1) continue;
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
 * an id not in the catalogue, a blocked one (C18, spawned by C17), or not of
 * the yard's realm (an Inferno `IC` id on the surface, a `C` id in the Inferno).
 */
export const obtainableOrThrow = (monster: string, realm: MonsterRealm = "surface"): MonsterEntry => {
  const entry = inRealm(monster, realm) ? monsterEntry(monster) : undefined;
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
  const realm = monsterRealmOf(save);
  const entry = obtainableOrThrow(monster, realm);

  const running = runningUnlock(save.lockerdata, realm);
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
  const running = runningUnlock(save.lockerdata, monsterRealmOf(save));
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
  // What the wrapper's clamp will let through (`credit.ts`, T3), for the report.
  const report: LockerCancelReport = {
    monster,
    refund: { r3: fitCredit(save, { r3: refund }).credited.r3 },
  };

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
