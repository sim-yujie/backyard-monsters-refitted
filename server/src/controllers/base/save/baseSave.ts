import type { Context } from "koa";
import type { KoaController } from "../../../utils/KoaController.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { postgres, redis } from "../../../server.js";
import { buildSaveData, mapSaveData } from "../../../services/base/mapSaveData.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { logger } from "../../../utils/logger.js";
import { Status } from "../../../enums/StatusCodes.js";
import { SaveKeys } from "../../../enums/SaveKeys.js";
import { BaseSaveSchema } from "../../../schemas/BaseSaveSchema.js";
import { resourcesHandler } from "./handlers/resourceHandler.js";
import { purchaseHandler } from "./handlers/purchaseHandler.js";
import { academyHandler } from "./handlers/academyHandler.js";
import { BaseType } from "../../../enums/Base.js";
import { attackNotBoundErr, permissionErr, saveFailureErr } from "../../../errors/errors.js";
import { combatConfig } from "../../../config/CombatConfig.js";
import { chargeBombSpend } from "../../../services/base/combat/bombSpend.js";
import { recordBombSpend } from "../../../services/base/combat/recordBombSpend.js";
import { defenderLootHandler } from "./handlers/defenderLootHandler.js";
import { monsterUpdateHandler, monsterUpdateMode } from "./handlers/monsterUpdateHandler.js";
import { validateSave } from "../../../scripts/anticheat/anticheat.js";
import { getOutpostOwnerSave } from "../../../services/base/getOutpostOwnerSave.js";
import { advanceBuildingTimers } from "../../../services/base/advanceBuildingTimers.js";
import { championHandler } from "./handlers/championHandler.js";
import { buildingDataHandler } from "./handlers/buildingDataHandler.js";
import { takeoverCellMR3, type TakeoverData } from "../../../services/maproom/v3/takeoverCellMR3.js";
import { protectAfterAttack } from "../../../services/maproom/v2/damageProtection.js";
import { takeoverOffer, type TakeoverOffer } from "../../../services/maproom/v2/takeoverOffer.js";
import { isMR3Structure } from "../../../services/maproom/v3/utils/isMR3Structure.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { MR1_TRIBE_IDS } from "../../../game-data/tribes/v1/index.js";
import { scaledMR1Tribes } from "../../../services/maproom/v1/scaledMR1Tribes.js";
import { economyConfig } from "../../../config/EconomyConfig.js";
import {
  auditEconomySave,
  type EconomyAuditKind,
} from "../../../services/base/economy/auditEconomySave.js";
import {
  applyDerivedFields,
  recordEconomyVerdict,
} from "../../../services/base/economy/recordVerdict.js";
import { checkAttackBinding, type AttackSession } from "../../../services/base/attackSession.js";
import {
  endAttackSession,
  readAttackSession,
} from "../../../services/base/attackSessionStore.js";
import {
  acquireFinalLock,
  discardCheckpoint,
  releaseFinalLock,
} from "../../../services/base/attackCheckpointStore.js";
import { ownerSaveConfig } from "../../../config/OwnerSaveConfig.js";
import { requireOwnerSaveAllowed } from "../../../services/base/ownerSave.js";
import { storedDamage } from "../../../services/base/storedDamage.js";
import {
  attackLootOf,
  bankAttackLoot,
  wholeAmounts,
  type AttackLoot,
} from "../../../services/base/combat/attackLoot.js";
import { combatCellHeight } from "../../../services/base/combat/cellHeight.js";
import { RESOURCE_KEYS, type ResourceAmounts } from "../../../game-rules/combat/index.js";

/**
 * Controller responsible for saving the user's base data.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} A promise that resolves when the base save process is complete.
 * @throws Will throw an error if the save operation fails.
 */
