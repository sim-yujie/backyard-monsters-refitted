import type { EntityManager } from "@mikro-orm/core";

import type { YardEventDefinition } from "../../../game-data/events/yardEvents.js";
import {
  EVENT_COPY_YARDS,
  EVENT_OF_YARD,
  EVENT_YARDS,
  EVENT_YARDS_MAP,
  eventYardOrder,
  isCopyYardId,
} from "../../../game-data/tribes/events/index.js";
import { Env } from "../../../enums/Env.js";
import { eventYardRefusedErr } from "../../../errors/errors.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import type { SaveData } from "../../../types/EntityData.js";
import { eventPlayerOf, type EventPlayerSave } from "../eventPlayer.js";
import { waveProgressStore } from "../waves/waveProgress.js";
import { liveYardEventRun } from "./yardEventRun.js";
import { readYardCopy, readYardStates, repairsAt, standingHealth, writeYardCopyOnce, type YardState } from "./yardStore.js";

/**
 * Who may attack which Brukkarg event yard, and the event's yards as the
 * player sees them (beta 10, bruk-port).
 *
 * - An event must be on (`yardEventRun.ts`, the dashboard's event control) and the yard one of its own.
 * - Creature Carnage: Town Hall 2 to 4 (Flash `Battletoads.doesQualify`).
 * - The yards fall in order: only the first one not yet wrecked can be
 *   attacked (Flash attacks the lowest yard not destroyed).
 * - Brukkarg War: yard k (1-based) opens once 5k waves are beaten (Flash
 *   `readyToAttackNextYard`); the fifth is a copy of the player's own yard,
 *   made once per run the first time it opens ({@link ensureYardCopy}).
 */

/** The copy yard's loot (PLACEHOLDER, owner to approve): never the player's own resources, which would mint them. */
export const COPY_YARD_LOOT = { r1: 4_000_000, r2: 4_000_000, r3: 3_000_000, r4: 2_000_000 } as const;

/**
 * Waves beaten in the Brukkarg War run, as the wave events keep them
 * (`waveProgressStore`, `event_progress.counter` of the run's row).
 * Swappable for the tests, and for trying the yards without the waves.
 */
export type WavesBeaten = (em: EntityManager, userid: number, runId: string) => Promise<number>;

const sqlWavesBeaten: WavesBeaten = async (em, userid, runId) => (await waveProgressStore().read(em, userid, runId)).beaten;

/** Local only: `BRUKWAR_NO_WAVES=1` opens every Brukkarg yard without waves (never on production). */
export const noWaves = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.ENV !== Env.PROD && env.BRUKWAR_NO_WAVES === "1";

let wavesBeatenOf: WavesBeaten = async (em, userid, runId) => (noWaves() ? 1_000 : sqlWavesBeaten(em, userid, runId));

/** Swaps the waves source (tests); returns the one it replaced. */
export const useWavesBeaten = (next: WavesBeaten): WavesBeaten => {
  const before = wavesBeatenOf;
  wavesBeatenOf = next;
  return before;
};

/** One yard of the event as the Events card shows it. */
export interface EventYardView {
  readonly baseid: string;
  /** 1-based place in the attack order. */
  readonly index: number;
  readonly destroyed: boolean;
  /** The damage the player's last attack left, 0-100 (0 once repaired). */
  readonly damage: number;
  /** When a damaged yard is whole again (unix s), 0 for none. */
  readonly repairsAt: number;
  /** The yard to attack now. */
  readonly next: boolean;
  /** Brukkarg War: waves to beat before it opens; 0 when open. */
  readonly wavesNeeded: number;
  /** The copy of the player's own yard. */
  readonly copy: boolean;
}

export interface EventYardsAnswer {
  readonly event: string;
  readonly runId: string;
  readonly endsAt: number;
  readonly yards: readonly EventYardView[];
  readonly beaten: number;
  /** Why the player cannot take part, or null. */
  readonly locked: string | null;
  /** Brukkarg War: waves beaten so far. */
  readonly waves?: number;
  /** The prizes, by yards beaten (`game-data/events/yardEvents.ts`). */
  readonly prizes: YardEventDefinition["prizes"];
}

