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
import { permissionErr, saveFailureErr } from "../../../errors/errors.js";
import { attackLootHandler } from "./handlers/attackLootHandler.js";
import { defenderLootHandler } from "./handlers/defenderLootHandler.js";
import { monsterUpdateHandler } from "./handlers/monsterUpdateHandler.js";
import { validateSave } from "../../../scripts/anticheat/anticheat.js";
import { getOutpostOwnerSave } from "../../../services/base/getOutpostOwnerSave.js";
import { advanceBuildingTimers } from "../../../services/base/advanceBuildingTimers.js";
import { championHandler } from "./handlers/championHandler.js";
import { buildingDataHandler } from "./handlers/buildingDataHandler.js";
import { takeoverCellMR3, type TakeoverData } from "../../../services/maproom/v3/takeoverCellMR3.js";
import { damageProtection } from "../../../services/maproom/v2/damageProtection.js";
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
  const baseSave = await postgres.em.findOne(Save, { basesaveid });

  if (!baseSave && MR1_TRIBE_IDS.has(saveData.baseid)) {
    const tribeSave = await scaledMR1Tribes(user, saveData);
    const filteredSave = await mapSaveData(tribeSave, user);

    ctx.status = Status.OK;
    ctx.body = { error: 0, ...filteredSave };
    return;
  }

  if (!baseSave) throw saveFailureErr();

  const isOwner = baseSave.saveuserid === user.userid;
  const isOutpostOwner = isOwner && baseSave.type === BaseType.OUTPOST;
  const isAttack = !isOwner && baseSave.attackid !== 0;

  // Not the owner and not in an attack
  if (!isOwner && baseSave.attackid === 0) throw permissionErr();

  await validateSave(user, baseSave, body);

  const now = getCurrentDateTime();

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

  const outpostOwnerSave = await getOutpostOwnerSave(baseSave, user);

  let takeoverData: TakeoverData | null = null;

  if (isAttack) {
    if (saveData.monsterupdate) {
      await monsterUpdateHandler(saveData.monsterupdate, userSave);
    }

    if (saveData.attackcreatures) {
      userSave.monsters = saveData.attackcreatures;
    }

    if (saveData.attackloot) {
      attackLootHandler(saveData.attackloot, userSave);
    }

    if (saveData.resources) {
      const lootTarget = outpostOwnerSave ?? baseSave;

      if (baseSave.type === BaseType.OUTPOST && !outpostOwnerSave) {
        logger.error(`Outpost ${baseSave.baseid} has no owner main save - loot applied to a dead column`);
      }

      defenderLootHandler(saveData.resources, lootTarget);
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
    // Grant damage protection to the defender main yard when the attack ends.
    const isProtectable = baseSave.type === BaseType.MAIN || baseSave.type === BaseType.OUTPOST;

    if (saveData.over && isProtectable && !isMR3Structure(baseSave.wmid)) {
      await damageProtection(baseSave);
    }
  }

  baseSave.attackid = saveData.over ? 0 : baseSave.attackid;

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
  };

  ctx.status = Status.OK;
  ctx.body = responseBody;
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
  if (key === SaveKeys.BUILDING_RESOURCES && userSave.buildingresources) {
    userSave.buildingresources[`b${baseSave.baseid}`] = baseSave.buildingresources?.[`b${baseSave.baseid}`];
    userSave.buildingresources["t"] = getCurrentDateTime();
  }

  if (key === SaveKeys.QUESTS) {
    userSave.quests = baseSave.quests;
  }
};
