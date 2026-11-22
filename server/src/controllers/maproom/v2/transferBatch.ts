import z from "zod";
import { LockMode } from "@mikro-orm/core";

import type { KoaController } from "../../../utils/KoaController.js";
import { postgres } from "../../../server.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import type { User } from "../../../database/models/user.model.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { monsterTransferRejectedErr, permissionErr } from "../../../errors/errors.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { deriveHousingCapacity, type TransferYard } from "../../../services/monsters/transferRules.js";
import { planBatchTransfer, readBatchPairs } from "../../../services/monsters/transferBatch.js";
import { catchUpTransferYards } from "../../../services/yard/armies.js";
import { recordUserQuestEvents } from "../../../services/quests/record.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";
import { readAttackSession } from "../../../services/base/attackSessionStore.js";
import { jsonField } from "../../../schemas/jsonField.js";
import { highestAcademyLevels, housingExpansionActive } from "../../../services/yard/housing.js";

/** `moves`: `[{ from, to, moved: { C1: 5 } }, ...]`, as JSON. */
const TransferBatchSchema = z.object({
  moves: jsonField("moves is not valid JSON"),
});

/**
 * `POST /worldmapv2/transferbatch` (beta 9 #7, owner 22 Nov 2026): the world
 * map's move tray sends one move with several pairs of yards — the main yard
 * to its five nearest outposts, every outpost home — free and instant, as one
 * pair through `transferassets` always was.
 *
 * The same checks as `transferMonsters.ts`, for every yard the move names:
 * each is the caller's own, all are on one world, none has an attack running;
 * the rows are locked main yard first, then in id order, and caught up before
 * any count is read. The pairs then go through `planBatchTransfer`
 * (`services/monsters/transferBatch.ts`), each checked against the rosters the
 * pairs before it left. One refused pair refuses the move: nothing is written.
 *
 * Answers `{ error: 0, moved, yards: [{ baseid, housed, capacity }] }`: every
 * yard the move touched, as the server now has it.
 */
export const transferBatch: KoaController = async (ctx) => {
  const { moves } = TransferBatchSchema.parse(ctx.request.body);
  const read = readBatchPairs(moves);
  if ("refused" in read) throw monsterTransferRejectedErr("batch", read.refused, {});
  const { pairs } = read;

  const user: User = ctx.authUser;
  const baseids = [...new Set(pairs.flatMap((pair) => [pair.from, pair.to]))];

  const saves = await postgres.em.find(Save, { baseid: { $in: baseids } });
  // A yard that does not exist or is not the caller's: the move is not theirs to make.
  if (saves.length !== baseids.length || saves.some((save) => save.saveuserid !== user.userid))
    throw permissionErr();

  const cells = await postgres.em.find(WorldMapCell, { baseid: { $in: baseids } });
  const worlds = new Set(baseids.map((baseid) => cells.find((cell) => cell.baseid === baseid)?.world?.uuid));
  if (worlds.size !== 1 || worlds.has(undefined))
    throw monsterTransferRejectedErr("world", "those yards are not on the same world.", { baseids });

  // The Academy levels and the Housing Expansion power-up live on the main yard.
  await postgres.em.populate(user, ["save"]);

  const { hatched, total, written } = await postgres.em.transactional(async (em) => {
    // The main yard's row first, then the rest in id order, as every route that
    // touches more than one of a player's yards locks them.
    const mainId = user.save?.basesaveid;
    const ids = [...new Set(saves.map((save) => save.basesaveid))].sort((a, b) => a - b);
    for (const basesaveid of mainId ? [mainId, ...ids.filter((id) => id !== mainId)] : ids)
      await em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

    if (saves.some((save) => save.saveuserid !== user.userid)) throw permissionErr();

    const sessions = await Promise.all(saves.map((save) => readAttackSession(save.basesaveid)));
    saves.forEach((save, index) => {
      if (isAttackActive(save) || sessions[index] !== null)
        throw monsterTransferRejectedErr("underAttack", "one of those yards is under attack.", {
          baseid: save.baseid,
        });
    });

    const mainSave = user.save ?? null;
    const now = getCurrentDateTime();
    const hatched = catchUpTransferYards(saves, mainSave, now);

    const boosted = housingExpansionActive(mainSave?.storedata, now);
    const yards = new Map<string, TransferYard>(
      saves.map((save) => [
        save.baseid,
        {
          baseid: save.baseid,
          type: save.type,
          stored: save.monsters,
          capacity: deriveHousingCapacity({
            buildingData: save.buildingdata,
            healthData: save.buildinghealthdata,
            housingExpansionActive: boosted || housingExpansionActive(save.storedata, now),
            inferno: save.type === BaseType.INFERNO,
          }),
        },
      ])
    );

    const verdict = planBatchTransfer({
      yards,
      pairs,
      monsterLevels: highestAcademyLevels([mainSave?.academy, ...saves.map((save) => save.academy)]),
    });
    if (!verdict.ok)
      throw monsterTransferRejectedErr(verdict.rule, verdict.message, {
        ...verdict.detail,
        pair: verdict.pair,
      });

    // Each roster lands as the delta the pairs made (#196): the caught-up rows
    // keep everything else, hatchery state included.
    const written = saves.map((save) => {
      const housed = verdict.housed[save.baseid] ?? {};
      save.monsters = { ...(save.monsters ?? {}), housed };
      return { baseid: save.baseid, housed, capacity: yards.get(save.baseid)?.capacity ?? 0 };
    });
    em.persist(saves);
    await em.flush();
    return { hatched, total: verdict.total, written };
  });

  await recordUserQuestEvents(postgres.em, user.userid, hatched);

  ctx.status = Status.OK;
  ctx.body = { error: 0, moved: total, yards: written };
};
