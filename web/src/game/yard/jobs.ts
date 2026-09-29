import type {
  AcademyData,
  AcademyEntry,
  BaseLoadResponse,
  BuildingData,
  BuildingDataMap,
  LockerData,
  StoreData,
} from "@/api/types";
import { maxHealth } from "./buildingArt";
import { costOf, fortifyStepsOf, rowOf, upgradeSteps, type YardKind } from "./buildingCosts";
import { damageOf } from "./repair";
import { countdownOf, type YardBuilding, type YardCountdown } from "./yardModel";

/**
 * Every timer in the yard as one list of jobs with end times
 * (`docs/design/yard-buildings.md` §2.2, §2.4).
 *
 * The server completes jobs, always, in its catch-up; the client only
 * predicts when one will end, so the display can flip the moment it does and
 * `YardStore` can ask the server for the real outcome a second later. This
 * module is that prediction and nothing else: pure functions from a save to
 * `{ kind, key, endsAt }`, plus {@link predictCompletion}, which writes a
 * finished job into a copy of the save the way the server's catch-up will.
 *
 * Clocks follow the save (§2.2): building countdowns are seconds left at
 * `savetime`; locker, academy, lab, champion, mushroom and store timers are
 * absolute unix seconds; hatchery countdowns are seconds left at
 * `monsters.saved`. Every `endsAt` here is on the server's clock.
 */

export const JobKind = {
  BUILD: "build",
  UPGRADE: "upgrade",
  FORTIFY: "fortify",
  /** `cR`. Nothing in Map Room 2 completes it; listed so the countdown is known. */
  REBUILD: "rebuild",
  REPAIR: "repair",
  /** A harvester's buffer reaching its capacity. */
  HARVEST: "harvest",
  UNLOCK: "unlock",
  TRAIN: "train",
  RESEARCH: "research",
  /** The monster a hatchery has in production. */
  HATCH: "hatch",
  /** A champion's starvation deadline: a feed is lost when it passes. */
  HUNGER: "hunger",
  /** The next mushroom respawn. */
  MUSHROOM: "mushroom",
  /** A timed store buff expiring (`BST`, `CLOD`, `HOD`, …). */
  STORE_ITEM: "storeItem",
} as const;
export type JobKind = (typeof JobKind)[keyof typeof JobKind];

export interface YardJob {
  readonly kind: JobKind;
  /** Unique within one save: `upgrade:12`, `unlock:C5`, `storeItem:BST`, `hunger:0`. */
  readonly key: string;
  /** What the job is on: a building id, a roster id, a store code or a champion index. */
  readonly id: number | string;
  /** The building to point at for this job, when there is one. */
  readonly buildingId: number | null;
  /** Unix seconds, server clock. Null while the job is frozen (a damaged building's countdown, a stalled hatchery). */
  readonly endsAt: number | null;
  /** Build, upgrade and fortify countdowns hold a worker (`workers.ts`). */
  readonly holdsWorker: boolean;
}

/**
 * The job kinds the server's catch-up completes today. Only these flip the
 * display and trigger a `state` call when they end: flipping a kind the
 * server does not complete yet would show an outcome the next answer takes
 * back. Phase 1 completes building countdowns and store buffs
 * (`server/src/services/yard/catchUpBuildings.ts`), Phase 2 unlocks
 * (`catchUpLocker.ts`), Phase 3 mushroom respawns (`catchUpMushrooms.ts`: the
 * display changes nothing, the `state` answer brings the new mushroom) and
 * repairs (`catchUpRepairs.ts`), Phase 4 trainings and Lab research
 * (`catchUpTraining.ts`); each later work package adds its kinds here in the
 * same change that adds its catch-up step (`hatch` with `catchUpMonsters.ts`,
 * `hunger` with Phase 5).
 *
 * `harvest` stays out on purpose (owner decision 2026-09-28): a buffer
 * filling is predicted on the client (`harvest.ts`) and never worth a
 * request; the server hears about harvesters only when the player presses
 * Collect all or taps one.
 */
