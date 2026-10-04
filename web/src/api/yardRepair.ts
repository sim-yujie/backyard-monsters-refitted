import { canFinishFree, damagedAt } from "@/game/yard/repair";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { SpeedupReport, YardResponse } from "./types";
import { speedUp, yardBody, type YardRefusal } from "./yard";

/**
 * Repairs (`docs/design/yard-buildings.md` §5.5; wire contract in
 * `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/repair           ids (JSON array) | all=1
 *   POST /api/:apiVersion/bm/yard/repair/instant
 *   POST /api/:apiVersion/bm/yard/speedup          id, item=SP1 (#279)
 *
 * Repair is free and holds no worker; the server heals in its catch-up. Repair
 * now (`FIX`) heals everything damaged at once for Shiny. A single repair with
 * five minutes or less left finishes free through the speed-up route's `SP1`,
 * as the original's Speed up did on a repairing building. The calls hold no
 * state; {@link repairActions} runs them through the `YardStore`'s
 * one-at-a-time queue, which merges each answer.
 */

const REPAIR_PATH = "/api/:apiVersion/bm/yard/repair";

/** `report` of `repair`. */
export interface RepairReport {
  /** Buildings that started repairing. */
  started: number[];
  /** Named buildings not started: not damaged, or already repairing. */
  skipped: { id: number; reason: "notDamaged" | "repairing" }[];
  /** Unix seconds by which every repair now running is done. */
  doneBy: number;
}

/** `report` of `repair/instant`. */
export interface RepairInstantReport {
  /** Buildings brought to full health. */
  repaired: number[];
  /** Shiny charged. */
  credits: number;
}

/** Starts repairing the named buildings. Refusal: 409 `notDamaged` when none could start. */
export const repairBuildings = (
  ids: readonly number[],
  baseid?: string,
): Promise<YardResponse<RepairReport>> =>
  post<YardResponse<RepairReport>>(REPAIR_PATH, yardBody({ ids: JSON.stringify(ids) }, baseid));

/** Repair all: starts every damaged building not already repairing. */
export const repairAll = (baseid?: string): Promise<YardResponse<RepairReport>> =>
  post<YardResponse<RepairReport>>(REPAIR_PATH, yardBody({ all: 1 }, baseid));

/** Repair now: everything damaged to full health for Shiny. Refusals: `notDamaged`, `shinyLocked`, `credits`. */
export const repairNow = (baseid?: string): Promise<YardResponse<RepairInstantReport>> =>
  post<YardResponse<RepairInstantReport>>(`${REPAIR_PATH}/instant`, yardBody({}, baseid));

/**
 * Finish free: one repair with 300 s or less left, to full health at once.
 * Refusal: `itemRefused` when the server counts more than 300 s left.
 */
export const finishRepair = (id: number, baseid?: string): Promise<YardResponse<SpeedupReport>> =>
  speedUp(id, "SP1", baseid);

/** The four calls, so the actions can be handed a stand-in under test. */
export interface RepairApi {
  ids: typeof repairBuildings;
  all: typeof repairAll;
  now: typeof repairNow;
  finish: typeof finishRepair;
}

export const repairApi: RepairApi = {
  ids: repairBuildings,
  all: repairAll,
  now: repairNow,
  finish: finishRepair,
};

/** The queue keys, for `store.isRunning`. */
export const RepairKey = {
  ALL: actionKey("repair", "all"),
  NOW: actionKey("repair", "now"),
  one: (id: number): string => actionKey("repair", id),
  finish: (id: number): string => actionKey("repair-finish", id),
} as const;

const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

export interface RepairActions {
  /** Repairs one building. Refused locally when it is not damaged or already repairing. */
  one(id: number): Promise<YardActionResult<RepairReport>>;
  /** Repair all. Refused locally when nothing is waiting for a repair. */
  all(): Promise<YardActionResult<RepairReport>>;
  /** Repair now, for Shiny. Refused locally when nothing is damaged. */
  now(): Promise<YardActionResult<RepairInstantReport>>;
  /** Finish free. Refused locally unless the building is repairing with five minutes or less left. */
  finish(id: number): Promise<YardActionResult<SpeedupReport>>;
}

/**
 * The repair routes through `store.run`, each re-checked against the state the
 * answer ahead of it left (T4).
 */
export const repairActions = (store: YardStore, api: RepairApi = repairApi): RepairActions => ({
  one: (id) =>
    store.run({
      key: RepairKey.one(id),
      check: (reader) => {
        const damage = damagedAt(reader.save, reader.now()).find((one) => one.id === id);
        if (!damage) return refuse("notDamaged", "That building does not need repairing.");
        return damage.repairing ? refuse("notDamaged", "That building is already being repaired.") : null;
      },
      send: (_api, ...yard) => api.ids([id], ...yard),
    }),
  all: () =>
    store.run({
      key: RepairKey.ALL,
      check: (reader) =>
        damagedAt(reader.save, reader.now()).some((damage) => !damage.repairing)
          ? null
          : refuse("notDamaged", "Nothing needs repairing."),
      send: (_api, ...yard) => api.all(...yard),
    }),
  now: () =>
    store.run({
      key: RepairKey.NOW,
      check: (reader) =>
        damagedAt(reader.save, reader.now()).length > 0
          ? null
          : refuse("notDamaged", "Nothing needs repairing."),
      send: (_api, ...yard) => api.now(...yard),
    }),
  finish: (id) =>
    store.run({
      key: RepairKey.finish(id),
      check: (reader) => {
        const damage = damagedAt(reader.save, reader.now()).find((one) => one.id === id);
        if (!damage?.repairing) return refuse("notDamaged", "That building is not being repaired.");
        return canFinishFree(damage)
          ? null
          : refuse("itemRefused", "Finishing free only works with 5 minutes or less to go.");
      },
      send: (_api, ...yard) => api.finish(id, ...yard),
    }),
});
