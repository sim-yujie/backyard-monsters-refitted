import { recycleBlock } from "@/game/yard/recycle";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";

/**
 * Recycling (`docs/design/yard-buildings.md` §5.4; wire contract in
 * `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/recycle   id
 *
 * The call holds no state; {@link recycleAction} runs it through the
 * `YardStore`'s one-at-a-time queue, which merges the answer.
 */

/** `report` of `recycle`. */
export interface RecycleReport {
  id: number;
  t: number;
  /** What came back, after the storage cap. */
  refund: UpgradeCost;
  /** What the storage cap turned away. */
  lost: UpgradeCost;
  /** A decoration put in storage: its type and how many are stored now. */
  stored: { type: number; count: number } | null;
  /** Monsters removed because housing shrank, per type. */
  culled: Record<string, number>;
}

/**
 * Recycles one building. Refusals: 400 `badRequest`; 409 `isTownHall`,
 * `mapRoom`, `busy`, `championInCage`, `championsFrozen`, `researching`,
 * `training`, `hatcheryBusy`, `unlocking`.
 */
export const recycleBuilding = (id: number): Promise<YardResponse<RecycleReport>> =>
  post<YardResponse<RecycleReport>>("/api/:apiVersion/bm/yard/recycle", { id });

/** The queue key, for `store.isRunning`. */
export const recycleKey = (id: number): string => actionKey("recycle", id);

/**
 * Recycles through `store.run`, re-checked against the state the answer ahead
 * of it left (T4): the building must still be there and still recyclable.
 */
export const recycleAction = (
  store: YardStore,
  id: number,
  send: typeof recycleBuilding = recycleBuilding,
): Promise<YardActionResult<RecycleReport>> =>
  store.run({
    key: recycleKey(id),
    check: (reader) => {
      const building = reader.save.buildingdata?.[String(id)];
      if (!building) {
        return { reason: "badRequest", message: "That building is not in your yard.", detail: {}, local: true };
      }
      const block = recycleBlock(building, reader.save, reader.now());
      return block ? { reason: block.reason, message: block.message, detail: {}, local: true } : null;
    },
    send: () => send(id),
  });