export const SERVER_COMPLETED_KINDS: ReadonlySet<JobKind> = new Set<JobKind>([
  JobKind.BUILD,
  JobKind.UPGRADE,
  JobKind.FORTIFY,
  JobKind.STORE_ITEM,
  JobKind.UNLOCK,
  JobKind.MUSHROOM,
  JobKind.TRAIN,
  JobKind.RESEARCH,
  JobKind.REPAIR,
]);

/** Monster Academy and Monster Lab type ids (`client/scripts/YARD_PROPS.as:2933`, `:6236`). */
export const ACADEMY_TYPE = 26;
export const LAB_TYPE = 116;

/** Twig Snapper to Goo Factory, the four harvesters. */
const HARVESTER_TYPES: ReadonlySet<number> = new Set([1, 2, 3, 4]);

/**
 * An academy `time` at or below 162 hours is a legacy remainder relative to
 * the save, not a date (`client/scripts/com/monsters/player/Player.as:170-177`).
 */
export const RELATIVE_TRAINING_LIMIT = 60 * 60 * 162;

/** A champion starves this long after its feed time passes (`CHAMPIONCAGE.as:26`). */
export const STARVE_SECONDS = 24 * 60 * 60;

/**
 * One mushroom respawns per this many seconds while the yard holds fewer than
 * the cap (design §5.6; the cap is 10, owner decision 2026-09-28,
 * `MUSHROOMS.as:135-137`). Mirrors `server/src/services/yard/mushrooms.ts`.
 */
export const MUSHROOM_RESPAWN_SECONDS = 17_280;
export const MUSHROOM_CAP = 10;

/** Hatchery Overdrive multipliers by store code (`docs/specs/monsters-and-hatchery.md` §5.5). */
export const OVERDRIVE_POWER: Readonly<Record<string, number>> = { HOD: 4, HOD2: 6, HOD3: 10 };

const finite = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * The moment the save's relative countdowns are measured from: `savetime`,
 * or the server's clock for a yard never saved — the same rule `readYard`
 * uses, so a job and the building drawn for it agree.
 */
export const savedAtOf = (save: Pick<BaseLoadResponse, "savetime" | "currenttime">): number =>
  typeof save.savetime === "number" && save.savetime > 0 ? save.savetime : save.currenttime;

/* ── Buildings ─────────────────────────────────────────────────────────── */

/**
 * When a harvester's buffer fills, or null when it is not filling.
 *
 * A cycle adds `produce[l-1]` after `cycleTime + ceil(cycleTime × (4 −
 * 4 / maxHealth × health))` seconds (`client/scripts/BRESOURCE.as:384-386`,
 * `:424-439`); `cP` is what is left of the current one (`rCP` read as a
 * fallback, the name this client first used). A harvester below
 * half health, or with a build, upgrade or fortify running, does not produce
 * (`BRESOURCE.as:301-302`). The Harvester Overdrive buff is not modelled.
 */
export const harvesterFullAt = (
  building: BuildingData,
  savedAt: number,
  health: BaseLoadResponse["buildinghealthdata"] = null,
): number | null => {
  if (!HARVESTER_TYPES.has(building.t)) return null;
  const stats = rowOf(building.t)?.[6];
  if (!stats) return null;
  if (building.cB || building.cU || building.cF) return null;

  const level = typeof building.l === "number" ? building.l : 1;
  const produce = stats.produce[level - 1];
  const cycleTime = stats.cycleTime[level - 1];
  const capacity = stats.capacity[level - 1];
  if (!produce || !cycleTime || capacity === undefined) return null;

  const max = maxHealth(building.t, level);
  const hp = finite(building.hp) ?? finite(health?.[String(building.id)]) ?? max;
  if (max !== null && hp !== null && hp < max * 0.5) return null;

  const stored = finite(building.st) ?? 0;
  if (stored >= capacity) return null;

  const cycle =
    max !== null && hp !== null && max > 0
      ? cycleTime + Math.ceil(cycleTime * (4 - (4 / max) * hp))
      : cycleTime;
  const cycles = Math.ceil((capacity - stored) / produce);
  const current = finite(building.cP) ?? finite(building.rCP);
  const first = current !== null && current > 0 ? current : cycle;
  return savedAt + first + (cycles - 1) * cycle;
};

