import type { AttackDetails } from "../../controllers/base/load/modes/baseModeAttack.js";
import { Save } from "../../database/models/save.model.js";
import { baseUnderAttackErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";

/** Attack ids run 1 to 99999, as Flash minted them. */
const ATTACK_ID_RANGE = 99999;

/**
 * A new attack id, never the one the row holds now: the claim below compares
 * against that one, so a new id equal to it could not be told apart.
 *
 * @param readAttackid - The `attackid` the attack load read off the row.
 * @param random - A number in [0, 1), `Math.random` by default.
 */
export const mintAttackId = (readAttackid: number, random: () => number = Math.random): number => {
  const id = Math.floor(random() * ATTACK_ID_RANGE) + 1;
  return id === readAttackid ? (id % ATTACK_ID_RANGE) + 1 : id;
};

/**
 * Marks a player's yard or outpost under attack for this attack, in one step
 * (patch 8.7, owner's pick "Claim in one step", 25 Nov 2026).
 *
 * The attack load reads the row with a plain `findOne` and checks it is not
 * under attack (`isAttackActive`) and not protected. Two attacks started at
 * the same moment both passed those checks and both went on to fight the
 * yard. Now the row is claimed with one conditional UPDATE, as `regrowCamp`
 * claims a camp: it sets the new `attackid` and the `attacks` list with this
 * attack on the end only while the row still holds the `attackid` this
 * request read and its protection is over. Writing the attack's record in
 * the same statement is what makes the yard count as under attack at once
 * (`isAttackActive` reads both), so a third attack started after the claim
 * is refused by the plain read. Only one of two claims can find the old
 * `attackid`; the other changes nothing and is answered as any attack on a
 * yard under attack is.
 *
 * One indexed single-row UPDATE, no transaction and no row lock held: it
 * costs what the flush that follows it used to, at any number of players.
 *
 * @param basesaveid - The defender's row.
 * @param readAttackid - Its `attackid` when the attack load checked it.
 * @param attackid - The new attack's id ({@link mintAttackId}).
 * @param attacks - The row's `attacks` list with this attack on the end.
 * @param now - The current unix time in seconds.
 * @throws {ClientSafeError} `baseUnderAttackErr` when another attack claimed
 *   the row first, or its protection started meanwhile.
 */
export const claimAttack = async (
  basesaveid: number,
  readAttackid: number,
  attackid: number,
  attacks: AttackDetails[],
  now: number
): Promise<void> => {
  const claimed = await postgres.em.nativeUpdate(
    Save,
    { basesaveid, attackid: readAttackid, protected: { $lte: now } },
    { attackid, attacks }
  );
  if (claimed === 0) throw baseUnderAttackErr();
};
