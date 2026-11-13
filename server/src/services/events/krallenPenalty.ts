import type { EntityManager } from "@mikro-orm/core";

import { championEntry } from "../../game-data/championCatalogue.js";
import { KRALLEN_TYPE } from "../../game-data/events/eventRewards.js";
import { huntStartLevel, krallenHuntMinimum, type EventDefinition } from "../../game-data/events/events.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { frozenBlob } from "../yard/chamber.js";
import {
  buildingOfType,
  CHAMPION_CHAMBER_TYPE,
  CHAMPION_STATUS,
  levelOf,
  maxHealthOf,
  readChampions,
  statusOf,
} from "../yard/champion.js";
import { liveEvents } from "./liveEvents.js";
import type { EventProgress, EventProgressStore, KrallenPenaltyNotice } from "./progressStore.js";
import { eventWindow } from "./schedule.js";

/**
 * The Krallen Hunt's penalty (owner, 2026-11-13; minimum in
 * `game-data/events/events.ts`, `krallenHuntMinimum`): a player who owned
 * Krallen when a hunt began and ends it below half its goal loses one level;
 * a level 1 Krallen is lost and must be won again.
 *
 * - **When.** Decided once a hunt is over, on the owner's next load of their
 *   main yard, under its row lock (`yard/yardRoute.ts` `catchUpOwnerYard`),
 *   for every hunt that ended since her entry's `hk` (unix s), oldest first,
 *   each from the level the one before left her at. Never while an attack on
 *   the yard is on: the next load decides it.
 * - **Start.** Her level when the hunt began (`huntStartLevel`): a player who
 *   won her in that hunt had none, so is never penalised.
 * - **Once.** The penalty is written on the hunt's progress row
 *   (`data.krallenPenalty {from, to, told}`, no migration) by a statement
 *   that refuses a second one, and `hk` moves past the hunt in the same
 *   transaction.
 * - **First look.** A Krallen without `hk` (won since the last load, or older
 *   than this rule) gets `hk` = now and is judged from the next hunt to end.
 * - **Lower.** One level down, health no higher than her new full health;
 *   frozen, the chamber's `fz` copy follows. Her loot aura `la` stays, and
 *   below level 3 the fight's level check leaves it off.
 * - **Lost.** Her entry leaves the list, aura and all; frozen, the chamber's
 *   `fz` copy drops her too.
 * - **Notice.** Every penalty not yet told comes back for the yard's
 *   one-time notice and is marked told.
 */

/** The slice of the locked main save this reads and writes. */
export interface PenaltySave {
  userid: number;
  champion?: unknown;
  buildingdata?: BuildingDataMap | null;
}

/** Her level before and after one penalty, 0 for lost. Pure. */
export const lowerKrallen = (
  raw: unknown,
  buildingdata: BuildingDataMap | null | undefined
): { champions: ChampionData[]; buildingdata: BuildingDataMap | null | undefined; from: number; to: number } => {
  const entry = championEntry(KRALLEN_TYPE)!;
  const champions = readChampions(raw);
  const index = champions.findIndex((one) => Math.trunc(Number(one.t)) === KRALLEN_TYPE);
  if (index < 0) return { champions, buildingdata, from: 0, to: 0 };
  const was = champions[index]!;
  const from = levelOf(was, entry);
  if (from <= 1) {
    champions.splice(index, 1);
  } else {
    const next: ChampionData = { ...was, l: from - 1 };
    next.hp = Math.min(Number(was.hp) || 0, maxHealthOf(next, entry));
    champions[index] = next;
  }
  const chamber = buildingOfType({ buildingdata }, CHAMPION_CHAMBER_TYPE);
  const frozen = statusOf(was) === CHAMPION_STATUS.FROZEN;
  const nextBuildings =
    frozen && chamber
      ? { ...(buildingdata ?? {}), [chamber.key]: { ...chamber.building, fz: frozenBlob(champions) } }
      : buildingdata;
  return { champions, buildingdata: nextBuildings, from, to: from - 1 };
};

/** Her level when `event` began, as its own penalty recorded it, else `huntStartLevel`. */
export const krallenStartLevel = (event: EventDefinition, progress: EventProgress, krallenNow: number): number => {
  const recorded = progress.data.krallenPenalty as { from?: unknown } | undefined;
  const from = Number(recorded?.from);
  if (Number.isInteger(from) && from > 0) return from;
  return huntStartLevel(event.ladder?.tiers ?? [], progress.claimedTiers, krallenNow);
};

/** The Krallen Hunts over by `now` and ended after `after`, oldest first. */
export const huntsEndedBetween = (
  after: number,
  now: number,
  events: readonly EventDefinition[] = liveEvents()
): { event: EventDefinition; endsAt: number }[] =>
  events
    .filter((event) => event.kind === "krallen")
    .map((event) => ({ event, endsAt: eventWindow(event, now).endsAt }))
    .filter(({ endsAt }) => endsAt > after && endsAt <= now)
    .sort((a, b) => a.endsAt - b.endsAt);

/**
 * Settles the hunts ended since her `hk` on the locked main save (written by
 * the caller's flush), then hands back every penalty not yet told.
 */
export const settleKrallenHunts = async (
  em: EntityManager,
  store: EventProgressStore,
  save: PenaltySave,
  now: number,
  options: { underAttack?: boolean; events?: readonly EventDefinition[] } = {}
): Promise<KrallenPenaltyNotice[]> => {
  const krallenOf = (champions: readonly ChampionData[]) =>
    champions.find((one) => Math.trunc(Number(one.t)) === KRALLEN_TYPE);
  let champions = readChampions(save.champion);
  let krallen = krallenOf(champions);

  if (krallen && !options.underAttack) {
    const settledTo = Number(krallen.hk);
    if (!(Number.isFinite(settledTo) && settledTo > 0)) {
      krallen.hk = now;
      save.champion = champions;
    } else {
      const hunts = huntsEndedBetween(settledTo, now, options.events);
      const progress = hunts.length
        ? await store.read(em, save.userid, hunts.map(({ event }) => event.id))
        : new Map<string, EventProgress>();
      const entry = championEntry(KRALLEN_TYPE)!;
      for (const { event, endsAt } of hunts) {
        if (!krallen) break;
        const row = progress.get(event.id);
        const startLevel = huntStartLevel(event.ladder?.tiers ?? [], row?.claimedTiers ?? [], levelOf(krallen, entry));
        const minimum = krallenHuntMinimum(startLevel);
        if (startLevel > 0 && (row?.counter ?? 0) < minimum) {
          const from = levelOf(krallen, entry);
          if (await store.recordKrallenPenalty(em, save.userid, event.id, from, from - 1)) {
            const lowered = lowerKrallen(champions, save.buildingdata);
            champions = lowered.champions;
            if (lowered.buildingdata !== save.buildingdata) save.buildingdata = lowered.buildingdata ?? null;
            krallen = krallenOf(champions);
          }
        }
        if (krallen) krallen.hk = endsAt;
      }
      if (hunts.length) save.champion = champions;
    }
  }

  return store.takeKrallenNotices(em, save.userid);
};
