/**
 * A scroll cue for a list that scrolls inside a window (Smart Repeat attack,
 * lead's vetting, 16 Nov 2026): a list with more below says so.
 *
 * - {@link watchMoreBelow}: the element carries `className` while there is
 *   more below its visible part (the CSS fades its bottom edge then), updated
 *   on scroll and on resize.
 *
 * It measures the laid-out page; where nothing is laid out (tests), it does
 * nothing.
 */

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
