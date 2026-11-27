import { randomInt } from "node:crypto";
import type { EntityManager } from "@mikro-orm/core";

import type { User } from "../../../database/models/user.model.js";
import { raidRefusedErr } from "../../../errors/errors.js";
import { ClientSafeError } from "../../../middleware/clientSafeError.js";
import { Status } from "../../../enums/StatusCodes.js";
import { defenderForcesOf, type RaidEvent } from "../../../game-rules/combat/index.js";
import { logger } from "../../../utils/logger.js";
import { catchUpLockedRow } from "../../../controllers/yard/yardAction.js";
import { countAfterCommit } from "../../alliance/allianceProgress.js";
import { isAttackActive } from "../../base/isAttackActive.js";
import {
  AUTO_ATTACK_SLOT_WAIT_MS,
  ReplayTimeoutError,
  fightRaidInWorker,
  reserveReplaySlot,
} from "../../base/combat/replayRunner.js";
import { ATTACK_ONLINE_SECONDS, isPresent, readPresenceMarks } from "../../user/online.js";
import { fightSecondsOf, type RaidFightInput, type RaidFightOutcome } from "../../raids/raidFight.js";
import {
  START_LOCK_SECONDS,
  lockForFight,
  lockMain,
  newSeed,
  notifyJobs,
  raidView,
  unlockYard,
  type RaidStart,
} from "../../raids/raidFlow.js";
import { raidFighting } from "../../raids/raidLock.js";
import { readSchedule, scheduleColumn, withFightLock } from "../../raids/raidSchedule.js";
import { newRaidId, openFightingRaid, readOpenRaid, type OpenRaid } from "../../raids/raidStore.js";
import { eventPlayerOf } from "../eventPlayer.js";
import type { WavePlanRecord } from "./waveLanding.js";
import { planWave, waveSize } from "./wavePlan.js";
import { waveProgressStore } from "./waveProgress.js";
import { liveWaveEvent, runId, type WaveRun } from "./waveRuns.js";
import { totemLevelFor } from "./waveRewards.js";
import { WAVE_TRIBE } from "./waveTribe.js";
import type { WaveEventDefinition } from "./waveTypes.js";

/**
 * Calling the next wave of the wave event on now (beta 10): the player's
 * "Next wave" on their own yard (owner, 27 Nov 2026: whenever they like). The
 * Trojan Horse's spring (`raids/trojanFight.ts`) step for step: the yard
 * frozen and held, the wave fought once in a replay worker, then opened as a
 * fighting raid under {@link WAVE_TRIBE}; the client plays it in the raid
 * scene and `/raid/finish` lands it (`raidFlow.ts` `settleRaid`, which hands
 * the wave to `waveLanding.ts`). Losing, or closing the game, leaves the wave
 * to call again.
 */

/** Why a wave route said no, beyond the raid's own refusals. */
export type WaveRefusal = "noEvent" | "notReady" | "allBeaten" | "notWave";

const WAVE_REFUSAL_MESSAGES: Record<WaveRefusal, string> = {
  noEvent: "No invasion is on right now.",
  notReady: "Finish the guided start to take part.",
  allBeaten: "You beat every wave!",
  notWave: "That fight is not an invasion wave.",
};

export const waveRefusedErr = (reason: WaveRefusal) =>
  new ClientSafeError({
    message: WAVE_REFUSAL_MESSAGES[reason],
    status: Status.CONFLICT,
    data: { reason },
    isClientFriendly: true,
  });

/** One monster of the next wave, for the HUD's preview. */
export interface WavePreviewGroup {
  readonly monster: string;
  readonly count: number;
}

