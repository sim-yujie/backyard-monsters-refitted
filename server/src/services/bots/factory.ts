import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { EntityManager } from "@mikro-orm/postgresql";

import { Bot } from "../../database/models/bot.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { AVATAR_IDS, avatarPath, PLACEHOLDER_PIC_SQUARE } from "../../game-data/avatars.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import type { Rng } from "../../game-rules/combat/rng.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { usernameMatch } from "../user/usernameLookup.js";
import { botName } from "./names.js";
import { shinyForSeed } from "./shiny.js";
import { PERSONAS, targetInBand, type Persona } from "./progression.js";
import { generateBotYard, type BotYard } from "./yardGenerator.js";
import { catchUpYard } from "../yard/catchUp.js";
import { visitMapRoom1 } from "./lookAlike.js";

/**
 * The bot factory (issue #239, `docs/design/bot-neighbours.md` §4.1 and §10):
 * makes Map Room 1 bots that look exactly like real players (decision 3).
 *
 * A bot is three rows: an ordinary `user`, an ordinary Map Room 1 main `save`
 * and its `bym.bot` row, which is the only thing that says "bot".
 *
 * - **Name** in a real player's style (`names.ts`), unique against
 *   `user.username` without case, as sign-up checks it.
 * - **Avatar**: one of the twelve critters, or the placeholder a player who
 *   never picked one has, in {@link AVATAR_SHARE} `[PLACEHOLDER]`.
 * - **Account**: `bot+<uuid>@bymr.invalid` and a bcrypt hash of 48 random
 *   bytes, so the row reads as any account's; login and reset refuse bots
 *   anyway (#235). Never the sandbox yard: `sandbox_start` is false and the
 *   save is built with `getDefaultBaseData(..., { forBot: true })`.
 * - **Age**: `createtime` (and the save's `createdAt`, the account's terms
 *   date) back-dated about as long as a player takes to reach the bot's level
 *   at `BOTS_DAYS_PER_LEVEL`, with jitter ({@link backdate}), so bots made in
 *   one run do not share a creation minute.
 * - **Yard**: the generator's yard (`yardGenerator.ts`) for a target drawn
 *   inside the level's band, laid over a new main save's defaults: no
 *   protection, the tutorial passed, `mapversion` 1, no world, no Inferno save,
 *   then settled as a player's own load leaves a yard ({@link settleNewYard}).
 * - **Pace**: `bot.level_since` puts the bot as far into its level as its
 *   target is into the band, which is where the grow job's linear pace (§4.4)
 *   would have it.
 * - **Shiny**: drawn from the seed inside the band a player of the level
 *   holds (`shiny.ts`), never the new-save 1,500.
 *
 * {@link createBots} writes in batches of {@link BATCH_SIZE}, one transaction
 * each. {@link fillPlan} decides which levels to make for an even spread over
 * levels 1-40, low levels first.
 *
 * Takes its entity manager from the caller and never imports `server.js`, so
 * the CLI (`scripts/bots.ts`) can use it without booting a server.
 */

/** Bots live on levels 1 to 40 (decision 4). */
export const BOT_MIN_LEVEL = 1;
export const BOT_MAX_LEVEL = 40;

/** Bots made per transaction (§10). */
export const BATCH_SIZE = 25;

/** Share of bots with a critter avatar; the rest keep the sign-up placeholder `[PLACEHOLDER]`. */
export const AVATAR_SHARE = 0.65;

/** The tutorial stage a finished tutorial leaves (`takeoverCell.ts`). */
const TUTORIAL_DONE = 205;

/** Times the factory redraws a bot whose yard does not land on the level asked for. */
const MAX_YARD_DRAWS = 12;

const DAY = 24 * 60 * 60;

/**
 * How many bots each level should hold for `total` spread evenly over levels
 * 1-40 (decision 4): the same number each, the remainder one more each on the
 * lowest levels. Index 0 is level 1.
 */
export const evenSpread = (total: number): number[] => {
  const levels = BOT_MAX_LEVEL - BOT_MIN_LEVEL + 1;
  const each = Math.floor(total / levels);
  const extra = total - each * levels;
  return Array.from({ length: levels }, (_, index) => each + (index < extra ? 1 : 0));
};

