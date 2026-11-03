import { buildingName } from "../buildingArt";
import { InvalidReason, type PlacementResult, type PlanNode } from "./placement";

/**
 * The pre-Apply checklist (design §3, F17).
 *
 * Three blocking checks about placement, and a warning row for decorations
 * Apply will put into storage, which reports rather than refuses. Each row names
 * the buildings that fail it, so the panel can offer "show me" and select
 * them — which is the whole point of the feature. The original collapsed all
 * of this into one untargeted `basePlanner_cantApply` message
 * (`BasePlannerPopup.as:557-563`).
 *
 * The first check is the one Apply is hard-blocked on. Section 8, Q4 keeps
 * Apply blocked while any non-decoration building is unplaced and forbids
 * auto-placing; the store tool made unplacing possible, so the set it reads is
 * the planner's drawer.
 *
 * Decorations are not in that set (#128). Apply puts a decoration the layout
 * leaves out into storage, as the Flash planner did
 * (`com/monsters/baseplanner/BasePlanner.as:113-122`), so one in the drawer is
 * a warning row saying so rather than a block.
 */

export interface ChecklistItem {
  readonly id: number;
  /** "Cannon Tower overlaps Sniper Tower". */
  readonly label: string;
}

export interface ChecklistRow {
  readonly key: string;
  readonly label: string;
  readonly ok: boolean;
  readonly items: readonly ChecklistItem[];
  /**
   * A row that reports rather than refuses.
   *
   * A decoration left in the drawer goes into storage on Apply (#128), which
   * is not a reason to refuse the move. So these rows are drawn with their own
   * mark, are left out of {@link Checklist.ok}, and do not outline anything in
   * red.
   */
  readonly warning?: boolean;
}

export interface Checklist {
  readonly rows: readonly ChecklistRow[];
  /** True when nothing blocks Apply. Warning rows are not counted. */
  readonly ok: boolean;
  /** Every building named by a *blocking* failing row, for the red outlines. */
  readonly faulted: Set<number>;
}

const nameOf = (node: PlanNode | undefined): string =>
  node ? (buildingName(node.type) ?? `Type ${node.type}`) : "a building";

/**
 * Builds the checklist from a plan's nodes and the result of validating them.
 *
 * Takes the validation result rather than running it, so the panel and the
 * Apply button share one pass over a 575-building yard instead of two.
 */
export const buildChecklist = (
  nodes: Map<number, PlanNode> | ReadonlyMap<number, PlanNode>,
  validation: PlacementResult,
  unplaced: readonly number[] = [],
  toStorage: readonly number[] = [],
): Checklist => {
  const overlaps: ChecklistItem[] = [];
  const outside: ChecklistItem[] = [];
  const faulted = new Set<number>();

  for (const issue of validation.issues) {
    const node = nodes.get(issue.id);
    faulted.add(issue.id);
    if (issue.reason === InvalidReason.OVERLAP) {
      const other = issue.otherId === undefined ? undefined : nodes.get(issue.otherId);
      if (issue.otherId !== undefined) faulted.add(issue.otherId);
      overlaps.push({ id: issue.id, label: `${nameOf(node)} overlaps ${nameOf(other)}` });
    } else {
      outside.push({ id: issue.id, label: `${nameOf(node)} is outside the yard` });
    }
  }

  const missing: ChecklistItem[] = unplaced.map((id) => ({
    id,
    label: `${nameOf(nodes.get(id))} is in the drawer`,
  }));
  for (const item of missing) faulted.add(item.id);

  const rows: ChecklistRow[] = [
    {
      key: "placed",
      label: "Every building is placed",
      ok: missing.length === 0,
      items: missing,
    },
    {
      key: "overlap",
      label: "No building overlaps another",
      ok: overlaps.length === 0,
      items: overlaps,
    },
    {
      key: "bounds",
      label: "Everything is inside the yard",
      ok: outside.length === 0,
      items: outside,
    },
    ...storageRows(nodes, toStorage),
  ];

  return {
    rows,
    ok: rows.every((row) => row.warning || row.ok),
    faulted,
  };
};

/**
 * The warning row for decorations left in the drawer (#128): Apply puts them
 * into storage, which the player should see before pressing it. Left out when
 * there are none.
 */
const storageRows = (
  nodes: Map<number, PlanNode> | ReadonlyMap<number, PlanNode>,
  toStorage: readonly number[],
): ChecklistRow[] =>
  toStorage.length === 0
    ? []
    : [
        {
          key: "toStorage",
          label: "Decorations in the drawer go into storage",
          ok: false,
          items: toStorage.map((id) => ({ id, label: `${nameOf(nodes.get(id))} goes into storage` })),
          warning: true,
        },
      ];
