import { neighbourDefenceBonus, parseDefenderForces } from "@/game/combat/rules";

/**
 * Map Room 2's neighbour defence bonus as the player sees it
 * (`docs/mr2-neighbours.md`): the friendly cells around a cell and the whole
 * percent its building health and tower damage both go up by. The count is
 * always the server's (the map's `nb`, or the `neighbours` the attack load
 * froze for the battle); the percent is the battle's own table, so what is
 * shown is what is fought.
 */
export interface NeighbourBonusView {
  /** Friendly neighbours, 1 to 6. */
  readonly count: number;
  /** Building health and tower damage up, whole percent. */
  readonly percent: number;
}

/** What to show for `count` friendly neighbours; null for none, or with the switch off (no count sent). */
export const neighbourBonusView = (count: number | undefined): NeighbourBonusView | null => {
  const bonus = neighbourDefenceBonus(count);
  if (!bonus || count === undefined) return null;
  return { count: Math.min(count, 6), percent: Math.round((bonus.damage ?? 0) * 100) };
};

/** The tooltip and screen-reader line: what the bonus does, in one sentence. */
export const neighbourBonusLine = (view: NeighbourBonusView): string =>
  `${view.count} friendly ${view.count === 1 ? "neighbour" : "neighbours"}: buildings +${view.percent}% health, towers +${view.percent}% damage.`;

/** The friendly neighbours an attack load froze for its battle; undefined with none or the switch off. */
export const loadNeighbours = (load: { readonly defenderforces?: unknown } | null | undefined): number | undefined =>
  parseDefenderForces(load?.defenderforces)?.neighbours;
