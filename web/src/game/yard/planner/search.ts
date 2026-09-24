import { kindOf } from "../buildingCosts";
import type { PlanNode } from "./placement";
import { typeName } from "./summary";

/**
 * Stacking buildings by type and level, for the two lists that show them.
 *
 * F16 asked for a search over the inventory. This is the arithmetic behind
 * both halves of that: the Find panel runs it over the buildings standing in
 * the yard, which is what finds the 400 walls among 575 without hunting for
 * them and what the batch wall upgrade selects against, and the inventory
 * drawer runs it over the buildings the store tool has lifted off
 * (`ui/yard/InventoryPanel.ts`). One grouping for both, so a stack reads the
 * same wherever it is shown.
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
 * `tower`, `resource`, `special`, `decoration` — read through `kindOf`.
 * Anything else, including a type the cost table does not know, lands under
 * `other` rather than under nothing, so a chip can always reach it.
 *
 * Pure arithmetic and string matching: no DOM, so the panel is a view over this
 * rather than a place where the rules live a second time.
 */

/** Buildings of one type at one level, and the ids they are. */
export interface SearchGroup {
  readonly type: number;
  readonly name: string;
  readonly level: number;
  /** The category, from {@link kindFor}: a props kind, or `other`. */
  readonly kind: string;
  /** Ascending, so the first is the one the camera frames. */
  readonly ids: readonly number[];
}

/** Where a type no category claims is filed. */
export const OTHER_KIND = "other";

/**
 * The categories the chips and the headers offer.
 *
 * The props table has more kinds than these — `cage`, `taunt`, `enemy`,
 * `placeholder` — and they are rare, unbuildable or both. They go under
 * `other` rather than each earning a chip nobody would press, and a type the
 * cost table has no row for at all goes there too, so every building is under
 * something a filter can reach.
 */
const CATEGORY_KINDS: ReadonlySet<string> = new Set([
  "tower",
  "special",
  "resource",
  "trap",
  "wall",
  "decoration",
]);

/** The category a chip or a header would file a type under. */
export const kindFor = (type: number): string => {
  const kind = kindOf(type);
  return CATEGORY_KINDS.has(kind) ? kind : OTHER_KIND;
};

/**
 * The order the kinds are shown in, for chips and for headers.
 *
 * The categories a player reaches for first, then the ones they sort out
 * afterwards. `other` is last and only appears when something lands in it.
 * Both lists read this one array, so a drawer header and a Find chip never
 * disagree about where a type belongs or which comes first.
 */
export const KIND_ORDER: readonly string[] = [
  "tower",
  "special",
  "resource",
  "trap",
  "wall",
  "decoration",
  OTHER_KIND,
];

/** What a kind is called on screen. */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  tower: "Towers",
  special: "Special",
  resource: "Resources",
  trap: "Traps",
  wall: "Walls",
  decoration: "Decorations",
  [OTHER_KIND]: "Other",
};

/** A kind's screen name, or the raw kind for one the table has not met. */
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

/** One category's stacks, for a list that shows headers. */
export interface SearchCategory {
  readonly kind: string;
  readonly label: string;
  /** In {@link searchNodes} order: name, then level ascending. */
  readonly groups: readonly SearchGroup[];
  /** Buildings, not stacks — what the header badge counts. */
  readonly total: number;
}

/**
 * Stacks filed under their kind, in {@link KIND_ORDER}.
 *
 * A drawer holding four hundred walls, a dozen towers and a handful of traps
 * is three short lists under headers rather than one long one, and the count
 * on a header is how many buildings are under it rather than how many rows —
 * a player wants to know they have 400 walls, not 3 kinds of wall.
 *
 * A kind with nothing in it is left out, so the headers describe the drawer
 * rather than the props table. Groups keep the order `searchNodes` put them
 * in, which is name then level ascending.
 */
export const categorise = (groups: Iterable<SearchGroup>): SearchCategory[] => {
  const byKind = new Map<string, SearchGroup[]>();
  for (const group of groups) {
    const existing = byKind.get(group.kind);
    if (existing) existing.push(group);
    else byKind.set(group.kind, [group]);
  }

  const order = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
  return [...byKind.entries()]
    .sort(
      ([a], [b]) =>
        (order.get(a) ?? KIND_ORDER.length) - (order.get(b) ?? KIND_ORDER.length) ||
        a.localeCompare(b),
    )
    .map(([kind, found]) => ({
      kind,
      label: kindLabel(kind),
      groups: found,
      total: found.reduce((count, group) => count + group.ids.length, 0),
    }));
};

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
