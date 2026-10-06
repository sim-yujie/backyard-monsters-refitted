import type { EntityManager } from "@mikro-orm/core";
import type { User } from "../../database/models/user.model.js";
import { raidRefusedErr } from "../../errors/errors.js";
import { TROJAN_HORSE_TYPE } from "../../game-data/buildingFootprints.js";
import { defenderForcesOf, type RaidEvent, type Roster } from "../../game-rules/combat/index.js";
import { logger } from "../../utils/logger.js";
import { catchUpLockedRow } from "../../controllers/yard/yardAction.js";
import { calculateEmpirePoints } from "../base/calculateEmpirePoints.js";
import { isAttackActive } from "../base/isAttackActive.js";
import { ReplayTimeoutError, fightRaidInWorker, reserveReplaySlot } from "../base/combat/replayRunner.js";
import { ATTACK_ONLINE_SECONDS, isOnline, readPresenceMarks } from "../user/online.js";
import { fightSecondsOf, type RaidFightInput, type RaidFightOutcome } from "./raidFight.js";
import {
  START_LOCK_SECONDS,
  lockForFight,
  lockMain,
  newSeed,
  notifyJobs,
  raidView,
  unlockYard,
  type RaidStart,
} from "./raidFlow.js";
import { raidFighting } from "./raidLock.js";
import { readSchedule, scheduleColumn, withFightLock, TROJAN_TRIBE } from "./raidSchedule.js";
import { newRaidId, openFightingRaid, readOpenRaid, type OpenRaid } from "./raidStore.js";
import { TROJAN_LAST_SPAWN_TICK, trojanArmy } from "./trojanArmy.js";

/**
 * Springing the Trojan Horse (#306 WP3, `docs/design/trojan-horse.md` §5-§7,
 * issue #326): the server builds the 51-monster army itself and opens the
 * fight at once, with no warning phase. Reuses the wild monster raid's
 * machinery end to end (`raidFlow.ts`): the same two-transaction start (the
 * yard frozen and provisionally locked, the fight run once in a worker
 * outside any transaction, the lock made the fight's own), the same fight
 * lock (`raidLock.ts`) and the same finish (`raidFlow.ts`'s `finishRaid`,
 * which lands it through `landRaid` — no Shiny, the horse removed, the
 * schedule's own rule, all keyed off `tribe === "wild"`, {@link TROJAN_TRIBE}).
 * Cancel on quit is the raid's own (`raidStore.ts`): nothing kept, the horse
 * and flag unchanged.
 *
 * Refused (`raidRefusedErr`) unless: the caller's own main yard
 * (`notMainYard`); the horse is in `buildingdata`, placed and not yet done
 * (`noHorse`); no raid already open or fighting (`raidOpen`); the yard not
 * locked by another fight nor under attack by a player (`raidOpen` /
 * `underAttack`); the player online on their yard (`offline`, the raid
 * presence check, `online.ts`). Two springs at once open one fight: the
 * second blocks on the same yard row and finds the first's provisional lock
 * already there.
 */

/** The yard as the fight found it, and its defence; what the start hands the client. */
type FrozenYard = RaidStart["fight"]["yard"];

interface TrojanFrozen {
  readonly raidId: string;
  readonly seed: number;
  readonly events: readonly RaidEvent[];
  readonly yard: FrozenYard;
  readonly defence: RaidStart["fight"]["defence"];
}

/** By monster id, for `RaidView.monsters` (`raidFlow.ts`); the horse has no warning alert to show it in, but the shape is shared. */
const rosterOf = (events: readonly RaidEvent[]): Roster => {
  const roster: Record<string, number> = {};
  for (const event of events) {
    for (const [monster, count] of Object.entries(event.monsters)) roster[monster] = (roster[monster] ?? 0) + count;
  }
  return roster;
};

/**
 * The spring's first transaction: every refusal gate that reads the row, the
 * yard brought up to date and copied for the fight, the army built, and a
 * provisional fight lock set under a fresh raid id — as `raidFlow.ts`'s
 * `freezeYard` does for an already-warned raid, but with no prior raid to
 * resume and its own eligibility gates instead.
 */
