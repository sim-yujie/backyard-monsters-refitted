import {
  infernoRefusalOf,
  loadInfernoMap,
  refusalData,
  startTribeAttack,
  tribeAttackLoad,
  type InfernoMapResponse,
  type TribeAttackStart,
} from "@/api/inferno";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import type { AttackRoster, AttackTarget, RosterSource } from "@/game/attack/attackTarget";
import { InfernoMapScreen } from "@/ui/inferno/InfernoMapScreen";
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
 */

export interface TribeEntryDeps {
  readonly modal: HTMLElement;
  /** The own Inferno yard's load, as it stands now. */
  readonly own: () => BaseLoadResponse;
  readonly notice: (message: string) => void;
  readonly openAttack: (target: AttackTarget) => void;
  readonly api?: {
    readonly map: () => Promise<InfernoMapResponse>;
    readonly start: (baseid: string) => Promise<TribeAttackStart>;
  };
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
 * What a tribe attack is fought with (`controllers/inferno/tribeAttack.ts`):
 * the Inferno yard's Housing Bunker monsters, as the start counted them, at
 * its Infernal Academy's levels; no champion, catapult or siege
 * (`UI_TOP.as:289`, `:296`). The Inferno yard's housing is the source the
 * save sends back. Its loot goes to the Inferno purse, so no storage cap.
 */
export const tribeRoster = (start: TribeAttackStart, save: Pick<BaseLoadResponse, "monsters">): AttackRoster => {
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
    flingerLevel: 1,
    catapultLevel: 0,
    sources,
    siege: null,
    resources: null,
    storageCap: null,
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

/** Opens the Inferno map. Resolves with its screen once the first answer is drawn, or says on it why not. */
export const openInfernoMap = async (deps: TribeEntryDeps): Promise<InfernoMapScreen> => {
  const api = deps.api ?? { map: loadInfernoMap, start: startTribeAttack };
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

  const screen: InfernoMapScreen = new InfernoMapScreen(deps.modal, {
    attack,
    refresh: () => void load(screen),
    now,
  });
  await load(screen);
  return screen;
};
