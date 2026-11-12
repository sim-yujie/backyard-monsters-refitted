import type { EventReward } from "../../game-data/events/eventRewards.js";
import {
  byTownHall,
  DAILY_ALL_DONE_SHINY,
  DAILY_ALWAYS,
  DAILY_FREE_SWAPS,
  DAILY_QUEST_COUNT,
  DAILY_QUESTS,
  LOGIN_CARD_SHINY,
  PACED_GROUPS,
  QUEST_KINDS,
  QUEST_STATS,
  QUEST_TRIBES,
  CATAPULT_TARGETS,
  WEEKLY_ALL_DONE_SHINY,
  WEEKLY_GROUPS,
  WEEKLY_PACE,
  WEEKLY_QUEST_SHINY,
  WEEKLY_QUESTS,
  type PacedGroup,
  type QuestKind,
  type WeeklyGroup,
} from "../../game-data/quests.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { capOf, type CreditSave } from "../yard/credit.js";
import { STARTER_MONSTER } from "../yard/locker.js";
import { townHallLevel } from "../yardplanner/costs.js";
import { DAY_SECONDS, utcDay, utcWeek } from "./period.js";

/**
 * A player's login card, daily quests and weekly quests: `save.dailyquests`
 * (migration `20261102_AddQuestsToSave.ts`), on the main save only, written
 * under the main row's lock like `achievements` and `onboarding`. Every
 * function here is pure; the yard action wrapper, the quest routes and the
 * attack / friend hooks read and write the record through them.
 *
 * Numbers and quest kinds are all `game-data/quests.ts`.
 */

/** One quest a player was given. Its rewards are fixed when it is picked. */
export interface QuestEntry {
  slot: number;
  kind: string;
  /** The monster id, tribe or building type the quest names, picked with it. */
  variant?: string;
  need: number;
  have: number;
  claimed: boolean;
  rewards: EventReward[];
  /**
   * Weekly quests: unix seconds when `have` first reached `need` (not the
   * Claim, so claiming late changes nothing). The next week's pace reads it.
   */
  doneAt?: number;
}

/** A day's or a week's quests. */
export interface QuestSet {
  /** `YYYY-MM-DD` of the period's first UTC day (a Monday for a week). */
  period: string;
  quests: QuestEntry[];
  /** The all-done bonus claimed. */
  bonus: boolean;
  /** Swaps used this period. */
  swaps: number;
}

export interface QuestRecord {
  v: 1;
  login: {
    /** Days claimed on the current card, 0-7; after 7 the next claim starts a new card at day 1. */
    claimed: number;
    /** UTC day of the last claim, or null. */
    last: string | null;
    /** Every day ever claimed. */
    total: number;
  };
  daily: QuestSet | null;
  weekly: QuestSet | null;
  /** Whether the player had a friend to help or gift when last checked (the social quest's choice). */
  hasFriend: boolean;
  /** The weekly Fighting and Resources quests' pace (owner, 9 Nov, Option A): their need is the base x this. */
  pace: QuestPace;
}

/** A multiplier per paced weekly group, within `WEEKLY_PACE.min`..`max`. */
export type QuestPace = Record<PacedGroup, number>;

/**
 * Counted actions: a stat (`game-data/quests.ts` `QUEST_STATS`), or
 * `<stat>:<variant>`, to how many (negative takes back, e.g. a cancelled upgrade).
 */
export type QuestEvents = Record<string, number>;

/** What picking reads about the player. */
export interface QuestPlayer {
  userid: number;
  townHall: number;
  buildings: ReadonlySet<number>;
  champion: boolean;
  hasFriend: boolean;
  /** Monsters the player can hatch: Pokey and every Locker unlock. */
  monsters: readonly string[];
  /** The storage cap, which resource rewards are a share of. */
  cap: number;
}

/** The slice of a save the quests read. */
export interface QuestSave extends CreditSave {
  userid: number;
  buildingdata?: BuildingDataMap | null;
  champion?: unknown;
  lockerdata?: JsonObject | null;
  dailyquests?: JsonObject | null;
}