/** Build, upgrade, fortify and rebuild countdowns, repairs, and harvester buffers. */
export const buildingJobs = (
  buildings: BuildingDataMap | null | undefined,
  savedAt: number,
  health: BaseLoadResponse["buildinghealthdata"] = null,
): YardJob[] => {
  const jobs: YardJob[] = [];
  for (const [key, building] of Object.entries(buildings ?? {})) {
    if (!building || typeof building.t !== "number") continue;
    const id = typeof building.id === "number" ? building.id : Number(key);
    const row = { ...building, id };

    const countdown = countdownOf(row, savedAt, health);
    if (countdown) {
      jobs.push({
        kind: countdown.kind,
        key: `${countdown.kind}:${id}`,
        id,
        buildingId: id,
        endsAt: countdown.paused ? null : countdown.endsAt,
        // A Starter Kit prefab builds up without the worker (outposts WP9).
        holdsWorker:
          countdown.kind !== JobKind.REBUILD &&
          !(countdown.kind === JobKind.BUILD && Number(row.prefab) > 0),
      });
    }

    // The server's reading and rate (`repair.ts`): the type's own repairTime.
    const damage = row.rE ? damageOf(row, { buildinghealthdata: health }, key) : null;
    if (damage) {
      jobs.push({
        kind: JobKind.REPAIR,
        key: `${JobKind.REPAIR}:${id}`,
        id,
        buildingId: id,
        endsAt: savedAt + Math.ceil((damage.max - damage.health) / damage.rate),
        holdsWorker: false,
      });
    }

    const full = harvesterFullAt(row, savedAt, health);
    if (full !== null) {
      jobs.push({
        kind: JobKind.HARVEST,
        key: `${JobKind.HARVEST}:${id}`,
        id,
        buildingId: id,
        endsAt: full,
        holdsWorker: false,
      });
    }
  }
  return jobs;
};

/* ── Progress of a building job ───────────────────────────────────────── */

/** How far along a building's countdown is at one moment. */
export interface CountdownProgress {
  /** Seconds left; the stored figure while the countdown is paused. */
  readonly remaining: number;
  /** Seconds the job runs in all: at least `remaining`, and never 0. */
  readonly total: number;
  /** 0 when the job has just started, 1 when it is done. */
  readonly fraction: number;
}

/**
 * How long a build or upgrade runs in all, in seconds.
 *
 * The server stores it as `cL` when it starts the job (#136): the countdown
 * alone cannot say, because Sharper Tools shortens a job by a fifth and the
 * cost table does not know that. A job started before `cL` existed, and any
 * fortify or rebuild, falls back to the table's time for the step, which is
 * exact whenever Sharper Tools was not running.
 *
 * The table is the yard's own (#191): on an outpost its times, its fortify
 * ladder for a fortification (`fortifyStepsOf`, the step that leaves the
 * building's `fort`), and for a Starter Kit prefab every step up to its level
 * (`client/scripts/BFOUNDATION.as:3057-3063`).
 *
 * @param level - The building's level now: 0 while it is being built.
 * @param yard - Which table the yard reads; a main yard when absent.
 */
export const countdownLength = (
  raw: BuildingData,
  kind: YardCountdown["kind"],
  level: number,
  yard: YardKind = "main",
): number => {
  const stored = finite(raw.cL);
  if (stored !== null && stored > 0 && (kind === JobKind.BUILD || kind === JobKind.UPGRADE)) {
    return stored;
  }
  if (kind === JobKind.FORTIFY) {
    return fortifyStepsOf(raw.t, yard)[Math.max(0, Math.floor(finite(raw.fort) ?? 0))]?.[4] ?? 0;
  }
  const prefab = finite(raw.prefab);
  if (kind === JobKind.BUILD && prefab !== null && prefab > 0) {
    return upgradeSteps(raw.t, 0, prefab, yard).reduce((total, step) => total + step[4], 0);
  }
  return costOf(raw.t, kind === JobKind.BUILD ? 0 : level, yard)?.[4] ?? 0;
};

/** `1 − remaining / total`, held between 0 and 1. */
export const progressFraction = (remaining: number, total: number): number =>
  total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 1;

