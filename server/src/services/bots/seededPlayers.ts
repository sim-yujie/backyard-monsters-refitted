import { LockMode } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

import { seededYardsOn } from "../../config/BotConfig.js";
import { Bot } from "../../database/models/bot.model.js";
import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { catchUpYard } from "../yard/catchUp.js";
import { STARTER_BUILDINGS } from "../yard/starterBase.js";
import { BATCH_SIZE, BOT_MAX_LEVEL, BOT_MIN_LEVEL, botYardSlices, drawBot, fillPlan } from "./factory.js";
import type { Persona } from "./progression.js";

/**
 * Real yards for the Map Room 2 dev players `db:seed:mr2` makes (issue #233).
 * Those 2,500 accounts fill the dev world map; without this they all keep the
 * blank new-account save, so visiting or attacking one shows an empty yard.
 *
 * Owner decisions (2026-10-05):
 *
 * 1. **Dev testing only.** Nothing here runs when `ENV` is production
 *    ({@link seededYardsOn}): the seed scripts refuse, the sweep leaves
 *    seeded rows alone and an attack books them nothing.
 * 2. **The bots' yard generator**, with the levels spread over 1-40 the way
 *    the bots are (`fillPlan`), drawn exactly as the factory draws a bot.
 * 3. **They repair and grow like the Map Room 1 bots**, by the bot sweep's
 *    own `grow` and `repair` jobs. Each player gets a `bym.bot` row in state
 *    `seeded`, which keeps them out of everything that reads bots
 *    (`state = 'active'`): neighbour lists, the 500 total, the rebalance,
 *    retire-all, remove-all. `isBot` is false for them, so they can still log
 *    in and are told of attacks as a player is. The sweep treats them as a
 *    bot with three differences (`sweep.ts`): they never retire (their
 *    growth stops at the top of level 40), they never look at Map Room 1's
 *    tribes, and they never show online. They never take revenge.
 *
 * Only blank yards are given one ({@link isBlankSeedYard}): a seeded account
 * someone has logged in to and built on keeps its yard and gets no row.
 * {@link giveSeededYards} is idempotent, so it also fixes a database seeded
 * before this existed (`bun run db:seed:mr2:yards`).
 */

const STARTER_TYPES = new Set(STARTER_BUILDINGS.map((building) => building.t));

/**
 * Whether a yard is still a new account's: nothing but the starter set (or
 * less, or nothing at all), every building at level 1.
 */
export const isBlankSeedYard = (buildingdata: BuildingDataMap | null | undefined): boolean => {
  const buildings = Object.values(buildingdata ?? {});
  return (
    buildings.length <= STARTER_BUILDINGS.length &&
    buildings.every((building) => STARTER_TYPES.has(Number(building.t)) && Number(building.l ?? 1) <= 1)
  );
};

/**
 * One level per player for `count` more seeded yards, the bots' way: the
 * shortfall of each level against an even spread of all seeded players over
 * levels 1-40 (`fillPlan`), any left over at random levels, then shuffled so
 * players next to each other on the map are not all one level.
 *
 * @param {number} count - Players to give a yard
 * @param {Record<number, number>} seededByLevel - Seeded players per level already
 * @param {Rng} rng - The draw
 * @returns {number[]} `count` levels, 1-40
 */
export const planSeededLevels = (count: number, seededByLevel: Readonly<Record<number, number>>, rng: Rng): number[] => {
  const already = Object.values(seededByLevel).reduce((sum, have) => sum + have, 0);
  const levels = fillPlan(already + count, seededByLevel, count);
  while (levels.length < count) levels.push(BOT_MIN_LEVEL + rng.int(BOT_MAX_LEVEL - BOT_MIN_LEVEL + 1));
  for (let index = levels.length - 1; index > 0; index--) {
    const other = rng.int(index + 1);
    [levels[index], levels[other]] = [levels[other]!, levels[index]!];
  }
  return levels;
};

/** One seeded player given a yard. */
export interface SeededYard {
  userid: number;
  level: number;
  persona: Persona;
}

