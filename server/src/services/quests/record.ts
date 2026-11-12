import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { EntityManager as SqlEntityManager } from "@mikro-orm/postgresql";

import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { logger } from "../../utils/logger.js";
import { sqlCountsAsNewFriend } from "./friends.js";
import { cleanEvents, recordQuests, type QuestEvents } from "./state.js";
import { countAfterCommit } from "../alliance/allianceProgress.js";

/**
 * Quest progress that lands outside a yard action, so outside the main row's
 * lock: an attack launched or landed, a defence held, a gift sent, a new
 * friend. Each runs a short transaction that locks the player's main row
 * (`SELECT … FOR UPDATE`, as every yard action does) and counts there, as
 * `recordAchievementEvents` does for achievements. Called after the action
 * has committed, so a failure is logged, never thrown: the action stands.
 */

/**
 * Counts `events` on the main save `basesaveid`. Returns whether it was
 * written (false for no events, no row, or not a main save).
 */
export const recordQuestEvents = async (
  em: EntityManager,
  basesaveid: number | null | undefined,
  events: QuestEvents | null | undefined,
  now: number = getCurrentDateTime()
): Promise<boolean> => {
  const clean = cleanEvents(events);
  if (!clean || !basesaveid) return false;
  try {
    return await countAfterCommit(() => em.transactional(async (tx) => {
      const main = await tx.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
      if (!main || main.type !== BaseType.MAIN) return false;
      recordQuests(main, now, clean);
      await tx.flush();
      return true;
    }));
  } catch (err) {
    logger.error(`Counting quest events ${JSON.stringify(clean)} on main save ${basesaveid} failed: ${err}`);
    return false;
  }
};

/** {@link recordQuestEvents} on a player's main save, found by user id. */
export const recordUserQuestEvents = async (
  em: EntityManager,
  userid: number,
  events: QuestEvents | null | undefined,
  now: number = getCurrentDateTime()
): Promise<boolean> => {
  if (!cleanEvents(events)) return false;
  try {
    const [row] = await (em as SqlEntityManager).execute<{ basesaveid: number | null }[]>(
      `SELECT save_basesaveid AS basesaveid FROM bym."user" WHERE userid = ?`,
      [userid]
    );
    return await recordQuestEvents(em, row?.basesaveid ? Number(row.basesaveid) : null, events, now);
  } catch (err) {
    logger.error(`Counting quest events for user ${userid} failed: ${err}`);
    return false;
  }
};

/**
 * A friendship just started between `a` and `b`: each side whose new friend
 * counts (`sqlCountsAsNewFriend`) moves their "make new friends" quest.
 */
export const recordNewFriendship = async (em: EntityManager, a: number, b: number, now: number = getCurrentDateTime()): Promise<void> => {
  for (const [me, friend] of [
    [a, b],
    [b, a],
  ] as const) {
    try {
      if (await sqlCountsAsNewFriend(em, me, friend, now)) await recordUserQuestEvents(em, me, { newFriend: 1 }, now);
    } catch (err) {
      logger.error(`Counting a new friend ${friend} for ${me} failed: ${err}`);
    }
  }
};
