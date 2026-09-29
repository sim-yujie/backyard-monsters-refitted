import type { Context } from "koa";
import type { CombatValidationMode } from "../../../config/CombatConfig.js";
import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { attackBombRefusedErr } from "../../../errors/errors.js";
import { logger } from "../../../utils/logger.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { bombSpendOf, catapultLevelOf, type BombSpend } from "./bombSpend.js";

/**
 * What the bombs in an attack save's fling log cost the attacker, checked the
 * way Flash checked a bomb before it let one go (issue #90, `bombSpend.ts`).
 *
 * `bombSpend.ts` is pure; this is the half that talks to the logger and turns
 * the mode into behaviour (`config/CombatConfig.ts`). Every bomb the table
 * knows is charged whatever the mode; the mode decides only what happens to a
 * bomb Flash would not have fired: `off` says nothing, `log` writes one
 * warning, `reject` writes it and refuses the save. It runs before any save key
 * is applied, so a refusal leaves every row untouched.
 *
 * The log is resent in full on every save, and so is charged on every attack
 * save that carries one, the same as `attackloot` is credited on every save.
 * The web client sends exactly one save per attack
 * (`web/src/game/attack/plugins/end.ts`); its checkpoints (issue #138,
 * `/base/checkpoint`) charge nothing, and the one save and the server's
 * finalisation of an abandoned attack (`finaliseAttack.ts`) exclude each other
 * through the final lock, so each attack's bombs are charged once. A Flash save carries no
 * log and is charged nothing here: its bomb spend is already netted into its
 * `attackloot` (`BASE.as:2859-2866`).
 *
 * @param ctx The Koa context, for the caller's IP.
 * @param user The attacker.
 * @param userSave The attacker's main save, whose pool pays.
 * @param baseSave The defender's row, for the log line.
 * @param flinglog The parsed `flinglog`, if one was sent.
 * @param mode The active `COMBAT_SAVE_VALIDATION` mode.
 * @param pool The pool the attack began with (the session's `attackerResources`),
 *   which the bombs are priced against when known (issue #23, C3); else the stored one.
 * @returns What to charge, or null when there is nothing to.
 * @throws {ClientSafeError} In `reject` mode, when a bomb could not have been fired.
 */
export const recordBombSpend = (
  ctx: Context,
  user: User,
  userSave: Save,
  baseSave: Save,
  flinglog: unknown,
  mode: CombatValidationMode,
  pool?: Partial<Record<"r1" | "r2" | "r3" | "r4", number>> | null
): BombSpend | null => {
  if (flinglog === undefined) return null;

  const spend = bombSpendOf(flinglog, {
    resources: (pool as JsonObject | undefined) ?? userSave.resources,
    catapultLevel: catapultLevelOf(userSave),
  });

  if (spend.violations.length > 0 && mode !== "off") {
    const rejected = mode === "reject";

    logger.warn("Attack bombs {outcome} for {username} (userid {userid}) on base {baseid}", {
      event: "attack-bomb-audit",
      outcome: rejected ? "rejected" : "flagged",
      mode,
      userid: user.userid,
      username: user.username,
      baseid: baseSave.baseid,
      basesaveid: baseSave.basesaveid,
      ip: ctx.ip,
      violations: spend.violations,
      charges: spend.charges,
    });

    if (rejected) throw attackBombRefusedErr([...spend.violations]);
  }

  return spend.charges.length > 0 ? spend : null;
};