/**
 * The levels to make so the active bots reach `target` spread evenly
 * (§10 step 3): each level's shortfall against {@link evenSpread}, lowest
 * levels first, at most `limit`. Levels already over their share are left as
 * they are (the daily rebalance's job, §4.4), so the plan can fall short of
 * `target - active` when some level is over.
 *
 * @param {number} target - Active bots wanted in total
 * @param {Record<number, number>} activeByLevel - Active bots per level now
 * @param {number} [limit] - At most this many
 * @returns {number[]} One level per bot to make, ascending
 */
export const fillPlan = (
  target: number,
  activeByLevel: Readonly<Record<number, number>>,
  limit = Number.POSITIVE_INFINITY
): number[] => {
  const plan: number[] = [];
  evenSpread(target).forEach((want, index) => {
    const level = BOT_MIN_LEVEL + index;
    for (let have = activeByLevel[level] ?? 0; have < want; have++) plan.push(level);
  });
  return plan.slice(0, Math.max(0, limit));
};

/** One bot's draw: everything about it but its name and account. */
export interface BotProfile {
  level: number;
  /** `bot.seed`: the generator's seed. */
  seed: number;
  persona: Persona;
  /** How far into the level's band the target sits, `[0, 1)`. */
  fraction: number;
  /** Points plus base value to grow to. */
  targetPoints: number;
  /** Unix seconds: the save's `createtime`. */
  createtime: number;
  /** Unix seconds: the last time "the player" saved. */
  savetime: number;
  /** `bot.level_since`. */
  levelSince: Date;
  /** `user.pic_square`. */
  picSquare: string;
  /** `save.credits`: the bot's Shiny (`shiny.ts`). */
  credits: number;
}

/**
 * The account's age in seconds for a bot at `fraction` of `level`: about the
 * time a player takes to get there at `daysPerLevel` days a level, times
 * 0.8-1.3, plus 1-36 hours, and never younger than its time on this level.
 */
export const backdate = (rng: Rng, level: number, fraction: number, daysPerLevel: number): number => {
  const onLevel = fraction * daysPerLevel * DAY;
  const climb = (level - 1 + fraction) * daysPerLevel * DAY * (0.8 + 0.5 * rng.float());
  const head = (1 + 35 * rng.float()) * 60 * 60;
  return Math.floor(Math.max(climb, onLevel) + head);
};

/** A critter or, for {@link AVATAR_SHARE} of bots, the placeholder. */
const avatarFor = (rng: Rng): string =>
  rng.float() < AVATAR_SHARE ? avatarPath(AVATAR_IDS[rng.int(AVATAR_IDS.length)]!) : PLACEHOLDER_PIC_SQUARE;

/**
 * Draws one bot of `level` (see the file comment).
 *
 * @param {Rng} rng - The draw
 * @param {number} level - The bot's level, 1-40
 * @param {number} now - Unix seconds
 * @param {number} daysPerLevel - `BOTS_DAYS_PER_LEVEL`
 * @returns {BotProfile} The bot's profile
 */
export const drawProfile = (rng: Rng, level: number, now: number, daysPerLevel: number): BotProfile => {
  const seed = rng.next();
  const persona = PERSONAS[rng.int(PERSONAS.length)]!;
  const fraction = rng.float();
  const age = backdate(rng, level, fraction, daysPerLevel);
  // Last seen saving some time in the past day and a half, never before it was made.
  const savetime = now - Math.floor(Math.min(age, 36 * 60 * 60) * rng.float());
  return {
    level,
    seed,
    persona,
    fraction,
    targetPoints: targetInBand(level, fraction),
    createtime: now - age,
    savetime,
    levelSince: new Date((now - Math.floor(fraction * daysPerLevel * DAY)) * 1000),
    picSquare: avatarFor(rng),
    credits: shinyForSeed(seed, level),
  };
};

/**
 * A profile and the yard it generates, redrawn until the yard stands on the
 * level asked for (a progression step can carry a small yard past a narrow
 * band's target).
 *
 * @throws {Error} When no draw lands on the level
 */
