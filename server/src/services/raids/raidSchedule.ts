import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { playerLevelOf } from "../base/calculateBaseLevel.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { ATTACK_ONLINE_SECONDS, isOnline, readPresenceMarks, type PresenceMarks } from "../user/online.js";
import { damagedBuildings } from "../yard/repair.js";
import { readOpenRaid, readRaidScreen, type RaidScreen } from "./raidStore.js";

/**
 * When a wild monster raid is due (#226 WP2, `docs/design/wild-raids.md`
 * §4.1 and §8.1).
 *
 * The schedule is the save's `aiattacks` column, Flash's `_history`
 * (`client/scripts/WMATTACK.as:135-202`). Flash ran raids on the client and
 * the server only stored what it sent; here the server owns it: `aiattacks`
 * is not in `Save.saveKeys`, so `/base/save` cannot write it, and a
 * Flash-era value is read through {@link readSchedule} and written back in
 * the new shape on the player's next yard load.
 *
 * Flash's names are kept. Its timing, which has no randomness:
 *
 * - every own-main-yard build load is a session (`WMATTACK.as:155`);
 * - with no raid in the last 4 days, or never one, the next is due 60
 *   seconds into the session (`:190-199`);
 * - otherwise it is due 2, 3 or 4 days after the last by the player's more /
 *   same / less choice, which also sizes the army and the hits each raider
 *   makes before it leaves (`:978-1008`; {@link RAID_PREFERENCES}).
 *
 * The owner's answers of 2026-10-05 add: no raid while anything in the yard
 * is damaged or repairing (Flash meant this and its check never worked,
 * `:271-287`), and protection does not stop one.
 */

/** Raids start at this player level (`WMATTACK.as:327`, `BASE._baseLevel >= 9`). */
export const RAID_MIN_LEVEL = 9;

/** Own-yard loads needed since the last raid (`WMATTACK.as:72`). */
export const SESSIONS_BETWEEN_RAIDS = 4;

/** A last raid longer ago than this, or none, makes the next due early (`WMATTACK.as:190`). */
export const LONG_GAP_SECONDS = 4 * 24 * 60 * 60;

/** ...this long after the session began (`WMATTACK.as:193`, `:197`). */
export const FIRST_RAID_DELAY_SECONDS = 60;

/** How many finished raids `recent` keeps, newest first. */
export const RECENT_RAIDS_KEPT = 10;

/** The player's choice after a raid: -1 less often, 0 the same, 1 more often. */
export type RaidPreference = -1 | 0 | 1;

/** What a preference does (`WMATTACK.as:978-1008`). */
export interface RaidPreferenceEffect {
  /** The wait from the last raid to the next. */
  readonly waitSeconds: number;
  /** The army's size multiplier (`_attackVolumeAmplifier`). */
  readonly amplifier: number;
  /** Building hits each raider makes before it leaves (`_hitsPerCreep`). */
  readonly hitLimit: number;
}

const DAY = 24 * 60 * 60;

export const RAID_PREFERENCES: Readonly<Record<RaidPreference, RaidPreferenceEffect>> = {
  [-1]: { waitSeconds: 4 * DAY, amplifier: 0.5, hitLimit: 20 },
  0: { waitSeconds: 3 * DAY, amplifier: 1, hitLimit: 30 },
  1: { waitSeconds: 2 * DAY, amplifier: 1.3, hitLimit: 50 },
};

/** One finished raid, as `recent` keeps it. */
export interface RaidRecord {
  readonly id: string;
  /** Unix seconds the fight started. */
  readonly at: number;
  readonly tribe: string;
  /** The yard's health at the end, 0 to 1, walls and traps left out. */
  readonly health: number;
  readonly stolen: Readonly<Record<string, number>>;
  /** Shiny paid for a good defence, 0 or 10. */
  readonly shiny: number;
}

/** `aiattacks` as the server keeps it (design §8.1). */
export interface RaidSchedule {
  readonly v: 2;
  /** Unix seconds the last finished raid started; 0 when there never was one. */
  readonly lastattack: number;
  /** Unix seconds the next raid is due from; absent until a session sets it. */
  readonly nextAttack?: number;
  readonly sessionsSinceLastAttack: number;
  readonly attackPreference: RaidPreference;
  /** The last raid applied, so a second finish of it applies nothing. */
  readonly lastRaidId?: string;
  readonly recent: readonly RaidRecord[];
  /** Flash's Trojan Horse state, left as it is for the backlog's issue (#306). */
  readonly s1?: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A whole number from a number or numeric string (Flash wrote `nextAttack` with a fraction); else undefined. */
const whole = (value: unknown): number | undefined => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : undefined;
};

