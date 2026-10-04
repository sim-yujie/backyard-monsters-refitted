import type { EntityManager } from "@mikro-orm/postgresql";

import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { TruceStatus } from "../../enums/TruceStatus.js";
import { ATTACK_TIMEOUT } from "../base/isAttackActive.js";
import { REVENGE_CAP_WINDOW_MS, REVENGE_GIVE_UP_HOURS, revengeCapsAllow, type RevengeEvent } from "./afterAttack.js";

/**
 * Whether a bot's booked revenge runs now (issue #244,
 * `docs/design/bot-neighbours.md` §4.7 step 1 and §7): the checks the sweep
 * makes when a `revenge` job is due, read fresh every time (never cached),
 * and what to do when one fails. Nothing here writes; the sweep (`sweep.ts`)
 * acts on the verdict, and the runner (`revengeRun.ts`) fights the battle.
 *
 * | Check | Fails | Then |
 * | --- | --- | --- |
 * | 72 hours since the attack that booked it (decision 19) | past it | cancel |
 * | the bot is active | retired or gone | cancel |
 * | the player's main yard is still on Map Room 1 | moved or gone | cancel |
 * | this bot has not attacked them since that attack | it has | cancel (it already took its revenge) |
 * | no truce between them | a truce | cancel |
 * | nobody is attacking the bot | under attack | retry in 15-60 minutes |
 * | the player is not protected (new-player, damage or bought) | protected | retry 1-6 hours after it ends |
 * | the player is not online and nobody is attacking them | either | retry in 15-60 minutes |
 * | the caps: 2 revenges on the player, 1 by this bot, in any 24 hours | full | retry 15-60 minutes after the window frees |
 *
 * A retry that would fall at or past the give-up time cancels instead. The
 * caps are counted from bots' attacks on the player that have happened (their
 * `attack_logs` rows), so revenges that run keep them whatever moved the
 * booked times; booked revenges that have not run yet do not hold a place.
 *
 * "Online" is a last-seen mark from the last {@link ONLINE_SECONDS}: the
 * key's whole life, stricter than the attack load's 60 seconds, so a player
 * who closed the game a minute ago is still left alone. It also needs a real
 * game action in the last ten minutes and no in-game check pending, as the
 * attack load does (`services/user/online.ts`, #271): a tab left open and
 * pinging is not online.
 */

/** A retry while the player is online or someone is attacking (§4.7). */
export const BUSY_RETRY_MINUTES = { min: 15, max: 60 } as const;
/** A retry once the player's protection ends, this much after it (§4.7). */
export const PROTECTED_RETRY_HOURS = { min: 1, max: 6 } as const;
/** A retry when no replay worker is free (§4.7 step 4). */
export const SLOT_RETRY_MINUTES = 5;
/** How long a last-seen mark counts as online: the key's life (`PRESENCE_TTL_SECONDS`). */
export const ONLINE_SECONDS = 120;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const CAP_WINDOW = REVENGE_CAP_WINDOW_MS / 1000;

/** Why a revenge is cancelled. */
export type RevengeCancel =
  | "gaveUp"
  | "botRetired"
  | "targetGone"
  | "alreadyAvenged"
  | "truce"
  | "nothingToSend"
  | "switchedOff";

/** Why a revenge waits. */
export type RevengeWait = "botUnderAttack" | "protected" | "online" | "underAttack" | "caps" | "busy" | "refused";

export type RevengeVerdict =
  | { readonly act: "run" }
  | { readonly act: "postpone"; readonly due: number; readonly reason: RevengeWait }
  | { readonly act: "cancel"; readonly reason: RevengeCancel };

/** What became of a revenge the checks let run (`revengeRun.ts`). */
export type RevengeOutcome =
  /** Fought and landed. */
  | { readonly status: "landed"; readonly damageBefore: number; readonly damageAfter: number }
  /** Committed; it lands from its checkpoint later (a replay past its deadline). */
  | { readonly status: "pending" }
  /** No replay worker free: nothing written, try again soon. */
  | { readonly status: "busy" }
  /** The attack load refused at the last moment: nothing written. */
  | { readonly status: "refused"; readonly reason: string }
  /** Nothing to send or nothing to attack: no revenge. */
  | { readonly status: "nothing" };

