import { BaseType } from "../../enums/Base.js";
import { redis } from "../../server.js";

/**
 * Who is "online", and so safe from attack on their main yard (#271).
 *
 * The server decides, not the client. A player is online while BOTH hold:
 *
 * 1. A recent presence mark: `last-seen:main:<userid>`, written by the web
 *    client's 30-second `/presence` ping, an own-yard load and a Flash yard
 *    save. It says a game is open.
 * 2. A real game action within {@link REAL_ACTION_WINDOW_SECONDS}:
 *    `last-action:<userid>`, written only by the routes in
 *    `realActions.ts` (collect, build, upgrade, hatch, attack, planner
 *    apply...). It says someone is playing that game.
 *
 * Neither the ping nor a load counts as an action, so a tab left open, a
 * mouse jiggler or a script that calls `/presence` keeps the first and loses
 * the second ten minutes after the last real action: the player reads as
 * offline and can be attacked. The owner set no cap on how long real play
 * keeps a player protected (like Flash).
 *
 * A pending challenge (`presence-challenge:<userid>`, the in-game check of
 * issue #273) reads as offline whatever the marks say. Nothing sets it yet.
 */

/** A real action keeps a player online this long: the owner's 10 minutes. */
export const REAL_ACTION_WINDOW_SECONDS = 10 * 60;

/** The attack load wants a presence mark from the last minute (`baseModeAttack.ts`). */
export const ATTACK_ONLINE_SECONDS = 60;

export const lastActionKey = (userid: number): string => `last-action:${userid}`;
export const challengeKey = (userid: number): string => `presence-challenge:${userid}`;
const lastSeenKey = (userid: number): string => `last-seen:${BaseType.MAIN}:${userid}`;

/** What the server knows of a player's presence; times in unix seconds. */
export interface PresenceMarks {
  /** The last presence mark, or null when it has expired. */
  readonly lastSeen: number | null;
  /** The last real game action, or null when it has expired. */
  readonly lastAction: number | null;
  /** An in-game check is waiting for an answer (#273). */
  readonly challengePending: boolean;
}

/** A stored time; a value that is there but does not parse counts as just now, as before. */
const timeOf = (raw: string | null | undefined, now: number): number | null => {
  if (raw === null || raw === undefined) return null;
  const at = Number(raw);
  return Number.isFinite(at) ? at : now;
};

/**
 * The rule itself: a presence mark from the last `seenWithinSeconds` (the
 * attack load allows 60, the bots' revenge the key's whole 120), a real
 * action from the last {@link REAL_ACTION_WINDOW_SECONDS}, and no challenge.
 */
export const isOnline = (marks: PresenceMarks, now: number, seenWithinSeconds: number): boolean =>
  !marks.challengePending &&
  marks.lastSeen !== null &&
  marks.lastSeen >= now - seenWithinSeconds &&
  marks.lastAction !== null &&
  marks.lastAction >= now - REAL_ACTION_WINDOW_SECONDS;

export const readPresenceMarks = async (userid: number, now: number): Promise<PresenceMarks> => {
  const [seen, action, challenge] = await Promise.all([
    redis.get(lastSeenKey(userid)),
    redis.get(lastActionKey(userid)),
    redis.get(challengeKey(userid)),
  ]);
  return {
    lastSeen: timeOf(seen, now),
    lastAction: timeOf(action, now),
    challengePending: challenge !== null && challenge !== undefined,
  };
};

/** Whether the player is online now (see the module comment). */
export const isPlayerOnline = async (userid: number, now: number, seenWithinSeconds: number): Promise<boolean> =>
  isOnline(await readPresenceMarks(userid, now), now, seenWithinSeconds);

/** Records a real game action (`realActions.ts`); the key lives as long as it counts. */
export const recordRealAction = async (userid: number, now: number): Promise<void> => {
  await redis.setex(lastActionKey(userid), REAL_ACTION_WINDOW_SECONDS, String(now));
};

/**
 * Sets or clears a pending in-game check (#273). While set the player reads
 * as offline. Not called by anything yet: the check that sets it is #273.
 */
export const setChallengePending = async (userid: number, pending: boolean): Promise<void> => {
  if (pending) await redis.set(challengeKey(userid), "1");
  else await redis.del(challengeKey(userid));
};
