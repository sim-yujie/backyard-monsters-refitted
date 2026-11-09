/**
 * Fades a scrolling box's edge where more is hidden (tester, 9 Nov: the
 * Friends list ended on a hard cut, the attack window already fades). The
 * box gets `scroll-fade--more-above` while it is scrolled down and
 * `scroll-fade--more-below` while more waits under it; `ui.css` turns those
 * into a soft mask at that edge. `content`, when given, is watched too, so
 * rows added or removed while the box keeps its height update the fades.
 * Returns what stops it.
 */
export const scrollFade = (box: HTMLElement, content?: HTMLElement): (() => void) => {
  box.classList.add("scroll-fade");
  const update = (): void => {
    box.classList.toggle("scroll-fade--more-above", box.scrollTop > 1);
    box.classList.toggle("scroll-fade--more-below", box.scrollTop + box.clientHeight < box.scrollHeight - 2);
  };
  box.addEventListener("scroll", update, { passive: true });
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
  resized?.observe(box);
  if (content) resized?.observe(content);
  update();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
  return () => {
    box.removeEventListener("scroll", update);
    resized?.disconnect();
  };
};