/** Everything the checks read, as it stands now. Times are unix seconds. */
export interface RevengeFacts {
  readonly now: number;
  /** The job gives up at this time. */
  readonly giveupAt: number;
  /** The bot's row and yard, or null when the bot is gone. */
  readonly bot: { readonly active: boolean; readonly underAttack: boolean } | null;
  /** The player's main yard, or null when there is none. */
  readonly target: {
    readonly onMapRoom1: boolean;
    readonly protectedUntil: number;
    readonly underAttack: boolean;
    readonly online: boolean;
  } | null;
  readonly truce: boolean;
  /** This bot has attacked the player since the attack that booked the revenge. */
  readonly alreadyAvenged: boolean;
  /** Bots' attacks on the player in the last 24 hours. */
  readonly landed: readonly RevengeEvent[];
}

/** A uniform time `min`-`max` units of `unit` seconds after `from`. */
const after = (from: number, band: { min: number; max: number }, unit: number, rng: () => number): number =>
  Math.floor(from + (band.min + rng() * (band.max - band.min)) * unit);

/**
 * When the caps let this bot attack the player again: the first time, from
 * now on, that a landed attack leaves the 24-hour window and the caps hold.
 */
export const capsFreeAt = (now: number, bot: number, landed: readonly RevengeEvent[]): number => {
  const leaves = landed
    .map((event) => event.at.getTime() / 1000 + CAP_WINDOW)
    .filter((time) => time > now)
    .sort((a, b) => a - b);
  return leaves.find((time) => revengeCapsAllow(new Date(time * 1000), bot, landed)) ?? leaves.at(-1) ?? now;
};

/**
 * Whether the revenge runs now, waits, or is given up (the file comment).
 *
 * @param facts - What the checks read.
 * @param bot - The bot's userid.
 * @param rng - Random numbers in [0, 1) for the retry times.
 */
export const revengeVerdict = (facts: RevengeFacts, bot: number, rng: () => number): RevengeVerdict => {
  const { now, giveupAt } = facts;
  const postpone = (due: number, reason: RevengeWait): RevengeVerdict =>
    due >= giveupAt ? { act: "cancel", reason: "gaveUp" } : { act: "postpone", due, reason };

  if (now >= giveupAt) return { act: "cancel", reason: "gaveUp" };
  if (!facts.bot?.active) return { act: "cancel", reason: "botRetired" };
  if (!facts.target?.onMapRoom1) return { act: "cancel", reason: "targetGone" };
  if (facts.alreadyAvenged) return { act: "cancel", reason: "alreadyAvenged" };
  if (facts.truce) return { act: "cancel", reason: "truce" };

  if (facts.bot.underAttack) return postpone(after(now, BUSY_RETRY_MINUTES, MINUTE, rng), "botUnderAttack");
  const { target } = facts;
  if (target.protectedUntil > now) {
    return postpone(after(target.protectedUntil, PROTECTED_RETRY_HOURS, HOUR, rng), "protected");
  }
  if (target.online) return postpone(after(now, BUSY_RETRY_MINUTES, MINUTE, rng), "online");
  if (target.underAttack) return postpone(after(now, BUSY_RETRY_MINUTES, MINUTE, rng), "underAttack");
  if (!revengeCapsAllow(new Date(now * 1000), bot, facts.landed)) {
    return postpone(after(capsFreeAt(now, bot, facts.landed), BUSY_RETRY_MINUTES, MINUTE, rng), "caps");
  }
  return { act: "run" };
};

/** A postponement after the runner found no replay worker free. */
export const slotBusyVerdict = (now: number, giveupAt: number): RevengeVerdict => {
  const due = now + SLOT_RETRY_MINUTES * MINUTE;
  return due >= giveupAt ? { act: "cancel", reason: "gaveUp" } : { act: "postpone", due, reason: "busy" };
};

/** A postponement after the attack load refused at the last moment (a check raced). */
export const refusedVerdict = (now: number, giveupAt: number, rng: () => number): RevengeVerdict => {
  const due = after(now, BUSY_RETRY_MINUTES, MINUTE, rng);
  return due >= giveupAt ? { act: "cancel", reason: "gaveUp" } : { act: "postpone", due, reason: "refused" };
};

