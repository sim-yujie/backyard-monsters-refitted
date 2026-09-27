import { damagedAt } from "@/game/yard/repair";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * Repairs (`docs/design/yard-buildings.md` §5.5; wire contract in
 * `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/repair           ids (JSON array) | all=1
 *   POST /api/:apiVersion/bm/yard/repair/instant
 *
 * Repair is free and holds no worker; the server heals in its catch-up. Repair
 * now (`FIX`) heals everything damaged at once for Shiny. The calls hold no
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
export const repairBuildings = (ids: readonly number[]): Promise<YardResponse<RepairReport>> =>
  post<YardResponse<RepairReport>>(REPAIR_PATH, { ids: JSON.stringify(ids) });

/** Repair all: starts every damaged building not already repairing. */
export const repairAll = (): Promise<YardResponse<RepairReport>> =>
  post<YardResponse<RepairReport>>(REPAIR_PATH, { all: 1 });

/** Repair now: everything damaged to full health for Shiny. Refusals: `notDamaged`, `shinyLocked`, `credits`. */
export const repairNow = (): Promise<YardResponse<RepairInstantReport>> =>
  post<YardResponse<RepairInstantReport>>(`${REPAIR_PATH}/instant`);

/** The three calls, so the actions can be handed a stand-in under test. */
export interface RepairApi {
  ids: typeof repairBuildings;
  all: typeof repairAll;
  now: typeof repairNow;
}

export const repairApi: RepairApi = { ids: repairBuildings, all: repairAll, now: repairNow };

/** The queue keys, for `store.isRunning`. */
export const RepairKey = {
  ALL: actionKey("repair", "all"),
  NOW: actionKey("repair", "now"),
  one: (id: number): string => actionKey("repair", id),
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
      send: () => api.ids([id]),
    }),
  all: () =>
    store.run({
      key: RepairKey.ALL,
      check: (reader) =>
        damagedAt(reader.save, reader.now()).some((damage) => !damage.repairing)
          ? null
          : refuse("notDamaged", "Nothing needs repairing."),
      send: () => api.all(),
    }),
  now: () =>
    store.run({
      key: RepairKey.NOW,
      check: (reader) =>
        damagedAt(reader.save, reader.now()).length > 0
          ? null
          : refuse("notDamaged", "Nothing needs repairing."),
      send: () => api.now(),
    }),
});
