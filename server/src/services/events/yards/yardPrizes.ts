import type { EntityManager } from "@mikro-orm/core";

import { BLACK_SPURTZ_TYPE, SPURTZ_PRIZE_REWARDS, SPURTZ_TYPE } from "../../../config/SpurtzConfig.js";
import type { YardEventDefinition, YardPrize } from "../../../game-data/events/yardEvents.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { coinStore } from "../eventCoins.js";
import { storedCount } from "../../yard/decor.js";
import { markPrizePaid } from "./yardStore.js";

/**
 * Paying a Brukkarg event's prizes (beta 10, bruk-port; the numbers are in
 * `game-data/events/yardEvents.ts`): each prize once per run, when the
 * player's count of yards beaten reaches it, inside the landing that beat the
 * yard. Glimmers go to the event coin balance (`eventCoins.ts`, award key
 * `yards:<run>:<count>` so a repeat pays nothing); a decoration into the
 * yard's storage; a Spurtz reward into the yard's `rewards`, which the build
 * gates read (`config/SpurtzConfig.ts`).
 */

/** What a landing paid, for the answer and the client's prize pop-up. */
export interface PaidPrize {
  readonly yards: number;
  readonly glimmers?: number;
  readonly decoration?: number;
  readonly spurtz?: 1 | 2 | 3;
}

/** The yard save slices a prize changes. */
export interface PrizeSave {
  researchdata?: JsonObject | null;
  rewards?: JsonObject | null;
  buildingdata?: JsonObject | null;
}

/** The prizes due at `beaten` yards (every prize at or below it). */
export const prizesDue = (event: YardEventDefinition, beaten: number): YardPrize[] =>
  event.prizes.filter((prize) => prize.yards <= beaten);

/**
 * A Spurtz reward written into `save`: the reward id in `rewards`; at 3 (Black
 * Diamond) every Spurtz Cannon in the yard becomes a Black Diamond one at its
 * level and place (Flash `SpurtzCannonReward3.swapBuildings`).
 */
export const applySpurtzReward = (save: PrizeSave, prize: 1 | 2 | 3): void => {
  const reward = SPURTZ_PRIZE_REWARDS[prize];
  save.rewards = { ...(save.rewards ?? {}), [reward]: { id: reward } };
  if (prize !== 3) return;
  const buildings = { ...(save.buildingdata ?? {}) } as Record<string, JsonObject>;
  let swapped = false;
  for (const [id, building] of Object.entries(buildings)) {
    if (building && Number(building.t) === SPURTZ_TYPE) {
      buildings[id] = { ...building, t: BLACK_SPURTZ_TYPE };
      swapped = true;
    }
  }
  if (swapped) save.buildingdata = buildings as JsonObject;
};

/**
 * Pays every prize due at `beaten` that is not paid yet for this run. The
 * caller holds the landing's transaction (`em`) and writes `save` with it.
 */
export const payYardPrizes = async (
  em: EntityManager,
  userid: number,
  runId: string,
  event: YardEventDefinition,
  beaten: number,
  save: PrizeSave
): Promise<PaidPrize[]> => {
  const paid: PaidPrize[] = [];
  for (const prize of prizesDue(event, beaten)) {
    if (!(await markPrizePaid(em, userid, runId, prize.yards))) continue;
    if (prize.glimmers && prize.glimmers > 0) {
      await coinStore().grant(em, userid, prize.glimmers, `yards-${event.key}`, `yards:${runId}:${prize.yards}`);
    }
    if (prize.decoration) {
      const researchdata = { ...(save.researchdata ?? {}) };
      researchdata[`b${prize.decoration}`] = storedCount(researchdata, prize.decoration) + 1;
      save.researchdata = researchdata;
    }
    if (prize.spurtz) applySpurtzReward(save, prize.spurtz);
    paid.push({
      yards: prize.yards,
      ...(prize.glimmers ? { glimmers: prize.glimmers } : {}),
      ...(prize.decoration ? { decoration: prize.decoration } : {}),
      ...(prize.spurtz ? { spurtz: prize.spurtz } : {}),
    });
  }
  return paid;
};
