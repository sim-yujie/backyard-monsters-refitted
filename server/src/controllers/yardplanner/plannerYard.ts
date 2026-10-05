import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { emitLevelChange } from "../../chat/levelChangeBus.js";
import { layoutInvalidErr } from "../../errors/errors.js";
import { YardTargetSchema } from "../../schemas/YardSchemas.js";
import { postgres } from "../../server.js";
import { playerLevelOf } from "../../services/base/calculateBaseLevel.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import { notInOutpostErr } from "../../services/yard/yardErrors.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { lockOwnYard } from "../yard/yardAction.js";

/**
 * The yard a Yard Planner route acts on (outposts WP3, issue #184).
 *
 * Without a `baseid` (or with the main yard's own) nothing changes: the batch
 * routes read `user.save` and write it in one flush, as they always have.
 *
 * With the `baseid` of one of the caller's Map Room 2 outposts, Apply and the
 * wall and trap batches act on that outpost the way the yard actions do
 * (`controllers/yard/yardAction.ts`): in one transaction, the main row locked
 * first and the outpost row second (`lockOwnYard`, `403 notYourYard`,
 * `409 underAttack`), the outpost caught up to now (`catchUpOutpost`), and the
 * route handed the outpost seen through the main yard (`poolView`), so its
 * charge and its points land on the main pool. The route's own countdown
 * advance then has no time left to replay.
 *
 * Saving, loading and deleting layouts is refused for an outpost: Flash's
 * planner could not save or load templates there
 * (`client/scripts/com/monsters/baseplanner/BasePlanner.as:41`).
 */

/**
 * The outpost `baseid` a planner request names, or undefined for the main
 * yard. Reads the body (a form post) or, for a `GET`, the query.
 *
 * @throws `400` for a `baseid` that is not a whole number.
 */
const targetOf = (user: User, raw: unknown): string | undefined => {
  const target = YardTargetSchema.safeParse(raw ?? {});
  if (!target.success) throw layoutInvalidErr("That yard could not be read.", { field: "baseid" });
  const { baseid } = target.data;
  return baseid === undefined || baseid === String(user.save?.baseid) ? undefined : baseid;
};

/**
 * Runs `run` against the yard the request names and writes it (the file
 * comment). `run` mutates the save it is handed; it must not persist it.
 *
 * On the main yard, once written, the caller's chat display name is pushed
 * if the level `run` leaves it at differs from the one last broadcast
 * (issue #232) — a no-op off an outpost, where #209's `basevalue` never
 * moves.
 *
 * @param user - The caller (`ctx.authUser`).
 * @param raw - The request body, which may carry `baseid`.
 * @param run - The route's work, given the yard and the request's `now`.
 * @returns What `run` returned.
 */
export const onPlannerYard = async <T>(
  user: User,
  raw: unknown,
  run: (save: Save, now: number) => T
): Promise<T> => {
  await postgres.em.populate(user, ["save"]);
  const baseid = targetOf(user, raw);

  if (baseid === undefined) {
    const save = user.save!;
    const result = run(save, getCurrentDateTime());
    postgres.em.persist(save);
    await postgres.em.flush();
    emitLevelChange(user.userid, user.username, playerLevelOf(save));
    return result;
  }

  return postgres.em.transactional(async (tx) => {
    const yard = await lockOwnYard(tx, user, baseid);
    const now = getCurrentDateTime();
    catchUpYard(yard.save, now);
    const result = run(yard.save, now);
    await tx.flush();
    return result;
  });
};

/**
 * Refuses a layout save, load or delete that names an outpost (the file
 * comment): `409 notInOutpost`.
 *
 * @param user - The caller, with `save` populated.
 * @param raw - The request body or query, which may carry `baseid`.
 */
export const refuseOutpostLayouts = (user: User, raw: unknown): void => {
  if (targetOf(user, raw) !== undefined) {
    throw notInOutpostErr("Layouts cannot be saved or loaded in an outpost.");
  }
};
