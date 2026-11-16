/**
 * Scroll cues for a list that scrolls inside a window (Smart Repeat attack,
 * lead's vetting, 16 Nov 2026): a list never rests on a half-cut row, and a
 * list with more below says so.
 *
 * - {@link fitWholeRows}: when the rows do not all fit, the list's height is
 *   cut back to the bottom of the last row that shows whole.
 * - {@link watchMoreBelow}: the element carries `className` while there is
 *   more below its visible part (the CSS fades its bottom edge then), updated
 *   on scroll and on resize.
 *
 * Both measure the laid-out page; where nothing is laid out (tests), they do
 * nothing.
 */

/**
 * Cuts a scrolling list back to whole rows when its rows do not all fit.
 *
 * @param list - The scrolling list; its rows are its element children.
 */
export const fitWholeRows = (list: HTMLElement): void => {
  list.style.removeProperty("max-height");
  list.style.removeProperty("min-height");
  // Fractional, as the rows' edges are (clientHeight rounds down).
  const box = list.getBoundingClientRect();
  const visible = box.height;
  if (visible <= 0) return;
  const top = box.top - list.scrollTop;
  const ends = ([...list.children] as HTMLElement[]).map((row) => row.getBoundingClientRect().bottom - top);
  // Every row whole, border included (measured, not rounded: a 1px cut shows).
  if (ends.every((end) => end <= visible + 0.25)) return;
  let bottom = 0;
  for (const end of ends) {
    if (end > visible + 0.25) break;
    bottom = end;
  }
  // Not even one whole row fits: leave the list as the layout made it.
  if (bottom <= 0) return;
  const padding = parseFloat(getComputedStyle(list).paddingBottom) || 0;
  const height = `${Math.ceil(bottom + padding)}px`;
  list.style.maxHeight = height;
  list.style.minHeight = height;
};

/**
 * Keeps `className` on `element` while it has more to scroll below.
 *
 * @returns Stops watching.
 */
export const watchMoreBelow = (element: HTMLElement, className: string): (() => void) => {
  const update = () => {
    const more = element.scrollHeight - element.scrollTop - element.clientHeight > 1;
    element.classList.toggle(className, more);
  };
  element.addEventListener("scroll", update, { passive: true });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  // The element and its children: a child that grows (a refusal line shown) adds more below.
  observer?.observe(element);
  for (const child of element.children) observer?.observe(child);
  update();
  return () => {
    element.removeEventListener("scroll", update);
    observer?.disconnect();
  };
};