const readRecord = (value: unknown): RaidRecord | null => {
  if (!isObject(value) || typeof value.id !== "string") return null;
  const stolen: Record<string, number> = {};
  if (isObject(value.stolen)) {
    for (const [key, amount] of Object.entries(value.stolen)) {
      const n = whole(amount);
      if (n !== undefined) stolen[key] = n;
    }
  }
  const health = typeof value.health === "number" && Number.isFinite(value.health) ? value.health : 0;
  return {
    id: value.id,
    at: whole(value.at) ?? 0,
    tribe: typeof value.tribe === "string" ? value.tribe : "",
    health,
    stolen,
    shiny: whole(value.shiny) ?? 0,
  };
};

/**
 * Reads `aiattacks` as it is stored, in any shape: null, `{}`, a Flash-era
 * `_history` (numbers or numeric strings, Flash's `queued` raid, its debug
 * values) or this module's own. Never throws. Flash's `queued` is dropped
 * (an open raid lives in Redis, `raidStore.ts`); `s1` is kept as it was.
 */
export const readSchedule = (raw: unknown): RaidSchedule => {
  const stored = isObject(raw) ? raw : {};
  const preference = whole(stored.attackPreference) ?? 0;
  const nextAttack = whole(stored.nextAttack);
  const recent = Array.isArray(stored.recent)
    ? stored.recent.flatMap((entry) => readRecord(entry) ?? []).slice(0, RECENT_RAIDS_KEPT)
    : [];
  return {
    v: 2,
    lastattack: Math.max(0, whole(stored.lastattack) ?? 0),
    ...(nextAttack !== undefined && nextAttack > 0 ? { nextAttack } : {}),
    sessionsSinceLastAttack: Math.max(0, whole(stored.sessionsSinceLastAttack) ?? 0),
    attackPreference: Math.sign(preference) as RaidPreference,
    ...(typeof stored.lastRaidId === "string" ? { lastRaidId: stored.lastRaidId } : {}),
    recent,
    ...("s1" in stored ? { s1: stored.s1 } : {}),
  };
};

/** The schedule as the column stores it. */
export const scheduleColumn = (schedule: RaidSchedule): JsonObject => structuredClone(schedule) as unknown as JsonObject;

/**
 * One own-main-yard build load (`WMATTACK.Setup`, `:143-202`): one more
 * session, and the next raid's time when the last is over 4 days old (60
 * seconds from now, renewed on every load, as Flash did) or when none is set
 * yet (the wait the player's preference gives).
 */
export const startSession = (schedule: RaidSchedule, now: number): RaidSchedule => {
  const sessions = { ...schedule, sessionsSinceLastAttack: schedule.sessionsSinceLastAttack + 1 };
  if (now - schedule.lastattack > LONG_GAP_SECONDS) return { ...sessions, nextAttack: now + FIRST_RAID_DELAY_SECONDS };
  if (schedule.nextAttack === undefined) {
    return { ...sessions, nextAttack: schedule.lastattack + RAID_PREFERENCES[schedule.attackPreference].waitSeconds };
  }
  return sessions;
};

/**
 * The player's more / same / less choice (`WMATTACK.as:978-1008`): the next
 * raid moves to that wait after the last one. With no raid yet the time is
 * left to the 4-day rule.
 */
export const setRaidFrequency = (schedule: RaidSchedule, preference: RaidPreference): RaidSchedule => {
  const next = { ...schedule, attackPreference: preference };
  if (schedule.lastattack <= 0) return next;
  return { ...next, nextAttack: schedule.lastattack + RAID_PREFERENCES[preference].waitSeconds };
};

/** A preference from a request: "more" / "same" / "less" or 1 / 0 / -1; null for anything else. */
export const parseRaidPreference = (value: unknown): RaidPreference | null => {
  switch (value) {
    case "more":
    case 1:
      return 1;
    case "same":
    case 0:
      return 0;
    case "less":
    case -1:
      return -1;
    default:
      return null;
  }
};

/** Whether this raid was already applied (design §8.2: finish applies once). */
export const raidAlreadyApplied = (schedule: RaidSchedule, raidId: string): boolean =>
  schedule.lastRaidId === raidId;

/**
 * A finished raid (design §6.3, Flash's `ResetWait`, `WMATTACK.as:964-972`):
 * the wait starts again from the fight's start, sessions back to 0, the next
 * raid after the preference's wait (D2 applies the choice every time), and
 * the raid kept in `recent`. A cancelled raid never comes here, so it stays
 * due and comes back on the player's next yard visit (owner, Q1).
 */
export const recordRaidFinished = (schedule: RaidSchedule, record: RaidRecord): RaidSchedule => ({
  ...schedule,
  lastattack: record.at,
  nextAttack: record.at + RAID_PREFERENCES[schedule.attackPreference].waitSeconds,
  sessionsSinceLastAttack: 0,
  lastRaidId: record.id,
  recent: [record, ...schedule.recent].slice(0, RECENT_RAIDS_KEPT),
});