export const drawBot = (
  rng: Rng,
  level: number,
  now: number,
  daysPerLevel: number
): { profile: BotProfile; yard: BotYard } => {
  if (!Number.isInteger(level) || level < BOT_MIN_LEVEL || level > BOT_MAX_LEVEL) {
    throw new Error(`A bot's level must be ${BOT_MIN_LEVEL}-${BOT_MAX_LEVEL}, not ${level}`);
  }
  for (let draw = 0; draw < MAX_YARD_DRAWS; draw++) {
    const profile = drawProfile(rng, level, now, daysPerLevel);
    const yard = generateBotYard({ seed: profile.seed, persona: profile.persona, targetPoints: profile.targetPoints, now });
    if (yard.level === level) return { profile, yard };
  }
  throw new Error(`No bot yard landed on level ${level}`);
};

/** The user row's fields for a bot. */
export const botUserData = (username: string, passwordHash: string, profile: BotProfile) => ({
  username,
  email: `bot+${randomUUID()}@bymr.invalid`,
  password: passwordHash,
  pic_square: profile.picSquare,
  // As a sign-up since #213 records it, on the day the account "was made".
  terms_accepted_at: new Date(profile.createtime * 1000),
  sandbox_start: false,
});

/**
 * The main save's fields for a bot: a new main save's defaults (never the
 * sandbox yard) with the generated yard laid over them (see the file comment).
 * `baseid` and `homebaseid` are the caller's, from the sequence.
 */
export const botSaveData = (user: User, profile: BotProfile, yard: BotYard) => {
  const buildingdata = Object.fromEntries(
    [...yard.buildings, ...yard.decorations].map((building) => [String(building.id), { ...building }])
  ) as unknown as BuildingDataMap;
  const made = new Date(profile.createtime * 1000);

  return {
    ...getDefaultBaseData(user, BaseType.MAIN, { forBot: true }),
    credits: profile.credits,
    createtime: profile.createtime,
    savetime: profile.savetime,
    protected: 0,
    tutorialstage: TUTORIAL_DONE,
    level: yard.level,
    points: yard.points,
    basevalue: yard.basevalue,
    buildingdata,
    resources: { ...yard.resources },
    lockerdata: yard.lockerdata,
    academy: yard.academy,
    monsters: yard.monsters,
    champion: yard.champion,
    storedata: yard.storedata,
    flinger: yard.flinger,
    catapult: yard.catapult,
    mapversion: MapRoomVersion.V1,
    worldid: null,
    // A bot never runs the guided start; null reads as a legacy save (`onboarding/state.ts`).
    onboarding: null,
    createdAt: made,
    takeoverDate: made,
  };
};

/**
 * A new bot's save as a player's own load leaves it (#245): caught up to its
 * `savetime`, a catch-up of no time that only gives the yard the fields every
 * loaded yard carries (the hatchery queues in `monsters`, mushrooms, the
 * harvesters' cycles), and Map Room 1's tribes in `wmstatus`, as a player who
 * has opened the map has them (`lookAlike.ts`). Without it a bot made but not
 * yet grown reads differently from a player in a view load.
 */
export const settleNewYard = (save: Save, savetime: number): void => {
  catchUpYard(save, savetime);
  visitMapRoom1(save);
};

/** One bot the factory made. */
export interface CreatedBot {
  userid: number;
  username: string;
  level: number;
  persona: Persona;
  baseid: string;
}

/** What {@link createBots} is given besides the levels. */
export interface CreateBotsOptions {
  /** The draw for every bot. */
  rng: Rng;
  /** Unix seconds. */
  now: number;
  daysPerLevel: number;
  /** Told after each batch commits. */
  onBatch?: (made: CreatedBot[]) => void;
}

/** A bcrypt hash of 48 random bytes, as hard to log in with as any. */
const randomPasswordHash = (): Promise<string> => bcrypt.hash(randomBytes(48).toString("base64"), 10);

/**
 * Names for `count` bots, unique among themselves and against every
 * `user.username` without case.
 */
const uniqueNames = async (em: EntityManager, rng: Rng, count: number): Promise<string[]> => {
  const chosen = new Map<string, string>();
  for (let round = 0; chosen.size < count; round++) {
    if (round > 50) throw new Error("Could not find unused bot names");
    const fresh: string[] = [];
    while (chosen.size + fresh.length < count) {
      const name = botName(rng);
      const key = name.toLowerCase();
      if (!chosen.has(key) && !fresh.some((other) => other.toLowerCase() === key)) fresh.push(name);
    }
    const taken = await em.find(User, { $or: fresh.map(usernameMatch) }, { fields: ["username"] });
    const takenKeys = new Set(taken.map((user) => user.username.toLowerCase()));
    for (const name of fresh) if (!takenKeys.has(name.toLowerCase())) chosen.set(name.toLowerCase(), name);
  }
  return [...chosen.values()];
};

