import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import type { AchievementEvents } from "./evaluate.js";
import { recordAchievementEvents } from "./events.js";
import { recordAchievements } from "./record.js";
import { isEarned, readAchievements, type AchievementsSave, type DailyTracks } from "./state.js";

/**
 * The counters behind beta 7's social hidden achievements (#392), all kept
 * by the server:
 *
 * - **Neighbourly** (23), `neighbourly`: other players' yards opened to look
 *   (`/base/load` `view`) or to help (`help`) on one UTC day, each yard once.
 *   A yard is a player's main yard or outpost, never the player's own and
 *   never a wild monster camp.
 * - **Regular** (24), `loginstreak`: the longest run of UTC days on which the
 *   player loaded their own main yard (`build`), which every session does
 *   first.
 * - **Popular** (25), `friends`: the most friends held at once, counted in
 *   `bym.friend` whenever a friendship starts and on each day's first load
 *   (which also covers friends made before this counter existed).
 *
 * Each runs in a short transaction that locks the player's main row, as
 * every achievement write does, after a cheap check on the row already
 * loaded so a repeat load or visit writes nothing. Failures are logged,
 * never thrown: the load stands.
 */

const DAY = 24 * 60 * 60;

/** Neighbourly's number and target: past it, visits are no longer kept. */
export const NEIGHBOURLY_ID = 23;
export const NEIGHBOURLY_TARGET = 30;

/** The UTC day number of unix seconds `now`. */
export const dayOf = (now: number): number => Math.floor(now / DAY);

/** The login tracker after a load at `now`, and the run it makes; null when today is already counted. */
export const loginStep = (
  daily: DailyTracks | undefined,
  now: number
): { daily: DailyTracks; streak: number } | null => {
  const day = dayOf(now);
  const last = daily?.login;
  if (last === day) return null;
  // A clock that went back a day neither breaks nor extends the run.
  if (last !== undefined && last > day) return null;
  const streak = last === day - 1 ? (daily?.streak ?? 1) + 1 : 1;
  return { daily: { ...daily, login: day, streak }, streak };
};

/**
 * The visit tracker after opening yard `baseid` at `now`, and today's count;
 * null when it changes nothing (seen today already, or the target reached).
 */
export const visitStep = (
  daily: DailyTracks | undefined,
  baseid: string,
  now: number
): { daily: DailyTracks; visits: number } | null => {
  const day = dayOf(now);
  const today = daily?.visitDay === day ? (daily.visits ?? []) : [];
  if (today.includes(baseid) || today.length >= NEIGHBOURLY_TARGET) return null;
  const visits = [...today, baseid];
  return { daily: { ...daily, visitDay: day, visits }, visits: visits.length };
};

/** The yard a load opened, as {@link countsAsVisit} reads it. */
export interface VisitedYard {
  baseid: string;
  userid: number | null | undefined;
  type: string | null | undefined;
}

/** Whether opening `yard` counts as a visit for player `visitor`: someone else's main yard or outpost. */
export const countsAsVisit = (visitor: number, yard: VisitedYard): boolean =>
  (yard.type === BaseType.MAIN || yard.type === BaseType.OUTPOST) &&
  Number(yard.userid) > 0 &&
  Number(yard.userid) !== visitor;

/** Whether today's first own-yard load is still to be counted, from the row already loaded. */
export const loginPending = (main: AchievementsSave, now: number): boolean =>
  loginStep(readAchievements(main).d, now) !== null;

/** Whether a visit of `baseid` would count, from the row already loaded. */
export const visitPending = (main: AchievementsSave, baseid: string, now: number): boolean => {
  const record = readAchievements(main);
  return !isEarned(record, NEIGHBOURLY_ID) && visitStep(record.d, baseid, now) !== null;
};

/** The player's friends now. */
export const friendCount = async (em: EntityManager, userid: number): Promise<number> => {
  const [row] = await (em as SqlEntityManager).execute<{ n: number | string }[]>(
    `SELECT count(*)::int AS n FROM bym.friend WHERE userid = ?`,
    [userid]
  );
  return Number(row?.n ?? 0);
};

/**
 * Locks main save `basesaveid`, lets `step` change its daily trackers, and
 * evaluates with the events it returns. Nothing is written when `step`
 * returns null. Returns whether it ran.
 */
const recordDaily = async (
  em: EntityManager,
  basesaveid: number,
  now: number,
  step: (daily: DailyTracks | undefined) => { daily: DailyTracks; events: AchievementEvents } | null
): Promise<boolean> =>
  em.transactional(async (tx) => {
    const main = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (!main || main.type !== BaseType.MAIN) return false;
    const record = readAchievements(main);
    const next = step(record.d);
    if (!next) return false;
    record.d = next.daily;
    main.achievements = record as unknown as Save["achievements"];
    await recordAchievements(tx, main, now, next.events);
    await tx.flush();
    return true;
  });

/**
 * Today's first load of the player's own main yard: one more day on the
 * login run (Regular) and the friends held now (Popular).
 *
 * @param main - The player's main save as loaded (its record decides whether there is anything to do).
 */
export const recordLogin = async (
  em: EntityManager,
  main: AchievementsSave & { basesaveid: number; userid: number },
  now: number = getCurrentDateTime()
): Promise<boolean> => {
  if (!loginPending(main, now)) return false;
  try {
    const friends = await friendCount(em, main.userid);
    return await recordDaily(em, main.basesaveid, now, (daily) => {
      const login = loginStep(daily, now);
      return login && { daily: login.daily, events: { loginstreak: login.streak, ...(friends > 0 && { friends }) } };
    });
  } catch (err) {
    logger.error(`Recording the daily login for main save ${main.basesaveid} failed: ${err}`);
    return false;
  }
};

/**
 * The player opened `yard` to look or help: one more yard visited today
 * (Neighbourly) when it is someone else's and new today.
 *
 * @param main - The visitor's main save as loaded.
 */
export const recordVisit = async (
  em: EntityManager,
  main: AchievementsSave & { basesaveid: number; userid: number },
  yard: VisitedYard,
  now: number = getCurrentDateTime()
): Promise<boolean> => {
  const baseid = String(yard.baseid);
  if (!countsAsVisit(main.userid, yard) || !visitPending(main, baseid, now)) return false;
  try {
    return await recordDaily(em, main.basesaveid, now, (daily) => {
      const visit = visitStep(daily, baseid, now);
      return visit && { daily: visit.daily, events: { neighbourly: visit.visits } };
    });
  } catch (err) {
    logger.error(`Recording a visit of yard ${baseid} for main save ${main.basesaveid} failed: ${err}`);
    return false;
  }
};

/**
 * A friendship just started for each of `players`: their friends now count
 * towards Popular. Logged, never thrown.
 */
export const recordFriendsHeld = async (
  em: EntityManager,
  players: readonly number[],
  now: number = getCurrentDateTime()
): Promise<void> => {
  for (const userid of players) {
    try {
      const [row] = await (em as SqlEntityManager).execute<{ basesaveid: number | null }[]>(
        `SELECT save_basesaveid AS basesaveid FROM bym."user" WHERE userid = ?`,
        [userid]
      );
      const basesaveid = row?.basesaveid ? Number(row.basesaveid) : null;
      if (!basesaveid) continue;
      const friends = await friendCount(em, userid);
      if (friends > 0) await recordAchievementEvents(em, basesaveid, { friends }, now);
    } catch (err) {
      logger.error(`Recording friends held for user ${userid} failed: ${err}`);
    }
  }
};
