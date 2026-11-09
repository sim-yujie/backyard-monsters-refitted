// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CENTRE_DOCK_GAP,
  CENTRE_MIN_BOTTOM,
  CENTRE_SIDE_GAP,
  CENTRE_TOP_GAP,
  CENTRE_WINDOW_CLASS,
  CENTRED_LAYOUT_QUERY,
  centreWindow,
  centredLayout,
  closeCentreWindow,
  fitCentreWindow,
  onCentreWindowOpen,
  openCentreWindow,
} from "./centreWindow";

/**
 * Owner, 9 Nov 2026 (option A): on a computer the game's windows open in the
 * true middle of the screen, as the pop-ups do, one at a time; only the
 * building panel, the planner's tools, world chat and the attack screen's
 * tools stay at the side. jsdom lays nothing out, so the CSS and the window
 * list are read as text.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, path), "utf8").replace(/\r\n/g, "\n");

/** A window that shows and hides, as the Monsters screen does. */
const fakeWindow = () => {
  const element = document.createElement("section");
  element.className = "panel";
  element.hidden = true;
  document.body.append(element);
  const close = vi.fn(() => {
    element.hidden = true;
    centre.closed();
  });
  const centre = centreWindow(element, close);
  const open = (): void => {
    element.hidden = false;
    centre.opened();
  };
  return { element, close, open, centre };
};

afterEach(() => {
  closeCentreWindow();
  document.body.replaceChildren();
});

describe("centreWindow: one middle window at a time", () => {
  it("marks the window with the class ui.css centres", () => {
    const { element } = fakeWindow();
    expect(element.classList.contains(CENTRE_WINDOW_CLASS)).toBe(true);
  });

  it("closes the window open before, and only that one", () => {
    const shop = fakeWindow();
    const mail = fakeWindow();
    shop.open();
    expect(openCentreWindow()).toBe(shop.element);
    mail.open();
    expect(shop.close).toHaveBeenCalledTimes(1);
    expect(shop.element.hidden).toBe(true);
    expect(mail.close).not.toHaveBeenCalled();
    expect(openCentreWindow()).toBe(mail.element);
  });

  it("does not close a window opened again over itself (a tab change)", () => {
    const monsters = fakeWindow();
    monsters.open();
    monsters.open();
    expect(monsters.close).not.toHaveBeenCalled();
    expect(openCentreWindow()).toBe(monsters.element);
  });

  it("forgets a window that closed itself", () => {
    const goals = fakeWindow();
    goals.open();
    goals.close();
    expect(openCentreWindow()).toBeNull();
    const events = fakeWindow();
    events.open();
    expect(goals.close).toHaveBeenCalledTimes(1);
  });

  it("leaves alone a window a scene left behind, off the page", () => {
    const old = fakeWindow();
    old.open();
    old.element.remove();
    fakeWindow().open();
    expect(old.close).not.toHaveBeenCalled();
  });

  it("tells listeners each time one opens (the yard closes its building panel)", () => {
    const heard = vi.fn();
    const stop = onCentreWindowOpen(heard);
    const build = fakeWindow();
    build.open();
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    fakeWindow().open();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("closeCentreWindow shuts the open one (a building's panel opening)", () => {
    const quests = fakeWindow();
    quests.open();
    closeCentreWindow();
    expect(quests.close).toHaveBeenCalledTimes(1);
    expect(openCentreWindow()).toBeNull();
  });
});

describe("centreWindow: computer or phone", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the same screens ui.css centres on", () => {
    const ask = vi.fn(() => ({ matches: false }) as MediaQueryList);
    vi.stubGlobal("matchMedia", ask);
    expect(centredLayout()).toBe(false);
    expect(ask).toHaveBeenCalledWith(CENTRED_LAYOUT_QUERY);
    expect(read("styles/ui.css")).toContain(`@media ${CENTRED_LAYOUT_QUERY} {\n  .overlay__layer > .panel.panel--centre {`);
  });
});