const freezeTrojan = async (em: EntityManager, user: User, now: number): Promise<TrojanFrozen> => {
  let completed: Awaited<ReturnType<typeof catchUpLockedRow>> = [];
  const frozen = await em.transactional(async (tx) => {
    const locked = await lockMain(tx, user);
    if (isAttackActive(locked)) throw raidRefusedErr("underAttack");
    if (raidFighting(locked, now)) throw raidRefusedErr("raidOpen");

    const schedule = readSchedule(locked.aiattacks);
    if (!schedule.trojan || schedule.trojan.doneAt !== undefined) throw raidRefusedErr("noHorse");

    completed = await catchUpLockedRow(tx, locked, now);

    const buildingdata = locked.buildingdata ?? {};
    const horse = Object.values(buildingdata).find((building) => Number(building?.t) === TROJAN_HORSE_TYPE);
    if (!horse) throw raidRefusedErr("noHorse");

    const yard: FrozenYard = structuredClone({
      buildingdata,
      buildinghealthdata: locked.buildinghealthdata ?? {},
      resources: locked.resources ?? {},
    });
    const defence = defenderForcesOf({ buildingdata: yard.buildingdata, academy: locked.academy, champion: locked.champion });
    const empirePoints = calculateEmpirePoints(locked.points ?? "0", locked.basevalue ?? "0");
    const events = trojanArmy({ horseX: Number(horse.X), horseY: Number(horse.Y), empirePoints });
    const raidId = newRaidId();

    locked.aiattacks = scheduleColumn(withFightLock(schedule, { id: raidId, until: now + START_LOCK_SECONDS }));
    await tx.flush();
    return { raidId, seed: newSeed(), events, yard, defence };
  });
  await notifyJobs(em, user.userid, completed);
  return frozen;
};

/**
 * The spring (§5, §7): the yard frozen and held (`freezeTrojan`), the fight
 * run once in a worker, then claimed in Redis with no prior warning to update
 * (`openFightingRaid`, via `lockForFight`'s `claim`). The client is handed
 * what it needs to play the same fight, exactly as `raid/start` would.
 *
 * A raid or another spring already open or fighting is refused (`raidOpen`),
 * as is one on a yard under attack (`underAttack`) or an ineligible horse
 * (`noHorse`). With no replay slot free, or a fight the worker could not
 * finish in time, it is `503 busy` and nothing is kept.
 */
export const springTrojanHorse = async (em: EntityManager, user: User, now: number): Promise<RaidStart> => {
  if (await readOpenRaid(user.userid)) throw raidRefusedErr("raidOpen");
  const marks = await readPresenceMarks(user.userid, now);
  if (!isOnline(marks, now, ATTACK_ONLINE_SECONDS)) throw raidRefusedErr("offline");

  const release = await reserveReplaySlot();
  if (!release) throw raidRefusedErr("busy");
  let start: RaidStart;
  try {
    const { raidId, seed, events, yard, defence } = await freezeTrojan(em, user, now);
    let outcome: RaidFightOutcome;
    try {
      outcome = await fightRaidInWorker({
        buildingdata: yard.buildingdata,
        buildinghealthdata: yard.buildinghealthdata,
        resources: yard.resources as RaidFightInput["resources"],
        log: { v: 1, seed, events },
        defence,
        raidSpawnsUntil: TROJAN_LAST_SPAWN_TICK,
      });
    } catch (err) {
      await unlockYard(em, user, raidId).catch((unlockErr: unknown) =>
        logger.warn(`Trojan Horse fight ${raidId} could not unlock its yard: ${(unlockErr as Error).message}`)
      );
      if (err instanceof ReplayTimeoutError) throw raidRefusedErr("busy");
      throw err;
    }

    const fightSeconds = fightSecondsOf(outcome);
    const fighting: OpenRaid = {
      id: raidId,
      phase: "fighting",
      tribe: TROJAN_TRIBE,
      plan: { army: rosterOf(events) },
      seed,
      attackAt: now,
      warned: 0,
      startedAt: now,
      fightSeconds,
      outcome,
    };
    switch (await lockForFight(em, user, fighting, now, openFightingRaid)) {
      case "lapsed":
        throw raidRefusedErr("busy");
      case "lifted":
      case "raidGone":
        // The yard's own fight lock is already lifted by `lockForFight`; there was never a
        // Redis entry to call off (the spring has no warning to have opened one).
        throw raidRefusedErr("noRaid");
    }
    start = {
      raid: raidView(fighting),
      fight: { seed, events, tick: outcome.ticks, seconds: fightSeconds, yard, defence },
    };
  } finally {
    release();
  }
  logger.info("Trojan Horse {id} sprung for userid {userid}", {
    event: "trojan-horse-sprung",
    userid: user.userid,
    id: start.raid.id,
    tick: start.fight.tick,
  });
  return start;
};
