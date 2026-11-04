/**
 * Timing marks for opening Map Room 2 (the owner's slow-open report, 4 Nov 2026), so an open can be
 * timed in any browser, dev or built: `performance.getEntriesByType("mark")` in the console lists
 * them. Each open clears the last open's marks.
 */
export const MR2_OPEN = "mr2-open";
/** The painted look first shows (its Low program, or the player's own when already compiled). */
export const MR2_PAINTED = "mr2-painted";
/** The ground draws with the player's own Quality's program. */
export const MR2_FULL_LOOK = "mr2-full-look";

const MARKS = [MR2_OPEN, MR2_PAINTED, MR2_FULL_LOOK];

/** Marks the start of an open, forgetting the last one's marks. */
export const markOpen = (): void => {
  for (const name of MARKS) performance.clearMarks(name);
  performance.mark(MR2_OPEN);
};

/** Marks a step of this open, the first time only. */
export const markOnce = (name: string): void => {
  if (performance.getEntriesByName(name, "mark").length === 0) performance.mark(name);
};
