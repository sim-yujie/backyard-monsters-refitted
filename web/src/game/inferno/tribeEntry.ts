import {
  infernoRefusalOf,
  loadInfernoMap,
  loadInfernoNeighbours,
  playerAttackLoad,
  refusalData,
  startPlayerAttack,
  startTribeAttack,
  tribeAttackLoad,
  type InfernoMapResponse,
  type InfernoNeighboursResponse,
  type PlayerAttackStart,
  type TribeAttackStart,
} from "@/api/inferno";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import type { AttackRoster, AttackTarget, RosterSource, ViewTarget } from "@/game/attack/attackTarget";
import { HOUSING_BUNKER_TYPE } from "@/game/monsters/housing";
import { InfernoMapScreen } from "@/ui/inferno/InfernoMapScreen";
import { confirmPlayerAttack } from "@/ui/inferno/PlayerAttackConfirm";
import { playerAttackPrompt, playerRefusal, playerRows, type PlayerRow } from "./playerMap";
import {
  TRIBE_MAP_FAILED,
  TRIBE_MAP_OFFLINE,
  TRIBE_NO_MONSTERS,
  TRIBE_START_OFFLINE,
  serverNow,
  tribeMapName,
  tribeRefusal,
  tribeRows,
  type TribeRow,
} from "./tribeMap";

/**
 * The Map button on the Inferno yard (WP 2.9, `docs/design/inferno.md` §2.7,
 * §3.2): the Inferno map of Moloch's seven tribes (`MAPROOM_INFERNO.Show`),
 * and Attack on one starting the server's tribe attack (WP 2.8,
 * `POST /bm/inferno/attack/start` kind `tribe`) and the attack scene on it,
 * as the Descent's Attack does (`descentEntry.ts`).
 *
 * Its Players tab (PvP, WP 3.5) lists the other players' Inferno yards
 * (`GET /bm/inferno/neighbours`): View opens one to look at only
 * (`POST /bm/inferno/view`, WP 3.4), and Attack asks first, in Flash's words
 * with the warning that the attack counts once started (owner, 27 Oct), then
 * starts the server's player attack (kind `player`) and the attack scene on it.
 */

export interface TribeEntryDeps {
  readonly modal: HTMLElement;
  /** The own Inferno yard's load, as it stands now. */
  readonly own: () => BaseLoadResponse;
  readonly notice: (message: string) => void;
  readonly openAttack: (target: AttackTarget) => void;
  /** Opens another player's Inferno yard to look at; left out, the map has no Players tab. */
  readonly openView?: (target: ViewTarget) => void;
  readonly api?: {
    readonly map: () => Promise<InfernoMapResponse>;
    readonly start: (baseid: string) => Promise<TribeAttackStart>;
    readonly neighbours?: () => Promise<InfernoNeighboursResponse>;
    readonly startPlayer?: (baseid: string) => Promise<PlayerAttackStart>;
  };
  /** The question before a player attack; the dialog by default. */
  readonly confirm?: (container: HTMLElement, name: string, text: string) => Promise<boolean>;
  /** The clock, ms; `Date.now` by default. */
  readonly nowMs?: () => number;
}

/** Whether the Inferno yard's Housing Bunkers hold any monster (`PlayerHandler.as:239`, `_housingUsed > 0`). */
export const housesMonsters = (save: Pick<BaseLoadResponse, "monsters">): boolean => {
  const housed = (save.monsters as { housed?: unknown } | null | undefined)?.housed;
  if (typeof housed !== "object" || housed === null) return false;
  return Object.values(housed as Record<string, unknown>).some((count) => typeof count === "number" && count > 0);
};

/**
 * The level of the Inferno yard's best finished Housing Bunker, which stands
 * in for the Flinger in a tribe attack (`GLOBAL.as:836-838`, `_attackersFlinger
 * = _bHousing._lvl`), as the server's `infernoTribeFlingCapacity` reads it:
 * one still being built counts for none. 0 with none.
 */
