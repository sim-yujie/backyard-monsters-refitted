import type { PlanNode } from "./placement";

/**
 * "Select all [type]" (#45, F14): a phone's way to a multi-selection.
 *
 * A finger has no Shift to add one building at a time, and the Box tool only
 * reaches what fits on the screen at once. So when everything selected is one
 * type, the building sheet offers every building of that type on the plot.
 *
 * `placed` is the plan's buildings on the plot (`Plan.buildings()`, which
 * already leaves out the drawer and anything fixed). The answer is null when
 * there is nothing to offer: an empty selection, a mix of types, or a
 * selection that already holds every one of them.
 */
export const sameTypeIds = (
  selected: readonly PlanNode[],
  placed: readonly PlanNode[],
): { type: number; ids: number[] } | null => {
  const first = selected[0];
  if (!first) return null;
  if (selected.some((node) => node.type !== first.type)) return null;

  const ids = placed.filter((node) => node.type === first.type).map((node) => node.id);
  const have = new Set(selected.map((node) => node.id));
  if (ids.every((id) => have.has(id))) return null;
  return { type: first.type, ids };
};
