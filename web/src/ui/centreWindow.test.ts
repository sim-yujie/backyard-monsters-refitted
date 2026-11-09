// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CENTRE_WINDOW_CLASS,
  CENTRED_LAYOUT_QUERY,
  centreWindow,
  centredLayout,
  closeCentreWindow,
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
    expect(rule).toContain("--centre-top: calc(var(--hud-height) + var(--space-3));");
    expect(rule).toContain("inset: var(--centre-top) 0 var(--centre-bottom);");
    expect(rule).toContain("margin: auto;");
    expect(rule).toContain("transform: none;");
  });

  it("keeps each window's own height, never taller than the band", () => {
    expect(rule).toContain("height: var(--centre-height, max-content);");
    expect(rule).toContain("max-height: calc(100% - var(--centre-top) - var(--centre-bottom));");
  });

  it("lets the notices show over a middle window", () => {
    const hud = read("styles/yard-hud.css");
    expect(hud).toMatch(/\.yard-notices \{\n {2}z-index: calc\(var\(--z-hud\) \+ 1\);/);
  });
});