export const emptyQuests = (): QuestRecord => ({
  v: 1,
  login: { claimed: 0, last: null, total: 0 },
  daily: null,
  weekly: null,
  hasFriend: false,
  pace: startPace(),
});

/** A new player's pace: today's numbers. */
export const startPace = (): QuestPace => ({ fighting: WEEKLY_PACE.start, resources: WEEKLY_PACE.start });

/** `value` within the pace's limits, to 4 decimals (no float drift over the weeks). */
const clampPace = (value: number): number =>
  Math.round(Math.min(WEEKLY_PACE.max, Math.max(WEEKLY_PACE.min, value)) * 10_000) / 10_000;

/** A stored pace, cleaned up: each group within the limits, 1 when missing. */
export const readPace = (raw: unknown): QuestPace => {
  const one = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pace = startPace();
  for (const group of PACED_GROUPS) {
    const value = Number(one[group]);
    if (Number.isFinite(value) && value > 0) pace[group] = clampPace(value);
  }
  return pace;
};

const whole = (raw: unknown, min = 0): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : min;
};

const isDay = (raw: unknown): raw is string => typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw);

const entryOf = (raw: unknown): QuestEntry | null => {
  if (raw === null || typeof raw !== "object") return null;
  const one = raw as Record<string, unknown>;
  if (typeof one.kind !== "string" || !QUEST_KINDS.has(one.kind)) return null;
  const need = whole(one.need, 1);
  return {
    slot: whole(one.slot),
    kind: one.kind,
    ...(typeof one.variant === "string" && one.variant !== "" && { variant: one.variant }),
    need,
    have: Math.min(need, whole(one.have)),
    claimed: one.claimed === true,
    rewards: Array.isArray(one.rewards) ? (one.rewards as EventReward[]) : [],
    ...(Number(one.doneAt) > 0 && { doneAt: whole(one.doneAt) }),
  };
};

const setOf = (raw: unknown): QuestSet | null => {
  if (raw === null || typeof raw !== "object") return null;
  const one = raw as Record<string, unknown>;
  if (!isDay(one.period)) return null;
  const quests = (Array.isArray(one.quests) ? one.quests : []).map(entryOf).filter((q): q is QuestEntry => q !== null);
  return { period: one.period, quests, bonus: one.bonus === true, swaps: whole(one.swaps) };
};

/** The record in `save.dailyquests`, cleaned up; an empty one for a save that has none. */
export const readQuests = (raw: unknown): QuestRecord => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyQuests();
  const one = raw as Record<string, unknown>;
  const login = (one.login ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    login: {
      claimed: Math.min(LOGIN_CARD_SHINY.length, whole(login.claimed)),
      last: isDay(login.last) ? login.last : null,
      total: whole(login.total),
    },
    daily: setOf(one.daily),
    weekly: setOf(one.weekly),
    hasFriend: one.hasFriend === true,
    pace: readPace(one.pace),
  };
};

/** The record as the save column holds it. */
export const questsJson = (record: QuestRecord): JsonObject => JSON.parse(JSON.stringify(record)) as JsonObject;

/** The building types in a yard. */
const buildingTypes = (buildingdata: BuildingDataMap | null | undefined): Set<number> => {
  const types = new Set<number>();
  for (const building of Object.values(buildingdata ?? {})) {
    const type = Number((building as { t?: unknown } | null)?.t);
    if (Number.isFinite(type)) types.add(type);
  }
  return types;
};

