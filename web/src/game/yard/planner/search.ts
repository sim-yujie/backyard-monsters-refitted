import { kindOf } from "../buildingCosts";
import type { PlanNode } from "./placement";
import { typeName } from "./summary";

/**
 * Searching the buildings that are already in the yard.
 *
 * Phase 1 has no inventory: every building is in the plan from the moment the
 * planner opens and nothing can be stored, so F16's "inventory search" is a
 * search over what is placed (plan §1.3). That is still the thing the feature
 * was for — finding the 400 walls among 575 buildings without hunting for them
 * — and it is what the batch wall upgrade needs to select against.
 *
 * ## Stacking
 *
 * A row is a type at a level, not a building: "Wooden Block L1 x400" is one row
 * carrying 400 ids. A list with one row per wall would be unreadable and slow
 * to draw, and the ids are what the caller wants anyway — it selects and frames
 * the whole group.
 *
 * ## Kinds
 *
 * The chips are the props table's own `type` strings — `wall`, `trap`,
 * `tower`, `resource`, `special`, `decoration` — read through `kindOf`. A type
 * the cost table does not know lands under `other` rather than under nothing,
 * so a chip can always reach it.
 *
 * Pure arithmetic and string matching: no DOM, so the panel is a view over this
 * rather than a place where the rules live a second time.
 */

/** Buildings of one type at one level, and the ids they are. */
export interface SearchGroup {
  readonly type: number;
  readonly name: string;
  readonly level: number;
  /** The props kind, or `other` for a type with no cost row. */
  readonly kind: string;
  /** Ascending, so the first is the one the camera frames. */
  readonly ids: readonly number[];
}

/** Where a type with no props kind is filed. */
export const OTHER_KIND = "other";

/** The props kind a chip would file a type under. */
export const kindFor = (type: number): string => kindOf(type) || OTHER_KIND;

const DIGITS = /^\d+$/;

/**
 * The groups matching a query and a set of chips.
 *
 * An empty query matches everything and an empty `kinds` set filters nothing,
 * so opening the panel lists the whole yard. A query of digits also matches on
 * the type id, which is how a type with no art or no name can still be found.
 *
 * Fixed nodes — the mushrooms — are never returned: they cannot be selected,
 * so offering them as a row would be offering a row that does nothing.
 */
export const searchNodes = (
  nodes: Iterable<PlanNode>,
  query: string,
  kinds: ReadonlySet<string>,
): SearchGroup[] => {
  const needle = query.trim().toLowerCase();
  const byId = DIGITS.test(needle);
  const groups = new Map<string, { group: SearchGroup; ids: number[] }>();

  for (const node of nodes) {
    if (node.fixed) continue;

    const kind = kindFor(node.type);
    if (kinds.size > 0 && !kinds.has(kind)) continue;

    const name = typeName(node.type);
    if (needle.length > 0) {
      const matches =
        name.toLowerCase().includes(needle) || (byId && String(node.type).includes(needle));
      if (!matches) continue;
    }

    const key = `${node.type}:${node.level}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(node.id);
      continue;
    }
    const ids: number[] = [node.id];
    groups.set(key, {
      group: { type: node.type, name, level: node.level, kind, ids },
      ids,
    });
  }

  const found = [...groups.values()].map((entry) => {
    entry.ids.sort((a, b) => a - b);
    return entry.group;
  });

  // Name first, then level: the order the Flash inventory listed stacks in, and
  // the one that puts a type's levels together where they can be compared.
  found.sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level || a.type - b.type);
  return found;
};

/**
 * How many buildings each kind has, for the chip badges.
 *
 * Counted over every node rather than over the matches, because a chip's count
 * is what it would show if it were the only filter — a badge that changed as
 * the query was typed would be telling the player about the query instead of
 * about the yard.
 */
export const countByKind = (nodes: Iterable<PlanNode>): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.fixed) continue;
    const kind = kindFor(node.type);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
};