/**
 * A building's running countdown at `now` (server clock): what is left, the
 * whole, and the fraction done, or null when nothing is running. The one
 * reading the building panel's bar and the bar drawn over the building in the
 * yard both use (#136, #139).
 */
export const countdownProgress = (
  building: Pick<YardBuilding, "level" | "countdown" | "raw">,
  now: number,
  yard: YardKind = "main",
): CountdownProgress | null => {
  const countdown = building.countdown;
  if (!countdown) return null;
  const remaining = countdown.paused ? countdown.seconds : Math.max(0, countdown.endsAt - now);
  const total = Math.max(
    countdownLength(building.raw, countdown.kind, building.level, yard),
    remaining,
    1,
  );
  return { remaining, total, fraction: progressFraction(remaining, total) };
};

/** The first building of a type, for pointing a monster job at its building. */
const firstOfType = (
  buildings: BuildingDataMap | null | undefined,
  type: number,
): number | null => {
  for (const [key, building] of Object.entries(buildings ?? {})) {
    if (building?.t === type)
      return typeof building.id === "number" ? building.id : Number(key);
  }
  return null;
};

/* ── Monsters ──────────────────────────────────────────────────────────── */

/** The Overdrive's length (`CLOD` `du`, `server/src/game-data/store/storeItems.ts`). */
const CLOD_SECONDS = 14_400;

/**
 * When an unlock stored as ending at `e` (at `from`) really ends, with the
 * Monster Locker Overdrive (`storedata.CLOD`, `{ s, e }`) taking 4 extra
 * seconds off per second from `from` on: the server's `unlockFinishAt`
 * (`server/src/services/yard/locker.ts`), which its catch-up applies (§4.3).
 */
export const unlockEndsAt = (
  e: number,
  from: number,
  storedata: StoreData | null | undefined,
): number => {
  const clodEnd = finite(storedata?.["CLOD"]?.e);
  if (clodEnd === null) return e;
  const clodStart = finite(storedata?.["CLOD"]?.s) ?? clodEnd - CLOD_SECONDS;
  const start = Math.max(from, clodStart);
  if (clodEnd <= start || e <= start) return e;
  const boosted = clodEnd - start;
  if (e - start <= 5 * boosted) return start + Math.ceil((e - start) / 5);
  return e - 4 * boosted;
};

/**
 * The running surface unlock (`lockerdata[id] = { t: 1, e }`), absolute `e`,
 * brought forward by a Locker Overdrive running after `savedAt`
 * ({@link unlockEndsAt}). Inferno (`IC…`) entries are not the server's to
 * finish (D19) and are left out.
 */
export const lockerJobs = (
  lockerdata: LockerData | null | undefined,
  lockerId: number | null = null,
  storedata: StoreData | null | undefined = null,
  savedAt = 0,
): YardJob[] => {
  const jobs: YardJob[] = [];
  for (const [monster, entry] of Object.entries(lockerdata ?? {})) {
    const ends = finite(entry?.e);
    if (entry?.t !== 1 || ends === null || !monster.startsWith("C")) continue;
    const started = finite(entry.s);
    jobs.push({
      kind: JobKind.UNLOCK,
      key: `${JobKind.UNLOCK}:${monster}`,
      id: monster,
      buildingId: lockerId,
      endsAt: unlockEndsAt(ends, Math.max(savedAt, started ?? 0), storedata),
      holdsWorker: false,
    });
  }
  return jobs;
};

/**
 * The absolute end of a training, converting a legacy relative `time`
 * (at or below {@link RELATIVE_TRAINING_LIMIT}) against `savedAt` as the
 * server's catch-up does once (§2.5).
 */
export const trainingEndsAt = (time: number, savedAt: number): number =>
  time <= RELATIVE_TRAINING_LIMIT ? time + savedAt : time;

/**
 * The Monster Academy training `monster`: the one whose `upg` names it
 * (`client/scripts/BUILDING26.as:103-121`), else the first academy.
 */
const academyTraining = (
  buildings: BuildingDataMap | null | undefined,
  monster: string,
): number | null => {
  for (const [key, building] of Object.entries(buildings ?? {})) {
    if (building?.t === ACADEMY_TYPE && building["upg"] === monster)
      return typeof building.id === "number" ? building.id : Number(key);
  }
  return firstOfType(buildings, ACADEMY_TYPE);
};