/** Why the player is outside the event, or null. */
export const playerLockOf = (event: YardEventDefinition, save: EventPlayerSave | null | undefined): "townHall" | "tutorial" | null => {
  const player = eventPlayerOf(save);
  if (!player.tutorialDone) return "tutorial";
  const hall = event.townHall;
  if (hall && (player.townHall < hall.min || player.townHall > hall.max)) return "townHall";
  return null;
};

const LOCK_WORDS = { townHall: "For Town Hall 2 to 4.", tutorial: "Finish the guided start first." } as const;

/** The yards with the player's progress, and which one is next. */
export const eventYardViews = (
  event: YardEventDefinition,
  states: ReadonlyMap<string, YardState>,
  waves: number,
  now: number
): EventYardView[] => {
  const order = eventYardOrder(event.key);
  const nextIndex = order.findIndex((baseid) => !states.get(baseid)?.destroyed);
  return order.map((baseid, index) => {
    const state = states.get(baseid);
    const health = standingHealth(state, now);
    const need = event.wavesPerYard ? event.wavesPerYard * (index + 1) : 0;
    return {
      baseid,
      index: index + 1,
      destroyed: Boolean(state?.destroyed),
      damage: Object.keys(health).length > 0 ? (state?.damage ?? 0) : 0,
      repairsAt: repairsAt(state, now),
      next: index === nextIndex,
      wavesNeeded: Math.max(0, need - waves),
      copy: isCopyYardId(baseid),
    };
  });
};

/** `GET /bm/events/yards`: the event on now with the player's yards, or null when none runs. */
export const eventYardsAnswer = async (
  em: EntityManager,
  userid: number,
  save: EventPlayerSave | null | undefined,
  now: number
): Promise<EventYardsAnswer | null> => {
  const live = liveYardEventRun(now);
  if (!live) return null;
  const [states, waves] = await Promise.all([
    readYardStates(em, userid, live.id),
    live.event.wavesPerYard ? wavesBeatenOf(em, userid, live.id) : Promise.resolve(0),
  ]);
  const yards = eventYardViews(live.event, states, waves, now);
  const lock = playerLockOf(live.event, save);
  return {
    event: live.event.key,
    runId: live.id,
    endsAt: live.run.endsAt,
    yards,
    beaten: yards.filter((yard) => yard.destroyed).length,
    locked: lock ? LOCK_WORDS[lock] : null,
    ...(live.event.wavesPerYard ? { waves } : {}),
    prizes: live.event.prizes,
  };
};

/** What an attack start needs of the yard it may attack. */
export interface AttackableEventYard {
  readonly event: YardEventDefinition;
  readonly runId: string;
  readonly baseid: string;
  /** The yard as it is fought: the template (or the player's copy) with its standing health. */
  readonly yard: SaveData;
  readonly state: YardState | null;
}

/**
 * The yard `baseid` if the player may attack it now; otherwise the refusal
 * (`eventYardRefusedErr`), before anything is written.
 */
export const requireAttackableEventYard = async (
  em: EntityManager,
  userid: number,
  save: EventPlayerSave | null | undefined,
  baseid: string,
  now: number
): Promise<AttackableEventYard> => {
  const live = liveYardEventRun(now);
  if (!live) throw eventYardRefusedErr("noEvent");
  if (EVENT_OF_YARD.get(baseid) !== live.event.key) throw eventYardRefusedErr("notThisEvent");
  const lock = playerLockOf(live.event, save);
  if (lock) throw eventYardRefusedErr(lock);

  const states = await readYardStates(em, userid, live.id);
  const waves = live.event.wavesPerYard ? await wavesBeatenOf(em, userid, live.id) : 0;
  const views = eventYardViews(live.event, states, waves, now);
  const view = views.find((one) => one.baseid === baseid)!;
  const next = views.find((one) => one.next);
  if (view.destroyed) throw eventYardRefusedErr("destroyed", { next: next?.baseid ?? null });
  if (!view.next) throw eventYardRefusedErr("notNext", { next: next?.baseid ?? null });
  if (view.wavesNeeded > 0) throw eventYardRefusedErr("waves", { waves: view.wavesNeeded });

  const template = view.copy ? await ensureYardCopy(em, userid, live.id, live.event.key, save as Record<string, unknown> | null | undefined) : EVENT_YARDS_MAP.get(baseid)!;
  const state = states.get(baseid) ?? null;
  return {
    event: live.event,
    runId: live.id,
    baseid,
    yard: { ...structuredClone(template), baseid, buildinghealthdata: { ...standingHealth(state, now) } },
    state,
  };
};

