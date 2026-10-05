import type { Layout, LayoutNode, LayoutPayload, LayoutStoredNode } from "@/api/types";
import { LAYOUT_VERSION } from "@/api/types";
import { maxLevel } from "../buildingCosts";
import type { MoveEntry, PlanEntry, StoreEntry } from "./commands";
import { plannableType, type Plan } from "./plan";
import { inBounds, Occupancy, snap, type PlanNode } from "./placement";

/**
 * Turning a plan into a saved layout and back.
 *
 * A layout node is `id`, `t`, `x`, `y`, `l`, `fort` in yard units: the same
 * units a `buildingdata` row uses, with the position fields in lower case
 * because that is what the server's schema asks for. So the format the client
 * saves is the format the server applies, with no translation layer to get out
 * of step. Mushrooms are never written: they are obstacles the planner cannot
 * move and the yard reseeds them on its own (`BASE.as:5097-5109`).
 *
 * ## Loading is not the reverse of saving
 *
 * A layout can name a building the yard no longer has, and it can have been
 * designed for a bigger plot than the account currently owns (design §8, Q8).
 * Neither is an error and neither may be auto-placed (§8, Q4: a building left
 * where it was can collide with one the layout puts on the same cells, so the
 * planner never guesses). What does not fit is reported and left where it
 * stands, Apply stays blocked on it, and the player decides.
 *
 * ## Half-finished plans
 *
 * A layout may be saved with buildings still in the drawer (owner decision
 * 2026-10-05, reversing Q14 (c)). Those go in `stored`, by id and type, and
 * loading the layout puts them back in the drawer. Apply is unchanged: it
 * stays blocked until the drawer holds nothing but decorations.
 */

/**
 * The `data` field for a save or an apply. A decoration put down out of
 * storage is no building yet, so it goes in `fromStorage` rather than
 * `nodes` (#128); a slot save drops those. Buildings in the drawer go in
 * `stored` — save only, Apply ignores it — except the drawer's stacks out
 * of storage, which are no buildings either.
 */
export const payloadFor = (plan: Plan): LayoutPayload => {
  const fromStorage = plan.fromStorageNodes().map((node) => ({ t: node.type, x: node.x, y: node.y }));
  const stored: LayoutStoredNode[] = plan
    .storedNodes()
    .filter((node) => !node.fromStorage && !node.fixed)
    .map((node) => ({ id: node.id, t: node.type }));
  return {
    version: LAYOUT_VERSION,
    expansion: plan.expansion,
    nodes: plan
      .buildings()
      .filter((node) => !node.fromStorage)
      .map(toLayoutNode),
    ...(fromStorage.length > 0 ? { fromStorage } : {}),
    ...(stored.length > 0 ? { stored } : {}),
  };
};

const toLayoutNode = (node: PlanNode): LayoutNode => ({
  id: node.id,
  t: node.type,
  x: node.x,
  y: node.y,
  ...(node.level !== 1 ? { l: node.level } : {}),
  ...(node.fort ? { fort: node.fort } : {}),
  // Only when there is one: `plan` is an additive optional field and a layout
  // that writes `plan: null` on 575 nodes is a bigger payload saying nothing
  // (`docs/design/planner-upgrades.md` §2.1).
  ...(node.plan ? { plan: { level: node.plan.level, order: node.plan.order } } : {}),
});

/** Why a saved node could not be put where the layout wanted it. */
export const MissReason = {
  /** Outside the plot for the expansion level the account has now. */
  BOUNDS: "bounds",
  /** The cells are held by a building the layout does not move. */
  BLOCKED: "blocked",
} as const;
export type MissReason = (typeof MissReason)[keyof typeof MissReason];

export interface LoadMiss {
  readonly id: number;
  readonly type: number;
  readonly reason: MissReason;
}

/**
 * A saved node whose building the yard no longer has.
 *
 * The position is carried, not just the id, because this is one of the two
 * places the client can learn where a trap stood before it fired: a trap that
 * explodes is deleted from the save, so a layout that still names it is the
 * only record of its spot for a player whose `firedtraps` list has been
 * trimmed. The re-arm button reads `t`, `x` and `y` straight into a
 * `TrapPlacement`.
 */
export interface LoadMissing {
  readonly id: number;
  /** Building type as the layout recorded it. */
  readonly t: number;
  /** Yard units, snapped, as the layout recorded them. */
  readonly x: number;
  readonly y: number;
}

export interface LoadResult {
  /** Before-and-after positions, so a load is one entry on the undo stack. */
  readonly entries: MoveEntry[];
  /** Buildings on the plot that the layout keeps in the drawer: lifted first. */
  readonly lifts: StoreEntry[];
  /** Buildings in the drawer that the layout puts on the plot: put down last. */
  readonly places: StoreEntry[];
  /** Planned upgrades the layout carried and this yard can still do. */
  readonly plans: PlanEntry[];
  /**
   * How many planned upgrades the layout carried that this yard cannot do.
   *
   * A count rather than a list: the reason is almost always that the building
   * has caught up or is mid-job, which is not something the player can act on,
   * so the banner says how many and not which.
   */
  readonly plansDropped: number;
  /** Saved nodes that stayed where they were, for the banner. */
  readonly didNotFit: LoadMiss[];
  /** Saved nodes this yard has no building for, with where they stood. */
  readonly missing: LoadMissing[];
  /** The expansion level the layout was designed for. */
  readonly expansion: number;
}

