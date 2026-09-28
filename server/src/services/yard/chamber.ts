import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { isDamaged } from "./buildingJobs.js";
import {
  activeChampionIndex,
  buildingOfType,
  cageOrThrow,
  CHAMPION_CHAMBER_TYPE,
  CHAMPION_STATUS,
  entryOf,
  isHungry,
  maxHealthOf,
  readChampions,
  statusOf,
  type ChampionSave,
} from "./champion.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * The Champion Chamber: `POST /bm/yard/champion/freeze` and `/thaw`
 * (`docs/design/yard-buildings.md` §7.2, issue #125;
 * `docs/specs/monsters-and-hatchery.md` §7.6).
 *
 * The chamber is cold storage, so the player can raise another champion
 * without losing the one they have.
 *
 * **Freeze** (`CHAMPIONCHAMBER.FreezeGuardian`, `client/scripts/CHAMPIONCHAMBER.as:103-141`):
 * the champion in the cage goes into the chamber. Refused while it is below
 * full health (`bdg_chamber_injured`) or hungry (`bdg_chamber_hungry`). Its
 * feed time becomes relative (`ft − now`, `:127`), so the clock stops while it
 * sleeps, and its status becomes 1. A frozen champion does not heal, starve
 * or defend (`catchUpChampions.ts` skips it).
 *
 * **Thaw** (`ThawGuardian`, `:143-221`): a frozen champion goes back to the
 * cage, `ft + now`, status 0. Refused while the chamber is damaged
 * (`bdg_chamber_damaged`) or a champion is in the cage
 * (`bdg_chamber_freeze`).
 *
 * **Storage** is unchanged from the original: the `champion` list is the
 * truth, and the chamber's own `fz` keeps a JSON string of the frozen
 * entries (`Export`, `:313-378`), written on every freeze and thaw so the two
 * agree. Nothing costs anything.
 *
 * Pure: the wrapper hands in the caught-up save and writes.
 */

/** The finished chamber: `409 noChamber` without one, `409 busy` while it is being built. */
const chamberOrThrow = (save: ChampionSave): { key: string; building: BuildingData } => {
  const chamber = buildingOfType(save, CHAMPION_CHAMBER_TYPE);
  if (!chamber) throw yardRefusedErr("noChamber", "Build a Champion Chamber first.");
  if (Number(chamber.building.cB) > 0) {
    throw yardRefusedErr("busy", "Your Champion Chamber is still being built.", {
      id: chamber.building.id,
    });
  }
  return chamber;
};

/**
 * The chamber's `fz`: every frozen champion in the shape the original
 * exported (`CHAMPIONCHAMBER.as:329-372`), as a JSON string.
 */
export const frozenBlob = (champions: readonly ChampionData[]): string =>
  JSON.stringify(
    champions
      .filter((champion) => statusOf(champion) === CHAMPION_STATUS.FROZEN)
      .map((champion) => ({
        ...(champion.nm ? { nm: champion.nm } : {}),
        t: champion.t,
        hp: Number(champion.hp) || 0,
        l: champion.l,
        ft: champion.ft,
        fd: Number(champion.fd) || 0,
        fb: Number(champion.fb) || 0,
        pl: Number(champion.pl) || 0,
        status: CHAMPION_STATUS.FROZEN,
      }))
  );

/** `buildingdata` with the chamber's `fz` rewritten from `champions`. */
const withBlob = (
  save: ChampionSave,
  key: string,
  building: BuildingData,
  champions: readonly ChampionData[]
): BuildingDataMap => ({
  ...(save.buildingdata ?? {}),
  [key]: { ...building, fz: frozenBlob(champions) },
});

/** `report` of `champion/freeze` and `/thaw`: the champion moved. */
export interface ChamberReport {
  champion: ChampionData;
}

/**
 * `POST /bm/yard/champion/freeze`: the champion in the cage into the chamber.
 *
 * Refusals, in order: `409 noChamber` / `409 busy`; `409 noChampion`;
 * `409 injured { hp, max }`; `409 hungry { feedTime }`.
 */
export const planChampionFreeze = (save: ChampionSave, now: number) => {
  const { key, building } = chamberOrThrow(save);
  const champions = readChampions(save.champion);
  const index = activeChampionIndex(champions);
  if (index < 0) throw yardRefusedErr("noChampion", "There is no champion in your cage.");
  const champion = champions[index]!;
  const entry = entryOf(champion)!;

  const max = maxHealthOf(champion, entry);
  if (Number(champion.hp) < max) {
    throw yardRefusedErr("injured", `Your ${entry.name} is injured. Heal it before you freeze it.`, {
      hp: Number(champion.hp) || 0,
      max,
    });
  }
  if (isHungry(champion, now)) {
    throw yardRefusedErr("hungry", `Your ${entry.name} is hungry. Feed it before you freeze it.`, {
      feedTime: Number(champion.ft) || 0,
    });
  }

  const frozen: ChampionData = {
    ...champion,
    ft: (Number(champion.ft) || 0) - now,
    status: CHAMPION_STATUS.FROZEN,
  };
  champions[index] = frozen;

  const report: ChamberReport = { champion: frozen };
  return {
    report,
    slices: { champion: champions, buildingdata: withBlob(save, key, building, champions) },
  };
};

/**
 * `POST /bm/yard/champion/thaw`: a frozen champion back into the cage.
 *
 * Refusals, in order: `409 noChamber` / `409 busy`; `409 damaged { id }` (the
 * chamber); `409 noCage` / `409 busy` (the cage); `409 championInCage`;
 * `409 notFrozen { type }`.
 *
 * @param type - Champion type 1..5.
 */
export const planChampionThaw = (save: ChampionSave, type: number, now: number) => {
  const { key, building } = chamberOrThrow(save);
  if (isDamaged(building, save.buildinghealthdata)) {
    throw yardRefusedErr("damaged", "Your Champion Chamber is damaged. Repair it before you thaw a champion.", {
      id: building.id,
    });
  }
  cageOrThrow(save);

  const champions = readChampions(save.champion);
  if (activeChampionIndex(champions) >= 0) {
    throw yardRefusedErr("championInCage", "Freeze the champion in your cage before you thaw another.");
  }
  const index = champions.findIndex(
    (champion) =>
      Math.trunc(Number(champion.t)) === type &&
      statusOf(champion) === CHAMPION_STATUS.FROZEN &&
      entryOf(champion) !== undefined
  );
  if (index < 0) throw yardRefusedErr("notFrozen", "That champion is not in the chamber.", { type });

  const champion = champions[index]!;
  const thawed: ChampionData = {
    ...champion,
    ft: (Number(champion.ft) || 0) + now,
    status: CHAMPION_STATUS.ACTIVE,
  };
  champions[index] = thawed;

  const report: ChamberReport = { champion: thawed };
  return {
    report,
    slices: { champion: champions, buildingdata: withBlob(save, key, building, champions) },
  };
};
