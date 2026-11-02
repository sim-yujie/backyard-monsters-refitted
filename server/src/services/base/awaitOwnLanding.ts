import { redis } from "../../server.js";
import { logger } from "../../utils/logger.js";
import { MR1_TRIBE_IDS } from "../../game-data/tribes/v1/index.js";
import { descentFinalLockKey } from "../inferno/descentSession.js";
import { infernoTribeFinalLockKey } from "../inferno/infernoTribeSession.js";
import { mr1TribeFinalLockKey } from "../maproom/v1/mr1TribeSession.js";
import { attackFinalLockKey } from "./attackCheckpoint.js";
import { listCheckpoints } from "./attackCheckpointStore.js";
import { attackerSessionKey } from "./attackSession.js";

/**
 * Lets a player's yard load wait for their own attack that is landing right
 * now (owner, 2 Nov 2026: leaving a battle must never undo it).
 *
 * Leaving the attack screen by a reload, Back or a closed tab sends the
 * attack's save as the page goes (`web/src/game/attack/plugins/end.ts`), and a
 * reload asks for the yard a moment later. The save holds the attack's final
 * lock while it replays the battle and writes it; the load's own pass
 * (`finaliseBeforeLoad`) found that lock taken, skipped the attack and served
 * the yard as it stood before it: the flung monsters back home and the loot
 * not in. The save then landed, but the player saw their attack undone, and
 * a player who then left again saw the same. So the load waits, briefly, for
 * every final lock that could be this player's attack:
 *
 * - the Map Room 2 attack their session names, and any row they hold a
 *   checkpoint on (`attackFinalLockKey`);
 * - a Map Room 1 tribe, the Descent and a Moloch tribe, which are keyed by the
 *   attacker (`mr1TribeSession.ts`, `descentSession.ts`, `infernoTribeSession.ts`).
 *
 * It never waits longer than {@link OWN_LANDING_WAIT_MS}, which covers a save's
 * replay deadline and a left save's longer one is short of; past it the load
 * goes on as before.
 */

/** The longest a load waits for the player's own attack to land. */
export const OWN_LANDING_WAIT_MS = 10_000;
/** How often it looks again. */
export const OWN_LANDING_POLL_MS = 100;

/** Every final-lock key that could be `userid`'s attack landing now. */
export const ownLandingLocks = async (userid: number): Promise<string[]> => {
  const keys = new Set<string>([descentFinalLockKey(userid), infernoTribeFinalLockKey(userid)]);
  for (const baseid of MR1_TRIBE_IDS) keys.add(mr1TribeFinalLockKey(userid, String(baseid)));

  const sessionRow = Number(await redis.get(attackerSessionKey(userid)));
  if (Number.isSafeInteger(sessionRow) && sessionRow > 0) keys.add(attackFinalLockKey(sessionRow));
  for (const { basesaveid, checkpoint } of await listCheckpoints()) {
    if (checkpoint.attackerid === userid) keys.add(attackFinalLockKey(basesaveid));
  }
  return [...keys];
};

export interface AwaitOwnLandingDeps {
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * Waits until none of `userid`'s attacks is landing, or the wait runs out.
 * Never throws: a failure here must not cost the player their yard.
 *
 * @returns Whether it had to wait at all.
 */
export const awaitOwnLanding = async (userid: number, deps: AwaitOwnLandingDeps = {}): Promise<boolean> => {
  try {
    return await waitForOwnLanding(userid, deps);
  } catch (err) {
    logger.error(`Waiting for ${userid}'s attack to land before a load failed: ${err}`);
    return false;
  }
};

const waitForOwnLanding = async (userid: number, deps: AwaitOwnLandingDeps): Promise<boolean> => {
  const waitMs = deps.waitMs ?? OWN_LANDING_WAIT_MS;
  const pollMs = deps.pollMs ?? OWN_LANDING_POLL_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? (() => Date.now());

  const keys = await ownLandingLocks(userid);
  const held = async (): Promise<boolean> => {
    for (const key of keys) if ((await redis.get(key)) !== null) return true;
    return false;
  };

  if (!(await held())) return false;
  const until = now() + waitMs;
  while (now() < until) {
    await sleep(pollMs);
    if (!(await held())) break;
  }
  return true;
};
