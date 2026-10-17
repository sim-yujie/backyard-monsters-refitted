import type { EntityManager } from "@mikro-orm/postgresql";

import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { academyRanks, type DefenderForces, type ResourceAmounts } from "../../game-rules/combat/index.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { logger } from "../../utils/logger.js";
import type { AttackSession } from "../base/attackSession.js";
import { academyLevels, type AbandonedInput } from "../base/combat/abandonedAttack.js";
import { defenceReplayLoadOf, isDefenceReplayTarget, readDefenceReplayLoad } from "./defenceReplayLoad.js";
import {
  DEFENCE_REPLAY_PAYLOAD_VERSION,
  type DefenceReplayPayload,
  storeDefenceReplay,
} from "./defenceReplayStore.js";

/**
 * Recording a defence replay when an attack on a Map Room 2 main yard lands
 * (`docs/design/defence-replays.md` §5, issue #359), from both landings: the
 * attacker's final save (`baseSave.ts`) and the server finishing it from its
 * checkpoint (`finaliseAttack.ts`: tab closed, timeout, server restart).
 *
 * The replay is the battle the SERVER fought: its yard, its log, its tick and
 * its attacker, as {@link AbandonedInput} holds them, laid over the attack load
 * the attacker was served (`defenceReplayLoad.ts`). Nothing here asks whether
 * either side is a bot (§9), and nothing here can fail a landing.
 */

/** One landed attack, as a landing hands it over. */
export interface LandedDefence {
  /** The defender's row, as the attack landed it. */
  readonly yard: Pick<Save, "basesaveid" | "baseid" | "saveuserid" | "type" | "mapversion">;
  readonly attacker: Pick<User, "userid" | "username" | "pic_square">;
  /** The attack's session: when it started, and the roster that makes it a server-fought battle. */
  readonly session: Pick<AttackSession, "attackid" | "startedat" | "entryHoused"> | null | undefined;
  /** What the server fought (`battleReplayInput`). */
  readonly input: AbandonedInput;
  /** The attack report as stored on the defender's row. */
  readonly report: unknown;
  /** The yard's whole damage % before the battle was written, and after. */
  readonly damageBefore: number;
  readonly damageAfter: number;
  /** The defender's loss (never positive). */
  readonly defenderDelta: Partial<ResourceAmounts> | null | undefined;
  readonly housedLost: number;
  /** When it landed, in server seconds. */
  readonly now: number;
}

/** The champion fields a replay keeps: never the learned brain (`b`, `bs`), which the load serves frozen. */
const CHAMPION_FIELDS = ["t", "l", "hp", "pl", "fb", "status", "s", "nm"] as const;

/** The attacker's champions as fought, cut down to {@link CHAMPION_FIELDS}. */
const championsOf = (champions: readonly ChampionData[] | null | undefined): JsonObject[] =>
  (champions ?? []).map((champion) => {
    const kept: JsonObject = {};
    for (const field of CHAMPION_FIELDS) {
      if (champion[field] !== undefined) kept[field] = champion[field];
    }
    return kept;
  });

/** The defender's loss as whole amounts lost, each 0 or more. */
const lostOf = (defenderDelta: Partial<ResourceAmounts> | null | undefined): JsonObject => {
  const lost: JsonObject = {};
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const delta = Number(defenderDelta?.[key] ?? 0);
    lost[key] = Number.isFinite(delta) && delta < 0 ? Math.floor(-delta) : 0;
  }
  return lost;
};

/**
 * Whether a landed attack is recorded: another account's Map Room 2 main yard
 * (`isDefenceReplayTarget`), fought by the server (its session carries the
 * roster). Map Room 1, outposts, camps, Inferno and own-yard raids are not.
 */
export const recordsDefenceReplay = (
  yard: LandedDefence["yard"],
  attackerid: number,
  session: LandedDefence["session"],
): boolean => Boolean(session?.entryHoused) && isDefenceReplayTarget(yard, attackerid);

/**
 * The payload to play the battle again (§3): the served load, allow-listed
 * once more, with every input the battle read replaced by the one the server
 * fought with, so the yard is the battle's even if the row moved between load
 * and landing; then the seed, the fought log and tick, and the attacker as
 * fought.
 *
 * @param load - The attack load as kept at load time.
 * @param input - What the server fought.
 * @param report - The attack report.
 */
