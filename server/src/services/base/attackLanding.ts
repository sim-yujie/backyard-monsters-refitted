import { LockMode, type Transaction } from "@mikro-orm/core";

import { Save } from "../../database/models/save.model.js";
import { saveFailureErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import type { OutpostOwnerSave } from "./getOutpostOwnerSave.js";

/**
 * Opens the transaction an attack's result lands in, and locks the rows it
 * writes (audit 2026-10-29, P1 and P2): the save that ends the attack
 * (`baseSave.ts`) and the finaliser landing an abandoned one
 * (`finaliseAttack.ts`) both. The caller commits it once the defender's
 * `attackid` is 0 and rolls it back if anything throws first.
 *
 * - **Once.** Nothing of the attack commits until all of it does, the attack
 *   closed with it, so a failure part-way pays nobody and leaves the attack
 *   open to land once: the save sent again, or the finaliser's next pass.
 *   Before, the loot could commit on its own (the save's first flush, a
 *   notice's flush in the finaliser) with the attack still open.
 * - **On the rows as they stand.** The rows were read before the battle's
 *   replay; their `resources` used to be written back whole, undoing a gift,
 *   a collection or a spend made meanwhile. They are read afresh here under
 *   the lock the yard actions, gifts and help take (`yardAction.ts`), so the
 *   bombs, the loot and the defender's loss land on them as they are now; the
 *   loot itself was worked out from the rows as the attack found them. The
 *   outpost owner's main row is read for its `resources` alone, as
 *   `getOutpostOwnerSave` reads it.
 *
 * Locked in `basesaveid` order. Runs on the context's entity manager, which
 * already holds these rows, so they are refreshed in place. Whether the row
 * is still the attack's is the caller's to check, under the lock.
 *
 * @throws {ClientSafeError} `saveFailureErr` when a row has gone.
 */
export const beginAttackLanding = async (
  attackerSave: Save,
  defender: Save,
  outpostOwnerSave: OutpostOwnerSave | null
): Promise<void> => {
  // Inside a transaction already (a bot's revenge lands inside the sweep's
  // job, `sweep.ts`): a savepoint on its connection, which holds the bot's
  // rows already. A transaction of its own would wait on them for ever, and
  // would take the caller's place on the context's entity manager.
  const outer = postgres.em.getTransactionContext();
  await postgres.em.begin(outer ? { ctx: outer } : {});
  const landing = postgres.em.getTransactionContext();
  if (landing) landings.set(landing, outer);

  const rows = [attackerSave, defender, outpostOwnerSave]
    .filter((row): row is Save => row !== null)
    .sort((a, b) => a.basesaveid - b.basesaveid);

  for (const row of rows) {
    const where = { basesaveid: row.basesaveid };
    const locked =
      row === outpostOwnerSave
        ? await postgres.em.findOne(Save, where, {
            fields: ["resources"],
            lockMode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
          })
        : await postgres.em.findOne(Save, where, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (!locked) throw saveFailureErr();
  }
};

/** Each open landing's transaction, and the caller's it is nested in, if any. */
const landings = new WeakMap<Transaction, Transaction | undefined>();

/** The context's open landing, if its transaction is one: not when none is open, or only the caller's. */
const openLanding = (): { landing: Transaction; outer: Transaction | undefined } | null => {
  const landing = postgres.em.getTransactionContext();
  return landing && landings.has(landing) ? { landing, outer: landings.get(landing) } : null;
};

/**
 * Commits the landing: everything of the attack, flushed, together. The
 * context then has the caller's transaction back, if it was nested in one.
 * A commit that throws leaves the landing open for the caller's rollback.
 */
export const commitAttackLanding = async (): Promise<void> => {
  const open = openLanding();
  if (!open) return;
  await postgres.em.commit();
  landings.delete(open.landing);
  if (open.outer) postgres.em.setTransactionContext(open.outer);
};

/**
 * Rolls back a landing that threw before its commit, and gives the context
 * back the caller's transaction, if it was nested in one. Nothing if none
 * is open, so never the caller's transaction itself.
 */
export const rollbackAttackLanding = async (): Promise<void> => {
  const open = openLanding();
  if (!open) return;
  landings.delete(open.landing);
  try {
    await postgres.em.rollback();
  } finally {
    if (open.outer) postgres.em.setTransactionContext(open.outer);
  }
};
