import type { Context } from "koa";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { baseGoneErr } from "../../errors/errors.js";
import { postgres } from "../../server.js";
import { logger } from "../../utils/logger.js";
import { readAttackSession } from "./attackSessionStore.js";

/**
 * Why a save's row is missing:
 * - `noBasesaveid` — the save named no row, and its base is no tribe that has none;
 * - `replaced` — another row holds the base now (a wild camp that regrew);
 * - `gone` — no row holds it (an outpost moved or taken, an owner deleted);
 * - `notShown` — a route that names no row (`updatesaved`) was refused a base
 *   that is there: out of the player's sight, or not their own.
 */
export type MissingBaseCause = "noBasesaveid" | "replaced" | "gone" | "notShown";

/**
 * Kept pure, like `checkAttackBinding`, so the rule is testable without a database.
 *
 * @param basesaveid - The row the save named; undefined for a route that names none.
 * @param now - The row that holds the base now, if any.
 */
export const missingBaseCause = (
  basesaveid: number | undefined,
  now: { basesaveid: number } | null
): MissingBaseCause => {
  if (basesaveid === undefined) return now ? "notShown" : "gone";
  if (!Number.isSafeInteger(basesaveid) || basesaveid <= 0) return "noBasesaveid";
  return now ? "replaced" : "gone";
};

interface MissingBaseSave {
  baseid: string;
  /** The row the save named; left out by a route that names none. */
  basesaveid?: number;
  /** What kind of save it was: `attack`, `own`, or the route's own word (`updatesaved view`). */
  saveType: string;
}

/**
 * Refuses a save whose row is not there (live: ~350 a day answered 500 with
 * nothing logged): `410` with `reason: "baseGone"`, which the web client
 * shows once and does not retry, and one WARN line saying who saved what and
 * why. `liveAttack` is the line to look for: this player's attack session on
 * the row was still open, so the attack's result was lost with it.
 *
 * @throws {ClientSafeError} `baseGoneErr`, always.
 */
export const refuseMissingBase = async (
  ctx: Context,
  user: User,
  { baseid, basesaveid, saveType }: MissingBaseSave
): Promise<never> => {
  const known = basesaveid !== undefined && Number.isSafeInteger(basesaveid) && basesaveid > 0;
  const now = await postgres.em.findOne(Save, { baseid }, { fields: ["basesaveid", "type"] });
  const session = known ? await readAttackSession(basesaveid!) : null;
  const cause = missingBaseCause(basesaveid, now);

  logger.warn("Save refused for {username} (userid {userid}): {saveType} on base {baseid} ({basesaveid}) {cause}", {
    event: "save-base-gone",
    userid: user.userid,
    username: user.username,
    baseid,
    basesaveid: known ? basesaveid : null,
    saveType,
    cause,
    liveAttack: session?.attackerid === user.userid,
    nowBasesaveid: now?.basesaveid ?? null,
    nowType: now?.type ?? null,
    path: ctx.path,
  });

  throw baseGoneErr(cause);
};
