import { WALL_TYPES } from "../buildingCosts";
import type { Yard } from "../yardModel";
import type { PlanNode } from "./placement";
import {
  effectiveLevel,
  heldResources,
  isShort,
  wallBatchPreview,
  type ResourceAmounts,
  type WallBatchPreview,
} from "./summary";

/**
 * Wall picking: the Upgrade walls mode's arithmetic (owner, 2026-11-04).
 *
 * The owner's players are new and cannot afford every wall at once, so the
 * batch upgrade starts from a button rather than from a selection: the player
 * presses Upgrade walls, then drags boxes over walls, taps walls in and out,
 * or presses Select all, and a live line says what the pick costs at the
 * chosen level. Nothing here touches the DOM or the network; the session and
 * the panel call it and the tests pin it.
 *
 * ## Why a box adds rather than replaces
 *
 * Picking part of a yard is the normal case, and on a phone it takes several
 * boxes: one per stretch of wall the screen can show. A box that replaced the
 * pick would throw the last stretch away each time. Taking walls back out is
 * a tap each, or Clear.
 *
 * ## Why only walls
 *
 * A box over a wall run always catches the towers inside it. They are ignored
 * here rather than filtered later, so the yard's highlight, the count and the
 * cost all agree on what is picked.
 */

/** A wall the batch upgrade could raise: on the plot, not fixed, a wall type. */
export const isPickableWall = (node: PlanNode | undefined): node is PlanNode =>
  node !== undefined && !node.fixed && !node.stored && WALL_TYPES.includes(node.type);

/** Every wall on the plot, in plan order: Select all. */
export const allWallIds = (nodes: Iterable<PlanNode>): number[] => {
  const ids: number[] = [];
  for (const node of nodes) if (isPickableWall(node)) ids.push(node.id);
  return ids;
};

/** Keeps only the walls of `ids`: what entering the mode keeps of a selection. */
export const wallsOnly = (
  ids: Iterable<number>,
  get: (id: number) => PlanNode | undefined,
): Set<number> => {
  const kept = new Set<number>();
  for (const id of ids) if (isPickableWall(get(id))) kept.add(id);
  return kept;
};

/** A box drawn over the yard: the pick so far plus every wall the box touches. */
export const boxPick = (
  base: ReadonlySet<number>,
  boxed: Iterable<number>,
  get: (id: number) => PlanNode | undefined,
): Set<number> => {
  const picked = new Set(base);
  for (const id of wallsOnly(boxed, get)) picked.add(id);
  return picked;
};

