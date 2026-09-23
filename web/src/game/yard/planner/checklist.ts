import { buildingName } from "../buildingArt";
import { InvalidReason, type PlacementResult, type PlanNode } from "./placement";

/**
 * The pre-Apply checklist (design §3, F17).
 *
 * Three blocking checks in phase 1, each naming the buildings that fail it so
 * the panel can offer "show me" and select them — which is the whole point of
 * the feature. The original collapsed all of this into one untargeted
 * `basePlanner_cantApply` message (`BasePlannerPopup.as:557-563`).
 *
 * The first check is structural for now. Section 8, Q4 keeps Apply hard-blocked
 * while any non-decoration building is unplaced and forbids auto-placing, but
 * phase 1 has no way to unplace one: every building in the yard is in the plan
 * from the moment the planner opens. The check is here, and reads the same set
 * a store tool would empty, so phase 2 turns it on rather than adding it.
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
}

export interface Checklist {
  readonly rows: readonly ChecklistRow[];
  /** True when nothing blocks Apply. */
  readonly ok: boolean;
  /** Every building named by a failing row, for the red outlines. */
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
      outside.push({
        id: issue.id,
        label: node?.decoration
          ? `${nameOf(node)} is outside the decoration area`
          : `${nameOf(node)} is outside the yard`,
      });
    }
  }

  const missing: ChecklistItem[] = unplaced.map((id) => ({
    id,
    label: `${nameOf(nodes.get(id))} has nowhere to go`,
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
  ];

  return { rows, ok: rows.every((row) => row.ok), faulted };
};
