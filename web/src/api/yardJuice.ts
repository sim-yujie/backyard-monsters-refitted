import { juicerProblemText, juicerStatus } from "@/game/monsters/juice";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * The Monster Juicer's yard route (`docs/design/yard-buildings.md` §7.3; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/juice   monsters (JSON {id: count})
 *
 * Juices housed monsters for `ceil(cResource × rate)` goo each, clamped to the
 * goo cap. Juicing out of a bunker is `bunker/remove` (`yardBunker.ts`).
 */

const JUICE_PATH = "/api/:apiVersion/bm/yard/juice";

/** `report` of `juice`. */
export interface JuiceReport {
  /** Monsters juiced, by id. */
  juiced: Record<string, number>;
  /** Goo that landed in storage. */
  goo: number;
  /** Goo the storage cap turned away. */
  lost: number;
  /** The Juicer's rate that applied. */
  rate: number;
}

/**
 * Juices `monsters` out of housing. Refusals: `mapRoom3`, `inferno`,
 * 400 `badRequest`, `noJuicer`, `busy`, `damaged`,
 * `notEnough { monster, have, need }`.
 */
export const juiceMonsters = (
  monsters: Readonly<Record<string, number>>,
): Promise<YardResponse<JuiceReport>> =>
  post<YardResponse<JuiceReport>>(JUICE_PATH, { monsters: JSON.stringify(monsters) });

export interface JuiceApi {
  juice: typeof juiceMonsters;
}

export const juiceApi: JuiceApi = { juice: juiceMonsters };

/** The queue key, for `store.isRunning`. */
export const JUICE_KEY = actionKey("juice", "housing");

export interface JuiceActions {
  /** Juices the selection. Refused locally when the Juicer cannot work or housing holds fewer. */
  juice(monsters: Readonly<Record<string, number>>): Promise<YardActionResult<JuiceReport>>;
}

const refuse = (reason: string, message: string, detail: Record<string, unknown> = {}): YardRefusal => ({
  reason,
  message,
  detail,
  local: true,
});

/**
 * The juice route through `store.run`, so it queues behind any request in
 * flight and re-checks, against the state the answer ahead of it left, that
 * the Juicer still works and the monsters are still there (T4).
 */
export const juiceActions = (store: YardStore, api: JuiceApi = juiceApi): JuiceActions => ({
  juice: (monsters) =>
    store.run({
      key: JUICE_KEY,
      check: (reader) => {
        const status = juicerStatus(reader.save);
        if (!status.ok) {
          const reason =
            status.problem === "building" || status.problem === "upgrading" ? "busy" : status.problem;
          return refuse(reason, juicerProblemText(status.problem));
        }
        const entries = Object.entries(monsters).filter(([, n]) => n > 0);
        if (entries.length === 0) return refuse("badRequest", "Pick at least one monster to juice.");
        for (const [monster, need] of entries) {
          const have = Number(reader.save.monsters?.housed?.[monster] ?? 0);
          if (need > have) {
            return refuse("notEnough", "You do not have that many of that monster housed.", {
              monster,
              have,
              need,
            });
          }
        }
        return null;
      },
      send: () => api.juice(monsters),
    }),
});