describe("Middle windows: which windows", () => {
  /** Every window the owner wants in the middle, by its source. */
  const MIDDLE = [
    "monsters/MonstersScreen.ts", // Locker, Hatch, Housing, Train, Lab tabs
    "siege/SiegeScreen.ts",
    "yard/ShopScreen.ts",
    "mail/MailboxScreen.ts",
    "friends/FriendsScreen.ts",
    "achievements/AchievementsScreen.ts",
    "defences/DefencesScreen.ts",
    "notifications/NotificationPanel.ts",
    "goals/GoalsPanel.ts",
    "events/EventsPanel.ts",
    "quests/QuestsPanel.ts",
    "yard/BuildMenu.ts",
  ];

  /** The four kept at the side on purpose. */
  const SIDE = [
    "yard/BuildingPanel.ts", // the building panel, right
    "friends/HelpPanel.ts", // a friend's building's help, in the same dock
    "yard/PlannerBar.ts", // the planner's tools
    "yard/ComparePanel.ts",
    "yard/CoveragePanel.ts",
    "chat/WorldChatBox.ts", // world chat
    "chat/ChatBox.ts",
    "attack/ArmyPanel.ts", // the attack screen's tools
    "attack/AttackMenu.ts",
    "attack/SiegePanel.ts",
    "attack/CatapultPanel.ts",
  ];

  it.each(MIDDLE)("%s opens in the middle, and says when it shows and shuts", (path) => {
    const source = read(path);
    expect(source).toMatch(/this\.centre = centreWindow\(this\.element, \(\) => this\.close\(\)\);/);
    expect(source).toContain("this.centre.opened();");
    expect(source).toContain("this.centre.closed();");
  });

  it.each(SIDE)("%s stays at the side", (path) => {
    const source = read(path);
    expect(source).not.toContain("centreWindow");
    expect(source).not.toContain(CENTRE_WINDOW_CLASS);
  });

  it("has no window standing beside the building panel any more", () => {
    for (const path of ["styles/monsters.css", "styles/shop.css", "styles/hatch.css", "styles/skin.css", "styles/building-panel.css"]) {
      expect(read(path)).not.toContain("--beside-panel");
    }
  });
});

