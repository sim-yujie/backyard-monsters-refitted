import { redis } from "../../../server.js";
import { TAKEOVER_GRANT_SECONDS, type TakeoverGrant } from "./takeoverGrant.js";

/**
 * Where takeover grants are kept (`takeoverGrant.ts`): Redis, one key per
 * outpost, like the attack sessions (`attackSessionStore.ts`). An outpost has
 * at most one grant, for the attacker who destroyed it, so the key is the
 * outpost and the attacker is in the value; every lookup starts from the
 * outpost. The key outlives the grant by a minute so a request at the last
 * second still reads it; `expiresAt` is what decides.
 */

const KEY_SLACK_SECONDS = 60;

export const takeoverGrantKey = (basesaveid: number) => `takeover-grant:${basesaveid}`;

/**
 * Records a grant.
 *
 * @param {TakeoverGrant} grant - The grant.
 */
export const startTakeoverGrant = async (grant: TakeoverGrant): Promise<void> => {
  await redis.setex(
    takeoverGrantKey(grant.basesaveid),
    TAKEOVER_GRANT_SECONDS + KEY_SLACK_SECONDS,
    JSON.stringify(grant)
  );
};

/**
 * Reads the grant on an outpost, live or just run out.
 *
 * @param {number} basesaveid - The outpost's save row.
 * @returns {Promise<TakeoverGrant | null>} The grant, or null if there is none.
 */
export const readTakeoverGrant = async (basesaveid: number): Promise<TakeoverGrant | null> => {
  const raw = await redis.get(takeoverGrantKey(basesaveid));
  if (!raw) return null;

  try {
    const grant = JSON.parse(raw) as TakeoverGrant;
    return Number.isFinite(grant?.attackerid) && Number.isFinite(grant?.expiresAt) ? grant : null;
  } catch {
    return null;
  }
};

/**
 * Ends a grant: taken, declined, or no longer needed.
 *
 * @param {number} basesaveid - The outpost's save row.
 */
export const endTakeoverGrant = async (basesaveid: number): Promise<void> => {
  await redis.del(takeoverGrantKey(basesaveid));
};