export const baseSave: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  await postgres.em.populate(user, ["save"]);

  const userSave = user.save!;

  const body = ctx.request.body as Record<string, unknown>;
  const saveData = BaseSaveSchema.parse(body);

  const { basesaveid } = saveData;
  const baseSave =
    Number.isSafeInteger(basesaveid) && basesaveid > 0
      ? await postgres.em.findOne(Save, { basesaveid })
      : null;

  // A Map Room 1 tribe has no row of its own; its attack is bound to the
  // attacker and the tribe base instead (issue #161, `scaledMR1Tribes.ts`).
  if (!baseSave && MR1_TRIBE_IDS.has(saveData.baseid)) {
    const { save: tribeSave, credited } = await scaledMR1Tribes(ctx, user, saveData);
    const filteredSave = await mapSaveData(tribeSave, user);

    ctx.status = Status.OK;
    ctx.body = { error: 0, ...filteredSave, ...(credited && { lootcredited: credited }) };
    return;
  }

  if (!baseSave) throw saveFailureErr();

  const isOwner = baseSave.saveuserid === user.userid;
  const isOutpostOwner = isOwner && baseSave.type === BaseType.OUTPOST;
  const isAttack = !isOwner && baseSave.attackid !== 0;

  // Not the owner and not in an attack
  if (!isOwner && baseSave.attackid === 0) throw permissionErr();

  // Owner saves of a main yard (issue #101) or an outpost (outposts plan WP0b)
  // are retired: yards change through the server's action routes now, and this
  // path would let a request overwrite one wholesale. Refused before anything
  // else runs; attack saves pass. `OWNER_SAVE_MODE=allow` turns it back on.
  requireOwnerSaveAllowed(ctx, user, baseSave, ownerSaveConfig.mode);

  // An attack's result lands once (issue #138). The save that ends it, a copy
  // of that save the web client sends again as the page closes, and the server
  // finishing the attack from its last checkpoint (`finaliseAttack.ts`) all
  // take this lock, and whichever holds it ends the attack session before
  // letting go — so the next one is refused by the binding check below.
  const finalises = isAttack && Boolean(saveData.over);

  if (finalises && !(await acquireFinalLock(baseSave.basesaveid))) throw attackNotBoundErr("finalising");

  try {
    await saveBase(ctx, { user, userSave, body, saveData, baseSave, isOutpostOwner, isAttack });
  } finally {
    if (finalises) await releaseFinalLock(baseSave.basesaveid);
  }
};

interface SaveInput {
  user: User;
  userSave: Save;
  body: Record<string, unknown>;
  saveData: ReturnType<typeof BaseSaveSchema.parse>;
  baseSave: Save;
  isOutpostOwner: boolean;
  isAttack: boolean;
}

/**
 * The save itself, once `baseSave` has decided who is saving what and, for a
 * save that ends an attack, holds the lock that makes it land once.
 */