export interface GiveSeededYardsOptions {
  rng: Rng;
  /** Unix seconds. */
  now: number;
  daysPerLevel: number;
  /** Read for {@link seededYardsOn}; `process.env` by default. */
  env?: Record<string, string | undefined>;
  /** Told after each batch commits. */
  onBatch?: (given: SeededYard[]) => void;
}

export interface GiveSeededYardsReport {
  given: SeededYard[];
  /** Seeded players without a row whose yard is not blank, left as they are. */
  notBlank: number;
}

/**
 * The `db:seed:mr2` players without a `bym.bot` row: a 12-hex-digit username,
 * its `@test.com` email (`seedAccount.ts`), and a main yard on a Map Room 2
 * world. The Map Room 3 and alliance seeds make the same accounts but not on
 * a Map Room 2 world.
 */
export const findSeededPlayers = (em: EntityManager) =>
  em.execute<{ userid: number; buildingdata: BuildingDataMap | null }[]>(
    `SELECT u.userid, s.buildingdata
       FROM bym."user" u
       JOIN bym.save s ON s.userid = u.userid AND s.type = ?
       JOIN bym.world w ON w.uuid = s.worldid AND w.map_version = ?
      WHERE u.username ~ '^[0-9a-f]{12}$'
        AND u.email = u.username || '@test.com'
        AND NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)
      ORDER BY u.userid`,
    [BaseType.MAIN, MapRoomVersion.V2]
  );

/** Seeded players per level. */
const seededByLevel = async (em: EntityManager): Promise<Record<number, number>> => {
  const rows = await em.execute<{ level: number; count: string }[]>(
    `SELECT level, count(*) AS count FROM bym.bot WHERE state = 'seeded' GROUP BY level`
  );
  return Object.fromEntries(rows.map((row) => [Number(row.level), Number(row.count)]));
};

/**
 * Gives every blank seeded player a generated yard and a `seeded` bot row (the
 * file comment), in batches of `BATCH_SIZE`, one transaction each. The yard
 * slices are the factory's (`botYardSlices`), laid over the player's own save,
 * so the account, its world, its cell and its age stay; the yard is then
 * caught up to its save time as the factory settles a new bot's.
 *
 * @throws {Error} On a production `ENV`
 */
export const giveSeededYards = async (
  em: EntityManager,
  options: GiveSeededYardsOptions
): Promise<GiveSeededYardsReport> => {
  if (!seededYardsOn(options.env ?? process.env)) {
    throw new Error("Seeded Map Room 2 yards are for dev databases only (ENV is production).");
  }
  const { rng, now, daysPerLevel } = options;
  const players = await findSeededPlayers(em);
  const blank = players.filter((player) => isBlankSeedYard(player.buildingdata));
  const levels = planSeededLevels(blank.length, await seededByLevel(em), rng);
  const given: SeededYard[] = [];

  for (let start = 0; start < blank.length; start += BATCH_SIZE) {
    const batch = blank.slice(start, start + BATCH_SIZE);
    const drawn = batch.map((_, index) => drawBot(rng, levels[start + index]!, now, daysPerLevel));

    const batchGiven = await em.fork().transactional(async (tx) => {
      const done: SeededYard[] = [];
      for (const [index, player] of batch.entries()) {
        const save = await tx.findOne(
          Save,
          { userid: player.userid, type: BaseType.MAIN },
          { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
        );
        // Built on since it was read: leave it.
        if (!save || !isBlankSeedYard(save.buildingdata)) continue;

        const { profile, yard } = drawn[index]!;
        Object.assign(save, botYardSlices(profile, yard));
        catchUpYard(save, profile.savetime);
        tx.create(Bot, {
          userid: player.userid,
          seed: profile.seed,
          persona: profile.persona,
          level: yard.level,
          level_since: profile.levelSince,
          state: "seeded",
        });
        done.push({ userid: player.userid, level: yard.level, persona: profile.persona });
      }
      await tx.flush();
      return done;
    });

    given.push(...batchGiven);
    options.onBatch?.(batchGiven);
  }
  return { given, notBlank: players.length - blank.length };
};
