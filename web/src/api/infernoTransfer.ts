import { academyLevel, housingSummary } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { pickedSpace } from "@/game/inferno/transfer";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * The Inferno monster transfer (WP 2.5-2.6, `docs/design/inferno.md` §2.7;
 * wire contract in `docs/server-api.md`):
 *
 *   POST /api/:apiVersion/bm/inferno/transfer   monsters (JSON {id: count})
 *
 * Brings Inferno monsters up from the Inferno yard's Compound into the main
 * yard's Housing, free. A main-yard yard action: it answers the main yard's
 * state, which the store merges.
 */

const TRANSFER_PATH = "/api/:apiVersion/bm/inferno/transfer";

/** `report` of the transfer. */
export interface InfernoTransferReport {
  /** What came up, by id. */
  moved: Record<string, number>;
  /** The Compound after the move. */
  compound: Record<string, number>;
  /** The main yard's housing after the move. */
  housed: Record<string, number>;
  used: number;
  capacity: number;
}

export const transferFromInferno = (
  monsters: Readonly<Record<string, number>>,
): Promise<YardResponse<InfernoTransferReport>> =>
  post<YardResponse<InfernoTransferReport>>(TRANSFER_PATH, { monsters: JSON.stringify(monsters) });

export interface InfernoTransferApi {
  transfer: typeof transferFromInferno;
}

export const infernoTransferApi: InfernoTransferApi = { transfer: transferFromInferno };

/** The queue key, for `store.isRunning`. */
export const INFERNO_TRANSFER_KEY = actionKey("infernoTransfer", "cave");

const refuse = (reason: string, message: string, detail: Record<string, unknown> = {}): YardRefusal => ({
  reason,
  message,
  detail,
  local: true,
});

/**
 * Sends a transfer through `store.run` (the main yard's store), so it queues
 * behind any request in flight and re-checks, against the state the answer
 * ahead of it left, that the Housing still has room (T4).
 */
export const transferActions = (
  store: YardStore,
  api: InfernoTransferApi = infernoTransferApi,
): { transfer(monsters: Readonly<Record<string, number>>): Promise<YardActionResult<InfernoTransferReport>> } => ({
  transfer: (monsters) =>
    store.run({
      key: INFERNO_TRANSFER_KEY,
      check: (reader) => {
        const picked = Object.fromEntries(Object.entries(monsters).filter(([, n]) => n > 0));
        if (Object.keys(picked).length === 0) return refuse("badRequest", "Pick at least one monster to transfer.");
        const room = housingSummary(reader.save, reader.now());
        const sizeOf = (id: string) => housingSpace(id, academyLevel(reader.save.academy, id)) ?? 0;
        const used = room.used + pickedSpace(picked, sizeOf);
        if (used > room.total) {
          return refuse("noRoom", "There is not enough room in your Housing for those monsters.", {
            used,
            capacity: room.total,
          });
        }
        return null;
      },
      send: () => api.transfer(monsters),
    }),
});
