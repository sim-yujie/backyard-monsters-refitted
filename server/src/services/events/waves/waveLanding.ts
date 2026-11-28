import type { EntityManager } from "@mikro-orm/core";

import type { Save } from "../../../database/models/save.model.js";
import type { BuildingDataMap } from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { logger } from "../../../utils/logger.js";
import { coinStore } from "../eventCoins.js";
import { storedCount } from "../../yard/decor.js";
import type { RaidFightOutcome } from "../../raids/raidFight.js";
import { waveEventByKey } from "./waveEvents.js";
import { waveBeaten } from "./wavePlan.js";
import { waveProgressStore } from "./waveProgress.js";
import type { WaveResult } from "./waveTribe.js";

/**
 * Landing a wave event's wave (beta 10), on the locked main yard inside the
 * raid's own landing transaction (`raids/raidFlow.ts` `settleRaid`, after
 * `landRaid` has applied the damage, started the repairs and stolen nothing):
 * the wave counted beaten or lost (`waveProgress.ts`), and a beaten one's
 * prizes paid once — its Glimmers (`eventCoins.ts`, keyed so a wave pays
 * once) and, on a totem wave, the totem given or raised (Flash's
 * `BTOTEM.TotemReward` / `UpgradeTotem`).
 */

/** What the open raid's plan carries for a wave (`waveFight.ts`). */
export interface WavePlanRecord {
  readonly event: string;
  readonly run: string;
  readonly wave: number;
  readonly surrendered?: boolean;
}

/** The wave a raid's plan is for, or null. */
export const wavePlanOf = (plan: unknown): WavePlanRecord | null => {
  const wave = (plan as { wave?: Partial<WavePlanRecord> } | null | undefined)?.wave;
  if (!wave || typeof wave.event !== "string" || typeof wave.run !== "string" || !Number.isInteger(wave.wave)) return null;
  return { event: wave.event, run: wave.run, wave: Number(wave.wave), surrendered: wave.surrendered === true };
};

const levelOf = (building: { l?: unknown } | undefined): number => Math.max(1, Math.floor(Number(building?.l) || 1));

/**
 * The yard with its totem at `level` or higher: a placed one raised, else a
 * stored one's level raised, else one put in storage (Flash gave a missing
 * totem back the same way). Never lowers a totem from an earlier run.
 * Mutates `save`; says whether one is on the yard.
 */
export const giveTotem = (
  save: Pick<Save, "buildingdata" | "researchdata">,
  type: number,
  level: number
): { level: number; placed: boolean; raised: boolean } => {
  const buildingdata: BuildingDataMap = { ...(save.buildingdata ?? {}) };
  let placed = false;
  let top = level;
  let before = 0;
  for (const [key, building] of Object.entries(buildingdata)) {
    if (Number(building?.t) !== type) continue;
    placed = true;
    before = Math.max(before, levelOf(building));
    const next = Math.max(levelOf(building), level);
    top = Math.max(top, next);
    if (next !== levelOf(building)) buildingdata[key] = { ...building!, l: next };
  }
  if (placed) {
    save.buildingdata = buildingdata;
    return { level: top, placed, raised: top > before };
  }
  const researchdata: JsonObject = { ...(save.researchdata ?? {}) };
  const stored = storedCount(researchdata, type);
  const storedLevel = Math.floor(Number(researchdata[`bl${type}`]) || 0);
  if (stored <= 0) researchdata[`b${type}`] = 1;
  top = Math.max(level, storedLevel);
  researchdata[`bl${type}`] = top;
  save.researchdata = researchdata;
  return { level: top, placed: false, raised: stored <= 0 || top > storedLevel };
};

export const landWave = async (
  tx: EntityManager,
  save: Save,
  userid: number,
  plan: unknown,
  outcome: Pick<RaidFightOutcome, "ticks" | "healthShare">
): Promise<WaveResult | undefined> => {
  const record = wavePlanOf(plan);
  const event = record ? waveEventByKey(record.event) : null;
  if (!record || !event) {
    logger.warn(`Wave landed for userid ${userid} without a known wave plan`);
    return undefined;
  }
  const store = waveProgressStore();
  const beaten = !record.surrendered && waveBeaten(outcome);
  let glimmers = 0;
  let totem: WaveResult["totem"];
  let counted = false;
  if (beaten) {
    counted = await store.beat(tx, userid, record.run, record.wave);
    const prize = event.prizes[record.wave - 1];
    if (counted && prize) {
      if (prize.glimmers > 0) {
        const paid = await coinStore().grant(tx, userid, prize.glimmers, "wave", `wave:${record.run}:${record.wave}`);
        if (paid !== null) glimmers = prize.glimmers;
      }
      // Told only when it changed: a totem from an earlier run may already stand higher.
      if (prize.totemLevel && event.totemType) {
        const given = giveTotem(save, event.totemType, prize.totemLevel);
        if (given.raised) totem = { type: event.totemType, level: given.level, placed: given.placed };
      }
    }
  } else {
    await store.lose(tx, userid, record.run);
  }
  const progress = await store.read(tx, userid, record.run);
  const next = progress.beaten >= event.waves.length ? null : progress.beaten + 1;
  logger.info("Wave {wave} of {eventKey} {how} for userid {userid}", {
    event: "wave-event-wave",
    wave: record.wave,
    eventKey: record.event,
    run: record.run,
    how: beaten ? (counted ? "beaten" : "beaten again") : record.surrendered ? "surrendered" : "lost",
    userid,
    health: outcome.healthShare,
    glimmers,
    totem: totem?.level ?? 0,
  });
  return {
    event: record.event,
    run: record.run,
    wave: record.wave,
    waves: event.waves.length,
    firstBonusWave: event.firstBonusWave,
    totemType: event.totemType ?? null,
    beaten,
    surrendered: record.surrendered === true,
    next,
    glimmers,
    ...(totem ? { totem } : {}),
  };
};