export const defenceReplayPayload = (load: JsonObject, input: AbandonedInput, report: unknown): DefenceReplayPayload => ({
  v: DEFENCE_REPLAY_PAYLOAD_VERSION,
  load: {
    ...defenceReplayLoadOf(load),
    buildingdata: input.defender.buildingdata ?? {},
    buildinghealthdata: input.defender.buildinghealthdata ?? null,
    resources: input.defender.resources ?? null,
    ...(input.defender.height !== undefined && { cellheight: input.defender.height }),
    ...(input.defence && { defenderforces: input.defence }),
    ...(input.playerLevel !== undefined && { attackerlevel: input.playerLevel }),
  },
  seed: input.log.seed,
  events: input.log.events,
  tick: input.tick,
  levels: academyLevels(input.attacker.academy),
  ranks: academyRanks(input.attacker.academy),
  champion: championsOf(input.attacker.champion),
  siege: input.attacker.siege ?? null,
  declareWar: input.declareWar,
  report,
});

/**
 * The battle a stored payload holds, as the server fights it
 * (`replayAbandonedAttack`): the inverse of {@link defenceReplayPayload}, for
 * checking a replay plays out as it landed.
 *
 * @param payload - A stored payload.
 */
export const defenceReplayInput = (payload: DefenceReplayPayload): AbandonedInput => {
  const load = payload.load;
  const ranks = (payload.ranks ?? {}) as Record<string, number>;
  const academy: JsonObject = {};
  for (const [id, level] of Object.entries(payload.levels)) academy[id] = { level };
  for (const [id, rank] of Object.entries(ranks)) academy[id] = { ...academy[id], powerup: rank };
  return {
    defender: {
      type: BaseType.MAIN,
      buildingdata: load.buildingdata ?? {},
      buildinghealthdata: load.buildinghealthdata ?? null,
      resources: load.resources ?? null,
      ...(typeof load.cellheight === "number" && { height: load.cellheight }),
    },
    attacker: {
      academy,
      champion: (payload.champion ?? null) as ChampionData[] | null,
      siege: payload.siege ?? null,
    },
    log: { v: 1, seed: payload.seed, events: payload.events },
    tick: payload.tick,
    declareWar: payload.declareWar,
    ...(typeof load.attackerlevel === "number" && { playerLevel: load.attackerlevel }),
    ...(load.defenderforces && { defence: load.defenderforces as DefenderForces }),
  };
};

/**
 * Records a landed attack's defence replay, when it is one (§5), and says the
 * new row's id for the defender's notice. Written in an ORM context of its
 * own, so it flushes nothing of the landing's. When the kept load is missing
 * (Redis lost it) the row is still written, with no replay (§9).
 *
 * It never fails the landing: any error is logged (`defence-replay-failed`)
 * and gives null, as does an attack that is not recorded.
 *
 * @param em - The landing's entity manager; the row is written in a fork of it.
 * @param landed - The landed attack.
 * @returns The replay's id, or null when none was written.
 */
export const recordDefenceReplay = async (em: EntityManager, landed: LandedDefence): Promise<number | null> => {
  const { yard, attacker, session } = landed;
  if (!session || !recordsDefenceReplay(yard, attacker.userid, session)) return null;

  try {
    const load = await readDefenceReplayLoad(yard.basesaveid, session.attackid);
    if (!load) {
      logger.warn("Defence replay on base {baseid} has no kept load; recorded without its replay", {
        event: "defence-replay-no-load",
        baseid: yard.baseid,
        basesaveid: yard.basesaveid,
        attackid: session.attackid,
      });
    }
    return await storeDefenceReplay(em.fork(), {
      defenderUserid: yard.saveuserid,
      baseid: String(yard.baseid),
      mapVersion: MapRoomVersion.V2,
      attacker: { userid: attacker.userid, username: attacker.username, picSquare: attacker.pic_square ?? null },
      attackedAt: new Date(session.startedat * 1000),
      landedAt: new Date(landed.now * 1000),
      damageBefore: landed.damageBefore,
      damageAfter: landed.damageAfter,
      loot: lostOf(landed.defenderDelta),
      housedLost: landed.housedLost,
      left: landed.input.left === true,
      payload: load ? defenceReplayPayload(load, landed.input, landed.report) : null,
    });
  } catch (error) {
    logger.error("Could not record the defence replay of base {baseid}", {
      event: "defence-replay-failed",
      baseid: yard.baseid,
      basesaveid: yard.basesaveid,
      attackerid: attacker.userid,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};
