import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { busyWorkers, workerCount } from "../yardplanner/workers.js";

/**
 * The yard state every `/bm/yard/*` response carries
 * (`docs/design/yard-buildings.md` §2.1; wire contract in `docs/server-api.md`,
 * "Yard actions").
 *
 * The save slices keep the names and shapes `/base/load` uses, so the client
 * merges them into the `BaseLoadResponse` it already holds the way `YardScene`
 * merges an Apply answer. Everything else is derived here so the client never
 * has to repeat a server rule to draw the HUD: `caps` is the storage cap the
 * server clamps credits to, and `workers` counts the jobs as the server does.
 *
 * FROZEN (2026-09-27): other work packages build against this shape. Add a
 * field only by agreement, never rename or remove one.
 */
export interface YardState {
  /** Unix seconds the stored countdowns are measured from; equals `currenttime` after a catch-up. */
  savetime: number;
  /** The server's clock at the moment of the answer, unix seconds. */
  currenttime: number;
  /** `save.resources` as stored: `r1`..`r4` (and any legacy `r*max` keys). */
  resources: JsonObject;
  /** Shiny balance; 0 while the account has Shiny locked, as `/base/load` reports it. */
  credits: number;
  /** Storage cap per resource. One figure today, repeated per key (`BASE.as:4802-4812`). */
  caps: { r1: number; r2: number; r3: number; r4: number };
  /** Worker slots and how many are on a build, upgrade or fortify countdown. */
  workers: { total: number; busy: number };
  buildingdata: BuildingDataMap;
  buildinghealthdata: BuildingHealthData;
  storedata: JsonObject;
  monsters: JsonObject;
  lockerdata: JsonObject;
  academy: JsonObject;
  champion: ChampionData[];
  mushrooms: JsonObject;
  researchdata: JsonObject;
}

/** The slice of a save {@link yardState} reads. */
export interface YardStateSave {
  savetime?: number;
  credits: number;
  resources?: JsonObject | null;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  storedata?: JsonObject | null;
  monsters?: JsonObject | null;
  lockerdata?: JsonObject | null;
  academy?: JsonObject | null;
  champion?: ChampionData[] | null;
  mushrooms?: JsonObject | null;
  researchdata?: JsonObject | null;
  outposts?: readonly unknown[] | null;
}

/**
 * Shapes a caught-up main yard for the client.
 *
 * Null jsonb columns come out as empty objects (and `champion` as an empty
 * array) so the client can merge without null checks.
 *
 * @param save - The caller's main yard, already caught up.
 * @param now - The request's `now`, reported as `currenttime`.
 * @param shinyLocked - Whether the account has Shiny locked (`user.shiny_locked`).
 */
export const yardState = (save: YardStateSave, now: number, shinyLocked: boolean): YardState => {
  const cap = storageCap(save);

  return {
    savetime: Number(save.savetime ?? 0),
    currenttime: now,
    resources: save.resources ?? {},
    credits: shinyLocked ? 0 : save.credits,
    caps: { r1: cap, r2: cap, r3: cap, r4: cap },
    workers: {
      total: workerCount(save.storedata),
      busy: busyWorkers(save.buildingdata),
    },
    buildingdata: save.buildingdata ?? {},
    buildinghealthdata: save.buildinghealthdata ?? {},
    storedata: save.storedata ?? {},
    monsters: save.monsters ?? {},
    lockerdata: save.lockerdata ?? {},
    academy: save.academy ?? {},
    champion: save.champion ?? [],
    mushrooms: save.mushrooms ?? {},
    researchdata: save.researchdata ?? {},
  };
};