/** Pokey and every monster the Locker has unlocked (`t: 2`), surface monsters only. */
const unlockedMonsters = (lockerdata: JsonObject | null | undefined): string[] => {
  const ids = new Set<string>([STARTER_MONSTER]);
  for (const [id, entry] of Object.entries(lockerdata ?? {})) {
    if (!/^C\d+$/.test(id)) continue;
    if (entry !== null && typeof entry === "object" && Number((entry as { t?: unknown }).t) === 2) ids.add(id);
  }
  return [...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
};

/** The player as picking reads them, from their main save. */
export const questPlayerOf = (save: QuestSave, hasFriend: boolean): QuestPlayer => ({
  userid: save.userid,
  townHall: Math.max(1, townHallLevel(save.buildingdata)),
  buildings: buildingTypes(save.buildingdata),
  champion: Array.isArray(save.champion) ? save.champion.length > 0 : Boolean(save.champion),
  hasFriend,
  monsters: unlockedMonsters(save.lockerdata),
  cap: capOf(save),
});

/** Whether `player` has unlocked `kind`. */
export const isUnlocked = (kind: QuestKind, player: QuestPlayer): boolean => {
  const unlock = kind.unlock;
  if (!unlock) return true;
  if (unlock.building !== undefined && !player.buildings.has(unlock.building)) return false;
  if (unlock.townHall !== undefined && player.townHall < unlock.townHall) return false;
  if (unlock.friend && !player.hasFriend) return false;
  if (unlock.noFriend && player.hasFriend) return false;
  if (unlock.champion && !player.champion) return false;
  return true;
};

// --- Seeded picking: the same player, period and salt always pick the same, so
// two requests racing to pick a day's quests agree. -------------------------

const hash = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** mulberry32. */
const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffled = <T>(list: readonly T[], seed: string): T[] => {
  const random = rng(hash(seed));
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

/**
 * What a quest of `kind` pays a player whose storage cap is `cap`. `pace`
 * scales a resource pay (the weekly Resources quest), up to
 * `WEEKLY_PACE.payMaxShare` of the cap.
 */
export const rewardsOf = (kind: QuestKind, cap: number, shiny = 0, pace = 1): EventReward[] => {
  const rewards: EventReward[] = [];
  const share = kind.pay ? (pace === 1 ? kind.pay.share : Math.min(WEEKLY_PACE.payMaxShare, kind.pay.share * pace)) : 0;
  const amount = kind.pay ? Math.floor(Math.max(0, cap) * share) : 0;
  if (kind.pay && amount > 0) {
    const amounts: Partial<Record<"r1" | "r2" | "r3" | "r4", number>> = {};
    for (const key of kind.pay.resources) amounts[key] = amount;
    rewards.push({ kind: "resources", amounts });
  }
  rewards.push(...(kind.extra ?? []));
  if (shiny > 0) rewards.push({ kind: "shiny", amount: shiny });
  return rewards;
};

/** What a variant of `kind` is picked from for `player`. */
export const variantChoices = (kind: QuestKind, player: QuestPlayer): string[] => {
  switch (kind.variant) {
    case "monster":
      return [...player.monsters];
    case "tribe":
      return [...QUEST_TRIBES];
    case "building":
      return CATAPULT_TARGETS.map(String);
    default:
      return [];
  }
};

/** How many a quest of `kind` needs for `player` (`random` draws a random need). */
export const needOf = (kind: QuestKind, player: QuestPlayer, random: () => number = Math.random): number => {
  const need = kind.need;
  if ("random" in need) return need.random[0] + Math.floor(random() * (need.random[1] - need.random[0] + 1));
  if ("capShare" in need) return Math.max(1, Math.floor(Math.max(0, player.cap) * need.capShare));
  return byTownHall(need, player.townHall);
};

/** The weekly group of each weekly kind. */
const GROUP_OF: ReadonlyMap<string, WeeklyGroup> = new Map(
  WEEKLY_GROUPS.flatMap((group) => WEEKLY_QUESTS[group].map((kind) => [kind.id, group] as const))
);

/** The paced group a quest kind belongs to, or null (Social, dailies). */
export const pacedGroupOf = (kind: string): PacedGroup | null => {
  const group = GROUP_OF.get(kind);
  return group !== undefined && (PACED_GROUPS as readonly string[]).includes(group) ? (group as PacedGroup) : null;
};

/** `value` to 3 significant figures (24,250,000 -> 24,300,000), whole numbers under 1,000. */
const roundNice = (value: number): number => {
  if (value < 1000) return Math.round(value);
  const step = 10 ** (Math.floor(Math.log10(value)) - 2);
  return Math.round(value / step) * step;
};

/** A paced weekly quest's need: the base need x the group's pace, rounded and clamped. */
export const pacedNeed = (group: PacedGroup, base: number, pace: number): number => {
  if (group === "fighting") {
    return Math.min(WEEKLY_PACE.fightsMax, Math.max(WEEKLY_PACE.fightsMin, Math.round(base * pace)));
  }
  if (pace === 1) return base;
  const low = Math.ceil(base * WEEKLY_PACE.lootMinShare);
  const high = Math.floor(base * WEEKLY_PACE.lootMaxShare);
  return Math.max(1, Math.min(high, Math.max(low, roundNice(base * pace))));
};

const entry = (slot: number, kind: QuestKind, player: QuestPlayer, seed: string, shiny = 0, pace?: QuestPace): QuestEntry => {
  const random = rng(hash(`${seed}|${kind.id}`));
  const group = pace ? pacedGroupOf(kind.id) : null;
  const base = needOf(kind, player, random);
  const need = group && pace ? pacedNeed(group, base, pace[group]) : base;
  const choices = variantChoices(kind, player);
  const variant = kind.variant ? choices[Math.floor(random() * choices.length)] : undefined;
  return {
    slot,
    kind: kind.id,
    ...(variant !== undefined && { variant }),
    need: Math.max(1, need),
    have: 0,
    claimed: false,
    rewards: rewardsOf(kind, player.cap, shiny, group === "resources" && pace ? pace.resources : 1),
  };
};

/** Whether `player` has unlocked `kind`, its variant included (a monster to name). */
const canPick = (kind: QuestKind, player: QuestPlayer): boolean =>
  isUnlocked(kind, player) && (!kind.variant || variantChoices(kind, player).length > 0);

/** A day's quests: {@link DAILY_QUEST_COUNT} unlocked kinds, picked at random. */
export const pickDaily = (player: QuestPlayer, day: string): QuestSet => {
  const open = DAILY_QUESTS.filter((kind) => canPick(kind, player));
  const seed = `${player.userid}|d|${day}`;
  // The always-there kind first (owner, decision 11), then the rest at random.
  const always = open.filter((kind) => kind.id === DAILY_ALWAYS);
  const rest = shuffled(
    open.filter((kind) => kind.id !== DAILY_ALWAYS),
    seed
  );
  const picked = [...always, ...rest].slice(0, DAILY_QUEST_COUNT);
  return { period: day, quests: picked.map((kind, slot) => entry(slot, kind, player, seed)), bonus: false, swaps: 0 };
};

/**
 * A week's quests: one unlocked kind from each weekly group, the Fighting and
 * Resources needs (and the Resources pay) scaled by `pace`. The pace is the
 * server's alone (owner, 12 Nov: "invisible to player and determined server
 * side"): the player only ever sees the need and the reward.
 */
export const pickWeekly = (player: QuestPlayer, week: string, pace: QuestPace = startPace()): QuestSet => {
  const quests: QuestEntry[] = [];
  WEEKLY_GROUPS.forEach((group, slot) => {
    const open = WEEKLY_QUESTS[group].filter((kind) => canPick(kind, player));
    const seed = `${player.userid}|w|${week}|${group}`;
    const kind = shuffled(open, seed)[0];
    if (!kind) return;
    quests.push(entry(slot, kind, player, seed, WEEKLY_QUEST_SHINY, pace));
  });
  return { period: week, quests, bonus: false, swaps: 0 };
};

/** Unix seconds of 00:00 UTC on `day` (`YYYY-MM-DD`). */
const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`) / 1000;

/** The day of its week (1 = Monday .. 7) a weekly quest was finished on, or null (not finished, or no time kept). */
export const doneDay = (quest: QuestEntry, week: string): number | null => {
  if (quest.have < quest.need || quest.doneAt === undefined) return null;
  return Math.min(7, Math.max(1, Math.floor((quest.doneAt - dayStart(week)) / DAY_SECONDS) + 1));
};

/** What last week's quest multiplies its group's pace by. */
export const paceStep = (quest: QuestEntry, week: string): number => {
  if (quest.have < quest.need) return WEEKLY_PACE.failStep;
  const day = doneDay(quest, week);
  // Finished before finish times were kept: no change.
  if (day === null) return 1;
  if (day <= WEEKLY_PACE.fastDay) return WEEKLY_PACE.fastStep;
  if (day >= WEEKLY_PACE.slowDay) return WEEKLY_PACE.slowStep;
  return 1;
};

/**
 * The pace for `week`, from the pace and the weekly quests the record held
 * before it. No quests yet (a new player): unchanged. Last week's quests: each
 * paced group steps by when its quest was finished. Older quests (the player
 * was away last week): each group they had a quest in counts as not finished,
 * once. A group with no quest (no Map Room yet) keeps its pace.
 */
export const nextPace = (pace: QuestPace, last: QuestSet | null, week: string): QuestPace => {
  if (!last || last.period >= week) return pace;
  const lastWeek = utcWeek(dayStart(week) - DAY_SECONDS);
  const next = { ...pace };
  for (const group of PACED_GROUPS) {
    const quest = last.quests.find((one) => pacedGroupOf(one.kind) === group);
    if (!quest) continue;
    const step = last.period === lastWeek ? paceStep(quest, last.period) : WEEKLY_PACE.failStep;
    next[group] = clampPace(pace[group] * step);
  }
  return next;
};

/**
 * The record with today's and this week's quests: new ones picked when the
 * day or the week has turned (or none were ever picked). Unclaimed rewards of
 * a period that is over are gone with it. The login card does not change.
 */
export const rollOver = (record: QuestRecord, player: QuestPlayer, now: number): QuestRecord => {
  const day = utcDay(now);
  const week = utcWeek(now);
  const daily = record.daily?.period === day ? record.daily : pickDaily(player, day);
  if (record.weekly?.period === week) return daily === record.daily ? record : { ...record, daily };
  // The old week is read for the pace before it is replaced.
  const pace = nextPace(record.pace, record.weekly, week);
  const weekly = pickWeekly(player, week, pace);
  return { ...record, daily, weekly, pace };
};

/** Counts `events` on a set; `stamp` (unix seconds) marks when a quest first reaches its need (weekly only). */
const countSet = (set: QuestSet | null, events: QuestEvents, stamp?: number): { set: QuestSet | null; changed: boolean } => {
  if (!set) return { set, changed: false };
  let changed = false;
  const quests = set.quests.map((quest) => {
    if (quest.claimed) return quest;
    const kind = QUEST_KINDS.get(quest.kind);
    if (!kind) return quest;
    let add = 0;
    for (const stat of kind.stats) {
      const value = Number(events[quest.variant !== undefined ? `${stat}:${quest.variant}` : stat]);
      if (Number.isFinite(value)) add += Math.trunc(value);
    }
    const have = Math.min(quest.need, Math.max(0, quest.have + add));
    if (have === quest.have) return quest;
    changed = true;
    const next: QuestEntry = { ...quest, have };
    if (stamp !== undefined && have >= quest.need && quest.doneAt === undefined) next.doneAt = stamp;
    if (have < quest.need) delete next.doneAt;
    return next;
  });
  return { set: changed ? { ...set, quests } : set, changed };
};

/**
 * Adds `events` to every unclaimed quest of the record's current day and
 * week. A weekly quest that reaches its need is stamped `doneAt = now`.
 */
export const countQuests = (
  record: QuestRecord,
  events: QuestEvents,
  now: number = Math.floor(Date.now() / 1000)
): { record: QuestRecord; changed: boolean } => {
  const daily = countSet(record.daily, events);
  const weekly = countSet(record.weekly, events, Math.floor(now));
  if (!daily.changed && !weekly.changed) return { record, changed: false };
  return { record: { ...record, daily: daily.set, weekly: weekly.set }, changed: true };
};

const STATS: ReadonlySet<string> = new Set(QUEST_STATS);

/** Whether `key` is a stat or `<stat>:<variant>`. */
const isEventKey = (key: string): boolean => STATS.has(key.split(":", 1)[0]!);

/** The sum of several event sets, unknown keys and zeros dropped. */
export const addQuestEvents = (...sets: (QuestEvents | null | undefined)[]): QuestEvents => {
  const out: QuestEvents = {};
  for (const set of sets) {
    for (const [key, raw] of Object.entries(set ?? {})) {
      const value = Math.trunc(Number(raw));
      if (!isEventKey(key) || !Number.isFinite(value) || value === 0) continue;
      out[key] = (out[key] ?? 0) + value;
      if (out[key] === 0) delete out[key];
    }
  }
  return out;
};

/** Drops zero and unknown keys; null when nothing is left. */
export const cleanEvents = (events: QuestEvents | null | undefined): QuestEvents | null => {
  const out = addQuestEvents(events);
  return Object.keys(out).length > 0 ? out : null;
};

/** `amount` of `stat`, and the same of `<stat>:<variant>`: what a hook adds. */
export const questEvent = (stat: string, variant: string | number | null | undefined, amount = 1): QuestEvents =>
  variant === null || variant === undefined || variant === ""
    ? { [stat]: amount }
    : { [stat]: amount, [`${stat}:${variant}`]: amount };

// --- The login card ----------------------------------------------------------

/** Today's login day (1-7), whether it is claimed, and how many days of the shown card are claimed. */
export const loginToday = (record: QuestRecord, now: number): { day: number; claimedToday: boolean; onCard: number } => {
  const today = utcDay(now);
  const { claimed, last } = record.login;
  if (last === today) return { day: Math.max(1, claimed), claimedToday: true, onCard: claimed };
  const onCard = claimed >= LOGIN_CARD_SHINY.length ? 0 : claimed;
  return { day: onCard + 1, claimedToday: false, onCard };
};

export type QuestRefusal =
  | "claimedToday"
  | "noSuchQuest"
  | "notDone"
  | "claimed"
  | "bonusNotReady"
  | "bonusClaimed"
  | "noSwapsLeft"
  | "cannotSwap"
  | "nothingToSwapTo";

export type QuestResult<T> = { ok: true; record: QuestRecord; value: T } | { ok: false; reason: QuestRefusal };

/** Claims today's login day: the next day on the card (a missed day pauses it, never resets it). */
export const claimLogin = (record: QuestRecord, now: number): QuestResult<{ day: number; shiny: number }> => {
  const today = loginToday(record, now);
  if (today.claimedToday) return { ok: false, reason: "claimedToday" };
  const day = today.day;
  return {
    ok: true,
    record: { ...record, login: { claimed: day, last: utcDay(now), total: record.login.total + 1 } },
    value: { day, shiny: LOGIN_CARD_SHINY[day - 1]! },
  };
};

export type QuestPeriod = "daily" | "weekly";

/** Claims one finished quest. Its rewards are paid by the caller. */
export const claimQuest = (record: QuestRecord, period: QuestPeriod, slot: number): QuestResult<QuestEntry> => {
  const set = record[period];
  const quest = set?.quests.find((one) => one.slot === slot);
  if (!set || !quest) return { ok: false, reason: "noSuchQuest" };
  if (quest.claimed) return { ok: false, reason: "claimed" };
  if (quest.have < quest.need) return { ok: false, reason: "notDone" };
  const claimed = { ...quest, claimed: true };
  const quests = set.quests.map((one) => (one.slot === slot ? claimed : one));
  return { ok: true, record: { ...record, [period]: { ...set, quests } }, value: claimed };
};

/** The all-done bonus's Shiny for a period. */
export const bonusShiny = (period: QuestPeriod): number => (period === "daily" ? DAILY_ALL_DONE_SHINY : WEEKLY_ALL_DONE_SHINY);

/** Whether every quest of the set is finished (claimed or not). */
export const allDone = (set: QuestSet | null): boolean =>
  !!set && set.quests.length > 0 && set.quests.every((quest) => quest.have >= quest.need);

/** Claims the all-done bonus of a period. */
export const claimBonus = (record: QuestRecord, period: QuestPeriod): QuestResult<{ shiny: number }> => {
  const set = record[period];
  if (!set || !allDone(set)) return { ok: false, reason: "bonusNotReady" };
  if (set.bonus) return { ok: false, reason: "bonusClaimed" };
  return { ok: true, record: { ...record, [period]: { ...set, bonus: true } }, value: { shiny: bonusShiny(period) } };
};

/**
 * Swaps one unfinished, unclaimed daily quest for another unlocked kind not
 * shown today (one free swap a day).
 */
export const swapDaily = (record: QuestRecord, player: QuestPlayer, slot: number): QuestResult<QuestEntry> => {
  const set = record.daily;
  const quest = set?.quests.find((one) => one.slot === slot);
  if (!set || !quest) return { ok: false, reason: "noSuchQuest" };
  if (set.swaps >= DAILY_FREE_SWAPS) return { ok: false, reason: "noSwapsLeft" };
  if (quest.claimed || quest.have >= quest.need) return { ok: false, reason: "cannotSwap" };
  const seed = `${player.userid}|s|${set.period}|${set.swaps}`;
  let fresh: QuestEntry;
  const always = QUEST_KINDS.get(DAILY_ALWAYS);
  if (quest.kind === DAILY_ALWAYS && always) {
    // The always-there quest keeps its kind: another tribe (owner, decision 11).
    const tribes = variantChoices(always, player).filter((one) => one !== quest.variant);
    if (tribes.length === 0) return { ok: false, reason: "nothingToSwapTo" };
    const tribe = shuffled(tribes, seed)[0]!;
    fresh = { ...entry(slot, always, player, seed), variant: tribe };
  } else {
    const shown = new Set(set.quests.map((one) => one.kind));
    const open = DAILY_QUESTS.filter(
      (kind) => kind.id !== DAILY_ALWAYS && canPick(kind, player) && !shown.has(kind.id)
    );
    const kind = shuffled(open, seed)[0];
    if (!kind) return { ok: false, reason: "nothingToSwapTo" };
    fresh = entry(slot, kind, player, seed);
  }
  const quests = set.quests.map((one) => (one.slot === slot ? fresh : one));
  return { ok: true, record: { ...record, daily: { ...set, quests, swaps: set.swaps + 1 } }, value: fresh };
};

/** How many rewards wait for a Claim tap: the login day, finished quests, all-done bonuses. */
export const claimableCount = (record: QuestRecord, now: number): number => {
  let count = loginToday(record, now).claimedToday ? 0 : 1;
  const day = utcDay(now);
  const week = utcWeek(now);
  for (const [set, current] of [
    [record.daily, day],
    [record.weekly, week],
  ] as const) {
    if (!set || set.period !== current) continue;
    count += set.quests.filter((quest) => !quest.claimed && quest.have >= quest.need).length;
    if (!set.bonus && allDone(set)) count += 1;
  }
  return count;
};

/**
 * The record with the day's and week's quests up to date and `events`
 * counted. `changed` says whether anything differs from `raw`.
 */
export const updateQuests = (
  save: QuestSave,
  now: number,
  events?: QuestEvents | null,
  hasFriend?: boolean
): { record: QuestRecord; changed: boolean } => {
  const before = readQuests(save.dailyquests);
  let record = hasFriend === undefined || hasFriend === before.hasFriend ? before : { ...before, hasFriend };
  record = rollOver(record, questPlayerOf(save, record.hasFriend), now);
  const clean = cleanEvents(events);
  if (clean) record = countQuests(record, clean, now).record;
  const changed = record !== before || save.dailyquests === null || save.dailyquests === undefined;
  return { record, changed };
};

/**
 * Rolls the main save's quests over and counts `events` on it, writing
 * `save.dailyquests` when anything changed. For code holding the main row's lock.
 */
export const recordQuests = (save: QuestSave, now: number, events?: QuestEvents | null): QuestRecord => {
  const { record, changed } = updateQuests(save, now, events);
  if (changed) save.dailyquests = questsJson(record);
  return record;
};