/** Academy trainings (`academy[id].time`), each on the academy doing it. */
export const trainingJobs = (
  academy: AcademyData | null | undefined,
  savedAt: number,
  buildings: BuildingDataMap | null | undefined = null,
): YardJob[] => {
  const jobs: YardJob[] = [];
  for (const [monster, entry] of Object.entries(academy ?? {})) {
    const time = finite(entry?.time);
    if (time === null || time <= 0) continue;
    jobs.push({
      kind: JobKind.TRAIN,
      key: `${JobKind.TRAIN}:${monster}`,
      id: monster,
      buildingId: academyTraining(buildings, monster),
      endsAt: trainingEndsAt(time, savedAt),
      holdsWorker: false,
    });
  }
  return jobs;
};

/** Lab research: the lab building's `upg` (monster), `upt` (absolute end) and `upl` (rank). */
export const researchJobs = (buildings: BuildingDataMap | null | undefined): YardJob[] => {
  const jobs: YardJob[] = [];
  for (const [key, building] of Object.entries(buildings ?? {})) {
    if (building?.t !== LAB_TYPE) continue;
    const ends = finite(building["upt"]);
    const monster = building["upg"];
    if (ends === null || typeof monster !== "string" || !monster) continue;
    const id = typeof building.id === "number" ? building.id : Number(key);
    jobs.push({
      kind: JobKind.RESEARCH,
      key: `${JobKind.RESEARCH}:${monster}`,
      id: monster,
      buildingId: id,
      endsAt: ends,
      holdsWorker: false,
    });
  }
  return jobs;
};

/** The Hatchery Overdrive running at `at`: its power and expiry, or null. */
export const overdriveAt = (
  storedata: StoreData | null | undefined,
  at: number,
): { power: number; until: number } | null => {
  let best: { power: number; until: number } | null = null;
  for (const [code, power] of Object.entries(OVERDRIVE_POWER)) {
    const until = finite(storedata?.[code]?.e);
    if (until === null || until <= at) continue;
    if (!best || power > best.power) best = { power, until };
  }
  return best;
};

/**
 * When a countdown of `seconds` left at `from` reaches zero, running
 * `power` times faster until `until` (Hatchery Overdrive, `BUILDING13.as:321-326`).
 */
export const acceleratedEnd = (
  from: number,
  seconds: number,
  overdrive: { power: number; until: number } | null,
): number => {
  if (!overdrive || overdrive.until <= from || overdrive.power <= 1) return from + seconds;
  const fast = overdrive.until - from;
  if (seconds <= fast * overdrive.power) return from + seconds / overdrive.power;
  return overdrive.until + (seconds - fast * overdrive.power);
};

/**
 * Each producing hatchery's current monster (`monsters.h[i]` with
 * `hstage[i] == 1`), measured from `monsters.saved`. A stalled hatchery
 * (stage 2, waiting for housing) has no end until housing frees up, so it is
 * listed with `endsAt: null`; an idle one is not listed.
 */
export const hatcheryJobs = (
  monsters: BaseLoadResponse["monsters"],
  storedata: StoreData | null | undefined,
  savedAt: number,
): YardJob[] => {
  const h = monsters?.h;
  const hid = monsters?.hid;
  const stages = monsters?.hstage;
  if (!Array.isArray(h) || !Array.isArray(hid)) return [];
  const from = finite(monsters?.saved) ?? savedAt;
  const overdrive = overdriveAt(storedata, from);

  const jobs: YardJob[] = [];
  h.forEach((slot, index) => {
    const building = hid[index];
    const stage = Array.isArray(stages) ? stages[index] : undefined;
    if (!Array.isArray(slot) || typeof building !== "number") return;
    const [monster, countdown] = slot;
    if (!monster || (stage !== 1 && stage !== 2)) return;
    const seconds = finite(countdown) ?? 0;
    jobs.push({
      kind: JobKind.HATCH,
      key: `${JobKind.HATCH}:${building}`,
      id: building,
      buildingId: building,
      endsAt: stage === 2 ? null : acceleratedEnd(from, Math.max(0, seconds), overdrive),
      holdsWorker: false,
    });
  });
  return jobs;
};