export const housingBunkerLevel = (save: Pick<BaseLoadResponse, "buildingdata">): number => {
  let best = 0;
  for (const building of Object.values(save.buildingdata ?? {})) {
    const row = building as { t?: unknown; l?: unknown; cB?: unknown } | null;
    if (Number(row?.t) !== HOUSING_BUNKER_TYPE) continue;
    if (typeof row?.cB === "number" && row.cB > 0) continue;
    const level = Number(row?.l);
    best = Math.max(best, Number.isFinite(level) && level > 0 ? level : 1);
  }
  return best;
};

/**
 * What a tribe attack is fought with (`controllers/inferno/tribeAttack.ts`):
 * the Inferno yard's Housing Bunker monsters, as the start counted them, at
 * its Infernal Academy's levels; no champion, catapult or siege
 * (`UI_TOP.as:289`, `:296`). The Inferno yard's housing is the source the
 * save sends back. Its loot goes to the Inferno purse, so no storage cap,
 * and the purse is the pool the attack's HUD shows (WP 2.10). One fling carries what the server says a Housing Bunker holds (R11,
 * `flingercapacity`, Declare War's quarter included), and the Housing
 * Bunker's level is the Flinger's.
 */
export const tribeRoster = (
  start: Pick<TribeAttackStart, "army" | "armybaseid" | "attackeracademy" | "flingercapacity">,
  save: Pick<BaseLoadResponse, "monsters" | "buildingdata" | "resources" | "credits">,
): AttackRoster => {
  const monsters: Record<string, number> = {};
  for (const [id, count] of Object.entries(start.army ?? {})) {
    if (typeof count === "number" && count > 0) monsters[id] = count;
  }
  const m = save.monsters;
  const sources: RosterSource[] =
    typeof m === "object" && m !== null ? [{ baseid: String(start.armybaseid), m: m as RosterSource["m"] }] : [];
  return {
    monsters,
    levels: { ...(start.attackeracademy ?? {}) },
    champions: [],
    flingerLevel: housingBunkerLevel(save),
    flingCapacity: Math.max(0, Math.floor(Number(start.flingercapacity) || 0)),
    catapultLevel: 0,
    sources,
    siege: null,
    // The Inferno yard's load carries the purse as its resources (`infernoPurse`).
    resources: save.resources ?? null,
    storageCap: null,
    ...(typeof save.credits === "number" ? { credits: save.credits } : {}),
  };
};

/** The attack scene's target for a started tribe attack. */
export const tribeTarget = (start: TribeAttackStart, baseid: string, roster: AttackRoster): AttackTarget => ({
  baseid,
  kind: "wild",
  name: tribeMapName(),
  roster,
  load: tribeAttackLoad(start),
  infernoTribe: true,
});

/**
 * The attack scene's target for a started player attack (WP 3.5): fought as
 * an Inferno yard with the tribe's roster rule, its load carrying the yard's
 * `basesaveid`, so its checkpoints reach the server.
 */
export const playerTarget = (start: PlayerAttackStart, row: PlayerRow, roster: AttackRoster): AttackTarget => ({
  baseid: row.baseid,
  kind: "main",
  name: start.ownername || row.name,
  owner: row.userid,
  roster,
  load: playerAttackLoad(start),
  infernoPlayer: true,
});

/** View on a player: their Inferno yard, to look at only, with the own purse on the HUD. */
export const playerViewTarget = (row: PlayerRow, own: Pick<BaseLoadResponse, "resources" | "credits">): ViewTarget => ({
  baseid: row.baseid,
  kind: "main",
  name: row.name,
  inferno: true,
  attack: null,
  refusal: null,
  own: { resources: own.resources ?? null, credits: own.credits },
});

export const PLAYERS_FAILED = "The players could not be loaded. Try again in a moment.";
export const PLAYERS_OFFLINE = "Could not reach the server to load the players. Check your connection.";

