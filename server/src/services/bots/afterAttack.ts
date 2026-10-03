import type { EntityManager } from "@mikro-orm/postgresql";

import { botConfig } from "../../config/BotConfig.js";

/**
 * What a bot does once a real player's attack on it lands (issue #241,
 * `docs/design/bot-neighbours.md` §4.5 and §7.2): it books its repair, and
 * maybe a revenge attack on that player. This only writes `bot_job` rows; the
 * bot sweep runs them when due, and checks again then (protection, online,
 * truce, the caps) before it attacks anyone.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The repair runs a random 1-4 hours after the attack `[PLACEHOLDER]`. */
export const REPAIR_DELAY_HOURS = { min: 1, max: 4 } as const;
/** Chance that an attack on a bot books a revenge attack `[PLACEHOLDER]`. */
export const REVENGE_CHANCE = 1 / 3;
/** The revenge is due a uniform 1-24 hours after the attack (decision 11). */
export const REVENGE_DELAY_HOURS = { min: 1, max: 24 } as const;
/** A revenge that has not run gives up this long after the attack that booked it (decision 19). */
export const REVENGE_GIVE_UP_HOURS = 72;
/** Most revenge attacks on one player, from any bots, in any 24 hours (decision 19). */
export const REVENGE_PER_PLAYER = 2;
/** Most revenge attacks by one bot on one player in any 24 hours (decision 19). */
export const REVENGE_PER_PAIR = 1;
/** The span the caps count over. */
export const REVENGE_CAP_WINDOW_MS = 24 * HOUR_MS;

/** Another revenge attack on the same player: done (its attack log) or still booked (its job). */
export interface RevengeEvent {
  readonly bot: number;
  readonly at: Date;
}

/**
 * Whether a revenge by `bot` at `at` keeps both caps, given the player's other
 * revenge attacks, done or booked: no 24-hour span may hold more than
 * {@link REVENGE_PER_PLAYER} of them on the player, or more than
 * {@link REVENGE_PER_PAIR} by this bot. A span holding a set of attacks can
 * always start at the earliest of them, so only spans starting at an attack
 * need counting. Pure, so the sweep can ask it again at run time.
 */
export const revengeCapsAllow = (at: Date, bot: number, others: readonly RevengeEvent[]): boolean => {
  const time = at.getTime();
  const near = others.filter((other) => Math.abs(other.at.getTime() - time) < REVENGE_CAP_WINDOW_MS);
  const capped = (events: readonly RevengeEvent[], cap: number): boolean => {
    const times = [...events.map((event) => event.at.getTime()), time];
    return times.some(
      (start) =>
        start <= time &&
        time < start + REVENGE_CAP_WINDOW_MS &&
        times.filter((other) => other >= start && other < start + REVENGE_CAP_WINDOW_MS).length > cap
    );
  };
  return (
    !capped(near, REVENGE_PER_PLAYER) &&
    !capped(
      near.filter((other) => other.bot === bot),
      REVENGE_PER_PAIR
    )
  );
};

/** A uniform time `min`-`max` hours after `at`. */
const hoursAfter = (at: Date, hours: { min: number; max: number }, rng: () => number): Date =>
  new Date(at.getTime() + (hours.min + rng() * (hours.max - hours.min)) * HOUR_MS);

export interface BotDefenceInput {
  /** The bot that was attacked. */
  readonly bot: number;
  /** The real player who attacked it. */
  readonly attacker: number;
  /** When the attack landed. */
  readonly at: Date;
  /** Random numbers in [0, 1); `Math.random` by default. */
  readonly rng?: () => number;
  /** Whether revenge is switched on (`BOTS_REVENGE`); read from the environment by default. */
  readonly revenge?: boolean;
}

export interface BotDefenceJobs {
  /** When the repair is due, or null when one was already booked. */
  readonly repair: Date | null;
  /** When the revenge is due, or null when none was booked. */
  readonly revenge: Date | null;
}

/**
 * Books the bot's repair, and with chance {@link REVENGE_CHANCE} a revenge on
 * its attacker within the caps, as `bot_job` rows. A repair already booked
 * stands (it heals the new damage too), and so does a revenge already booked
 * on this player. The caps are counted from the player's booked revenge jobs
 * and from the attack logs of bots' attacks on them, under a lock on the
 * player so two landings at once cannot both take the last place.
 *
 * Writes in a transaction of its own, on a fork of `em` holding no entities,
 * so nothing the caller has persisted is flushed with it.
 */
export const scheduleAfterBotDefence = async (em: EntityManager, input: BotDefenceInput): Promise<BotDefenceJobs> => {
  const { bot, attacker, at } = input;
  const rng = input.rng ?? Math.random;
  const revengeOn = input.revenge ?? botConfig().revenge;

  return em.fork().transactional(async (tx) => {
    const repairAt = hoursAfter(at, REPAIR_DELAY_HOURS, rng);
    const repaired = await tx.execute<{ id: number }[]>(
      `INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'repair', ?)
       ON CONFLICT DO NOTHING RETURNING id`,
      [bot, repairAt]
    );
    const repair = repaired.length > 0 ? repairAt : null;

    if (!revengeOn || rng() >= REVENGE_CHANCE) return { repair, revenge: null };

    const due = hoursAfter(at, REVENGE_DELAY_HOURS, rng);
    await tx.execute(`SELECT pg_advisory_xact_lock(hashtext('bot-revenge'), ?)`, [attacker]);
    const others = await tx.execute<{ bot: number; at: Date | string }[]>(
      `SELECT bot_userid AS bot, due_at AS at FROM bym.bot_job
        WHERE kind = 'revenge' AND target_userid = ?
       UNION ALL
       SELECT log.attacker_userid AS bot, log.attacktime AS at FROM bym.attack_logs log
         JOIN bym.bot ON bot.userid = log.attacker_userid
        WHERE log.defender_userid = ? AND log.type = 'main' AND log.attacktime > ?`,
      [attacker, attacker, new Date(due.getTime() - REVENGE_CAP_WINDOW_MS)]
    );
    const events = others.map((row) => ({ bot: Number(row.bot), at: new Date(row.at) }));
    if (!revengeCapsAllow(due, bot, events)) return { repair, revenge: null };

    const booked = await tx.execute<{ id: number }[]>(
      `INSERT INTO bym.bot_job (bot_userid, kind, target_userid, due_at, giveup_at) VALUES (?, 'revenge', ?, ?, ?)
       ON CONFLICT DO NOTHING RETURNING id`,
      [bot, attacker, due, new Date(at.getTime() + REVENGE_GIVE_UP_HOURS * HOUR_MS)]
    );
    return { repair, revenge: booked.length > 0 ? due : null };
  });
};