describe("Middle windows: the shared rule", () => {
  const css = read("styles/ui.css");
  const rule = (() => {
    const at = css.indexOf(".overlay__layer > .panel.panel--centre {");
    return css.slice(at, css.indexOf("}", at));
  })();

  it("centres on both axes in the band between the HUD and the dock row", () => {
    expect(rule).toContain("--centre-top: calc(var(--hud-height) + var(--centre-overhang, 0px) + var(--space-2));");
    expect(rule).toContain("inset: var(--centre-top) 0 var(--centre-bottom);");
    expect(rule).toContain("margin: auto;");
    expect(rule).toContain("transform: none;");
  });

  it("keeps each window's own height, never taller than the band", () => {
    expect(rule).toContain("height: var(--centre-height, max-content);");
    expect(rule).toContain("max-height: calc(100% - var(--centre-top) - var(--centre-bottom));");
  });

  it("draws a middle window over the dock, Events and the zoom rail, and the notices over it", () => {
    expect(rule).toContain("z-index: calc(var(--z-hud) + 1);");
    const hud = read("styles/yard-hud.css");
    expect(hud).toMatch(/\.yard-notices \{\n {2}z-index: calc\(var\(--z-hud\) \+ 2\);/);
  });

  it("leaves room above the frame for the painted name plate and close X", () => {
    expect(css).toContain(
      ":root[data-skin] .overlay__layer > .panel.panel--centre {\n    --centre-overhang: max(12px, var(--skin-title-lift) - var(--skin-edge));",
    );
  });
});

describe("Middle windows: never over the dock (tester, 9 Nov)", () => {
  const css = read("styles/ui.css");
  /** 1280x720: the HUD's Events button top right, the dock row along the bottom. */
  const screen = { width: 1280, height: 720 };
  const events = { left: 1196, top: 104, right: 1264, bottom: 190 };
  const monsters = { left: 1044, top: 582, right: 1136, bottom: 690 };
  const build = { left: 1160, top: 568, right: 1252, bottom: 694 };
  const map = { left: 24, top: 600, right: 100, bottom: 694 };

  it("keeps the band's bottom above the top of each dock button under the window", () => {
    const fit = fitCentreWindow(screen, 1100, [monsters, map]);
    expect(fit.bottom).toBe(720 - monsters.top + CENTRE_DOCK_GAP);
  });

  it("does not shrink a window for a dock button beside it, not under it", () => {
    expect(fitCentreWindow(screen, 600, [monsters, build, map]).bottom).toBe(CENTRE_MIN_BOTTOM);
  });

  it("goes by the tallest button under the window, its badge included", () => {
    const withBadge = { ...monsters, top: monsters.top - 10 };
    expect(fitCentreWindow(screen, 1100, [withBadge, map]).bottom).toBe(720 - withBadge.top + CENTRE_DOCK_GAP);
  });

  it("narrows a wide window to clear the Events column, close X and all, still centred", () => {
    const fit = fitCentreWindow(screen, 1208, [events]);
    expect(fit.maxWidth).toBe(1280 - 2 * (1280 - events.left + CENTRE_SIDE_GAP));
    expect(fitCentreWindow(screen, 900, [events]).maxWidth).toBeNull();
  });

  it("checks the dock under the narrowed width, not the window's own", () => {
    // 1208 wide would reach Kits in the corner; narrowed to clear Events it stops short of it.
    const kits = { left: 1185, top: 590, right: 1260, bottom: 694 };
    expect(fitCentreWindow(screen, 1208, [kits]).bottom).toBeGreaterThan(CENTRE_MIN_BOTTOM);
    const fit = fitCentreWindow(screen, 1208, [events, kits]);
    expect(fit.maxWidth).not.toBeNull();
    expect(fit.bottom).toBe(CENTRE_MIN_BOTTOM);
  });

  it("has no short-screen exception: the band's bottom is the dock, whatever the height", () => {
    expect(css).not.toMatch(/height <= 760px/);
    expect(css.match(/--centre-bottom:/g)).toHaveLength(1);
  });

  it("measures the dock in the page and sets the band and the notices' place", () => {
    const layer = document.createElement("div");
    layer.className = "overlay__layer";
    const box = (element: Element, left: number, top: number, width: number, height: number): void => {
      element.getBoundingClientRect = () => new DOMRect(left, top, width, height);
    };
    box(layer, 0, 0, 1280, 720);
    const dock = document.createElement("div");
    dock.className = "yard-dock";
    const door = document.createElement("button");
    door.className = "yard-dock__button events-door";
    box(door, events.left, events.top, events.right - events.left, events.bottom - events.top);
    const right = document.createElement("div");
    right.className = "yard-dock__right";
    const more = document.createElement("div");
    more.className = "bubble-menu";
    box(more, 944, 590, 92, 100);
    const badge = document.createElement("span");
    badge.className = "yard-dock__badge bubble-menu__badge";
    box(badge, 1010, 578, 22, 22);
    more.append(badge);
    right.append(more);
    dock.append(door, right);
    const element = document.createElement("section");
    element.className = "panel";
    Object.defineProperty(element, "offsetWidth", { value: 1208 });
    box(element, 100, 94, 1080, 460);
    const bar = document.createElement("div");
    bar.className = "panel__titlebar";
    box(bar, 100, 94, 1080, 52);
    element.append(bar);
    layer.append(dock, element);
    document.body.append(layer);
    centreWindow(element, () => undefined).opened();
    expect(element.style.maxWidth).toBe(`${1280 - 2 * (1280 - events.left + CENTRE_SIDE_GAP)}px`);
    expect(element.style.getPropertyValue("--centre-bottom")).toBe(`${720 - 578 + CENTRE_DOCK_GAP}px`);
    expect(layer.style.getPropertyValue("--centre-notice-top")).toBe(`${94 + 52 + 8}px`);
  });

  it("starts the band under the HUD, leaving room for the name plate sticking up", () => {
    const layer = document.createElement("div");
    layer.className = "overlay__layer";
    const box = (element: Element, left: number, top: number, width: number, height: number): void => {
      element.getBoundingClientRect = () => new DOMRect(left, top, width, height);
    };
    box(layer, 0, 0, 1280, 720);
    const hud = document.createElement("div");
    hud.className = "hud hud--corner";
    box(hud, 16, 16, 1248, 79);
    const dock = document.createElement("div");
    dock.className = "yard-dock";
    const element = document.createElement("section");
    element.className = "panel";
    Object.defineProperty(element, "offsetWidth", { value: 440 });
    box(element, 420, 98, 440, 400);
    const bar = document.createElement("div");
    bar.className = "panel__titlebar";
    box(bar, 444, 122, 392, 30);
    const plate = document.createElement("h2");
    plate.className = "panel__title";
    box(plate, 540, 98 - 14, 200, 48);
    const close = document.createElement("button");
    box(close, 838, 98 - 12, 46, 46);
    bar.append(plate, close);
    element.append(bar);
    layer.append(dock, element);
    document.body.append(hud, layer);
    centreWindow(element, () => undefined).opened();
    expect(element.style.getPropertyValue("--centre-top")).toBe(`${95 + 14 + CENTRE_TOP_GAP}px`);
  });

  it("reads the window's minimum width from its CSS and keeps it, over Events", () => {
    const layer = document.createElement("div");
    layer.className = "overlay__layer";
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 1280, 720);
    const dock = document.createElement("div");
    dock.className = "yard-dock";
    const door = document.createElement("button");
    door.getBoundingClientRect = () =>
      new DOMRect(events.left, events.top, events.right - events.left, events.bottom - events.top);
    dock.append(door);
    const element = document.createElement("section");
    element.className = "panel";
    element.style.setProperty("--centre-min-width", "1212px");
    Object.defineProperty(element, "offsetWidth", { value: 1212 });
    element.getBoundingClientRect = () => new DOMRect(34, 115, 1212, 560);
    layer.append(dock, element);
    document.body.append(layer);
    centreWindow(element, () => undefined).opened();
    expect(element.style.maxWidth).toBe("");
  });

  it("hangs the yard's notices under the open window's title bar, not on it", () => {
    expect(css).toContain(
      ".overlay__layer:has(> .panel--centre:not([hidden])) > .yard-notices {\n    top: var(--centre-notice-top,",
    );
  });
});