/**
 * Each active champion's starvation deadline: `ft + 24 h`
 * (`ChampionBase.as:1062-1076`). Frozen champions (status 1) keep a relative
 * `ft` and do not starve, so only status 0 is listed.
 */
export const championJobs = (champions: BaseLoadResponse["champion"]): YardJob[] => {
  const jobs: YardJob[] = [];
  (champions ?? []).forEach((champion, index) => {
    const ft = finite(champion?.ft);
    if (champion?.status !== 0 || ft === null || ft <= 0) return;
    jobs.push({
      kind: JobKind.HUNGER,
      key: `${JobKind.HUNGER}:${index}`,
      id: index,
      buildingId: null,
      endsAt: ft + STARVE_SECONDS,
      holdsWorker: false,
    });
  });
  return jobs;
};

/** The next mushroom respawn, while the yard holds fewer than {@link MUSHROOM_CAP}. */
export const mushroomJobs = (mushrooms: BaseLoadResponse["mushrooms"]): YardJob[] => {
  const last = finite(mushrooms?.s);
  const count = Array.isArray(mushrooms?.l) ? mushrooms.l.length : 0;
  if (last === null || last <= 0 || count >= MUSHROOM_CAP) return [];
  return [
    {
      kind: JobKind.MUSHROOM,
      key: JobKind.MUSHROOM,
      id: JobKind.MUSHROOM,
      buildingId: null,
      endsAt: last + MUSHROOM_RESPAWN_SECONDS,
      holdsWorker: false,
    },
  ];
};

/** Timed store buffs (`storedata[code].e`). */
export const storeItemJobs = (storedata: StoreData | null | undefined): YardJob[] => {
  const jobs: YardJob[] = [];
  for (const [code, entry] of Object.entries(storedata ?? {})) {
    const ends = finite(entry?.e);
    if (ends === null || ends <= 0) continue;
    jobs.push({
      kind: JobKind.STORE_ITEM,
      key: `${JobKind.STORE_ITEM}:${code}`,
      id: code,
      buildingId: null,
      endsAt: ends,
      holdsWorker: false,
    });
  }
  return jobs;
};

/** Monster Locker type id (`client/scripts/YARD_PROPS.as:913`). */
const LOCKER_TYPE = 8;

/**
 * Every job in the yard, soonest first, frozen jobs last.
 *
 * `extends countdownOf`: the building half is `countdownOf` in `yardModel.ts`
 * with the paused rule the server applies; the rest are the monster, champion,
 * mushroom and store timers of §2.2.
 */
export const yardJobs = (save: BaseLoadResponse): YardJob[] => {
  const savedAt = savedAtOf(save);
  const buildings = save.buildingdata;
  const jobs = [
    ...buildingJobs(buildings, savedAt, save.buildinghealthdata),
    ...lockerJobs(save.lockerdata, firstOfType(buildings, LOCKER_TYPE), save.storedata, savedAt),
    ...trainingJobs(save.academy, savedAt, buildings),
    ...researchJobs(buildings),
    ...hatcheryJobs(save.monsters, save.storedata, savedAt),
    ...championJobs(save.champion),
    ...mushroomJobs(save.mushrooms),
    ...storeItemJobs(save.storedata),
  ];
  return jobs.sort(
    (a, b) =>
      (a.endsAt ?? Number.POSITIVE_INFINITY) - (b.endsAt ?? Number.POSITIVE_INFINITY) ||
      a.key.localeCompare(b.key),
  );
};

/** The soonest-ending job holding a worker, for the HUD's Workers control (design §3.1). */
export const nextWorkerJob = (jobs: readonly YardJob[]): YardJob | null =>
  jobs.find((job) => job.holdsWorker && job.endsAt !== null) ?? null;

/* ── Predicting a completion ──────────────────────────────────────────── */