/**
 * Works out where a saved layout would put each building.
 *
 * Nothing is written: the caller pushes the returned entries through the
 * command stack, which is what makes a load undoable like any other edit.
 *
 * The order matters. Buildings the layout says nothing about are obstacles and
 * go into the scratch grid first, at the positions they already hold. Then each
 * saved node is tried in turn against that grid, so two saved nodes cannot both
 * claim the same cells and the first one named wins — the same first-come rule
 * the original's placement loop used.
 *
 * ## The drawer
 *
 * A building the layout keeps in the drawer is lifted ({@link LoadResult.lifts})
 * and is no obstacle. A saved node whose building is in the drawer now is put
 * down ({@link LoadResult.places}) where it fits and stays in the drawer where
 * it does not. The caller applies lifts, then moves, then places, so each
 * lands on cells the step before has cleared. A stored entry whose building
 * the yard no longer has is dropped quietly: it stood nowhere, so there is no
 * spot to report.
 *
 * ## Plans are set, never cleared
 *
 * A saved node carrying a `plan` this yard can still do sets one; a saved node
 * with no `plan` leaves whatever the player has planned alone. A layout is a
 * record of positions first, and a load that silently wiped the upgrades
 * planned in the last minute would be a worse surprise than one that leaves a
 * plan the player can clear in a click (`docs/design/planner-upgrades.md`
 * §2.3, which lists only the reading side of this field).
 */
export const planLoad = (plan: Plan, layout: Layout): LoadResult => {
  const named = new Set<number>();
  for (const node of layout.nodes) {
    if (plan.get(node.id)) named.add(node.id);
  }
  const lifts: StoreEntry[] = [];
  for (const saved of layout.stored ?? []) {
    const node = plan.get(saved.id);
    if (!node || node.fixed) continue;
    named.add(node.id);
    if (!node.stored) lifts.push({ id: node.id, x: node.x, y: node.y, store: true });
  }

  const grid = new Occupancy();
  for (const node of plan.all()) {
    if (!named.has(node.id)) grid.stamp(node);
  }

  const entries: MoveEntry[] = [];
  const places: StoreEntry[] = [];
  const plans: PlanEntry[] = [];
  const didNotFit: LoadMiss[] = [];
  const missing: LoadMissing[] = [];
  let plansDropped = 0;
  let order = 0;

  for (const saved of layout.nodes) {
    const node = plan.get(saved.id);
    const x = snap(Number(saved.x) || 0);
    const y = snap(Number(saved.y) || 0);

    if (!node || node.fixed) {
      missing.push({ id: saved.id, t: saved.t, x, y });
      continue;
    }

    // Plans are read whether or not the position fits: a wall that could not
    // be moved into a shrunken yard can still be upgraded where it stands.
    if (saved.plan) {
      const level = Number(saved.plan.level);
      const wanted = Number.isFinite(level) ? Math.trunc(level) : 0;
      // `order` is taken from the layout where it has one and renumbered by
      // reading order otherwise, so a layout written by something that dropped
      // the field still walks in the order its nodes are listed in.
      const savedOrder = Number(saved.plan.order);
      const at = Number.isFinite(savedOrder) && savedOrder >= 0 ? Math.trunc(savedOrder) : order;
      order = Math.max(order, at) + 1;

      const plannable =
        plannableType(node.type) &&
        !node.busy &&
        !node.damaged &&
        wanted > node.level &&
        wanted <= maxLevel(node.type);

      if (!plannable) plansDropped++;
      else if (!node.plan || node.plan.level !== wanted || node.plan.order !== at) {
        plans.push({ id: node.id, before: node.plan, after: { level: wanted, order: at } });
      }
    }

    // One that does not fit stays where it is: on its cells, or in the drawer.
    if (!inBounds(node, x, y, plan.plot)) {
      didNotFit.push({ id: node.id, type: node.type, reason: MissReason.BOUNDS });
      if (!node.stored) grid.stamp(node);
      continue;
    }
    if (grid.blockedBy(node, x, y) !== null) {
      didNotFit.push({ id: node.id, type: node.type, reason: MissReason.BLOCKED });
      if (!node.stored) grid.stamp(node);
      continue;
    }

    grid.stamp(node, x, y);
    if (node.stored) {
      places.push({ id: node.id, x, y, store: false });
    } else if (node.x !== x || node.y !== y) {
      entries.push({ id: node.id, fromX: node.x, fromY: node.y, toX: x, toY: y });
    }
  }

  return {
    entries,
    lifts,
    places,
    plans,
    plansDropped,
    didNotFit,
    missing,
    expansion: layout.expansion,
  };
};

/**
 * A slot's line in the layouts list: how many buildings it places, how many it
 * keeps in the drawer when there are any, the plot it was drawn for and when.
 */
export const layoutMeta = (layout: Layout): string => {
  const stored = layout.stored?.length ?? 0;
  return [
    `${layout.nodes.length} buildings`,
    ...(stored > 0 ? [`${stored} in storage`] : []),
    `expansion ${layout.expansion}`,
    layoutDate(layout.updatedAt),
  ].join(" · ");
};

/**
 * A layout's `updatedAt` as a short local date.
 *
 * The field is typed as a number or a string because the server has not settled
 * which it sends; seconds, milliseconds and an ISO string all land here.
 */
export const layoutDate = (updatedAt: number | string): string => {
  const date =
    typeof updatedAt === "number"
      ? new Date(updatedAt < 1e11 ? updatedAt * 1000 : updatedAt)
      : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
