import type { ChampionStance } from "@/game/combat/rules";
import { juicerProblemText, juicerStatus } from "@/game/monsters/juice";
import { championEntry } from "@/game/yard/championCatalogue";
import {
  activeChampion,
  cageView,
  chamberView,
  specialChampion,
  CHAMPION_NAME_MAX,
  championView,
  freezeGate,
  frozenChampions,
  thawGate,
} from "@/game/yard/championModel";
import { actionKey, type YardActionResult, type YardStore, type YardStoreReader } from "@/game/yard/YardStore";
import { post } from "./http";
import type { ChampionSaveEntry, YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * The Champion Cage's yard routes (`docs/design/yard-buildings.md` §7.2; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/champion/raise    type (1..3)
 *   POST /api/:apiVersion/bm/yard/champion/feed     mode = monsters | shiny
 *   POST /api/:apiVersion/bm/yard/champion/evolve
 *   POST /api/:apiVersion/bm/yard/champion/heal
 *   POST /api/:apiVersion/bm/yard/champion/rename   name
 *   POST /api/:apiVersion/bm/yard/champion/stance   type, stance (Mode, #220)
 *   POST /api/:apiVersion/bm/yard/champion/juice
 *   POST /api/:apiVersion/bm/yard/champion/freeze   (Champion Chamber, #125)
 *   POST /api/:apiVersion/bm/yard/champion/thaw     type
 */

const CHAMPION_PATH = "/api/:apiVersion/bm/yard/champion";

export type FeedMode = "monsters" | "shiny";

/** `report` of every champion route: the champion afterwards. */
export interface ChampionReport {
  champion: ChampionSaveEntry;
}

/** `report` of `champion/feed`. */
export interface ChampionFeedReport extends ChampionReport {
  mode: FeedMode;
  eaten: Record<string, number>;
  credits: number;
  evolved: boolean;
}

/** `report` of `champion/evolve` and `/heal`: the Shiny charged. */
export interface ChampionPaidReport extends ChampionReport {
  credits: number;
}

export const championRaise = (
  type: number,
  baseid?: string,
): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(
    `${CHAMPION_PATH}/raise`,
    yardBody({ type: String(type) }, baseid),
  );

export const championFeed = (
  mode: FeedMode,
  baseid?: string,
): Promise<YardResponse<ChampionFeedReport>> =>
  post<YardResponse<ChampionFeedReport>>(`${CHAMPION_PATH}/feed`, yardBody({ mode }, baseid));

export const championEvolve = (baseid?: string): Promise<YardResponse<ChampionPaidReport>> =>
  post<YardResponse<ChampionPaidReport>>(`${CHAMPION_PATH}/evolve`, yardBody({}, baseid));

/** `type` 5 heals Krallen; leave it out for the champion in the cage. */
export const championHeal = (baseid?: string, type?: number): Promise<YardResponse<ChampionPaidReport>> =>
  post<YardResponse<ChampionPaidReport>>(
    `${CHAMPION_PATH}/heal`,
    yardBody(type === undefined ? {} : { type: String(type) }, baseid),
  );

export const championRename = (
  name: string,
  baseid?: string,
): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(`${CHAMPION_PATH}/rename`, yardBody({ name }, baseid));

/**
 * Remembers the Mode a champion attacks in (issue #220), any champion the
 * player keeps, so the army panel opens on it next time.
 */
export const championStance = (
  type: number,
  stance: ChampionStance,
): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(
    `${CHAMPION_PATH}/stance`,
    yardBody({ type: String(type), stance }),
  );

export const championJuice = (baseid?: string): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(`${CHAMPION_PATH}/juice`, yardBody({}, baseid));

export const championFreeze = (baseid?: string, type?: number): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(
    `${CHAMPION_PATH}/freeze`,
    yardBody(type === undefined ? {} : { type: String(type) }, baseid),
  );

export const championThaw = (
  type: number,
  baseid?: string,
): Promise<YardResponse<ChampionReport>> =>
  post<YardResponse<ChampionReport>>(
    `${CHAMPION_PATH}/thaw`,
    yardBody({ type: String(type) }, baseid),
  );

export interface ChampionApi {
  raise: typeof championRaise;
  feed: typeof championFeed;
  evolve: typeof championEvolve;
  heal: typeof championHeal;
  rename: typeof championRename;
  juice: typeof championJuice;
  freeze: typeof championFreeze;
  thaw: typeof championThaw;
}

export const championApi: ChampionApi = {
  raise: championRaise,
  feed: championFeed,
  evolve: championEvolve,
  heal: championHeal,
  rename: championRename,
  juice: championJuice,
  freeze: championFreeze,
  thaw: championThaw,
};

/** The queue keys, for `store.isRunning`. */
export const ChampionKey = {
  raise: actionKey("champion", "raise"),
  feed: (mode: FeedMode): string => actionKey("championFeed", mode),
  evolve: actionKey("champion", "evolve"),
  heal: actionKey("champion", "heal"),
  rename: actionKey("champion", "rename"),
  juice: actionKey("champion", "juice"),
  freeze: actionKey("champion", "freeze"),
  healSpecial: actionKey("champion", "healSpecial"),
  freezeSpecial: actionKey("champion", "freezeSpecial"),
  thaw: (type: number): string => actionKey("championThaw", type),
} as const;

export interface ChampionActions {
  raise(type: number): Promise<YardActionResult<ChampionReport>>;
  feed(mode: FeedMode): Promise<YardActionResult<ChampionFeedReport>>;
  evolve(): Promise<YardActionResult<ChampionPaidReport>>;
  heal(): Promise<YardActionResult<ChampionPaidReport>>;
  rename(name: string): Promise<YardActionResult<ChampionReport>>;
  juice(): Promise<YardActionResult<ChampionReport>>;
  freeze(): Promise<YardActionResult<ChampionReport>>;
  /** Heals Krallen, who stays beside the champion in the cage. */
  healSpecial(): Promise<YardActionResult<ChampionPaidReport>>;
  /** Freezes Krallen into the Chamber. */
  freezeSpecial(): Promise<YardActionResult<ChampionReport>>;
  thaw(type: number): Promise<YardActionResult<ChampionReport>>;
}

const refuse = (reason: string, message: string, detail: Record<string, unknown> = {}): YardRefusal => ({
  reason,
  message,
  detail,
  local: true,
});

/** The champion in the cage as the panel sees it now, or the refusal for its absence. */
const activeOrRefuse = (reader: YardStoreReader) => {
  const cage = cageView(reader.save, reader.now());
  if (cage.kind === "noCage") return refuse("noCage", "Build a Champion Cage first.");
  if (cage.kind === "building") return refuse("busy", "Your Champion Cage is still being built.");
  if (cage.kind !== "active") return refuse("noChampion", "There is no champion in your cage.");
  return cage.view;
};

/** `t` of Krallen, the one special champion. */
const SPECIAL_TYPE = 5;

/** Krallen as the panel sees him now (awake), or the refusal for his absence. */
const specialOrRefuse = (reader: YardStoreReader) => {
  const champion = specialChampion(reader.save);
  const view =
    champion && Number(champion.status ?? 0) === 0 ? championView(reader.save, champion, reader.now()) : null;
  return view ?? refuse("noChampion", "Krallen is not in your yard.");
};

/**
 * The champion routes through `store.run`, so they queue behind any request
 * in flight and re-check, against the state the answer ahead of them left,
 * what the client can see (T4): the champion is there, hungry enough, and the
 * housing holds the recipe. Prices are the server's; the Shiny check is left
 * to it.
 */
export const championActions = (store: YardStore, api: ChampionApi = championApi): ChampionActions => ({
  raise: (type) =>
    store.run({
      key: ChampionKey.raise,
      check: (reader) => {
        const entry = championEntry(type);
        if (!entry?.raisable) return refuse("notRaisable", "That champion cannot be raised at the cage.");
        const cage = cageView(reader.save, reader.now());
        if (cage.kind === "noCage") return refuse("noCage", "Build a Champion Cage first.");
        if (cage.kind === "building") return refuse("busy", "Your Champion Cage is still being built.");
        if (activeChampion(reader.save)) return refuse("championInCage", "Your cage already holds a champion.");
        if (frozenChampions(reader.save).some((one) => Number(one.t) === type)) {
          return refuse("frozen", `Your ${entry.name} is frozen in the Champion Chamber. Thaw it instead.`);
        }
        return null;
      },
      send: (_api, ...yard) => api.raise(type, ...yard),
    }),
  feed: (mode) =>
    store.run({
      key: ChampionKey.feed(mode),
      check: (reader) => {
        const view = activeOrRefuse(reader);
        if ("reason" in view) return view;
        if (mode === "monsters") {
          if (view.hunger === "fed") return refuse("notHungry", `Your ${view.entry.name} is not hungry yet.`);
          const short = view.recipe.find((row) => row.have < row.need);
          if (short) {
            return refuse("notEnough", "You do not have enough of that monster housed.", {
              monster: short.monster,
              have: short.have,
              need: short.need,
            });
          }
          return null;
        }
        return view.feedShiny === null
          ? refuse(
              view.top ? "fullBuff" : "notHungry",
              view.top ? `Your ${view.entry.name} is fully buffed.` : `Your ${view.entry.name} is not hungry yet.`,
            )
          : null;
      },
      send: (_api, ...yard) => api.feed(mode, ...yard),
    }),
  evolve: () =>
    store.run({
      key: ChampionKey.evolve,
      check: (reader) => {
        const view = activeOrRefuse(reader);
        if ("reason" in view) return view;
        return view.top ? refuse("maxLevel", `Your ${view.entry.name} is fully evolved.`) : null;
      },
      send: (_api, ...yard) => api.evolve(...yard),
    }),
  heal: () =>
    store.run({
      key: ChampionKey.heal,
      check: (reader) => {
        const view = activeOrRefuse(reader);
        if ("reason" in view) return view;
        return view.health >= view.maxHealth
          ? refuse("fullHealth", `Your ${view.entry.name} is already at full health.`)
          : null;
      },
      send: (_api, ...yard) => api.heal(...yard),
    }),
  healSpecial: () =>
    store.run({
      key: ChampionKey.healSpecial,
      check: (reader) => {
        const view = specialOrRefuse(reader);
        if ("reason" in view) return view;
        return view.health >= view.maxHealth
          ? refuse("fullHealth", `${view.name} is already at full health.`)
          : null;
      },
      send: (_api, ...yard) => api.heal(yard[0], SPECIAL_TYPE),
    }),
  freezeSpecial: () =>
    store.run({
      key: ChampionKey.freezeSpecial,
      check: (reader) => {
        const view = specialOrRefuse(reader);
        if ("reason" in view) return view;
        const gate = freezeGate(reader.save, view);
        return gate ? refuse("freezeRefused", gate) : null;
      },
      send: (_api, ...yard) => api.freeze(yard[0], SPECIAL_TYPE),
    }),
  rename: (name) =>
    store.run({
      key: ChampionKey.rename,
      check: (reader) => {
        const trimmed = name.trim();
        if (trimmed.length < 1 || trimmed.length > CHAMPION_NAME_MAX) {
          return refuse("badRequest", `A champion's name is 1 to ${CHAMPION_NAME_MAX} characters.`);
        }
        return activeChampion(reader.save) ? null : refuse("noChampion", "There is no champion in your cage.");
      },
      send: (_api, ...yard) => api.rename(name.trim(), ...yard),
    }),
  juice: () =>
    store.run({
      key: ChampionKey.juice,
      check: (reader) => {
        const active = activeChampion(reader.save);
        if (!active || !championView(reader.save, active, reader.now())) {
          return refuse("noChampion", "There is no champion in your cage.");
        }
        const status = juicerStatus(reader.save);
        if (!status.ok) {
          const reason =
            status.problem === "building" || status.problem === "upgrading" ? "busy" : status.problem;
          return refuse(reason, juicerProblemText(status.problem));
        }
        return null;
      },
      send: (_api, ...yard) => api.juice(...yard),
    }),
  freeze: () =>
    store.run({
      key: ChampionKey.freeze,
      check: (reader) => {
        const view = activeOrRefuse(reader);
        if ("reason" in view) return view;
        const gate = freezeGate(reader.save, view);
        return gate ? refuse("freezeRefused", gate) : null;
      },
      send: (_api, ...yard) => api.freeze(...yard),
    }),
  thaw: (type) =>
    store.run({
      key: ChampionKey.thaw(type),
      check: (reader) => {
        const view = chamberView(reader.save, reader.now());
        const gate = thawGate(view, championEntry(type)?.kind === "special");
        if (gate) return refuse("thawRefused", gate);
        if (view.kind === "ready" && !view.frozen.some((one) => one.entry.t === type)) {
          return refuse("notFrozen", "That champion is not in the chamber.");
        }
        return null;
      },
      send: (_api, ...yard) => api.thaw(type, ...yard),
    }),
});
