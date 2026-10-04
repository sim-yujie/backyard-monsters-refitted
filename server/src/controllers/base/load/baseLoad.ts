import { devConfig } from "../../../config/GameConfig.js";
import { Save } from "../../../database/models/save.model.js";
import { postgres, redis } from "../../../server.js";
import type { KoaController } from "../../../utils/KoaController.js";
import { storeItems } from "../../../game-data/store/storeItems.js";
import { User } from "../../../database/models/user.model.js";
import { getFlags } from "../../../game-data/flags.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { ATTACK_MODES, BaseMode, BaseType } from "../../../enums/Base.js";
import { EnumYardType } from "../../../enums/EnumYardType.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { WORLD_SIZE } from "../../../config/MapRoom2Config.js";
import { RESOURCE_PRODUCTION_RATES, RESOURCE_CAPACITIES, DEFENDER_DAMAGE_REDUCTION, STRONGHOLD_BONUSES, STRUCTURE_RANGE } from "../../../config/MapRoom3Config.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { getDefenderCoords, isDefensiveStructure } from "../../../services/maproom/v3/getDefenderCoords.js";
import { getHexDistance } from "../../../services/maproom/v3/getHexNeighborOffsets.js";
import { Status } from "../../../enums/StatusCodes.js";
import {
  takeOutpostNotices,
  type OutpostNoticeJob,
} from "../../../services/maproom/v2/outpostNotices.js";
import { notifyAndCount } from "../../../services/notifications/notifications.js";
import { baseModeView } from "./modes/baseModeView.js";
import { baseModeBuild } from "./modes/baseModeBuild.js";
import { baseModeAttack } from "./modes/baseModeAttack.js";
import { infernoModeDescent } from "./modes/infernoModeDescent.js";
import { infernoModeView } from "./modes/infernoModeView.js";
import { infernoModeAttack } from "./modes/infernoModeAttack.js";
import { infernoModeBuild } from "./modes/infernoModeBuild.js";
import { validateAttack } from "../../../services/maproom/validateAttack.js";
import { playerMapVersion } from "../../../services/maproom/playerMapVersion.js";
import { BaseLoadSchema } from "../../../schemas/BaseLoadSchema.js";
import { baseNotFoundErr, discordAgeErr } from "../../../errors/errors.js";
import { EnumBaseRelationship } from "../../../enums/EnumBaseRelationship.js";
import { canAttack } from "../../../services/base/canAttack.js";
import { createMR1Tribes } from "../../../services/maproom/v1/createMR1Tribes.js";
import { MR1_TRIBES } from "../../../enums/Tribes.js";
import { MR1_TRIBE_IDS } from "../../../game-data/tribes/v1/index.js";
import { calculateBaseLevel, playerLevelOf } from "../../../services/base/calculateBaseLevel.js";
import { RESOURCE_KEYS } from "../../../services/base/updateResources.js";
import { mapSaveData } from "../../../services/base/mapSaveData.js";
import { onboardingSummary } from "../../../services/onboarding/summary.js";
import { clearExpiredStoreItems } from "../../../services/base/clearExpiredStoreItems.js";
import { syncDerivedLevels } from "../../../services/yard/derivedLevels.js";
import { catchUpOwnerOutpost, catchUpOwnerYard } from "../../yard/yardRoute.js";
import type { CompletedJob } from "../../../services/yard/catchUp.js";
import { extractTownHall } from "../../../utils/extractTownHall.js";
import { getChatChannel, getOrCreateChatToken } from "../../../chat/chatChannels.js";
import { getAllianceData } from "../../../services/alliance/allianceData.js";
import { runningPowerups } from "../../../services/alliance/powerups.js";
import { cellRelationship, findRelationships } from "../../../services/alliance/relationships.js";
import { INFERNO_CHAT_CHANNEL } from "../../../config/ChatConfig.js";
import { finaliseBeforeLoad } from "../../../services/base/finaliseAttack.js";
import { combatCellHeight } from "../../../services/base/combat/cellHeight.js";
import type { DefenderForces } from "../../../game-rules/combat/index.js";
import type { ChampionBrains } from "../../../services/base/attackSession.js";
import { touchLastSeen } from "../../../services/user/lastSeen.js";
import { logger } from "../../../utils/logger.js";

