import type { Save } from "../../database/models/save.model.js";
import { isAttackActive } from "./isAttackActive.js";
import { readAttackSession } from "./attackSessionStore.js";

/**
 * Whether an attack is running on a yard: its own record, or a live attack
 * session. A route that moves or deletes a yard refuses while one runs, as
 * the attack's save would land on a yard that has moved or no longer exists
 * (`migrateBase.ts`, `migrateToFriend.ts`).
 */
export const yardUnderAttack = async (yard: Save): Promise<boolean> =>
  isAttackActive(yard) || (await readAttackSession(yard.basesaveid)) !== null;