/** A save's attack state as `isAttackActive` reads it, against the given clock. */
export const underAttackAt = (save: { attackid?: number | null; attacks?: unknown }, now: number): boolean => {
  if (!save.attackid) return false;
  const attacks = Array.isArray(save.attacks) ? (save.attacks as { starttime?: number }[]) : [];
  const last = attacks.at(-1);
  return last?.starttime !== undefined && now - Number(last.starttime) < ATTACK_TIMEOUT;
};

/** The job a verdict is about. */
export interface RevengeJob {
  readonly bot: number;
  readonly target: number;
  /** Unix seconds. */
  readonly giveupAt: number;
}

/** When a revenge job gives up: its `giveup_at`, or 72 hours after it was booked. */
export const giveupOf = (giveupAt: Date | string | null | undefined, createdAt: Date | string): number =>
  Math.floor(
    (giveupAt ? new Date(giveupAt).getTime() : new Date(createdAt).getTime() + REVENGE_GIVE_UP_HOURS * HOUR * 1000) /
      1000
  );

/**
 * Reads the {@link RevengeFacts} for a job, fresh, on the sweep's transaction.
 * The bot's row is taken `FOR NO KEY UPDATE SKIP LOCKED`: the per-bot lock,
 * held until the job's transaction ends, so no other server runs this bot's
 * revenge or grows it meanwhile. Null when another server holds it.
 *
 * @param tx - The job's transaction.
 * @param job - The revenge job.
 * @param now - Unix seconds.
 * @param isOnline - Whether the player has been seen within {@link ONLINE_SECONDS}.
 */
export const readRevengeFacts = async (
  tx: EntityManager,
  job: RevengeJob,
  now: number,
  isOnline: (userid: number, now: number) => Promise<boolean>
): Promise<RevengeFacts | null> => {
  const [bot] = await tx.execute<{ state: string }[]>(
    `SELECT state FROM bym.bot WHERE userid = ? FOR NO KEY UPDATE SKIP LOCKED`,
    [job.bot]
  );
  if (!bot) {
    const [exists] = await tx.execute(`SELECT 1 FROM bym.bot WHERE userid = ?`, [job.bot]);
    if (exists) return null;
  }

  const yardOf = async (userid: number) =>
    (
      await tx.execute<{ mapversion: number; protected: number; attackid: number; attacks: unknown }[]>(
        `SELECT mapversion, protected, attackid, attacks FROM bym.save
          WHERE userid = ? AND saveuserid = ? AND type = ? ORDER BY basesaveid LIMIT 1`,
        [userid, userid, BaseType.MAIN]
      )
    )[0];
  const botYard = await yardOf(job.bot);
  const yard = await yardOf(job.target);

  const [truce] = await tx.execute(
    `SELECT 1 FROM bym.truce
      WHERE ((initiator_userid = ? AND recipient_userid = ?) OR (initiator_userid = ? AND recipient_userid = ?))
        AND status = ? AND expires_at > ?
      LIMIT 1`,
    [job.bot, job.target, job.target, job.bot, TruceStatus.ACCEPTED, now]
  );

  const triggeredAt = job.giveupAt - REVENGE_GIVE_UP_HOURS * HOUR;
  const logs = await tx.execute<{ bot: number; at: Date | string }[]>(
    `SELECT log.attacker_userid AS bot, log.attacktime AS at FROM bym.attack_logs log
       JOIN bym.bot ON bot.userid = log.attacker_userid
      WHERE log.defender_userid = ? AND log.type = ? AND log.attacktime > ?`,
    [job.target, BaseType.MAIN, new Date(Math.min(now - CAP_WINDOW, triggeredAt) * 1000)]
  );
  const events = logs.map((row) => ({ bot: Number(row.bot), at: new Date(row.at) }));

  return {
    now,
    giveupAt: job.giveupAt,
    bot: bot ? { active: bot.state === "active" && !!botYard, underAttack: !!botYard && underAttackAt(botYard, now) } : null,
    target: yard
      ? {
          onMapRoom1: Number(yard.mapversion) === MapRoomVersion.V1,
          protectedUntil: Number(yard.protected) || 0,
          underAttack: underAttackAt(yard, now),
          online: await isOnline(job.target, now),
        }
      : null,
    truce: !!truce,
    alreadyAvenged: events.some((event) => event.bot === job.bot && event.at.getTime() / 1000 >= triggeredAt),
    landed: events.filter((event) => event.at.getTime() / 1000 > now - CAP_WINDOW),
  };
};