type Stronghold = { level: number; cell?: { x: number; y: number } | null };

const STRONGHOLD_FIELDS = ["level", "cell.x", "cell.y"] as const;

const INFERNO_SAVE_MODES = new Set<string>([BaseMode.IBUILD, BaseMode.IATTACK, BaseMode.IWMATTACK]);

/**
 * Controller responsible for loading base modes based on the user's request.
 *
 * @param {Context} ctx - The Koa context object.
 * @returns {Promise<void>} A promise that resolves when the base load process is complete.
 * @throws Will throw an error if the base load process fails.
 */
export const baseLoad: KoaController = async (ctx) => {
  const user: User = ctx.authUser;
  const { baseid, type, mapversion: requestedVersion, attackData, attackcost } = BaseLoadSchema.parse(ctx.request.body);

  // An attack the player left without saving is finished before anything
  // below reads a row it writes — the player's own save above all — so their
  // yard shows its monsters spent and its bombs paid for, and a new attack
  // cannot fling them again (issue #138, `finaliseAttack.ts`).
  const attacking = type === BaseMode.ATTACK || type === BaseMode.WMATTACK;
  if (type === BaseMode.BUILD || ATTACK_MODES.has(type)) {
    await finaliseBeforeLoad(user.userid, type, baseid, attacking);
  }

  await postgres.em.populate(user, INFERNO_SAVE_MODES.has(type) ? ["save", "infernosave"] : ["save"]);

  // The player's Map Room is the one their own save records, not the
  // request's: every rule below follows it, the attack's range check above
  // all, which a forged 3 or 1 used to skip (issue #165, `playerMapVersion.ts`).
  const mapversion = playerMapVersion(user.save);

  let baseSave: Save | null = null;
  /** The defence an attack is fought against (issue #195), served beside the yard. */
  let defenderForces: DefenderForces | undefined;
  /** The attacker's champions' brains, as the attack froze them (issue #219), served to the client. */
  let championBrains: ChampionBrains | undefined;

  // The attacker's level for the engine's low-level loot bonus, served to the
  // client and kept in the attack session for the loot replay, so both run
  // the battle at the same level (issue #167).
  const attackerLevel = attacking ? playerLevelOf(user.save!) : undefined;

  switch (type) {
    case BaseMode.BUILD:
      baseSave = await baseModeBuild(user, baseid);
      redis.setex(`last-seen:main:${user.userid}`, 120, getCurrentDateTime().toString());
      // Seen in the last 30 days is what earns a Map Room 1 neighbour place (issue #235).
      await touchLastSeen(postgres.em, user).catch((err) =>
        logger.warn(`last_seen_at not written for user ${user.userid}: ${err}`)
      );
      break;

    case BaseMode.VIEW:
    case BaseMode.IVIEW:
      baseSave = await baseModeView(baseid, mapversion, user.save!.worldid, user);
      break;

    case BaseMode.ATTACK:
      if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();

      await validateAttack(user, attackData, mapversion);
      ({ save: baseSave, defenderForces, championBrains } = await baseModeAttack({
        user,
        baseid,
        mapversion,
        attackCost: attackcost,
        attackerLevel,
      }));
      break;

    case BaseMode.IDESCENT:
      baseSave = await infernoModeDescent(user);
      break;

    case BaseMode.IBUILD:
      baseSave = await infernoModeBuild(user);
      break;

    case BaseMode.IWMVIEW:
      baseSave = await infernoModeView(user, baseid);
      break;

    case BaseMode.IATTACK:
      if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();

      await validateAttack(user, attackData, mapversion);
      baseSave = await infernoModeAttack(user, baseid);
      break;

    case BaseMode.IWMATTACK:
      if (!ctx.meetsDiscordAgeCheck) throw discordAgeErr();
      
      await validateAttack(user, attackData, mapversion);
      baseSave = await infernoModeAttack(user, baseid);
      break;

    case BaseMode.WMVIEW:
      baseSave = await baseModeView(baseid, mapversion, user.save!.worldid, user);
      break;

    case BaseMode.WMATTACK:
      if (!ctx.meetsDiscordAgeCheck && !MR1_TRIBE_IDS.has(baseid)) throw discordAgeErr();
      
      await validateAttack(user, attackData, mapversion);
      ({ save: baseSave, defenderForces, championBrains } = await baseModeAttack({
        user,
        baseid,
        mapversion,
        attackCost: attackcost,
        attackerLevel,
      }));
      break;

    default:
      throw new Error(`Base type not handled, type: ${type}.`);
  }

  if (!baseSave) throw baseNotFoundErr();

  const userSave = user.save!;
  const isOwner = user.userid === baseSave.userid;
  const isInferno = baseSave.type === BaseType.INFERNO;
  const isAttack = ATTACK_MODES.has(type);

  // The target cell's height, which stretches an outpost's tower range in the
  // engine; the attack save's loot replay reads the same stored value, so both
  // fight the same battle (issue #179, `cellHeight.ts`). The owner's own
  // outpost build load reads it too (issue #262): without it the planner has
  // no way to draw the same range the engine will actually fire at.
  const ownOutpostBuild = isOwner && type === BaseMode.BUILD && baseSave.type === BaseType.OUTPOST;
  const cellHeight =
    attacking || ownOutpostBuild ? await combatCellHeight(baseSave) : undefined;

  // The owner opening their own main yard: finish whatever ended while they
  // were away and write it, before anything below reads the yard
  // (docs/design/yard-buildings.md §2.3). What finished goes back as
  // `completed`, for the client's "While you were away" notice (issue #135).
  // An own Map Room 2 outpost gets the same, on its own rows: timers, repairs,
  // hatcheries and damage, and the core when it is empty (outposts WP3).
  // Both also pay the player's Map Room 2 outpost income into the main pool
  // under the main row's lock (`autobankYard`, outposts WP4).
  // That notice is no longer a toast but one entry in the player's
  // notification list, written here; the answer carries the list's unread
  // count as `notifications`, for the yard's bell (issue #257).
  let completed: (CompletedJob | OutpostNoticeJob)[] | undefined;
  let notifications: number | undefined;
  if (type === BaseMode.BUILD && isOwner && baseSave.type === BaseType.MAIN) {
    let jobs: CompletedJob[];
    ({ save: baseSave, completed: jobs } = await catchUpOwnerYard(baseSave));
    // Outpost attacks and takeovers since the player last looked, told once
    // in the same notice and kept in the mailbox (outposts WP8, #187).
    completed = [...jobs, ...(await takeOutpostNotices(postgres.em, user.userid))];
    notifications = await notifyAndCount(postgres.em, user.userid, null, "away", completed);
  } else if (
    type === BaseMode.BUILD &&
    isOwner &&
    baseSave.type === BaseType.OUTPOST &&
    baseSave.mapversion !== MapRoomVersion.V3
  ) {
    ({ save: baseSave, completed } = await catchUpOwnerOutpost(user, baseSave));
    const outpost = baseSave.type === BaseType.OUTPOST ? String(baseSave.baseid) : null;
    notifications = await notifyAndCount(postgres.em, user.userid, outpost, "away", completed);
  }

  // Only a client on Map Room 1 asks for its tribes (the web never does).
  if (type === BaseMode.BUILD && requestedVersion === MapRoomVersion.V1 && mapversion === MapRoomVersion.V1) {
    userSave.level = calculateBaseLevel(userSave.points, userSave.basevalue);
    
    const mr1Tribes = await createMR1Tribes(userSave, MR1_TRIBES);
    const wmstatus = new Map(userSave.wmstatus.map((status) => [status[0], status]));

    mr1Tribes.forEach((tribe) => wmstatus.set(tribe[0], tribe));
    userSave.wmstatus = [...wmstatus.values()];
    
    postgres.em.persist(userSave);
    await postgres.em.flush();
  }

  // Both run for an owner, so the Flinger/Catapult cache heals on the next load (issue #94).
  const levelsChanged = isOwner && syncDerivedLevels(baseSave);

  if (isOwner && (clearExpiredStoreItems(baseSave) || levelsChanged)) {
    postgres.em.persist(baseSave);
    await postgres.em.flush();
  }

  const filteredSave = await mapSaveData(baseSave, user);
  const isTutorialEnabled = devConfig.skipTutorial ? 205 : filteredSave.tutorialstage;

  const flags = getFlags();
  flags.discordOldEnough = Number(ctx.meetsDiscordAgeCheck);

  const townHall = extractTownHall(userSave.buildingdata || {});

  flags.maproom2 = userSave.mr2upgraded || (townHall && townHall.l >= 6) ? 1 : 0;
  flags.mr2upgraded = userSave.mr2upgraded ? 1 : 0;

  let totalResourceRate = 0;
  let totalResourceCapacity = 0;
  let totalStrongholdBonus = 0;
  let totalDefenderStrongholdBonus = 0;
  let defenderReduction = 0;

  if (mapversion === MapRoomVersion.V3) {
    // Sum production rate and storage capacity from all player-owned MR3 resource outposts.
    if (isOwner && !isInferno) {
      const resourceOutposts = await postgres.em.find(
        Save,
        {
          saveuserid: user.userid,
          type: BaseType.OUTPOST,
          wmid: EnumYardType.RESOURCE,
        },
        { fields: ["level"] },
      );

      for (const { level } of resourceOutposts) {
        totalResourceRate += RESOURCE_PRODUCTION_RATES[level];
        totalResourceCapacity += RESOURCE_CAPACITIES[level];
      }

      // Auto-bank calculates and applies resources accumulated since the player's last session.
      if (type === BaseMode.BUILD && totalResourceRate > 0) {
        const now = getCurrentDateTime();
        const lastAccumulated = userSave.buildingresources?.t;

        if (lastAccumulated) {
          const elapsed = now - lastAccumulated;
          const accumulated = Math.floor(totalResourceRate * elapsed);

          if (accumulated > 0 && userSave.resources) {
            for (const resource of RESOURCE_KEYS)
              userSave.resources[resource] += accumulated;
          }
        }

        userSave.buildingresources!.t = now;
        postgres.em.persist(userSave);
        await postgres.em.flush();
      }
    }

    // Strongholds boost monster damage (attacker) and tower damage (defender),
    // but only if the target cell falls within their attack range.
    if (type === BaseMode.ATTACK && baseSave.cell) {
      const targetCell: WorldMapCell = baseSave.cell;

      const [attackerStrongholds, defenderStrongholds] = await Promise.all([
        postgres.em.find(
          Save,
          {
            saveuserid: user.userid,
            type: BaseType.OUTPOST,
            wmid: EnumYardType.STRONGHOLD,
          },
          { populate: ["cell"], fields: STRONGHOLD_FIELDS },
        ),

        postgres.em.find(
          Save,
          {
            saveuserid: baseSave.saveuserid,
            type: BaseType.OUTPOST,
            wmid: EnumYardType.STRONGHOLD,
          },
          { populate: ["cell"], fields: STRONGHOLD_FIELDS },
        ),
      ]);

      const strongholdBonus = (strongholds: Stronghold[]) => {
        let bonus = 0;

        for (const { level, cell } of strongholds) {
          const distance = cell && getHexDistance(cell.x, cell.y, targetCell.x, targetCell.y);
            
          if (distance && distance <= STRUCTURE_RANGE[EnumYardType.STRONGHOLD][level])
            bonus += STRONGHOLD_BONUSES[level];
        }
        return bonus;
      };

      totalStrongholdBonus = strongholdBonus(attackerStrongholds);
      totalDefenderStrongholdBonus = strongholdBonus(defenderStrongholds);
    }
  }

  // Set damage reduction buff for attacking bases with defenders
  if (mapversion === MapRoomVersion.V3 && !isOwner && type === BaseMode.ATTACK) {
    const attackedCell = baseSave.cell;

    if (attackedCell?.uid && isDefensiveStructure(attackedCell.base_type)) {
      const defenderCoords = getDefenderCoords(attackedCell.x, attackedCell.y, attackedCell.base_type);

      const defenderCells = await postgres.em.find(WorldMapCell, {
        $and: [
          { $or: defenderCoords.map(([x, y]) => ({ x, y })) },
          { base_type: EnumYardType.FORTIFICATION },
          { uid: attackedCell.uid },
          { map_version: MapRoomVersion.V3 },
          { world: user.save!.worldid },
        ],
      });

      defenderReduction = DEFENDER_DAMAGE_REDUCTION[defenderCells.length];
    }
  }

  const attackAllowed = canAttack(userSave, baseSave, mapversion);

  let baseOwner;

  if (isOwner) {
    baseOwner = user;
  } else {
    baseOwner = await postgres.em.findOne(
      User,
      { userid: baseSave.userid },
      { fields: ["pic_square", "alliance_id"] }
    );
  }

  const avatar = baseOwner?.pic_square;
  let chattoken: string | undefined;
  let chatchannel: string | undefined;

  if (isOwner) {
    chattoken = await getOrCreateChatToken(user.userid);
    chatchannel = isInferno ? INFERNO_CHAT_CHANNEL : getChatChannel(userSave.mapversion);
  }

  const isOwnMainYard = isOwner && !isInferno;
  const isOverworldAttack = isAttack && !isInferno;

  const ownerAllianceId = isInferno ? 0 : (baseOwner?.alliance_id ?? 0);
  const flaggedAlliances = ownerAllianceId ? [ownerAllianceId] : [];
  
  const stances = await findRelationships(user.alliance_id, flaggedAlliances);

  const alliance = isOwnMainYard ? await getAllianceData(user) : null;
  const powerups = isOwnMainYard ? await runningPowerups(user.alliance_id) : [];

  const attpowerups = isOverworldAttack ? await runningPowerups(user.alliance_id) : [];

  const relationship = isOwnMainYard
    ? EnumBaseRelationship.SELF
    : cellRelationship(user.alliance_id, ownerAllianceId, stances);

  const response: Record<string, unknown> = {
    ...filteredSave,
    relationship,
    canattack: attackAllowed,
    flags,
    worldsize: WORLD_SIZE,
    error: 0,
    id: filteredSave.basesaveid,
    storeitems: storeItems,
    tutorialstage: isTutorialEnabled,
    currenttime: getCurrentDateTime(),
    pic_square: avatar,
    chatservers: [process.env.CHAT_WS_HOST!],
    ...(isAttack && { attpowerups }),
    ...(attackerLevel !== undefined && { attackerlevel: attackerLevel }),
    // The player's own level for the yard HUD (#192): their main save's, on
    // an outpost too, as the map shows it (`userCell.ts`).
    ...(isOwner && !isInferno && { playerlevel: playerLevelOf(user.save!) }),
    // The account's new-player tutorial summary on the owner's build-mode
    // load, main yard or outpost (issue #227, `services/onboarding/summary.ts`).
    // The column itself is server-only and never sent.
    ...(isOwner && !isInferno && type === BaseMode.BUILD && { onboarding: onboardingSummary(user.save!) }),
    ...(cellHeight !== undefined && { cellheight: cellHeight }),
    ...(defenderForces && { defenderforces: defenderForces }),
    ...(championBrains && { attackerbrains: championBrains }),
    ...(completed && { completed }),
    ...(notifications !== undefined && { notifications }),
    ...(isOwner && {
      chatenabled: 1,
      chattoken,
      chatchannel,
      ...(alliance && { alliancedata: alliance }),
      powerups,
    }),
  };

  if (isOwner && !isInferno && mapversion === MapRoomVersion.V3) {
    response.player = { buffs: { 2: totalResourceRate, 10: totalResourceCapacity } };
  }

  if (defenderReduction > 0) {
    response.player = { buffs: { 1: defenderReduction } };
  }

  if (type === BaseMode.ATTACK && mapversion === MapRoomVersion.V3) {
    if (totalStrongholdBonus > 0) response.attackingplayer = { buffs: { 5: totalStrongholdBonus } };
    if (totalDefenderStrongholdBonus > 0) response.defendingplayer = { buffs: { 6: totalDefenderStrongholdBonus } };
  }

  // Only send descent tribe IDs (201-213) to the client
  if (type === BaseMode.IDESCENT) {
    const wmstatus = (filteredSave.wmstatus ?? []).filter(baseid => baseid[0] >= 201 && baseid[0] <= 213);

    response.resources = filteredSave.iresources;
    response.wmstatus = wmstatus;
  }

  ctx.status = Status.OK;
  ctx.body = response;
};