/** Opens the Inferno map. Resolves with its screen once the first answer is drawn, or says on it why not. */
export const openInfernoMap = async (deps: TribeEntryDeps): Promise<InfernoMapScreen> => {
  const api = {
    map: loadInfernoMap,
    start: startTribeAttack,
    neighbours: loadInfernoNeighbours,
    startPlayer: startPlayerAttack,
    ...deps.api,
  };
  const confirm = deps.confirm ?? confirmPlayerAttack;
  const openView = deps.openView;
  const nowMs = deps.nowMs ?? Date.now;
  let clock = { currenttime: Math.floor(nowMs() / 1000), receivedAt: nowMs() };
  const now = (): number => serverNow(clock.currenttime, clock.receivedAt, nowMs());

  let loading = false;
  const load = async (screen: InfernoMapScreen): Promise<void> => {
    if (loading) return;
    loading = true;
    try {
      const answer = await api.map();
      clock = { currenttime: answer.currenttime, receivedAt: nowMs() };
      screen.setData(tribeRows(answer, now()));
    } catch (caught) {
      screen.setStatus(caught instanceof NetworkError ? TRIBE_MAP_OFFLINE : TRIBE_MAP_FAILED);
    } finally {
      loading = false;
    }
  };

  const attack = async (row: TribeRow): Promise<void> => {
    // Flash: Attack with nothing housed says so and goes nowhere (`PlayerHandler.as:300-310`).
    if (!housesMonsters(deps.own())) {
      deps.notice(TRIBE_NO_MONSTERS);
      screen.enableAttack();
      return;
    }
    let start: TribeAttackStart;
    try {
      start = await api.start(row.baseid);
    } catch (caught) {
      if (caught instanceof NetworkError) {
        deps.notice(TRIBE_START_OFFLINE);
      } else {
        const respawnAt = caught instanceof ApiError ? Number(refusalData(caught)["respawnAt"]) || null : null;
        const refusal = tribeRefusal(infernoRefusalOf(caught), respawnAt, now());
        deps.notice(refusal.text);
        if (refusal.refresh) await load(screen);
      }
      screen.enableAttack();
      return;
    }
    screen.close();
    deps.openAttack(tribeTarget(start, row.baseid, tribeRoster(start, deps.own())));
  };

  let loadingPlayers = false;
  const loadPlayers = async (screen: InfernoMapScreen): Promise<void> => {
    if (loadingPlayers) return;
    loadingPlayers = true;
    try {
      const answer = await api.neighbours();
      screen.setPlayers(playerRows(answer));
    } catch (caught) {
      screen.setPlayersStatus(caught instanceof NetworkError ? PLAYERS_OFFLINE : PLAYERS_FAILED);
    } finally {
      loadingPlayers = false;
    }
  };

  /** Flash's `PlayerHandler.onAttack`: nothing housed, a refusal or a No goes nowhere. */
  const attackPlayer = async (row: PlayerRow): Promise<void> => {
    const own = deps.own();
    if (!housesMonsters(own)) {
      deps.notice(TRIBE_NO_MONSTERS);
      screen.enableAttack();
      return;
    }
    const prompt = playerAttackPrompt(row, Number(own.protected) || 0, now());
    if (prompt.kind === "refuse") {
      deps.notice(prompt.text);
      screen.enableAttack();
      return;
    }
    if (!(await confirm(deps.modal, row.name, prompt.text))) {
      screen.enableAttack();
      return;
    }
    let start: PlayerAttackStart;
    try {
      start = await api.startPlayer(row.baseid);
    } catch (caught) {
      if (caught instanceof NetworkError) {
        deps.notice(TRIBE_START_OFFLINE);
      } else {
        const refusal = playerRefusal(
          infernoRefusalOf(caught),
          caught instanceof ApiError ? refusalData(caught) : {},
          row.name,
        );
        deps.notice(refusal.text);
        if (refusal.refresh) await loadPlayers(screen);
      }
      screen.enableAttack();
      return;
    }
    screen.close();
    deps.openAttack(playerTarget(start, row, tribeRoster(start, deps.own())));
  };

  const screen: InfernoMapScreen = new InfernoMapScreen(deps.modal, {
    attack,
    refresh: () => void load(screen),
    now,
    ...(openView
      ? {
          players: {
            attack: attackPlayer,
            view: (row: PlayerRow) => {
              screen.close();
              openView(playerViewTarget(row, deps.own()));
            },
          },
        }
      : {}),
  });
  await Promise.all([load(screen), ...(openView ? [loadPlayers(screen)] : [])]);
  return screen;
};