/**
 * A copy of the save with these jobs finished, as the server's catch-up
 * will finish them, so the display can flip the moment a countdown reaches
 * zero (§2.4 step 1). The server's answer replaces it a second later.
 *
 * Building countdowns follow `advanceBuildingTimers` exactly
 * (`server/src/services/base/advanceBuildingTimers.ts:53-75`): an upgrade
 * raises `l` by one, a build takes `prefab` as its level when it has one, a
 * fortify raises `fort`. The rest follow §2.2's "On completion" column.
 * Kinds whose outcome the server decides (a hatch into housing, a
 * starvation, a respawn at a random spot, a rebuild) are left as they are.
 *
 * Nothing in `save` is mutated; every slice touched is copied.
 */
export const predictCompletion = (
  save: BaseLoadResponse,
  jobs: readonly YardJob[],
): BaseLoadResponse => {
  if (jobs.length === 0) return save;

  // The slices this prediction touched, each copied once on first touch.
  const next: {
    buildingdata?: BuildingDataMap;
    buildinghealthdata?: Record<string, number>;
    storedata?: StoreData;
    lockerdata?: LockerData;
    academy?: AcademyData;
  } = {};

  const building = (id: number | null): BuildingData | null => {
    if (id === null) return null;
    const buildings = (next.buildingdata ??= { ...(save.buildingdata ?? {}) });
    const current = buildings[String(id)];
    if (!current) return null;
    const copy = { ...current };
    buildings[String(id)] = copy;
    return copy;
  };
  const academyEntry = (monster: string): AcademyEntry => {
    const academy = (next.academy ??= { ...(save.academy ?? {}) });
    const copy = { ...(academy[monster] ?? {}) };
    academy[monster] = copy;
    return copy;
  };

  for (const job of jobs) {
    switch (job.kind) {
      case JobKind.UPGRADE: {
        const row = building(job.buildingId);
        if (!row) break;
        delete row.cU;
        delete row.cL;
        row.l = (typeof row.l === "number" && row.l > 0 ? row.l : 1) + 1;
        break;
      }
      case JobKind.BUILD: {
        const row = building(job.buildingId);
        if (!row) break;
        delete row.cB;
        delete row.cL;
        if (typeof row["prefab"] === "number" && row["prefab"] > 0) row.l = row["prefab"];
        delete row["prefab"];
        break;
      }
      case JobKind.FORTIFY: {
        const row = building(job.buildingId);
        if (!row) break;
        delete row.cF;
        row.fort = (typeof row.fort === "number" ? row.fort : 0) + 1;
        break;
      }
      case JobKind.REPAIR: {
        const row = building(job.buildingId);
        if (!row) break;
        delete row.hp;
        delete row.rE;
        const health = (next.buildinghealthdata ??= { ...(save.buildinghealthdata ?? {}) });
        delete health[String(job.buildingId)];
        break;
      }
      case JobKind.HARVEST: {
        const row = building(job.buildingId);
        if (!row) break;
        const level = typeof row.l === "number" ? row.l : 1;
        const capacity = rowOf(row.t)?.[6]?.capacity[level - 1];
        if (capacity !== undefined) row.st = capacity;
        break;
      }
      case JobKind.STORE_ITEM: {
        const storedata = (next.storedata ??= { ...(save.storedata ?? {}) });
        delete storedata[String(job.id)];
        break;
      }
      case JobKind.UNLOCK: {
        const monster = String(job.id);
        const lockerdata = (next.lockerdata ??= { ...(save.lockerdata ?? {}) });
        lockerdata[monster] = { t: 2 };
        const entry = academyEntry(monster);
        if (typeof entry.level !== "number") entry.level = 1;
        break;
      }
      case JobKind.TRAIN: {
        const monster = String(job.id);
        const entry = academyEntry(monster);
        entry.level = (typeof entry.level === "number" ? entry.level : 1) + 1;
        delete entry.time;
        delete entry.duration;
        const hall = building(job.buildingId);
        if (hall && hall["upg"] === monster) delete hall["upg"];
        break;
      }
      case JobKind.RESEARCH: {
        const lab = building(job.buildingId);
        if (!lab) break;
        const rank = finite(lab["upl"]);
        if (rank !== null) academyEntry(String(job.id)).powerup = rank;
        delete lab["upg"];
        delete lab["upt"];
        delete lab["upl"];
        break;
      }
      default:
        break;
    }
  }

  return { ...save, ...next };
};