const saveBase = async (
  ctx: Context,
  { user, userSave, body, saveData, baseSave, isOutpostOwner, isAttack }: SaveInput
): Promise<void> => {
  const now = getCurrentDateTime();

  // The attack must be this caller's (issue #25). A non-zero `attackid` on the
  // row is not on its own permission to write to it: the save has to come from
  // the account the server recorded when the attack started, inside the same
  // 7-minute window `isAttackActive` uses. Checked before `validateSave` and
  // before the economy audit so a refusal touches nothing at all.
  const session = isAttack
    ? await requireAttackBinding(ctx, user, baseSave, saveData.attackid, now)
    : null;

  await validateSave(user, baseSave, body);

  // What the attack's resource bombs cost the attacker (issue #90), worked out
  // from the fling log and the bomb table before any key is applied, so a
  // refusal in `reject` mode leaves every row untouched. Charged further down,
  // before the loot is banked.
  const bombs = isAttack
    ? recordBombSpend(ctx, user, userSave, baseSave, saveData.flinglog, combatConfig.mode)
    : null;

  const outpostOwnerSave = await getOutpostOwnerSave(baseSave, user);

  // Map Room 3 is the attacker's own save's say, never the attack load's
  // `mapversion`, which the client picks (issues #163, #164).
  const mapRoom3 = userSave.mapversion === MapRoomVersion.V3;

  // The loot on both sides (issue #163), worked out from the rows as they
  // stand before any key of this save is applied — the attacker's champions
  // above all. Only the save that ends the attack lands any: every save of an
  // attack repeats the whole log, and that one holds the final lock.
  const loot =
    isAttack && saveData.over
      ? attackLootOf({
          sent: saveData.attackloot,
          reported: saveData.resources,
          flinglog: saveData.flinglog,
          session,
          defender: {
            type: baseSave.type,
            buildingdata: baseSave.buildingdata,
            buildinghealthdata: baseSave.buildinghealthdata,
            resources: (outpostOwnerSave ?? baseSave).resources,
            height: await combatCellHeight(baseSave),
          },
          attacker: userSave,
          mapRoom3,
        })
      : null;

  if (loot) logCappedLoot(ctx, user, baseSave, saveData.attackloot, loot);

  // The economy audit (docs/design/economy-save-validation.md §3.3). It runs
  // before any key is applied, so a refusal in `reject` mode leaves the stored
  // row untouched. Attacks, Map Room 1 tribes and anything that is not a main
  // or outpost yard are not audited (§2.1), and `off` skips it entirely.
  const auditKind = economyAuditKind(isAttack, isOutpostOwner, baseSave.type);

  const verdict =
    economyConfig.mode === "off" || auditKind === "none"
      ? null
      : auditEconomySave({
          kind: auditKind,
          stored: baseSave,
          // An outpost session's delta lands on the player's main pool.
          pool: isOutpostOwner ? userSave : baseSave,
          submitted: {
            ...saveData,
            points: body.points,
            basevalue: body.basevalue,
            researchdata: body.researchdata,
          },
          now,
          config: economyConfig,
        });

  if (verdict) await recordEconomyVerdict(ctx, user, baseSave, verdict, economyConfig.mode);

  const storedHealthData = baseSave.buildinghealthdata;

  // Standard save logic
  for (const key of isAttack ? Save.attackSaveKeys : Save.saveKeys) {
    const value = body[key] as string;

    switch (key) {
      case SaveKeys.RESOURCES:
        if (isOutpostOwner) {
          resourcesHandler(userSave, value, { skipCapacity: true });
        } else {
          resourcesHandler(baseSave, value);
        }
        break;

      case SaveKeys.POINTS:
        baseSave.points = value.toString();
        break;

      case SaveKeys.BASEVALUE:
        baseSave.basevalue = value.toString();
        break;

      case SaveKeys.IRESOURCES:
        resourcesHandler(baseSave, value, { key: SaveKeys.IRESOURCES });
        break;

      case SaveKeys.ACADEMY:
        academyHandler(ctx, baseSave);
        break;

      case SaveKeys.BUILDINGDATA:
        if (saveData.buildingdata == null) break;

        if (isAttack) {
          buildingDataHandler(saveData.buildingdata, baseSave);
        } else {
          baseSave[SaveKeys.BUILDINGDATA] = saveData.buildingdata;
        }
        break;

      case SaveKeys.CHAMPION:
        if (isAttack) {
          if (saveData.attackerchampion) {
            userSave.champion = saveData.attackerchampion;
          }

          if (saveData.champion) {
            championHandler(saveData.champion, baseSave);
          }
        } else {
          if (saveData.champion) {
            baseSave.champion = saveData.champion;
          }
        }
        break;

      case SaveKeys.ATTACKERSIEGE:
        if (isAttack) {
          userSave.siege = saveData.attackersiege;
        }
        break;

      // The outpost income rates and the time they are paid up to are the
      // server's (`services/maproom/v2/autobank.ts`, outposts WP4): a client
      // copy, the owner's or an attacker's, is never written.
      case SaveKeys.BUILDING_RESOURCES:
        break;

      // A whole number, cut down, as Flash sent it: the column is an integer
      // and Postgres would round 99.95 up to 100 (#72).
      case SaveKeys.DAMAGE: {
        const damage = storedDamage(value);
        if (damage !== null) baseSave.damage = damage;
        break;
      }

      default:
        if (value) {
          const save = baseSave as unknown as Record<string, unknown>;
          try {
            save[key] = JSON.parse(value);
          } catch (_) {
            save[key] = value;
          }
        }
    }

    if (isOutpostOwner) updateOutposts(userSave, baseSave, key);
  }

  if (!isAttack && saveData.purchase) purchaseHandler(ctx, saveData.purchase, userSave);

  // In `reject` mode the storage caps and the base value are the server's to
  // work out, so the client's copies are overwritten once the purchase has been
  // applied (§3.3). `log` mode derives nothing: the promise it makes is that
  // not one byte written changes (§6, item 8). Only a main-yard audit derives
  // anything of its own — an outpost verdict carries the main pool's caps.
  if (verdict && economyConfig.mode === "reject" && auditKind === "main") {
    applyDerivedFields(baseSave, verdict.derived);
  }

  let takeoverData: TakeoverData | null = null;
  /** The attacker's one chance at the outpost they just destroyed (issue #182). */
  let takeoverGrant: TakeoverOffer | null = null;
  /** What the attacker's pool took of the loot (issue #166), for the response. */
  let banked: ResourceAmounts | null = null;

  if (isAttack) {
    if (saveData.monsterupdate) {
      await monsterUpdateHandler(saveData.monsterupdate, userSave, {
        session,
        finalises: Boolean(saveData.over),
        flinglog: saveData.flinglog,
        now,
        mapRoom3,
      });
    }

    // Flash's whole-army blob, kept for a Map Room 3 attack alone: Map Room 1
    // and 2 attacks (their sessions carry `entryHoused`) settle through
    // `monsterupdate` and never write one, and nobody else writes one at all
    // (issue #164).
    if (
      monsterUpdateMode({ session, mapRoom3 }) === "mapRoom3" &&
      isRecord(saveData.attackcreatures)
    ) {
      userSave.monsters = saveData.attackcreatures;
    }

    // Bombs first: Flash takes a bomb's cost out of the pool as it is fired
    // (`ResourceBombs.as:301-306`), and the loot after it fills the room that
    // leaves, up to the attacker's cap (issue #166, `bankAttackLoot`).
    if (bombs) {
      userSave.resources = chargeBombSpend(bombs.spend, userSave.resources);
    }

    if (loot) {
      banked = bankAttackLoot(userSave, loot.credit, loot.krallenBuff).credited;
    }

    // The defender's loss lands with the attacker's gain, held between what
    // the battle credited and what it could take (`attackLootOf`). Loot that
    // did not fit in the attacker's storage is still lost, as in Flash.
    const defenderDelta = loot?.defenderDelta;

    if (defenderDelta) {
      const lootTarget = outpostOwnerSave ?? baseSave;

      if (baseSave.type === BaseType.OUTPOST && !outpostOwnerSave) {
        logger.error(`Outpost ${baseSave.baseid} has no owner main save - loot applied to a dead column`);
      }

      defenderLootHandler(defenderDelta, lootTarget);
      postgres.em.persist(lootTarget);
    }

    postgres.em.persist(userSave);
    await postgres.em.flush();

    // MR3 Takeover Logic:
    // If the attack is over and damage >= 90, trigger takeover or destroy logic.
    // MR3 capturable structures (RESOURCE, STRONGHOLD, FORTIFICATION) allow re-capture
    // from OUTPOST type (player-owned) in addition to first capture from TRIBE type.
    if (saveData.over && baseSave.damage >= 90) {
      if (isMR3Structure(baseSave.wmid)) {
        if (baseSave.type === BaseType.TRIBE || baseSave.type === BaseType.OUTPOST) {
          takeoverData = await takeoverCellMR3(baseSave, user, userSave);
        }
      } else if (baseSave.type === BaseType.TRIBE) {
        const cell = await postgres.em.findOne(WorldMapCell, {
          baseid: baseSave.baseid,
          map_version: MapRoomVersion.V3,
        });

        if (cell && !cell.destroyed_at) cell.destroyed_at = new Date();
      }
    }
    // Grant damage protection to the defender when the attack ends, or, for a
    // player outpost left at 90% or more, the attacker's one chance to take it
    // over, with the protection starting when that chance ends (`takeoverGrant.ts`).
    const isProtectable = baseSave.type === BaseType.MAIN || baseSave.type === BaseType.OUTPOST;

    if (saveData.over && isProtectable && !isMR3Structure(baseSave.wmid)) {
      const grant = await protectAfterAttack(baseSave, user.userid);
      if (grant) takeoverGrant = await takeoverOffer(grant, user, userSave, baseSave);
    }
  }

  baseSave.attackid = saveData.over ? 0 : baseSave.attackid;

  // The attack is finished, so its session is spent. Dropping it now frees the
  // row immediately instead of leaving a key that authorises nothing until it
  // times out (issue #25).
  if (isAttack && saveData.over) {
    await endAttackSession(baseSave.basesaveid);
    // Nothing is left for the server to finish from (issue #138).
    await discardCheckpoint(baseSave.basesaveid);
  }

  // Attack saves store health from the attacker's replay but keep buildingdata from the DB,
  // so the owner's countdowns are brought up to the attack before savetime moves to it.
  if (isAttack && baseSave.buildingdata) {
    baseSave.buildingdata = advanceBuildingTimers(baseSave.buildingdata, storedHealthData, now - baseSave.savetime);
  }

  baseSave.id = baseSave.savetime;
  baseSave.savetime = now;

  if (!isAttack) {
    await redis.setex(`last-seen:main:${user.userid}`, 120, getCurrentDateTime().toString());
  }

  postgres.em.persist(baseSave);
  await postgres.em.flush();

  const filteredSave = buildSaveData(baseSave, user, outpostOwnerSave);
  logger.info(`Saving ${user.username}'s base | IP: ${ctx.ip}`);

  const responseBody = {
    error: 0,
    basesaveid: baseSave.basesaveid,
    ...filteredSave,
    ...(takeoverData && { takeover: takeoverData }),
    ...(takeoverGrant && { takeovergrant: takeoverGrant }),
    ...(banked && { lootcredited: banked }),
  };

  ctx.status = Status.OK;
  ctx.body = responseBody;
};

