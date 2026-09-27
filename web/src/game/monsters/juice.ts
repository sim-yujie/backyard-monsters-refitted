import type { BaseLoadResponse, ResourceCaps, Resources } from "@/api/types";
import { maxHp } from "@/game/combat/rules";
import { academyLevel } from "./housing";
import { hatchCost } from "./monsterCatalogue";

/**
 * The Monster Juicer on the client (`docs/design/yard-buildings.md` §7.3,
 * decision D10): whether it works, its rate, and what a selection juices into.
 *
 * The same rule the server applies (`server/src/services/yard/juice.ts`):
 * `ceil(cResource × rate)` goo per monster, `cResource` its hatch cost at its
 * academy level, `rate` 0.6 / 0.8 / 1.0 at Juicer level 1 / 2 / 3
 * (`client/scripts/BUILDING9.as:54-67`). It works once built, while not
 * upgrading and above half health (`client/scripts/HOUSINGPOPUP.as:311-323`).
 * The goo is clamped to the cap the way every credit is, so the preview says
 * what the cap would swallow. The route charges its own figure; this is for
 * the labels.
 */

/** Monster Juicer type id (`client/scripts/BUILDING9.as:13`). */
export const JUICER_TYPE = 9;

/** Goo per unit of hatch cost, by Juicer level 1..3. */
export const JUICER_RATES: readonly number[] = [0.6, 0.8, 1];

/** Why no Juicer can juice right now: the server's refusals. */
export type JuicerProblem = "noJuicer" | "building" | "upgrading" | "damaged";

export type JuicerStatus =
  | { readonly ok: true; readonly id: number; readonly level: number; readonly rate: number }
  | { readonly ok: false; readonly problem: JuicerProblem; readonly id: number | null };

/** The rate at a Juicer level, clamped to the table. */
export const juicerRate = (level: number): number =>
  JUICER_RATES[Math.max(1, Math.min(Math.floor(level) || 1, JUICER_RATES.length)) - 1]!;

const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The Juicer that works now, or why none does. With more than one, a working
 * one wins, the highest level first; with none working, the first one's
 * problem is the answer (as the server picks).
 */
export const juicerStatus = (save: BaseLoadResponse): JuicerStatus => {
  const juicers = Object.entries(save.buildingdata ?? {})
    .filter(([, building]) => Number(building?.t) === JUICER_TYPE)
    .map(([key, building]) => ({ id: Number(building.id ?? key), building }))
    .filter(({ id }) => Number.isFinite(id))
    .sort((a, b) => a.id - b.id);
  if (juicers.length === 0) return { ok: false, problem: "noJuicer", id: null };

  const problemOf = (id: number, building: (typeof juicers)[number]["building"]): JuicerProblem | null => {
    if (numberOf(building.cB) > 0) return "building";
    if (numberOf(building.cU) > 0) return "upgrading";
    const level = Math.max(1, Math.floor(numberOf(building.l)) || 1);
    const raw = save.buildinghealthdata?.[String(id)] ?? building.hp;
    if (raw !== undefined && raw !== null && Number(raw) <= maxHp(JUICER_TYPE, level) * 0.5) {
      return "damaged";
    }
    return null;
  };

  let best: JuicerStatus | null = null;
  for (const { id, building } of juicers) {
    if (problemOf(id, building) !== null) continue;
    const level = Math.max(1, Math.floor(numberOf(building.l)) || 1);
    if (!best || (best.ok && level > best.level)) best = { ok: true, id, level, rate: juicerRate(level) };
  }
  if (best) return best;
  const first = juicers[0]!;
  return { ok: false, problem: problemOf(first.id, first.building)!, id: first.id };
};

/** A sentence for a {@link JuicerProblem}. */
export const juicerProblemText = (problem: JuicerProblem): string => {
  switch (problem) {
    case "noJuicer":
      return "Build a Monster Juicer to turn monsters back into goo.";
    case "building":
      return "Your Monster Juicer is still being built.";
    case "upgrading":
      return "Your Monster Juicer is being upgraded. It juices again when the upgrade is done.";
    case "damaged":
      return "Your Monster Juicer is too damaged to work. Repair it first.";
  }
};

/** Goo `count` of `monster` juice into at `rate`, at the monster's academy level. */
export const juiceGoo = (save: BaseLoadResponse, monster: string, count: number, rate: number): number =>
  Math.ceil((hatchCost(monster, academyLevel(save.academy, monster)) ?? 0) * rate) * count;

/** What a selection would come to. */
export interface JuicePreview {
  /** Monsters in the selection. */
  readonly count: number;
  /** Goo before the cap. */
  readonly goo: number;
  /** Goo that would land. */
  readonly credited: number;
  /** Goo the cap would swallow. */
  readonly lost: number;
}

/**
 * What juicing `selection` would give at `rate`, clamped to the goo cap the
 * way the server clamps it (a pool already over the cap takes nothing).
 */
export const juicePreview = (
  save: BaseLoadResponse,
  selection: Readonly<Record<string, number>>,
  rate: number,
  resources: Resources,
  caps: ResourceCaps | null,
): JuicePreview => {
  let count = 0;
  let goo = 0;
  for (const [id, n] of Object.entries(selection)) {
    if (!(n > 0)) continue;
    count += n;
    goo += juiceGoo(save, id, n, rate);
  }
  const have = numberOf(resources.r4);
  const cap = caps?.r4;
  const credited = typeof cap === "number" ? Math.max(have, Math.min(have + goo, cap)) - have : goo;
  return { count, goo, credited, lost: goo - credited };
};
