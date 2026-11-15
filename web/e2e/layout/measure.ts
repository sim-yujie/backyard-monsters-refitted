/**
 * What the layout check measures on one open window, in the page.
 *
 * `checkWindow` runs inside the browser (it is passed to `page.evaluate`, so
 * it must not use anything from outside its own body) and returns every rule
 * the window breaks, in plain words. The rules (owner, 15 Nov 2026,
 * .claude/skills/layout-rules/SKILL.md):
 *
 * - the window box is inside the screen;
 * - on the centred (non-phone) layout it is no taller than the screen below
 *   the top bar;
 * - its close button, title and tabs are on the screen and nothing covers
 *   the close button (a tab row inside the box that scrolls, such as the
 *   Champion's Mode tabs, scrolls with the content and is not judged);
 * - its list (the biggest box that scrolls, else the body) shows at least a
 *   few rows (`minList` px), or all of its content when that is shorter; a
 *   window that already fills the screen below the top bar cannot give its
 *   list more, and needs only `minListFull` px (two rows);
 * - something is actually drawn in the visible part of the list, and when the
 *   window names its items (`itemSelector`) one of them is in view.
 *
 * "Visible" means the part of a box left after cutting it to the screen and
 * to every parent that clips (overflow other than visible); a box that is
 * merely in the DOM, or scrolled out of its parent, does not count.
 */

export interface CheckArgs {
  /** The window's own class on its `.panel`, e.g. ".build-menu". */
  readonly panelSelector: string;
  /** Items that must be in view, e.g. ".build-tile". */
  readonly itemSelector: string | null;
  /** The fewest pixels of list a window may show (a few rows). */
  readonly minList: number;
  /** The fewest when the window already fills the screen below the top bar. */
  readonly minListFull: number;
  /** Rounding slack, in pixels. */
  readonly tolerance: number;
}

