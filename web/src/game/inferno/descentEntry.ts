import {
  descentAttackLoad,
  loadInfernoState,
  startDescentAttack,
  type DescentAttackStart,
  type InfernoState,
} from "@/api/inferno";
import { NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { hasAnythingToSend, mainYardRoster } from "@/game/attack/attackEntry";
import type { AttackRoster, AttackTarget } from "@/game/attack/attackTarget";
import { FLINGER_TYPE } from "@/game/maproom1/mr1Model";
import type { Yard } from "@/game/yard/yardModel";
import { descentMap, enableDescentAttack } from "@/ui/inferno/DescentScreens";
import type { Popup } from "@/ui/Popup";
import {
  DESCENT_START_FAILED,
  DESCENT_START_OFFLINE,
  DESCENT_STATE_FAILED,
  NO_MONSTERS,
  descentBaseid,
} from "./descentText";

/**
 * Enter Cavern before the Descent is won (WP 1.13, `docs/design/inferno.md`
 * §2.4): Flash's Descent map (`MAPROOM_DESCENT.Setup` / `Show`), and Attack
 * on its next yard starting the server's Descent attack (WP 1.11) and the
 * attack scene on it. Once the Descent is passed, Enter Cavern goes down to
 * the Inferno yard instead (`DescentDataLoaded`, `INFERNOPORTAL.ToggleYard`).
 */

/** Moloch, the Descent's tribe (`ai_descenttribe_name`). */
export const MOLOCH_NAME = "Moloch";

export interface DescentEntryDeps {
  readonly modal: HTMLElement;
  /** The own main yard's load and its drawn yard, as they stand now. */
  readonly own: () => { readonly save: BaseLoadResponse; readonly yard: Yard };
  readonly notice: (message: string) => void;
  /** Down to the Inferno yard: the Descent is won. */
  readonly openInferno: () => void;
  readonly openAttack: (target: AttackTarget) => void;
  readonly api?: {
    readonly state: () => Promise<InfernoState>;
    readonly start: (baseid: string) => Promise<DescentAttackStart>;
  };
}

/**
 * The Flinger level the Descent's flings are capped at: the main yard's
 * Flinger, built, at its level (the server's `flingerLevelOf`, which sets
 * `flingercapacity` the same way). 0 with none.
 */
export const descentFlingerLevel = (yard: Yard): number =>
  yard.buildings.reduce((best, one) => (one.type === FLINGER_TYPE && one.level > best ? one.level : best), 0);

/**
 * What the Descent is fought with: the main yard's housing and champions
 * alone (`ATTACK.as:589-591`), and no storage cap on what it brings back, the
 * Descent's loot going into the Inferno purse uncapped (Flash).
 */
export const descentRoster = (save: BaseLoadResponse, yard: Yard): AttackRoster => ({
  ...mainYardRoster(save, descentFlingerLevel(yard)),
  storageCap: null,
});

/**
 * The attack scene's target for a started Descent attack. One fling carries
 * what the server's Descent flinger does (`flingercapacity`, Flash's
 * `YARD_PROPS` table, `ATTACK.as:588-591`), which its replay cuts every
 * fling to (`descentFightableLog`), not the Map Room 2 flinger's 2,250.
 */
export const descentTarget = (start: DescentAttackStart, baseid: string, roster: AttackRoster): AttackTarget => ({
  baseid,
  kind: "wild",
  name: MOLOCH_NAME,
  roster: { ...roster, flingCapacity: Math.max(0, Math.floor(Number(start.flingercapacity) || 0)) },
  load: descentAttackLoad(start),
  descentYard: start.descentyard,
});

/** Opens the way down: the Descent map, or the Inferno yard once it is won. Resolves with the map, if one opened. */
export const enterDescent = async (deps: DescentEntryDeps): Promise<Popup | null> => {
  const api = deps.api ?? { state: loadInfernoState, start: startDescentAttack };
  let state: InfernoState;
  try {
    state = await api.state();
  } catch {
    deps.notice(DESCENT_STATE_FAILED);
    return null;
  }
  if (state.descent.passed || state.hasYard) {
    deps.openInferno();
    return null;
  }

  let map: Popup | null = null;
  const attack = async (yard: number): Promise<void> => {
    const own = deps.own();
    const roster = descentRoster(own.save, own.yard);
    // Flash: Attack with nothing housed and no champion says so and goes nowhere.
    if (!hasAnythingToSend(roster)) {
      deps.notice(NO_MONSTERS);
      if (map) enableDescentAttack(map);
      return;
    }
    const baseid = descentBaseid(yard);
    let start: DescentAttackStart;
    try {
      start = await api.start(baseid);
    } catch (caught) {
      deps.notice(caught instanceof NetworkError ? DESCENT_START_OFFLINE : DESCENT_START_FAILED);
      if (map) enableDescentAttack(map);
      return;
    }
    map?.close();
    deps.openAttack(descentTarget(start, baseid, roster));
  };
  map = descentMap(deps.modal, state.descent, { attack });
  return map;
};
