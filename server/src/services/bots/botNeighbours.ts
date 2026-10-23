import type { EntityManager } from "@mikro-orm/postgresql";

import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { AttackDetails } from "../../controllers/base/load/modes/baseModeAttack.js";
import { ATTACK_TIMEOUT } from "../base/isAttackActive.js";
import { shuffle } from "../../utils/shuffle.js";
import { BOT_FLOOR_LEVEL } from "../../config/BotConfig.js";

/**
 * How many levels above the floor a list always reaches for bots, so a
 * player under level 15 still gets the nearest bots: levels 15-17, about 57
 * bots at the even spread, enough for 25 places with most attackable.
 */
export const FLOOR_REACH = 2;

/**
 * The levels to take bots from for a player's neighbour window: the window,
 * but never below the floor (no bot stands there, owner 2026-10-23) and
 * always reaching at least {@link FLOOR_REACH} levels above it, so a new
 * player (levels 1-14) gets the nearest bots, 15-17, alongside the real
 * players of their own window.
 *
 * @param {{ min: number; max: number }} levels - The player's neighbour window
 * @returns {{ min: number; max: number }} The bots' window
 */
export const botLevelWindow = (levels: { min: number; max: number }): { min: number; max: number } => ({
  min: Math.max(levels.min, BOT_FLOOR_LEVEL),
  max: Math.max(levels.max, BOT_FLOOR_LEVEL + FLOOR_REACH),
});

/**
 * A bot that could fill a Map Room 1 neighbour place: its yard and account
 * fields, the same ones a real player's entry is built from.
 */
export interface BotNeighbourCandidate {
  userid: number;
  baseid: string;
  points: string;
  basevalue: string;
  lastupdateAt: Date;
  username: string;
  pic_square: string | null;
  /** The level the brain keeps in `bym.bot`. */
  level: number;
  /** Not protected and not under attack right now. */
  attackable: boolean;
}

interface BotRow {
  userid: number;
  baseid: string;
  points: string;
  basevalue: string;
  lastupdate_at: Date | string;
  username: string;
  pic_square: string | null;
  level: number;
  protected: number;
  attackid: number;
  last_attack: AttackDetails | null;
}

/**
 * The active bots inside a level window, with what is needed to tell whether
 * each can be attacked now (issue #236, `docs/design/bot-neighbours.md` §4.3
 * step 2). Retired bots and bots off Map Room 1 are never candidates. One
 * query on `bot_state_level`; the window holds a few hundred bots at most
 * (500 spread over levels 15-40).
 *
 * @param {EntityManager} em - The entity manager to read with
 * @param {number} forUserid - The player the list is for, never their own neighbour
 * @param {{ min: number; max: number }} levels - The level window, inclusive
 * @param {number} now - The current time, unix seconds
 * @returns {Promise<BotNeighbourCandidate[]>} Every bot that could take a place
 */
export const findBotCandidates = async (
  em: EntityManager,
  forUserid: number,
  levels: { min: number; max: number },
  now: number
): Promise<BotNeighbourCandidate[]> => {
  const rows = await em.execute<BotRow[]>(
    `
      SELECT b.userid, b.level, s.baseid, s.points, s.basevalue, s.lastupdate_at,
             s.protected, s.attackid, s.attacks -> -1 AS last_attack,
             u.username, u.pic_square
      FROM bym.bot b
      JOIN bym.save s ON s.userid = b.userid AND s.type = ?
      JOIN bym."user" u ON u.userid = b.userid
      WHERE b.state = 'active'
        AND b.level BETWEEN ? AND ?
        AND b.userid <> ?
        AND s.mapversion = ?
    `,
    [BaseType.MAIN, levels.min, levels.max, forUserid, MapRoomVersion.V1]
  );

  return rows.map((row) => ({
    userid: row.userid,
    baseid: row.baseid,
    points: row.points,
    basevalue: row.basevalue,
    lastupdateAt: new Date(row.lastupdate_at),
    username: row.username,
    pic_square: row.pic_square,
    level: row.level,
    // As `updateNeighbourData` and `isAttackActive` decide them.
    attackable:
      !(row.protected > 0 && row.protected > now) &&
      !(row.attackid !== 0 && row.last_attack && now - row.last_attack.starttime < ATTACK_TIMEOUT),
  }));
};

/**
 * Up to `count` bots for the empty places: bots attackable now first, and
 * inside each group spread across the levels (a shuffled round over the
 * levels, a random bot of each level per round) so no one level crowds the
 * list.
 *
 * @param {BotNeighbourCandidate[]} candidates - The bots in the window
 * @param {number} count - How many places are empty
 * @param {() => number} random - A source of numbers in [0, 1)
 * @returns {BotNeighbourCandidate[]} The picked bots, at most `count`
 */
export const pickBotNeighbours = (
  candidates: BotNeighbourCandidate[],
  count: number,
  random: () => number = Math.random
): BotNeighbourCandidate[] => {
  if (count <= 0) return [];

  const spread = (bots: BotNeighbourCandidate[]): BotNeighbourCandidate[] => {
    const byLevel = new Map<number, BotNeighbourCandidate[]>();
    for (const bot of shuffle(bots, random)) {
      byLevel.set(bot.level, [...(byLevel.get(bot.level) ?? []), bot]);
    }

    const queues = shuffle([...byLevel.values()], random);
    const picked: BotNeighbourCandidate[] = [];

    while (queues.some((queue) => queue.length)) {
      for (const queue of queues) {
        const bot = queue.shift();
        if (bot) picked.push(bot);
      }
    }
    return picked;
  };

  return [
    ...spread(candidates.filter((bot) => bot.attackable)),
    ...spread(candidates.filter((bot) => !bot.attackable)),
  ].slice(0, count);
};
