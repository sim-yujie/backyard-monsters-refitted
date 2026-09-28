import z from "zod";
import { LockMode, type EntityManager } from "@mikro-orm/core";

import type { KoaController } from "../../../utils/KoaController.js";
import { postgres } from "../../../server.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { User } from "../../../database/models/user.model.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { monsterTransferRejectedErr, permissionErr } from "../../../errors/errors.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import {
  HOUSING_EXPANSION_ITEMS,
  checkMonsterTransfer,
  deriveHousingCapacity,
  type TransferYard,
} from "../../../services/monsters/transferRules.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { catchUpTransferYards } from "../../../services/yard/armies.js";
import { countsOf } from "../../../services/yard/attackRoster.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";
import { readAttackSession } from "../../../services/base/attackSessionStore.js";

const TransferMonstersScema = z.object({
  frombaseid: z.string(),
  tobaseid: z.string(),
  monsters: z.string().transform((monsters, ctx) => {
    try {
      return JSON.parse(monsters) as unknown;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "monsters is not valid JSON" });
      return z.NEVER;
    }
  }),
});

/**
 * Whether the Housing Expansion power-up is running on a save
 * (`EXH`/`EXHI` in `Save.storedata`, `client/scripts/STORE.as:2419-2431`).
 *
 * @param {JsonObject | null | undefined} storeData - A save's `storedata`
 * @param {number} now - Current unix seconds
 * @returns {boolean} True while the power-up is active
 */
const housingExpansionActive = (
  storeData: JsonObject | null | undefined,
  now: number
): boolean =>
  HOUSING_EXPANSION_ITEMS.some((item) => Number(storeData?.[item]?.e ?? 0) > now);

/**
 * The caller's Monster Academy level per monster id, which is what decides a
 * monster's `cStorage` (`CREATURES.GetProperty`, `client/scripts/CREATURES.as:68-77`).
 *
 * An outpost's own `academy` column is usually empty while the levels really
 * live on the main yard, so the highest level found across the saves wins. Only
 * `C1`'s housing space varies by level and it shrinks as the level rises, so
 * reading high is the reading that never over-measures an honest army.
 *
 * @param {(JsonObject | null | undefined)[]} academies - `Save.academy` from each save involved
 * @returns {Record<string, number>} Academy level per monster id
 */
const academyLevels = (
  academies: (JsonObject | null | undefined)[]
): Record<string, number> => {
  const levels: Record<string, number> = {};

  for (const academy of academies) {
    if (!academy) continue;

    for (const [id, entry] of Object.entries(academy)) {
      const level = Math.floor(Number((entry as JsonObject | null)?.level ?? 0));

      if (Number.isFinite(level) && level > (levels[id] ?? 0)) levels[id] = level;
    }
  }

  return levels;
};

/**
 * Controller to handle the transfer of monsters between outposts and main yards.
 *
 * The client posts two **complete replacement** `monsters` blobs, one per yard,
 * and the server used to write both verbatim — so a hand-made request could copy
 * an army into the destination without taking it out of the source. Everything
 * past the ownership check is issue #27: quantities, holdings, conservation and
 * the destination's housing capacity, decided by
 * `services/monsters/transferRules.ts`. Both yards are caught up first, and an
 * accepted transfer writes only the two posted `housed` rosters onto them.
 *
 * A transfer that involves an outpost needs both yards on the same world (the
 * outposts plan, WP0), and nothing moves while either yard has an attack
 * running: the attack's save would otherwise land on a garrison it did not
 * fight. The rows are locked, main yard first, for the whole check and write.
 *
 * @param {Object} ctx - The Koa context object.
 * @returns {Promise<void>}
 */