/** What the yard, HUD and Events card show about the wave event on now. */
export interface WaveStatus {
  readonly event: string;
  readonly title: string;
  readonly run: string;
  readonly endsAt: number;
  readonly waves: number;
  readonly firstBonusWave: number;
  readonly beaten: number;
  readonly lost: number;
  /** The wave "Next wave" calls, or null once all are beaten. */
  readonly next: number | null;
  /** The next wave's monsters (none shown for a bonus wave, Flash's "??????") and their count. */
  readonly preview: readonly WavePreviewGroup[];
  readonly size: number;
  /** The next wave's prize. */
  readonly prize: { readonly glimmers: number; readonly totemLevel?: number } | null;
  readonly totemType: number | null;
  /** The totem level earned so far this run (0: none). */
  readonly totemLevel: number;
  readonly banner: { readonly modern: string; readonly classic: string };
}

/** The status for `event`'s `run` with `beaten`/`lost`. Pure. */
export const waveStatusOf = (event: WaveEventDefinition, run: WaveRun, beaten: number, lost: number): WaveStatus => {
  const next = beaten >= event.waves.length ? null : beaten + 1;
  const preview: WavePreviewGroup[] = [];
  if (next !== null && next < event.firstBonusWave) {
    for (const group of event.waves[next - 1] ?? []) {
      const monster = group.kind === "creep" ? group.monster : `G${group.guardian}`;
      const count = group.kind === "creep" ? group.count : 1;
      const same = preview.find((one) => one.monster === monster);
      if (same) (same as { count: number }).count += count;
      else preview.push({ monster, count });
    }
  }
  return {
    event: event.key,
    title: event.title,
    run: runId(run),
    endsAt: run.endsAt,
    waves: event.waves.length,
    firstBonusWave: event.firstBonusWave,
    beaten,
    lost,
    next,
    preview,
    size: next === null ? 0 : waveSize(event, next),
    prize: next === null ? null : (event.prizes[next - 1] ?? null),
    totemType: event.totemType ?? null,
    totemLevel: totemLevelFor(beaten),
    banner: event.banner,
  };
};

/** The wave event on now and the player's place in it, or null when none is on. */
export const readWaveStatus = async (em: EntityManager, userid: number, now: number): Promise<WaveStatus | null> => {
  const live = liveWaveEvent(now);
  if (!live) return null;
  const progress = await waveProgressStore().read(em, userid, runId(live.run));
  return waveStatusOf(live.event, live.run, progress.beaten, progress.lost);
};

type FrozenYard = RaidStart["fight"]["yard"];

interface WaveFrozen {
  readonly raidId: string;
  readonly seed: number;
  readonly events: readonly RaidEvent[];
  readonly army: Record<string, number>;
  readonly turn: number;
  readonly lastSpawnTick: number;
  readonly record: WavePlanRecord;
  readonly yard: FrozenYard;
  readonly defence: RaidStart["fight"]["defence"];
}

/** The first transaction: the gates on the locked row, the yard caught up and copied, the wave planned, the yard held. */
const freezeWave = async (
  em: EntityManager,
  user: User,
  live: { run: WaveRun; event: WaveEventDefinition },
  wave: number,
  now: number
): Promise<WaveFrozen> => {
  let completed: Awaited<ReturnType<typeof catchUpLockedRow>> = [];
  const frozen = await countAfterCommit(() =>
    em.transactional(async (tx) => {
      const locked = await lockMain(tx, user);
      if (isAttackActive(locked)) throw raidRefusedErr("underAttack");
      if (raidFighting(locked, now)) throw raidRefusedErr("raidOpen");
      if (live.event.requires?.tutorial && !eventPlayerOf(locked).tutorialDone) throw waveRefusedErr("notReady");

      completed = await catchUpLockedRow(tx, locked, now);
      const yard: FrozenYard = structuredClone({
        buildingdata: locked.buildingdata ?? {},
        buildinghealthdata: locked.buildinghealthdata ?? {},
        resources: locked.resources ?? {},
      });
      const defence = defenderForcesOf({
        buildingdata: yard.buildingdata,
        academy: locked.academy,
        champion: locked.champion,
        storedata: locked.storedata,
        now,
      });
      const plan = planWave({ event: live.event, wave, quarter: randomInt(0, 4) });
      if (!plan) throw waveRefusedErr("allBeaten");
      if (plan.championsSkipped > 0) {
        logger.info(`Wave ${wave} of ${live.event.key}: ${plan.championsSkipped} champion group(s) skipped, champion raiders not wired yet`);
      }
      const raidId = newRaidId();
      const schedule = readSchedule(locked.aiattacks);
      locked.aiattacks = scheduleColumn(withFightLock(schedule, { id: raidId, until: now + START_LOCK_SECONDS }));
      await tx.flush();
      return {
        raidId,
        seed: newSeed(),
        events: plan.events,
        army: plan.army,
        turn: plan.turn,
        lastSpawnTick: plan.lastSpawnTick,
        record: { event: live.event.key, run: runId(live.run), wave },
        yard,
        defence,
      };
    })
  );
  await notifyJobs(em, user.userid, completed);
  return frozen;
};

