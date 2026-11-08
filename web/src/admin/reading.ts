/**
 * The section whose content fills the reading area: the one with the most of its height between
 * the reading line (a fifth down the screen) and the screen's foot, ties going to the later one.
 * With nothing in the area (a gap) it is the last section that starts above the line. A section
 * that has grown to fill the screen (a mail conversation opening) wins over the short one before it.
 */
export const readingSection = <T extends string>(
  boxes: readonly { id: T; top: number; bottom: number }[],
  viewportHeight: number,
): T | undefined => {
  const line = viewportHeight * 0.2;
  let best: T | undefined;
  let bestFill = 0;
  for (const box of boxes) {
    const fill = Math.min(box.bottom, viewportHeight) - Math.max(box.top, line);
    if (fill > 0 && fill >= bestFill) {
      best = box.id;
      bestFill = fill;
    }
  }
  if (best !== undefined) return best;
  let above: T | undefined;
  for (const box of boxes) if (box.top <= line) above = box.id;
  return above;
};
