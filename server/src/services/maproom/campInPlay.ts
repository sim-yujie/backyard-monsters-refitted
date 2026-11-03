import { redis } from "../../server.js";
import { attackSessionKey } from "../base/attackSession.js";
import { attackCheckpointKey } from "../base/attackCheckpoint.js";

/**
 * Whether an attack is still on a camp's row: its session is open, or it was
 * left with a checkpoint the finaliser has yet to land.
 *
 * A camp's row never lists its attacks (`baseModeAttack` pushes none for a
 * tribe), so `isAttackActive` cannot tell, and a camp first attacked keeps its
 * template's old `savetime` until that attack's save, so the expiry rule calls
 * it regrown for the attack's whole length. Regrowing it then deleted the row
 * under the attack, whose save found nothing (live: 500s, the result lost).
 *
 * @param basesaveid - The camp's row.
 */
export const isCampInPlay = async (basesaveid: number | undefined): Promise<boolean> => {
  if (!basesaveid) return false;
  const [session, checkpoint] = await Promise.all([
    redis.get(attackSessionKey(basesaveid)),
    redis.get(attackCheckpointKey(basesaveid)),
  ]);
  return session !== null || checkpoint !== null;
};