export const transferMonsters: KoaController = async (ctx) => {
  const { frombaseid, tobaseid, monsters } = TransferMonstersScema.parse(
    ctx.request.body
  );

  const currentUser: User = ctx.authUser;

  if (frombaseid === tobaseid)
    throw monsterTransferRejectedErr("endpoints", "a yard cannot send monsters to itself.", {
      baseid: frombaseid,
    });

  if (!Array.isArray(monsters) || monsters.length < 2)
    throw monsterTransferRejectedErr(
      "quantities",
      "that transfer was not sent in a shape the server understands.",
      {}
    );

  const [fromBlob, toBlob] = monsters as [unknown, unknown];

  // Determine the order so the query always makes the source base the first result.
  const orderBy = frombaseid > tobaseid ? { baseid: 'DESC' as const } : { baseid: 'ASC' as const };

  // Fetch the bases to transfer the monsters between
  const [fromBase, toBase] = await postgres.em.find(Save, {
    baseid: { $in: [frombaseid, tobaseid] },
  }, { orderBy });

  if (!fromBase || !toBase) {
    ctx.status = Status.BAD_REQUEST;
    ctx.body = { error: 1 };
    throw new Error(`One or both bases not found. From: ${frombaseid}, To: ${tobaseid}`);
  }

  // Verify that both bases belong to the same user
  if (fromBase.saveuserid !== toBase.saveuserid) {
    ctx.status = Status.FORBIDDEN;
    ctx.body = { error: 1 };
    throw new Error(`Bases belong to different users. From: ${frombaseid} with SaveId: ${fromBase.saveuserid}, To: ${tobaseid} with SaveId: ${toBase.saveuserid}`);
  }

  // A shared saveuserid only proves the two yards have the same owner, not that the
  // caller is that owner. Without this, any authenticated player can rewrite the
  // monster garrisons of any other player's main yard and outpost.
  if (
    fromBase.saveuserid !== currentUser.userid ||
    toBase.saveuserid !== currentUser.userid
  ) {
    throw permissionErr();
  }

  if (fromBase.type === BaseType.OUTPOST || toBase.type === BaseType.OUTPOST) {
    const cells = await postgres.em.find(WorldMapCell, { baseid: { $in: [frombaseid, tobaseid] } });
    const worldOf = (baseid: string) => cells.find((cell) => cell.baseid === baseid)?.world?.uuid;
    const world = worldOf(frombaseid);

    if (!world || world !== worldOf(tobaseid))
      throw monsterTransferRejectedErr("world", "those yards are not on the same world.", {
        frombaseid,
        tobaseid,
      });
  }

  // The Academy levels and the Housing Expansion power-up both live on the main
  // yard, which an outpost transfer would otherwise never load.
  await postgres.em.populate(currentUser, ["save"]);

  await postgres.em.transactional(async (em) => {
    // The main yard's row first, then the two yards in id order, as every
    // route that touches more than one of a player's yards locks them.
    const mainId = currentUser.save?.basesaveid;
    const yardIds = [...new Set([fromBase.basesaveid, toBase.basesaveid])].sort((a, b) => a - b);

    for (const basesaveid of mainId ? [mainId, ...yardIds.filter((id) => id !== mainId)] : yardIds)
      await em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

    if (fromBase.saveuserid !== currentUser.userid || toBase.saveuserid !== currentUser.userid)
      throw permissionErr();

    for (const yard of [fromBase, toBase]) {
      if (isAttackActive(yard) || (await readAttackSession(yard.basesaveid)) !== null)
        throw monsterTransferRejectedErr("underAttack", "one of those yards is under attack.", {
          baseid: yard.baseid,
        });
    }

    await transferBetween(em, currentUser, fromBase, toBase, fromBlob, toBlob);
  });

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};

/**
 * The transfer itself, once both yards are locked and quiet: catch up, check
 * against the rules, and write the two rosters.
 */
const transferBetween = async (
  em: EntityManager,
  currentUser: User,
  fromBase: Save,
  toBase: Save,
  fromBlob: unknown,
  toBlob: unknown
): Promise<void> => {
  const { baseid: frombaseid } = fromBase;
  const { baseid: tobaseid } = toBase;
  const mainSave = currentUser.save ?? null;
  const now = getCurrentDateTime();

  // Both yards as they are now (docs/design/yard-buildings.md §2.3): the
  // rules measure the caught-up rosters, and what is written keeps the
  // server's production state.
  catchUpTransferYards([fromBase, toBase], mainSave, now);

  const capacityFor = (save: Save): number =>
    deriveHousingCapacity({
      buildingData: save.buildingdata,
      healthData: save.buildinghealthdata,
      housingExpansionActive:
        housingExpansionActive(save.storedata, now) ||
        housingExpansionActive(mainSave?.storedata, now),
      inferno: save.type === BaseType.INFERNO,
    });

  const yardOf = (save: Save): TransferYard => ({
    baseid: save.baseid,
    type: save.type,
    stored: save.monsters,
    capacity: capacityFor(save),
  });

  const verdict = checkMonsterTransfer({
    from: yardOf(fromBase),
    to: yardOf(toBase),
    fromBlob,
    toBlob,
    monsterLevels: academyLevels([mainSave?.academy, fromBase.academy, toBase.academy]),
  });

  if (!verdict.ok)
    throw monsterTransferRejectedErr(verdict.rule, verdict.message, {
      ...verdict.detail,
      frombaseid,
      tobaseid,
    });

  // Only the rosters move. The hatchery state stays the server's: the posted
  // blobs are the client's copies, and their `h`/`hcc`/`saved` may be older.
  fromBase.monsters = { ...(fromBase.monsters ?? {}), housed: countsOf((fromBlob as JsonObject | null)?.housed) };
  toBase.monsters = { ...(toBase.monsters ?? {}), housed: countsOf((toBlob as JsonObject | null)?.housed) };

  em.persist([fromBase, toBase]);
  await em.flush();
};