/**
 * The player's own yard copied as the event's last yard, made once per run
 * (Flash `copybase`): its buildings at full health, its bunkers' monsters,
 * its academy and its champions, at its level. Its loot is
 * {@link COPY_YARD_LOOT}, not the player's own.
 */
export const copyOfOwnYard = (template: SaveData, save: Record<string, unknown> | null | undefined): JsonObject => {
  const loot = COPY_YARD_LOOT;
  return {
    ...(structuredClone(template) as JsonObject),
    level: Number(save?.level) || 1,
    buildingdata: withoutStoredHarvest((save?.buildingdata ?? {}) as JsonObject),
    academy: structuredClone((save?.academy ?? {}) as JsonObject),
    champion: structuredClone((save?.champion ?? []) as JsonObject[]) as unknown as JsonObject,
    resources: { ...loot, r1max: loot.r1, r2max: loot.r2, r3max: loot.r3, r4max: loot.r4 },
  } as JsonObject;
};

/**
 * The buildings without what their harvesters hold (`st`): the copy's loot is
 * {@link COPY_YARD_LOOT} alone, never the player's own stores.
 */
const withoutStoredHarvest = (buildingdata: JsonObject): JsonObject => {
  const out: JsonObject = {};
  for (const [id, building] of Object.entries(structuredClone(buildingdata))) {
    if (building && typeof building === "object" && !Array.isArray(building)) {
      const { st: _stored, ...rest } = building as JsonObject;
      out[id] = rest;
    } else out[id] = building;
  }
  return out;
};

/** The run's copy of the player's yard: the one stored, or one made now from `save` and stored. */
export const ensureYardCopy = async (
  em: EntityManager,
  userid: number,
  runId: string,
  key: keyof typeof EVENT_YARDS,
  save: Record<string, unknown> | null | undefined
): Promise<SaveData> => {
  const template = EVENT_COPY_YARDS[key]!;
  const stored = await readYardCopy(em, userid, runId);
  if (stored) return stored as SaveData;
  return (await writeYardCopyOnce(em, userid, runId, copyOfOwnYard(template, save))) as SaveData;
};

/** The yard a landing replays over: the template, or the stored copy. */
export const fightTemplateOf = async (em: EntityManager, userid: number, runId: string, baseid: string): Promise<SaveData | null> => {
  if (!isCopyYardId(baseid)) return EVENT_YARDS_MAP.get(baseid) ?? null;
  return (await readYardCopy(em, userid, runId)) as SaveData | null;
};

/**
 * An event yard opened to look at (`wmview`): the yard the event on now
 * serves, with the player's standing damage, or null outside its event. The
 * copy yard shows only once it is made.
 */
export const viewEventYard = async (em: EntityManager, userid: number, baseid: string, now: number): Promise<SaveData | null> => {
  const live = liveYardEventRun(now);
  if (!live || EVENT_OF_YARD.get(baseid) !== live.event.key) return null;
  const template = await fightTemplateOf(em, userid, live.id, baseid);
  if (!template) return null;
  const states = await readYardStates(em, userid, live.id);
  return { ...structuredClone(template), baseid, buildinghealthdata: { ...standingHealth(states.get(baseid), now) } };
};