/**
 * Makes one bot per entry of `levels`, in batches of {@link BATCH_SIZE}, each
 * batch one transaction: a batch is made whole or not at all. Yards and
 * password hashes are prepared before the transaction opens.
 *
 * @param {EntityManager} em - The caller's entity manager (never the server's)
 * @param {number[]} levels - One level per bot
 * @param {CreateBotsOptions} options - The draw, the clock and the pace
 * @returns {Promise<CreatedBot[]>} Every bot made, in order
 */
export const createBots = async (
  em: EntityManager,
  levels: readonly number[],
  options: CreateBotsOptions
): Promise<CreatedBot[]> => {
  const { rng, now, daysPerLevel } = options;
  const made: CreatedBot[] = [];

  for (let start = 0; start < levels.length; start += BATCH_SIZE) {
    const batch = levels.slice(start, start + BATCH_SIZE);
    const drawn = batch.map((level) => drawBot(rng, level, now, daysPerLevel));
    const hashes = await Promise.all(batch.map(randomPasswordHash));

    const batchMade = await em.fork().transactional(async (tx) => {
      const names = await uniqueNames(tx, rng, batch.length);
      const users = drawn.map(({ profile }, index) =>
        tx.create(User, botUserData(names[index]!, hashes[index]!, profile))
      );
      await tx.flush();

      const saves: Save[] = [];
      for (const [index, user] of users.entries()) {
        const { profile, yard } = drawn[index]!;
        const [{ baseid }] = await tx.execute<[{ baseid: string }]>(`SELECT nextval('bym.user_baseid_seq') AS baseid`);
        const save = tx.create(Save, {
          ...botSaveData(user, profile, yard),
          baseid: String(baseid),
          homebaseid: Number(baseid),
        });
        settleNewYard(save, profile.savetime);
        saves.push(save);
      }
      await tx.flush();

      users.forEach((user, index) => {
        const { profile, yard } = drawn[index]!;
        user.save = saves[index]!;
        tx.create(Bot, {
          userid: user.userid,
          seed: profile.seed,
          persona: profile.persona,
          level: yard.level,
          level_since: profile.levelSince,
        });
      });
      await tx.flush();

      return users.map((user, index) => ({
        userid: user.userid,
        username: user.username,
        level: drawn[index]!.yard.level,
        persona: drawn[index]!.profile.persona,
        baseid: saves[index]!.baseid,
      }));
    });

    made.push(...batchMade);
    options.onBatch?.(batchMade);
  }
  return made;
};

/** Active bots per level. */
export const activeBotsByLevel = async (em: EntityManager): Promise<Record<number, number>> => {
  const rows = await em.execute<{ level: number; count: string }[]>(
    `SELECT level, count(*) AS count FROM bym.bot WHERE state = 'active' GROUP BY level`
  );
  return Object.fromEntries(rows.map((row) => [Number(row.level), Number(row.count)]));
};

/** Bots made since `since`, for `--per-day` and `status`. */
export const botsMadeSince = async (em: EntityManager, since: Date): Promise<number> => {
  const [row] = await em.execute<[{ count: string }]>(`SELECT count(*) AS count FROM bym.bot WHERE created_at >= ?`, [
    since,
  ]);
  return Number(row?.count ?? 0);
};

/**
 * Moves every active bot off Map Room 1 at once (§10 kill switch, §4.4
 * retirement): its save to `mapversion` 2 with no world, `bot.state`
 * `retired`, its pending jobs dropped. Every neighbour list drops it on its
 * next read. Rows stay, so mail and attack logs keep their names.
 *
 * @returns {Promise<number>} How many bots were retired
 */
export const retireAllBots = async (em: EntityManager, now: Date): Promise<number> =>
  em.fork().transactional(async (tx) => {
    await tx.execute(
      `UPDATE bym.save s SET mapversion = ?, worldid = NULL
       FROM bym.bot b WHERE s.userid = b.userid AND b.state = 'active' AND s.type = ?`,
      [MapRoomVersion.V2, BaseType.MAIN]
    );
    const retired = await tx.execute<{ userid: number }[]>(
      `UPDATE bym.bot SET state = 'retired', retired_at = ? WHERE state = 'active' RETURNING userid`,
      [now]
    );
    await tx.execute(
      `DELETE FROM bym.bot_job WHERE bot_userid IN (SELECT userid FROM bym.bot WHERE state = 'retired')`
    );
    return retired.length;
  });

