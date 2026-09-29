import { bunkerSpace, bunkerState, type BunkerSource } from "@/game/monsters/bunker";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * The Monster Bunker's yard routes (`docs/design/yard-buildings.md` §7.1; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/bunker/fill     bunker, monsters (JSON {id: count}), source
 *   POST /api/:apiVersion/bm/yard/bunker/remove   bunker, monster, count
 *
 * Fill takes monsters from housing (putty) or buys them (Shiny); remove takes
 * them out for good, juiced when a Juicer works, else deleted (D11).
 */

const BUNKER_PATH = "/api/:apiVersion/bm/yard/bunker";

/** `report` of `bunker/fill`. */
export interface BunkerFillReport {
  bunker: number;
  source: BunkerSource;
  added: Record<string, number>;
  /** Putty charged (`housing`). */
  cost: { r3: number };
  /** Shiny charged (`buy`). */
  credits: number;
  used: number;
  capacity: number;
}

/** `report` of `bunker/remove`. */
export interface BunkerRemoveReport {
  bunker: number;
  monster: string;
  removed: number;
  /** True when a Juicer turned them into goo; false when they were deleted. */
  juiced: boolean;
  /** Goo that landed after the cap. */
  goo: number;
  /** Goo the cap swallowed. */
  lost: number;
}

/**
 * Puts monsters in a bunker. Refusals: `mapRoom3`, `noBunker`, `busy`,
 * 400 `badRequest`, `notBunkerable`, `notBuyable`, `locked`, `notEnough`,
 * `bunkerFull { capacity, used, need }`, `shortfall`, `shinyLocked`, `credits`.
 */
export const bunkerFill = (
  bunker: number,
  monsters: Readonly<Record<string, number>>,
  source: BunkerSource,
  baseid?: string,
): Promise<YardResponse<BunkerFillReport>> =>
  post<YardResponse<BunkerFillReport>>(
    `${BUNKER_PATH}/fill`,
    yardBody({ bunker: String(bunker), monsters: JSON.stringify(monsters), source }, baseid),
  );

/** Takes monsters out for good. Refusals: `noBunker`, `mapRoom3`, 400 `badRequest`, `notInBunker`. */
export const bunkerRemove = (
  bunker: number,
  monster: string,
  count: number | "all",
  baseid?: string,
): Promise<YardResponse<BunkerRemoveReport>> =>
  post<YardResponse<BunkerRemoveReport>>(
    `${BUNKER_PATH}/remove`,
    yardBody({ bunker: String(bunker), monster, count: String(count) }, baseid),
  );

export interface BunkerApi {
  fill: typeof bunkerFill;
  remove: typeof bunkerRemove;
}

export const bunkerApi: BunkerApi = { fill: bunkerFill, remove: bunkerRemove };

/** The queue keys, for `store.isRunning`. */
export const BunkerKey = {
  fill: (bunker: number): string => actionKey("bunkerFill", bunker),
  remove: (bunker: number): string => actionKey("bunkerRemove", bunker),
} as const;

export interface BunkerActions {
  fill(
    bunker: number,
    monsters: Readonly<Record<string, number>>,
    source: BunkerSource,
  ): Promise<YardActionResult<BunkerFillReport>>;
  remove(bunker: number, monster: string, count: number | "all"): Promise<YardActionResult<BunkerRemoveReport>>;
}

const refuse = (reason: string, message: string, detail: Record<string, unknown> = {}): YardRefusal => ({
  reason,
  message,
  detail,
  local: true,
});

/**
 * The bunker routes through `store.run`, so they queue behind any request in
 * flight and re-check, against the state the answer ahead of them left, what
 * the client can see: the bunker is there and built, the monsters are in
 * housing, and there is room (T4).
 */
export const bunkerActions = (store: YardStore, api: BunkerApi = bunkerApi): BunkerActions => ({
  fill: (bunker, monsters, source) =>
    store.run({
      key: BunkerKey.fill(bunker),
      check: (reader) => {
        const state = bunkerState(reader.save, bunker);
        if (!state) return refuse("noBunker", "There is no Monster Bunker there.", { id: bunker });
        if (state.building) return refuse("busy", "This Monster Bunker is still being built.");
        const entries = Object.entries(monsters).filter(([, n]) => n > 0);
        if (entries.length === 0) {
          return refuse("badRequest", "Pick at least one monster to put in the bunker.");
        }
        if (source === "housing") {
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
        }
        const need = bunkerSpace(reader.save, monsters);
        if (state.used + need > state.capacity) {
          return refuse("bunkerFull", "That is more than the bunker has room for.", {
            capacity: state.capacity,
            used: state.used,
            need,
          });
        }
        return null;
      },
      send: (_api, ...yard) => api.fill(bunker, monsters, source, ...yard),
    }),
  remove: (bunker, monster, count) =>
    store.run({
      key: BunkerKey.remove(bunker),
      check: (reader) => {
        const state = bunkerState(reader.save, bunker);
        if (!state) return refuse("noBunker", "There is no Monster Bunker there.", { id: bunker });
        return (state.contents[monster] ?? 0) > 0
          ? null
          : refuse("notInBunker", "That monster is not in this bunker.", { monster });
      },
      send: (_api, ...yard) => api.remove(bunker, monster, count, ...yard),
    }),
});