/** A tap on `id`: a wall goes in or out, anything else leaves the pick alone. */
export const togglePick = (
  picked: ReadonlySet<number>,
  id: number | null,
  get: (id: number) => PlanNode | undefined,
): Set<number> => {
  const next = new Set(picked);
  if (id === null || !isPickableWall(get(id))) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** What the live line says: the batch preview plus whether it can be paid for. */
export interface PickSummary extends WallBatchPreview {
  /** How many walls are picked, counting the ones already at the level. */
  readonly picked: number;
  /** Something would change, and the yard holds enough for it. */
  readonly affordable: boolean;
}

export const pickSummary = (
  nodes: readonly PlanNode[],
  target: number,
  yard: Yard,
): PickSummary => {
  const walls = nodes.filter((node) => isPickableWall(node));
  const preview = wallBatchPreview(walls, target, yard);
  return {
    ...preview,
    picked: walls.length,
    affordable: preview.eligible.length > 0 && !isShort(preview.shortfall),
  };
};

/**
 * "Affordable": as many walls as the yard can pay for at `target`.
 *
 * Drawn from `nodes` — the pick when there is one, so a pick that is too dear
 * is trimmed down rather than replaced, and every wall when there is not. The
 * cheapest walls go first (the ones already nearest the level), and ties keep
 * the order they came in, so a trimmed pick keeps the walls picked first.
 * Walls already at the level are left out: they would cost nothing and change
 * nothing. Empty when the hall does not allow `target` at all.
 */
export const affordablePick = (
  nodes: readonly PlanNode[],
  target: number,
  yard: Yard,
): number[] => {
  const budget = heldResources(yard.resources);

  const priced: { id: number; cost: ResourceAmounts; total: number }[] = [];
  for (const node of nodes) {
    if (!isPickableWall(node)) continue;
    const one = wallBatchPreview([node], target, yard);
    if (one.gate) return [];
    if (one.eligible.length === 0) continue;
    const { cost } = one;
    priced.push({ id: node.id, cost, total: cost.r1 + cost.r2 + cost.r3 + cost.r4 });
  }
  // Array.prototype.sort is stable, so equal prices keep the order given.
  priced.sort((a, b) => a.total - b.total);

  const spent = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const chosen: number[] = [];
  for (const entry of priced) {
    const fits =
      spent.r1 + entry.cost.r1 <= budget.r1 &&
      spent.r2 + entry.cost.r2 <= budget.r2 &&
      spent.r3 + entry.cost.r3 <= budget.r3 &&
      spent.r4 + entry.cost.r4 <= budget.r4;
    if (!fits) continue;
    spent.r1 += entry.cost.r1;
    spent.r2 += entry.cost.r2;
    spent.r3 += entry.cost.r3;
    spent.r4 += entry.cost.r4;
    chosen.push(entry.id);
  }
  return chosen;
};

/**
 * The level the window offers: one above the lowest wall picked, or, with
 * nothing picked, the lowest wall in the yard (owner, 2026-11-04). Capped at
 * the highest level the hall allows (`allowed`, in rising order); null when
 * the hall allows none.
 */
export const autoWallTarget = (
  picked: readonly PlanNode[],
  all: readonly PlanNode[],
  allowed: readonly { readonly level: number }[],
): number | null => {
  const walls = picked.filter((node) => isPickableWall(node));
  const from = walls.length > 0 ? walls : all.filter((node) => isPickableWall(node));
  const top = allowed.at(-1)?.level ?? null;
  if (from.length === 0) return top;
  const lowest = Math.min(...from.map(effectiveLevel));
  return allowed.find((entry) => entry.level > lowest)?.level ?? top;
};

/** The window's level and whether the player chose it with a level button. */
export interface WallTargetChoice {
  readonly target: number;
  readonly manual: boolean;
}

/**
 * The level after the pick changed: it follows the pick
 * ({@link autoWallTarget}) unless the player pressed a level button, whose
 * choice is kept while it still raises a picked wall. A chosen level that
 * would do nothing gives way to the followed one.
 */
export const followWallTarget = (
  choice: WallTargetChoice,
  picked: readonly PlanNode[],
  all: readonly PlanNode[],
  allowed: readonly { readonly level: number }[],
  yard: Yard,
): WallTargetChoice => {
  const walls = picked.filter((node) => isPickableWall(node));
  if (choice.manual) {
    if (walls.length === 0) return choice;
    if (wallBatchPreview(walls, choice.target, yard).eligible.length > 0) return choice;
  }
  return { target: autoWallTarget(walls, all, allowed) ?? choice.target, manual: false };
};

/**
 * "Select all" at `target` (owner, 2026-11-04: the player chooses the level
 * first, then all or what they can afford). It picks every wall below the
 * level, and only when the yard can pay for every one of them; otherwise the
 * button is greyed with the reason.
 */
export interface SelectAllCheck {
  /** The walls below `target`: what the button picks. */
  readonly ids: number[];
  /** Why the button is greyed, or null when it can be pressed. */
  readonly reason: string | null;
}

export const selectAllCheck = (
  all: readonly PlanNode[],
  target: number,
  yard: Yard,
  hallWord = "Town Hall",
): SelectAllCheck => {
  const preview = wallBatchPreview(all.filter((node) => isPickableWall(node)), target, yard);
  const ids = preview.eligible;
  if (ids.length === 0) return { ids, reason: `Every wall is already at level ${target} or higher.` };
  if (preview.gate) return { ids, reason: `Level ${target} needs ${hallWord} ${preview.gate.need}.` };
  if (isShort(preview.shortfall)) {
    return {
      ids,
      reason: `Not enough to raise all ${ids.length} ${ids.length === 1 ? "wall" : "walls"} to level ${target}.`,
    };
  }
  return { ids, reason: null };
};

/**
 * "Affordable" at `target`: as many walls as the yard can pay for, cheapest
 * (nearest the level) first.
 *
 * A pick that is too dear is trimmed down to what can be paid for
 * ({@link affordablePick}); a pick that can be paid for is kept and topped up
 * from the rest of the yard with what is left over, so the button never throws
 * away walls the player chose. `reason` says why the button is greyed: nothing
 * can be paid for, or the pick is already all the yard can afford.
 */
export interface AffordableCheck {
  readonly ids: number[];
  readonly reason: string | null;
}

export const affordableFill = (
  picked: readonly PlanNode[],
  all: readonly PlanNode[],
  target: number,
  yard: Yard,
): AffordableCheck => {
  const walls = picked.filter((node) => isPickableWall(node));
  const pickPreview = wallBatchPreview(walls, target, yard);
  const below = all.filter((node) => isPickableWall(node) && effectiveLevel(node) < target);
  if (below.length === 0) {
    return { ids: [], reason: `Every wall is already at level ${target} or higher.` };
  }

  let ids: number[];
  if (pickPreview.eligible.length > 0 && isShort(pickPreview.shortfall)) {
    ids = affordablePick(walls, target, yard);
  } else {
    const held = heldResources(yard.resources);
    const cost = pickPreview.cost;
    const left: Yard = {
      ...yard,
      resources: {
        ...yard.resources,
        r1: held.r1 - cost.r1,
        r2: held.r2 - cost.r2,
        r3: held.r3 - cost.r3,
        r4: held.r4 - cost.r4,
      },
    };
    const chosen = new Set(walls.map((node) => node.id));
    const rest = below.filter((node) => !chosen.has(node.id));
    ids = [...pickPreview.eligible, ...affordablePick(rest, target, left)];
  }

  if (ids.length === 0) {
    return { ids, reason: `You cannot afford a single wall at level ${target} yet.` };
  }
  const same =
    ids.length === pickPreview.eligible.length &&
    ids.every((id) => pickPreview.eligible.includes(id)) &&
    !isShort(pickPreview.shortfall);
  return same
    ? { ids, reason: `Your pick is already all you can afford at level ${target}.` }
    : { ids, reason: null };
};