/** Which bots {@link deleteBots} removes. */
export type DeleteScope = "retired" | "all";

/**
 * Deletes bots and their rows: jobs, the bot row, neighbour cache, the user
 * and every save. Other players' neighbour lists drop them on the next read
 * (their save is gone).
 *
 * - `retired` (`delete-retired`, §10): retired bots that nothing in the mail
 *   references (no message, thread or truce), so no thread loses a name.
 * - `all` (dev only, `remove-all`): every bot, active or retired, and the
 *   mail, truces and attack logs it is part of, so a dev database is as it
 *   was before the bots.
 *
 * @returns {Promise<number>} How many bots were deleted
 */
export const deleteBots = async (em: EntityManager, scope: DeleteScope): Promise<number> =>
  em.fork().transactional(async (tx) => {
    const unreferenced = `
      AND NOT EXISTS (SELECT 1 FROM bym.message m WHERE m.userid = b.userid OR m.targetid = b.userid)
      AND NOT EXISTS (SELECT 1 FROM bym.thread t WHERE t.userid = b.userid OR t.targetid = b.userid)
      AND NOT EXISTS (SELECT 1 FROM bym.truce r WHERE r.initiator_userid = b.userid OR r.recipient_userid = b.userid)`;
    await tx.execute(
      `CREATE TEMP TABLE doomed_bots ON COMMIT DROP AS
       SELECT b.userid FROM bym.bot b WHERE ${scope === "retired" ? `b.state = 'retired' ${unreferenced}` : "TRUE"}`
    );
    const doomed = `(SELECT userid FROM doomed_bots)`;

    if (scope === "all") {
      await tx.execute(`DELETE FROM bym.message WHERE userid IN ${doomed} OR targetid IN ${doomed}`);
      await tx.execute(`DELETE FROM bym.thread WHERE userid IN ${doomed} OR targetid IN ${doomed}`);
      await tx.execute(`DELETE FROM bym.truce WHERE initiator_userid IN ${doomed} OR recipient_userid IN ${doomed}`);
      await tx.execute(
        `DELETE FROM bym.attack_logs WHERE attacker_userid IN ${doomed} OR defender_userid IN ${doomed}`
      );
    }
    await tx.execute(`DELETE FROM bym.bot_job WHERE bot_userid IN ${doomed}`);
    const deleted = await tx.execute<{ userid: number }[]>(
      `DELETE FROM bym.bot WHERE userid IN ${doomed} RETURNING userid`
    );
    await tx.execute(`DELETE FROM bym.maproom WHERE userid IN ${doomed}`);
    await tx.execute(`DELETE FROM bym."user" WHERE userid IN ${doomed}`);
    await tx.execute(`DELETE FROM bym.save WHERE userid IN ${doomed}`);
    return deleted.length;
  });

/** What `status` prints. */
export interface BotStatus {
  active: number;
  retired: number;
  /** Active bots per level, 1-40. */
  byLevel: Record<number, number>;
  /** Pending jobs per kind. */
  jobs: Record<string, number>;
  /** Bots made in the last 24 hours. */
  madeToday: number;
}

/** The bot population at a glance. */
export const botStatus = async (em: EntityManager, now: Date): Promise<BotStatus> => {
  const states = await em.execute<{ state: string; count: string }[]>(
    `SELECT state, count(*) AS count FROM bym.bot GROUP BY state`
  );
  const jobs = await em.execute<{ kind: string; count: string }[]>(
    `SELECT kind, count(*) AS count FROM bym.bot_job GROUP BY kind`
  );
  const count = (state: string) => Number(states.find((row) => row.state === state)?.count ?? 0);
  return {
    active: count("active"),
    retired: count("retired"),
    byLevel: await activeBotsByLevel(em),
    jobs: Object.fromEntries(jobs.map((row) => [row.kind, Number(row.count)])),
    madeToday: await botsMadeSince(em, new Date(now.getTime() - DAY * 1000)),
  };
};
