import { NO_OUTPOST_LABELS, readOutpostLabels, type OutpostLabels } from "@/api/outpostLabels";
import type { OffsetCell } from "@/game/HexGrid";

/**
 * The player's outpost names and pins (beta 7, owner 9 Nov 2026: "Allow
 * players to name / pin the outpost of their choice so it's easy for them to
 * navigate"), kept for the session.
 *
 * The owner's build-mode yard loads carry the set as `outpostlabels`
 * ({@link seedOutpostLabels}); every rename and pin answers with the whole
 * set ({@link setOutpostLabels}). The yard switcher and the map's own
 * outpost buttons read it here, so a rename shows everywhere at once.
 */

let current: OutpostLabels = NO_OUTPOST_LABELS;
/** The last load's set, so binding the same load again does not undo a later rename. */
let seeded: unknown;
const listeners = new Set<() => void>();

export const outpostLabels = (): OutpostLabels => current;

export const setOutpostLabels = (labels: OutpostLabels): void => {
  current = labels;
  for (const listener of [...listeners]) listener();
};

/**
 * Takes the set a yard load carried. A load with none leaves the set as it
 * is, as does the same load seen again; a new load's set replaces it.
 */
export const seedOutpostLabels = (raw: unknown): void => {
  if (raw === undefined || raw === seeded) return;
  seeded = raw;
  setOutpostLabels(readOutpostLabels(raw));
};

/** Calls `listener` after every change; returns the unsubscribe. */
export const onOutpostLabels = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The outpost's own name, or "" when it has none. */
export const outpostName = (baseid: string, labels: OutpostLabels = current): string =>
  labels.names[baseid] ?? "";

/** "439, 461": an outpost's coordinates, as the list shows an unnamed one. */
export const cellText = (cell: OffsetCell): string => `${cell.col}, ${cell.row}`;

/** For the tests: back to no labels. */
export const resetOutpostLabels = (): void => {
  seeded = undefined;
  current = NO_OUTPOST_LABELS;
  listeners.clear();
};