/** Why no raid is due; the gates in the order they are checked. */
export type RaidNotDue =
  | "notMainYard"
  | "mapRoom"
  | "level"
  | "sessions"
  | "notYet"
  | "damaged"
  | "underAttack"
  | "raidOpen"
  | "offline"
  | "screen";

/** The slice of a main save the due rule reads. */
export interface RaidDueSave {
  type?: string;
  mapversion?: number;
  points?: string | null;
  basevalue?: string | null;
  aiattacks?: unknown;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** Everything the due rule needs, read beforehand. */
export interface RaidDueFacts {
  readonly save: RaidDueSave;
  readonly now: number;
  readonly marks: PresenceMarks;
  /** The last presence ping's screen, or null when it said none (or expired). */
  readonly screen: RaidScreen | null;
  readonly underAttack: boolean;
  readonly raidOpen: boolean;
}

/** Map Rooms whose main yards are raided (design §4.1: Map Room 1 or 2). */
const RAIDED_MAP_ROOMS: ReadonlySet<number> = new Set([MapRoomVersion.V1, MapRoomVersion.V2]);

/**
 * Any building damaged or repairing. The save should be caught up first: a
 * stored save can still show damage a repair has healed since, which only
 * holds the raid back until the next catch-up.
 */
const yardDamaged = (save: RaidDueSave): boolean =>
  damagedBuildings({ type: save.type, buildingdata: save.buildingdata, buildinghealthdata: save.buildinghealthdata })
    .length > 0 || Object.values(save.buildingdata ?? {}).some((building) => Boolean(building?.rE));

/**
 * The due rule (design §4.1, with the owner's answers to §10): null when a
 * raid is due now, else the first gate that holds it back.
 *
 * 1. The player's main yard, on Map Room 1 or 2 (outposts and Inferno never).
 * 2. Player level 9 or more.
 * 3. At least 4 sessions since the last raid.
 * 4. Its time has come: `nextAttack`, or with none set yet the last raid
 *    plus the preference's wait (never, with no raid and no session yet).
 * 5. Nothing in the yard damaged or repairing (owner, Q5).
 * 6. Not under attack, and no raid already open.
 * 7. Online by #271's rule with the attack load's 60-second window, and no
 *    in-game check pending (#273).
 * 8. The last presence ping said "yard, Planner closed" (§7.3).
 *
 * Protection does not hold a raid back (owner, Q6).
 */
export const raidDueCheck = (facts: RaidDueFacts): RaidNotDue | null => {
  const { save, now } = facts;
  if (save.type !== BaseType.MAIN) return "notMainYard";
  if (!RAIDED_MAP_ROOMS.has(Number(save.mapversion ?? MapRoomVersion.V1))) return "mapRoom";
  if (playerLevelOf(save) < RAID_MIN_LEVEL) return "level";

  const schedule = readSchedule(save.aiattacks);
  if (schedule.sessionsSinceLastAttack < SESSIONS_BETWEEN_RAIDS) return "sessions";
  const dueAt =
    schedule.nextAttack ??
    (schedule.lastattack > 0 ? schedule.lastattack + RAID_PREFERENCES[schedule.attackPreference].waitSeconds : null);
  if (dueAt === null || now < dueAt) return "notYet";

  if (yardDamaged(save)) return "damaged";
  if (facts.underAttack) return "underAttack";
  if (facts.raidOpen) return "raidOpen";
  if (!isOnline(facts.marks, now, ATTACK_ONLINE_SECONDS)) return "offline";
  if (facts.screen?.where !== "yard" || facts.screen.planner) return "screen";
  return null;
};

/**
 * {@link raidDueCheck} for a player, reading their presence, last screen and
 * open raid from Redis.
 *
 * @param userid - The player.
 * @param save - Their main save, caught up.
 * @param now - Unix seconds.
 */
export const raidDueNow = async (userid: number, save: Save, now: number): Promise<RaidNotDue | null> => {
  const [marks, screen, open] = await Promise.all([
    readPresenceMarks(userid, now),
    readRaidScreen(userid),
    readOpenRaid(userid),
  ]);
  return raidDueCheck({ save, now, marks, screen, underAttack: isAttackActive(save), raidOpen: open !== null });
};

/**
 * Counts a session on the owner's build-mode load of their main yard
 * (design §8.1), under the row lock, and writes the schedule back in the
 * server's shape (a Flash-era value is normalised here). Skipped for any
 * row that is not a main yard.
 *
 * @returns The locked row as written, or null when nothing was.
 */
export const countRaidSession = (em: EntityManager, basesaveid: number, now: number): Promise<Save | null> =>
  em.transactional(async (tx) => {
    const locked = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (!locked || locked.type !== BaseType.MAIN) return null;
    locked.aiattacks = scheduleColumn(startSession(readSchedule(locked.aiattacks), now));
    await tx.flush();
    return locked;
  });