/**
 * "Next wave": the next wave of the event on now, fought and opened. Refused
 * with no event on (`noEvent`), the guided start not done (`notReady`), every
 * wave beaten (`allBeaten`), a raid already open or fighting (`raidOpen`), a
 * player attacking the yard (`underAttack`), the game not open on the yard
 * (`offline`), or no fight slot free (`503 busy`).
 */
export const startNextWave = async (em: EntityManager, user: User, now: number): Promise<RaidStart & { wave: WaveStatus }> => {
  const live = liveWaveEvent(now);
  if (!live) throw waveRefusedErr("noEvent");
  const progress = await waveProgressStore().read(em, user.userid, runId(live.run));
  const status = waveStatusOf(live.event, live.run, progress.beaten, progress.lost);
  if (status.next === null) throw waveRefusedErr("allBeaten");
  if (await readOpenRaid(user.userid)) throw raidRefusedErr("raidOpen");
  const marks = await readPresenceMarks(user.userid, now);
  if (!isPresent(marks, now, ATTACK_ONLINE_SECONDS)) throw raidRefusedErr("offline");

  const release = await reserveReplaySlot(AUTO_ATTACK_SLOT_WAIT_MS, { kind: "wave" });
  if (!release) throw raidRefusedErr("busy");
  let start: RaidStart;
  try {
    const frozen = await freezeWave(em, user, live, status.next, now);
    let outcome: RaidFightOutcome;
    try {
      outcome = await fightRaidInWorker({
        buildingdata: frozen.yard.buildingdata,
        buildinghealthdata: frozen.yard.buildinghealthdata,
        resources: frozen.yard.resources as RaidFightInput["resources"],
        log: { v: 1, seed: frozen.seed, events: frozen.events },
        defence: frozen.defence,
        raidSpawnsUntil: frozen.lastSpawnTick,
      });
    } catch (err) {
      await unlockYard(em, user, frozen.raidId).catch((unlockErr: unknown) =>
        logger.warn(`Wave fight ${frozen.raidId} could not unlock its yard: ${(unlockErr as Error).message}`)
      );
      if (err instanceof ReplayTimeoutError) throw raidRefusedErr("busy");
      throw err;
    }

    const fightSeconds = fightSecondsOf(outcome);
    const fighting: OpenRaid = {
      id: frozen.raidId,
      phase: "fighting",
      tribe: WAVE_TRIBE,
      plan: { army: frozen.army, bearing: frozen.turn, wave: frozen.record },
      seed: frozen.seed,
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
        throw raidRefusedErr("noRaid");
    }
    start = {
      raid: raidView(fighting),
      fight: {
        seed: frozen.seed,
        events: frozen.events,
        tick: outcome.ticks,
        seconds: fightSeconds,
        yard: frozen.yard,
        defence: frozen.defence,
      },
    };
  } finally {
    release();
  }
  logger.info("Wave {wave} of {eventKey} called by userid {userid}", {
    event: "wave-event-called",
    eventKey: live.event.key,
    wave: status.next,
    userid: user.userid,
    id: start.raid.id,
    tick: start.fight.tick,
  });
  return { ...start, wave: status };
};