/**
 * Refuses an attack save that did not come from this attack's attacker
 * (issue #25, `services/base/attackSession.ts`).
 *
 * The decision itself is pure and lives in `checkAttackBinding`; this reads the
 * stored session, logs a refusal and turns it into a client error. The log line
 * carries the caller and the recorded attacker, because a `wrong-attacker`
 * refusal is somebody attempting to bank another player's attack and is worth
 * seeing in the audit trail.
 *
 * @param {Context} ctx - The Koa context, for the caller's IP.
 * @param {User} user - The account that sent the save.
 * @param {Save} baseSave - The defender's stored row.
 * @param {string | undefined} submitted - The `attackid` the client sent, if any.
 * @param {number} now - Server seconds.
 * @returns {Promise<AttackSession>} The session the save is bound to.
 * @throws {ClientSafeError} When the save is not this attack's result.
 */
const requireAttackBinding = async (
  ctx: Context,
  user: User,
  baseSave: Save,
  submitted: string | undefined,
  now: number
): Promise<AttackSession> => {
  const session = await readAttackSession(baseSave.basesaveid);

  const result = checkAttackBinding({
    session,
    callerid: user.userid,
    storedAttackId: baseSave.attackid,
    submittedAttackId: submitted ? Number(submitted) : undefined,
    now,
  });

  if (result.ok) return session!;

  logger.warn(
    "Attack save refused for {username} (userid {userid}) on base {baseid}: {reason}",
    {
      event: "attack-binding-refused",
      reason: result.reason,
      userid: user.userid,
      username: user.username,
      baseid: baseSave.baseid,
      basesaveid: baseSave.basesaveid,
      attackerid: session?.attackerid ?? null,
      attackid: baseSave.attackid,
      submittedAttackId: submitted ?? null,
      ip: ctx.ip,
    }
  );

  throw attackNotBoundErr(result.reason);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Logs an attack save whose loot the server did not credit in full (issue
 * #163). An honest client reports what the server's replay derives, so a line
 * here is either a modified client or the two runtimes disagreeing, and either
 * is worth seeing.
 */
const logCappedLoot = (
  ctx: Context,
  user: User,
  baseSave: Save,
  sent: unknown,
  loot: AttackLoot
): void => {
  const asked = wholeAmounts(sent);
  const capped = RESOURCE_KEYS.some((key) => loot.credit[key] < asked[key]);
  if (!capped && loot.basis !== "no-log" && loot.basis !== "no-roster") return;

  logger.warn("Attack loot capped for {username} (userid {userid}) on base {baseid}", {
    event: "attack-loot-capped",
    basis: loot.basis,
    userid: user.userid,
    username: user.username,
    baseid: baseSave.baseid,
    basesaveid: baseSave.basesaveid,
    sent,
    cap: loot.cap,
    credited: loot.credit,
    ip: ctx.ip,
  });
};

/**
 * Which economy rules this save is subject to
 * (`docs/design/economy-save-validation.md` §2.1).
 *
 * `main` is an owner save of a main yard, the only yard the cost table
 * describes, and gets every rule. `outpost` is an owner save from an outpost
 * session: its delta lands on the player's main pool, so the resource rules
 * still apply, but outpost buildings have their own props table the server
 * cannot price. Everything else — attacks, Map Room 1 tribes, anything that is
 * neither a main yard nor an outpost — is `none`.
 */
const economyAuditKind = (
  isAttack: boolean,
  isOutpostOwner: boolean,
  type: Save["type"]
): EconomyAuditKind => {
  if (isAttack) return "none";
  if (isOutpostOwner) return "outpost";
  return type === BaseType.MAIN ? "main" : "none";
};

const updateOutposts = (
  userSave: Save,
  baseSave: Save,
  key: keyof Save
) => {
  if (key === SaveKeys.QUESTS) {
    userSave.quests = baseSave.quests;
  }
};