export interface CheckReport {
  readonly found: boolean;
  readonly phoneLayout: boolean;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly panel: {
    readonly top: number;
    readonly left: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly listHeight: number;
  readonly problems: readonly string[];
  readonly notes: readonly string[];
}

export const checkWindow = (args: CheckArgs): CheckReport => {
  interface Box {
    top: number;
    left: number;
    bottom: number;
    right: number;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tol = args.tolerance;
  const problems: string[] = [];
  const notes: string[] = [];
  const screen: Box = { top: 0, left: 0, bottom: vh, right: vw };
  const phoneLayout = window.matchMedia("(width <= 620px), (height <= 500px)").matches;

  const round = (value: number): number => Math.round(value);
  const height = (box: Box): number => Math.max(0, box.bottom - box.top);
  const width = (box: Box): number => Math.max(0, box.right - box.left);
  const intersect = (a: Box, b: Box): Box => ({
    top: Math.max(a.top, b.top),
    left: Math.max(a.left, b.left),
    bottom: Math.min(a.bottom, b.bottom),
    right: Math.min(a.right, b.right),
  });
  const boxOf = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
  };
  const describe = (element: Element | null): string => {
    if (!element) return "nothing";
    const classes =
      typeof element.className === "string"
        ? element.className.trim().split(/\s+/).slice(0, 2)
        : [];
    return `${element.tagName.toLowerCase()}${classes.length ? `.${classes.join(".")}` : ""}`;
  };
  const shown = (element: Element): boolean => {
    for (let at: Element | null = element; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) < 0.05
      )
        return false;
      if (at instanceof HTMLElement && at.hidden) return false;
    }
    return true;
  };
  /** The part of an element left after the screen and every clipping parent cut it. */
  const visibleBox = (element: Element): Box => {
    let box = intersect(boxOf(element), screen);
    let fixed = getComputedStyle(element).position === "fixed";
    // The body's and the page's overflow belong to the screen, already cut above.
    for (
      let at = element.parentElement;
      at && at !== document.body && at !== document.documentElement;
      at = at.parentElement
    ) {
      const style = getComputedStyle(at);
      // A fixed box escapes its parents' clipping unless one of them makes a
      // containing block for it (a transform, filter or containment).
      const contains =
        style.transform !== "none" ||
        style.filter !== "none" ||
        /paint|strict|content/.test(style.contain);
      if (fixed && !contains) continue;
      if (contains) fixed = false;
      if (style.position === "fixed") fixed = true;
      if (style.overflowX !== "visible" || style.overflowY !== "visible")
        box = intersect(box, boxOf(at));
    }
    return box;
  };
  const hitInside = (box: Box, owner: Element): Element | null | true => {
    if (width(box) < 1 || height(box) < 1) return null;
    const hit = document.elementFromPoint(
      (box.left + box.right) / 2,
      (box.top + box.bottom) / 2,
    );
    return hit && owner.contains(hit) ? true : hit;
  };

  const panels = [...document.querySelectorAll(`.overlay__layer ${args.panelSelector}`)].filter(
    (element) => shown(element) && element.getBoundingClientRect().width > 0,
  );
  const panel = panels[panels.length - 1];
  if (!panel) {
    return {
      found: false,
      phoneLayout,
      viewport: { width: vw, height: vh },
      panel: null,
      listHeight: 0,
      problems: [`the window (${args.panelSelector}) is not on the screen`],
      notes,
    };
  }

  // The window box.
  const own = boxOf(panel);
  if (own.top < -tol || own.left < -tol || own.bottom > vh + tol || own.right > vw + tol) {
    problems.push(
      `window sticks out of the ${vw}x${vh} screen: top ${round(own.top)}, bottom ${round(own.bottom)}, ` +
        `left ${round(own.left)}, right ${round(own.right)}`,
    );
  }
  const hud = document.querySelector(".hud");
  const hudBottom = hud && shown(hud) ? Math.max(0, hud.getBoundingClientRect().bottom) : 0;
  if (!phoneLayout && height(own) > vh - hudBottom + tol) {
    problems.push(
      `window is ${round(height(own))} px tall, taller than the ${round(vh - hudBottom)} px below the top bar`,
    );
  }

  // Close button: on the screen and not covered.
  const close = [...panel.querySelectorAll('button[aria-label^="Close"]')].find(shown) ?? null;
  if (!close) {
    problems.push("no close button is showing");
  } else {
    const box = visibleBox(close);
    const full = boxOf(close);
    if (height(box) < height(full) * 0.6 || width(box) < width(full) * 0.6) {
      problems.push(
        `close button is cut off (${round(width(box))}x${round(height(box))} px of it shows)`,
      );
    } else {
      const hit = hitInside(box, close);
      if (hit !== true) problems.push(`close button is covered by ${describe(hit)}`);
    }
  }

  // Title: on the screen when the window draws one.
  const title = panel.querySelector(".panel__title");
  if (title && shown(title) && height(boxOf(title)) > 1) {
    if (height(visibleBox(title)) < height(boxOf(title)) * 0.5)
      problems.push("title is cut off");
  } else {
    notes.push("no drawn .panel__title (painted or hidden title)");
  }

  // Tabs: in sight from top to bottom. A tab row that scrolls sideways may
  // hide a tab to the side; that one is skipped.
  const scrolls = (element: Element): boolean => {
    const style = getComputedStyle(element);
    return style.overflowY === "auto" || style.overflowY === "scroll";
  };
  const inScroller = (element: Element): boolean => {
    for (let at = element.parentElement; at && at !== panel; at = at.parentElement)
      if (scrolls(at)) return true;
    return false;
  };
  const tabs = [...panel.querySelectorAll('[role="tab"], .tabs__tab')].filter(shown);
  let scrolledTabs = 0;
  for (const tab of tabs) {
    if (inScroller(tab)) {
      scrolledTabs += 1;
      continue;
    }
    const box = visibleBox(tab);
    if (width(box) < 1) continue;
    if (height(box) < height(boxOf(tab)) * 0.5) {
      problems.push(`tab "${(tab.textContent ?? "").trim().slice(0, 24)}" is cut off`);
    }
  }

  if (scrolledTabs > 0) notes.push(`${scrolledTabs} tabs inside the list, not judged`);

  // The list: the biggest box that scrolls, else the body.
  const body =
    panel.querySelector(":scope > .panel__body") ?? panel.querySelector(".panel__body");
  const scrollers = [...panel.querySelectorAll("*")].filter(
    (element) => scrolls(element) && shown(element),
  );
  const list =
    scrollers.reduce<Element | null>(
      (best, element) =>
        best === null || element.scrollHeight > best.scrollHeight ? element : best,
      null,
    ) ?? body;
  // A window that already runs from just under the top bar to near the
  // screen's foot cannot give its list more: two rows are then enough
  // (owner's rule "about 120px", lead to confirm; phone on its side, 15 Nov).
  const fillsScreen = own.top <= hudBottom + 48 && own.bottom >= vh - 24;
  const minList = fillsScreen ? Math.min(args.minList, args.minListFull) : args.minList;
  if (fillsScreen) notes.push("fills the screen below the top bar");
  let listHeight = 0;
  if (!list) {
    problems.push("the window has no body or list");
  } else {
    const listBox = visibleBox(list);
    listHeight = round(height(listBox));
    const need = Math.min(minList, list.scrollHeight);
    if (height(listBox) + tol < need) {
      problems.push(
        `list (${describe(list)}) shows ${listHeight} px, needs ${round(need)} px ` +
          `(its content is ${list.scrollHeight} px tall)`,
      );
    }
    if (body && body !== list) {
      const bodyBox = visibleBox(body);
      const bodyNeed = Math.min(minList, body.scrollHeight);
      if (height(bodyBox) + tol < bodyNeed) {
        problems.push(`body shows ${round(height(bodyBox))} px, needs ${round(bodyNeed)} px`);
      }
    }

    // Something drawn in the visible part of the list.
    const drawn = [...list.querySelectorAll("*")].some((element) => {
      const leaf =
        element.childElementCount === 0 ||
        /^(IMG|SVG|CANVAS|BUTTON|INPUT|PICTURE)$/i.test(element.tagName);
      if (!leaf || !shown(element)) return false;
      const box = intersect(boxOf(element), listBox);
      return width(box) >= 4 && height(box) >= 4;
    });
    if (!drawn) problems.push(`list (${describe(list)}) shows nothing`);

    if (args.itemSelector) {
      const items = [...panel.querySelectorAll(args.itemSelector)].filter(shown);
      const inView = items.find((item) => {
        const box = visibleBox(item);
        return height(box) >= Math.min(24, height(boxOf(item)) * 0.5) && width(box) >= 4;
      });
      if (!inView) {
        problems.push(`no ${args.itemSelector} in view (${items.length} in the window)`);
      } else {
        const hit = hitInside(visibleBox(inView), panel);
        if (hit !== true)
          problems.push(
            `the first ${args.itemSelector} in view is covered by ${describe(hit)}`,
          );
      }
    }
  }

  return {
    found: true,
    phoneLayout,
    viewport: { width: vw, height: vh },
    panel: {
      top: round(own.top),
      left: round(own.left),
      width: round(width(own)),
      height: round(height(own)),
    },
    listHeight,
    problems,
    notes,
  };
};

/** What the page says about its own input and layout, recorded per profile. */
export interface PageFacts {
  readonly coarse: boolean;
  readonly hoverNone: boolean;
  readonly maxTouchPoints: number;
  readonly phoneLayout: boolean;
  readonly viewport: string;
  readonly visualViewport: string;
  readonly userAgent: string;
}

export const pageFacts = (): PageFacts => ({
  coarse: window.matchMedia("(pointer: coarse)").matches,
  hoverNone: window.matchMedia("(hover: none)").matches,
  maxTouchPoints: navigator.maxTouchPoints,
  phoneLayout: window.matchMedia("(width <= 620px), (height <= 500px)").matches,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  visualViewport: window.visualViewport
    ? `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)}`
    : "none",
  userAgent: navigator.userAgent,
});
