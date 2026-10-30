import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { emitLevelChange } from "../../chat/levelChangeBus.js";
import { BaseType } from "../../enums/Base.js";
import { layoutInvalidErr } from "../../errors/errors.js";
import { YardTargetSchema } from "../../schemas/YardSchemas.js";
import { postgres } from "../../server.js";
import { playerLevelOf } from "../../services/base/calculateBaseLevel.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import { syncInfernoCap } from "../../services/inferno/infernoLoad.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import { notInOutpostErr, notYourYardErr } from "../../services/yard/yardErrors.js";
import { yardKindOf, type YardKind } from "../../services/yardplanner/costs.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { lockInfernoRow, lockOwnYard } from "../yard/yardAction.js";

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
 *
 * The Inferno yard's `baseid` works like the main yard's (owner decision
 * 2026-10-29, overriding Flash, which had no planner there, `BASE.as:1072`;
 * `docs/design/inferno.md` §2.5). Apply and the batches lock the main row and
 * then the Inferno row (`lockOwnYard`, `403 infernoOff` while the Inferno is
 * switched off) and act on the Inferno yard seen through the main yard
 * (`infernoView`): its own buildings and Inferno footprints, the Inferno purse.
 * Its layouts are its own: they live in the Inferno row's `savetemplate`,
 * never mixed with the main yard's ({@link onLayoutYard}).
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
    // Compared once `run` and the flush are done, so a layout or upgrade
    // batch that moves the Flinger's level invalidates the Map Room 2 fog
    // of war sight cache (issue #329, #330 WP1).
    const flingerBefore = save.flinger;
    const result = run(save, getCurrentDateTime());
    postgres.em.persist(save);
    await postgres.em.flush();
    emitLevelChange(user.userid, user.username, playerLevelOf(save));
    await invalidateSightIfFlingerChanged(user, flingerBefore, save.flinger);
    return result;
  }

  const result = await postgres.em.transactional(async (tx) => {
    const yard = await lockOwnYard(tx, user, baseid);
    const now = getCurrentDateTime();
    const flingerBefore = yard.save.flinger;
    catchUpYard(yard.save, now);
    const batchResult = run(yard.save, now);
    // A Resource Pod an Apply finishes moves the Inferno caps, as a yard
    // action's does (`runYardAction`).
    if (yard.inferno) syncInfernoCap(yard.main, yard.inferno);
    await tx.flush();
    return { batchResult, flingerBefore, flingerAfter: yard.save.flinger };
  });

  await invalidateSightIfFlingerChanged(user, result.flingerBefore, result.flingerAfter);
  return result.batchResult;
};

/**
 * {@link invalidateSightIfFlingerChanged} (`sightService.ts`), imported on
 * use: this module already pulls `lockOwnYard` from
 * `controllers/yard/yardAction.ts`, which is itself part of the import chain
 * `sightService.ts` would otherwise loop back through (`tips.ts` imports
 * `defineYardAction` from there) — the same reason
 * `services/yard/mapRoom.ts`'s `joinWorld` imports late too.
 */
const invalidateSightIfFlingerChanged = async (
  user: User,
  before: number | undefined,
  after: number | undefined
): Promise<void> => {
  const sightService = await import("../../services/maproom/sight/sightService.js");
  await sightService.invalidateSightIfFlingerChanged(user, before, after);
};

/**
 * The row whose `savetemplate` holds the layouts a request names, and the
 * yard's kind: the main save without a `baseid` (or with its own), the
 * caller's Inferno row with its `baseid_inferno` (the file comment), and an
 * outpost is refused (`409 notInOutpost`), as Flash's planner could not save
 * or load layouts there (`BasePlanner.as:41`).
 *
 * The Inferno row is read under its lock when `write` is set (a save or a
 * delete, written in the same transaction), and plainly for a read, which an
 * attack on the Inferno yard does not stop, as it does not stop the main
 * yard's list either.
 *
 * @param user - The caller (`ctx.authUser`).
 * @param raw - The request body or query, which may carry `baseid`.
 * @param run - The route's work on the row; it must not persist it.
 * @param write - Whether `run` changes the row, which is then written.
 * @returns What `run` returned.
 * @throws `409 notInOutpost`, `403 infernoOff`, `403 notYourYard`, and
 *   `409 underAttack` for a write on an Inferno yard being attacked.
 */
export const onLayoutYard = async <T>(
  user: User,
  raw: unknown,
  run: (save: Save, kind: YardKind) => T,
  write: boolean
): Promise<T> => {
  await postgres.em.populate(user, ["save"]);
  const main = user.save!;
  const baseid = targetOf(user, raw);

  if (baseid === undefined) {
    const result = run(main, "main");
    if (write) {
      postgres.em.persist(main);
      await postgres.em.flush();
    }
    return result;
  }

  if (!(Number(main.baseid_inferno) > 0) || baseid !== String(main.baseid_inferno)) {
    throw notInOutpostErr("Layouts cannot be saved or loaded in an outpost.");
  }

  if (!write) {
    requireInfernoEnabled();
    const inferno = await postgres.em.findOne(Save, { baseid });
    if (!inferno || inferno.type !== BaseType.INFERNO || inferno.userid !== user.userid) {
      throw notYourYardErr();
    }
    return run(inferno, yardKindOf(inferno));
  }

  return postgres.em.transactional(async (tx) => {
    const inferno = await lockInfernoRow(tx, user, baseid);
    const result = run(inferno, yardKindOf(inferno));
    await tx.flush();
    return result;
  });
};

/**
 * Refuses a legacy Flash template call that names any yard but the main
 * one: `409 notInOutpost`. The Flash client never had a planner outside the
 * main yard, so its routes (`gettemplates`, `savetemplate`) stay main-only.
 *
 * @param user - The caller, with `save` populated.
 * @param raw - The request body or query, which may carry `baseid`.
 */
export const refuseOutpostLayouts = (user: User, raw: unknown): void => {
  if (targetOf(user, raw) !== undefined) {
    throw notInOutpostErr("Layouts cannot be saved or loaded in an outpost.");
  }
};
