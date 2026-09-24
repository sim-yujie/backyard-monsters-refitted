import { buildingName } from "../buildingArt";
import { InvalidReason, type PlacementResult, type PlanNode } from "./placement";
import type { ApplyPreview } from "./upgrades";

/**
 * The pre-Apply checklist (design §3, F17).
 *
 * Three blocking checks about placement, and — once anything is planned —
 * three warning rows about what the upgrade walk will not manage, which report
 * rather than refuse (`docs/design/planner-upgrades.md` §5.5). Each row names
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
 * Decorations are in that set too, although the server would accept a layout
 * that leaves one out (`services/yardplanner/validateLayout.ts`,
 * `unplacedBuildings`). The server does not *remove* a building it is not sent
 * — it simply leaves it where it stands — so a stored decoration would come
 * back at its old position, possibly under whatever the plan has since moved
 * onto those cells. Blocking on it is the only reading of "stored" that the
 * yard can keep its side of.
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
   * Apply is partial by design where planned upgrades are concerned
   * (`docs/design/planner-upgrades.md` §3.2): a job the yard cannot afford or
   * has no worker for is started later, not a reason to refuse the move. So
   * these rows are drawn with their own mark, are left out of
   * {@link Checklist.ok}, and do not outline anything in red.
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
  preview: ApplyPreview | null = null,
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
    ...upgradeRows(nodes, preview),
  ];

  return {
    rows,
    ok: rows.every((row) => row.warning || row.ok),
    faulted,
  };
};

/**
 * The three warning rows a plan with upgrades adds (design F17,
 * `yard-planner-redesign.md:465-467`).
 *
 * Built from the Apply preview rather than from the plan, so the checklist and
 * the dialog cannot disagree about which job the yard cannot pay for: they are
 * reading the same walk. They are left out entirely when there is nothing
 * planned, because three green ticks about upgrades nobody asked for is noise
 * in front of the Apply button.
 */
const upgradeRows = (
  nodes: Map<number, PlanNode> | ReadonlyMap<number, PlanNode>,
  preview: ApplyPreview | null,
): ChecklistRow[] => {
  if (!preview) return [];
  const planned =
    preview.started.length +
    preview.finished.length +
    preview.waiting.length +
    preview.skipped.length;
  if (planned === 0) return [];

  const named = (id: number): string => nameOf(nodes.get(id));

  const short = preview.skipped
    .filter((row) => row.reason === "shortfall")
    .map((row) => ({ id: row.id, label: `${named(row.id)} cannot be paid for yet` }));

  const waiting = preview.waiting.map((row) => ({
    id: row.id,
    label: `${named(row.id)} waits for a free worker`,
  }));

  const gated = preview.skipped
    .filter((row) => row.reason === "townHall" || row.reason === "requirements")
    .map((row) => ({
      id: row.id,
      label: row.townHall
        ? `${named(row.id)} needs Town Hall ${row.townHall.need}`
        : `${named(row.id)} needs buildings it does not have`,
    }));

  return [
    {
      key: "upgradeResources",
      label: "Enough resources for the planned upgrades",
      ok: short.length === 0,
      items: short,
      warning: true,
    },
    {
      key: "upgradeWorkers",
      label: "Enough free workers",
      ok: waiting.length === 0,
      items: waiting,
      warning: true,
    },
    {
      key: "upgradeRequirements",
      label: "No planned upgrade is blocked by a prerequisite",
      ok: gated.length === 0,
      items: gated,
      warning: true,
    },
  ];
};
