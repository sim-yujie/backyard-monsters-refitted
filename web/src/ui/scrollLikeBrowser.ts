/**
 * For tests only. jsdom keeps any `scrollTop` it is given; a browser ignores
 * one set on a box that is not shown (`hidden`, or inside a hidden box), reads
 * it as 0 while hidden, and shows the box at its old position again when it
 * comes back. Gives `element` the browser's behaviour, so a test catches a
 * window that resets a tab's scroll before showing it (patch 6.3, 6 Nov 2026).
 */
export function scrollLikeBrowser(element: HTMLElement): void {
  let top = 0;
  const shown = (): boolean => {
    for (let at: HTMLElement | null = element; at; at = at.parentElement) {
      if (at.hidden) return false;
    }
    return true;
  };
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => (shown() ? top : 0),
    set: (value: number) => {
      if (shown()) top = value;
    },
  });
}
