import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../database/models/save.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { recordAchievements } from "../achievements/record.js";
import { countTribeDestroyed } from "./counters.js";

/**
 * Counts a Map Room 1 tribe the server's replay destroyed (goals WM1-WM4,
 * `docs/design/tutorial.md` §6.2, issue #227) on the attacker's main row.
 *
 * The tribe save does not hold the attacker's row lock, so the count is
 * written in its own short transaction that does (`SELECT … FOR UPDATE`, as
 * every yard action locks it), re-reading `onboarding` there: a yard action
 * writing the column at the same moment (a claim, another counter) is never
 * overwritten, nor overwrites this.
 *
 * The account's achievements are evaluated in the same transaction
 * (`docs/design/achievements.md` §7.2, issue #204), so a Kozu tribe unlocks
 * "Kozu Crusher" at once: the evaluator reads `tribes.kozu`.
 *
 * @param em - The request's entity manager.
 * @param basesaveid - The attacker's main save.
 * @param baseid - The tribe base destroyed.
 */
export const recordTribeDestroyed = async (
  em: EntityManager,
  basesaveid: number,
  baseid: string
): Promise<void> =>
  em.transactional(async (tx) => {
    const save = await tx.findOne(
      Save,
      { basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    if (!save) return;
    const onboarding = countTribeDestroyed(save, baseid);
    if (!onboarding) return;
    save.onboarding = onboarding;
    await recordAchievements(tx, save, getCurrentDateTime());
    await tx.flush();
  });
