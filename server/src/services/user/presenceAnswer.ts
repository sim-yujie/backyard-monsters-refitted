import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { postgres, redis } from "../../server.js";
import { readAttackSession } from "../base/attackSessionStore.js";
import { ATTACK_TIMEOUT, isAttackActive } from "../base/isAttackActive.js";
import { challengeKey, readLastAction } from "./online.js";

/**
 * What the web client's presence ping, and the "Stay protected?" tap, answer
 * besides `error: 0` (#275). Small on purpose: the ping goes every 30 seconds.
 */
export interface PresenceAnswer {
  /** The server's clock, unix seconds: the client measures the next two against it. */
  readonly now: number;
  /**
   * The player's last real action (`realActions.ts`), unix seconds, or 0 when
   * none in the last ten minutes. The client shows "Stay protected?" nine
   * minutes after it.
   */
  readonly lastAction: number;
  /**
   * An in-game check is waiting for an answer (#273, `botChallenge.ts`): the
   * player reads as offline until they answer it, so the client asks for it
   * (`POST /bm/presence/check`) and shows it.
   */
  readonly checkPending: boolean;
  /**
   * The player's main yard is being attacked: who by, and when the attack
   * runs out at the latest (unix seconds). Absent otherwise. Every yard
   * action is refused until it ends (`yardUnderAttackErr`), so the client
   * locks the yard and reloads it once this is gone.
   */
  readonly attack?: { readonly by: string; readonly ends: number };
}

/**
 * The attack on the player's main yard, if one is running: the yard actions'
 * own rule (`isAttackActive`). The attack session in Redis is read first, so
 * the ping touches the database only while an attack has started.
 */
export const attackOnMainYard = async (user: User): Promise<PresenceAnswer["attack"]> => {
  const basesaveid = user.save?.basesaveid;
  if (basesaveid == null) return undefined;
  const session = await readAttackSession(basesaveid);
  if (!session) return undefined;
  const save = await postgres.em.findOne(Save, { basesaveid }, { fields: ["attackid", "attacks"], refresh: true });
  if (!save || !isAttackActive(save)) return undefined;
  const last = save.attacks.at(-1);
  if (!last) return undefined;
  return { by: last.name || "another player", ends: last.starttime + ATTACK_TIMEOUT };
};

/**
 * The answer for this player now.
 *
 * @param user - The caller.
 * @param now - Unix seconds.
 * @param lastAction - The last real action when the caller already knows it
 *   (the tap that just made one); read from Redis otherwise.
 */
export const presenceAnswer = async (user: User, now: number, lastAction?: number): Promise<PresenceAnswer> => {
  const [action, attack, check] = await Promise.all([
    lastAction ?? readLastAction(user.userid, now),
    attackOnMainYard(user),
    redis.get(challengeKey(user.userid)),
  ]);
  return { now, lastAction: action ?? 0, checkPending: check !== null && check !== undefined, ...(attack && { attack }) };
};