describe("Middle windows: never smaller than their minimum (tester-41, 9 Nov)", () => {
  /** 1280x720, as measured: Events under the HUD, the dock row along the bottom. */
  const screen = { width: 1280, height: 720 };
  const events = { left: 1196, top: 104, right: 1264, bottom: 190 };
  const mainYard = { left: 24, top: 490, right: 118, bottom: 590 };
  const collect = { left: 840, top: 580, right: 935, bottom: 704 };
  const more = { left: 956, top: 595, right: 1024, bottom: 690 };
  const dock = [events, mainYard, collect, more];
  /** HUD bottom 95 + the plate's 14 + the gap. */
  const top = 95 + 14 + CENTRE_TOP_GAP;

  it("keeps a wide window's minimum width, covering Events rather than squeezing its content", () => {
    // The Hatch tab: 1212px with its frame, all of it needed for one row of slots.
    const fit = fitCentreWindow(screen, 1212, [events], { minWidth: 1212 });
    expect(fit.maxWidth).toBeNull();
    expect(fit.over).toBe(true);
  });

  it("still narrows to clear Events when that leaves it its minimum", () => {
    const fit = fitCentreWindow(screen, 1208, [events], { minWidth: 900 });
    expect(fit.maxWidth).toBe(1280 - 2 * (1280 - events.left + CENTRE_SIDE_GAP));
    expect(fit.over).toBe(false);
  });

  it("narrows only as far as the minimum when Events is too far in", () => {
    const fit = fitCentreWindow(screen, 1208, [events], { minWidth: 1100 });
    expect(fit.maxWidth).toBe(1100);
    expect(fit.over).toBe(true);
  });

  it("stays above the dock when the band holds its minimum height", () => {
    const fit = fitCentreWindow(screen, 700, dock, { top, minHeight: 400 });
    expect(fit.bottom).toBe(720 - collect.top + CENTRE_DOCK_GAP);
    expect(fit.over).toBe(false);
  });

  it("reaches over the dock on a short screen rather than shrink below its minimum", () => {
    // Hatch or Build at 1280x720: the dock leaves ~450px, the window needs 560.
    const fit = fitCentreWindow(screen, 1212, dock, { top, minWidth: 1212, minHeight: 560 });
    expect(fit.bottom).toBe(CENTRE_MIN_BOTTOM);
    expect(fit.over).toBe(true);
  });

  it("stops above the first dock button down that leaves it its minimum", () => {
    // Build at 900x1000: over Collect all, still clear of the Build button under it.
    const tall = { width: 900, height: 1000 };
    const collectAll = { left: 780, top: 720, right: 875, bottom: 840 };
    const buildButton = { left: 780, top: 850, right: 875, bottom: 975 };
    const fit = fitCentreWindow(tall, 868, [collectAll, buildButton], { top, minHeight: 640 });
    expect(fit.bottom).toBe(1000 - buildButton.top + CENTRE_DOCK_GAP);
    expect(fit.over).toBe(true);
  });

  it("has no minimum height without a measured top", () => {
    expect(fitCentreWindow(screen, 1212, dock, { minHeight: 560 }).bottom).toBe(720 - mainYard.top + CENTRE_DOCK_GAP);
  });

  it("gives the Monsters screen, its Hatch tab and Build their minimums in CSS", () => {
    expect(read("styles/monsters.css")).toContain("--centre-min-height: 560px;");
    expect(read("styles/hatch.css")).toContain("--centre-min-width: 1212px;");
    const build = read("styles/build-menu.css");
    expect(build).toContain("--centre-min-width: 1200px;");
    expect(build).toContain("--centre-min-height: 640px;");
  });

  it("lets Build's tiles reflow to fewer columns, never squash, and names break between words", () => {
    const build = read("styles/build-menu.css");
    expect(build).toContain(
      "grid-template-columns: repeat(auto-fill, minmax(max(108px, calc((100% - 4 * var(--space-3)) / 5)), 1fr));",
    );
    expect(build).toMatch(/\.build-tile__name \{\n {4}overflow-wrap: break-word;/);
  });

  it("wraps a hatchery's slots rather than sliding sideways when too narrow for one row", () => {
    expect(read("styles/hatch.css")).toMatch(
      /@container hatch \(560px <= width < 1092px\) \{\n {2}\.hatch-line__slots,\n {2}\.hatch-line__now \{\n {4}flex-wrap: wrap;/,
    );
  });
});
