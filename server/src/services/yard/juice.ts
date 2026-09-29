import { hatchCost, monsterEntry } from "../../game-data/monsterCatalogue.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { yardKindOf, type ResourceAmounts } from "../yardplanner/costs.js";
import type { StorageCapSave } from "../base/economy/resourceBudget.js";
import { fitCredit } from "./credit.js";
import { academyLevels, isMapRoom3Monsters } from "./hatchery.js";
import { levelOf, monsterIdOf, readHoused } from "./production.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The Monster Juicer: `POST /bm/yard/juice` and the goo rule the bunker's
 * remove shares (`docs/design/yard-buildings.md` §7.3, decision D10; issue #122).
 *
 * **Rate, from the Flash code.** One monster juices into
 * `ceil(cResource × rate)` goo, `cResource` being its hatch cost at its
 * academy level and `rate` 0.6 at Juicer level 1, 0.8 at level 2 and 1.0 at
 * level 3 (`client/scripts/BUILDING9.as:54-67`; the housing popup previews the
 * same figure per monster, `client/scripts/HOUSINGPOPUP.as:254-268`). The
 * original also multiplied by the creep's health fraction, but a housed or
 * bunkered Map Room 2 monster is always at full health, so it is 1 here. The
 * credit went through `BASE.Fund` without the force flag, so it is clamped to
 * the goo cap: the wrapper's `credit` does that (T3), and the report says what
 * the cap swallowed.
 *
 * **When it works.** The Juicer must be built (`GLOBAL._bJuicer` is only set
 * once `Constructed`, `BUILDING9.as:140-145`, `:194-199`), not upgrading, and
 * above half health (`HOUSINGPOPUP.as:311-323`, `MONSTERBUNKERPOPUP.as:702-704`).
 * Inferno monsters are refused (`HOUSINGPOPUP.as:307-310`); a Map Room 2 yard
 * only houses `C` ids anyway.
 *
 * Pure: the wrapper hands in the caught-up save, this returns what changes.
 */

/** Monster Juicer type id (`client/scripts/BUILDING9.as:13`). */
export const JUICER_TYPE = 9;

/** Goo per unit of hatch cost, by Juicer level 1..3 (`BUILDING9.as:56-62`). */
export const JUICER_RATES: readonly number[] = [0.6, 0.8, 1];

/** The most one request may juice: far above any housing. */
export const MAX_JUICE = 100_000;

/** The slice of a save the Juicer reads. */
export interface JuiceSave extends StorageCapSave {
  /** `BaseType`: an outpost's Juicer reads the outpost health ladder. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  monsters?: JsonObject | null;
  academy?: JsonObject | null;
}

/** A Juicer that can juice right now. */
export interface WorkingJuicer {
  id: number;
  level: number;
  /** Goo per unit of hatch cost. */
  rate: number;
}

/** Why no Juicer can juice right now. */
export type JuicerProblem = "noJuicer" | "building" | "upgrading" | "damaged";

/** The Juicer's rate at a level, clamped to the table. */
export const juicerRate = (level: number): number =>
  JUICER_RATES[Math.max(1, Math.min(Math.floor(level) || 1, JUICER_RATES.length)) - 1]!;

/** A finite number off a jsonb field, 0 otherwise. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** Every Juicer on the yard with its id, lowest id first. */
const juicers = (save: JuiceSave): [number, BuildingData][] =>
  Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === JUICER_TYPE)
    .map(([key, building]): [number, BuildingData] => [Number(building.id ?? key), building])
    .filter(([id]) => Number.isFinite(id))
    .sort(([a], [b]) => a - b);

/** Why one Juicer cannot juice, or null when it can. */
const problemOf = (save: JuiceSave, id: number, building: BuildingData): JuicerProblem | null => {
  if (numberOf(building.cB) > 0) return "building";
  if (numberOf(building.cU) > 0) return "upgrading";
  const level = Math.max(1, Math.floor(numberOf(building.l)) || 1);
  const raw = save.buildinghealthdata?.[String(id)] ?? building.hp;
  const half = maxHp(JUICER_TYPE, level, yardKindOf(save)) * 0.5;
  if (raw !== undefined && raw !== null && Number(raw) <= half) {
    return "damaged";
  }
  return null;
};

/**
 * The Juicer that can juice now, or why none can. With more than one (the
 * original allowed one, `GLOBAL._bJuicer`), a working one wins, the highest
 * level first; with none working, the first one's problem is the answer.
 */
export const juicerStatus = (
  save: JuiceSave
): { juicer: WorkingJuicer; problem: null } | { juicer: null; problem: JuicerProblem } => {
  const all = juicers(save);
  if (all.length === 0) return { juicer: null, problem: "noJuicer" };

  let best: WorkingJuicer | null = null;
  for (const [id, building] of all) {
    if (problemOf(save, id, building) !== null) continue;
    const level = Math.max(1, Math.floor(numberOf(building.l)) || 1);
    if (!best || level > best.level) best = { id, level, rate: juicerRate(level) };
  }
  if (best) return { juicer: best, problem: null };
  const [id, building] = all[0]!;
  return { juicer: null, problem: problemOf(save, id, building)! };
};

/** The Juicer that can juice now, or null (the bunker then deletes instead). */
export const workingJuicer = (save: JuiceSave): WorkingJuicer | null => juicerStatus(save).juicer;

/** The refusal for a {@link JuicerProblem}. */
export const juicerErr = (problem: JuicerProblem) => {
  switch (problem) {
    case "noJuicer":
      return yardRefusedErr("noJuicer", "Build a Monster Juicer first.");
    case "building":
      return yardRefusedErr("busy", "Your Monster Juicer is still being built.");
    case "upgrading":
      return yardRefusedErr("busy", "Your Monster Juicer is being upgraded. Try again when it is done.");
    case "damaged":
      return yardRefusedErr("damaged", "Your Monster Juicer is too damaged to work. Repair it first.");
  }
};

/**
 * Goo `count` of `monster` juice into at `rate`: `ceil(cResource × rate)`
 * each, `cResource` at the monster's academy level.
 */
export const juiceGoo = (
  monster: string,
  count: number,
  levels: Readonly<Record<string, number>>,
  rate: number
): number => Math.ceil((hatchCost(monster, levelOf(levels, monster)) ?? 0) * rate) * count;

/**
 * A `C` id the catalogue knows, legacy rename applied; `409 inferno` for an
 * Inferno monster, `400 badRequest` for anything else.
 */
export const juiceableOrThrow = (raw: string): string => {
  if (/^IC\d+$/.test(raw)) {
    throw yardRefusedErr("inferno", "Inferno monsters cannot be juiced.", { monster: raw });
  }
  const id = /^C\d+$/.test(raw) ? monsterIdOf(raw) : null;
  if (!id || !monsterEntry(id)) {
    throw yardBadRequestErr("That is not a monster you can juice.", { monster: raw });
  }
  return id;
};

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
 * `POST /bm/yard/juice`: juices housed monsters for goo.
 *
 * Refusals, in order: `409 mapRoom3`; `409 inferno` / `400 badRequest` per id;
 * the Juicer's (`409 noJuicer`, `409 busy`, `409 damaged`); `409 notEnough
 * { monster, have, need }` when housing holds fewer than asked.
 *
 * @param save - The caught-up yard.
 * @param monsters - How many of each to juice (whole, at least 1 each).
 */
export const planJuice = (save: JuiceSave, monsters: Readonly<Record<string, number>>) => {
  if (isMapRoom3Monsters(save.monsters)) {
    throw yardRefusedErr("mapRoom3", "Juicing on a Map Room 3 yard is not supported yet.");
  }

  const wanted: Record<string, number> = {};
  for (const [raw, count] of Object.entries(monsters)) {
    const id = juiceableOrThrow(raw);
    wanted[id] = (wanted[id] ?? 0) + Math.floor(count);
  }
  if (Object.keys(wanted).length === 0) {
    throw yardBadRequestErr("Pick at least one monster to juice.");
  }

  const status = juicerStatus(save);
  if (!status.juicer) throw juicerErr(status.problem);
  const { rate } = status.juicer;

  const housed = readHoused(save.monsters);
  for (const [id, need] of Object.entries(wanted)) {
    const have = housed[id] ?? 0;
    if (need > have) {
      throw yardRefusedErr("notEnough", "You do not have that many of that monster housed.", {
        monster: id,
        have,
        need,
      });
    }
  }

  const levels = academyLevels(save.academy);
  let goo = 0;
  for (const [id, count] of Object.entries(wanted)) {
    goo += juiceGoo(id, count, levels, rate);
    housed[id] = housed[id]! - count;
    if (housed[id] === 0) delete housed[id];
  }

  const credit: Partial<ResourceAmounts> = { r4: goo };
  const fit = fitCredit(save, credit);
  const report: JuiceReport = {
    juiced: wanted,
    goo: fit.credited.r4,
    lost: fit.overflow.r4,
    rate,
  };
  return {
    report,
    slices: { monsters: { ...(save.monsters ?? {}), housed } },
    credit,
  };
};
