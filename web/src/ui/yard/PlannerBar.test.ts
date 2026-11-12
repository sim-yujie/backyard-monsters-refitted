// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import { YardView } from "@/game/yard/YardRenderer";
import { PlannerBar, type PlannerBarActions } from "./PlannerBar";
import { PlannerLayout } from "./plannerLayout";

/**
 * The planner's bars, and above all what a read-only session leaves out
 * (design §8, Q5).
 *
 * The read-only path has no way into it from the running client yet — every
 * load the yard scene makes is its own base in build mode — so this is the
 * only place the bar's read-only shape is exercised at all.
 */

const noop = (): void => {};

const actions = (): PlannerBarActions => ({
  onTool: noop,
  onView: noop,
  onOverlay: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onFind: noop,
  onLayouts: vi.fn(),
  onChecklist: vi.fn(),
  onUpgradeWalls: vi.fn(),
  onRearmTraps: vi.fn(),
  onApply: vi.fn(),
  onPutBack: vi.fn(),
  onStore: vi.fn(),
  onClearYard: vi.fn(),
  onInventory: vi.fn(),
  onHelp: noop,
  onExit: noop,
});

const stateOf = (overrides: Partial<PlannerState> = {}): PlannerState => ({
  tool: PlannerTool.SELECT,
  selectionCount: 0,
  movedCount: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  slot: null,
  slotName: "",
  dragInvalid: false,
  carrying: false,
  storedCount: 0,
  unplacedCount: 0,
  placing: false,
  view: YardView.BLUEPRINT,
  previewing: false,
  readOnly: false,
  wallPicking: false,
  ...overrides,
});

/** Every button label on the mounted bars, in order. */
const labels = (bar: PlannerBar): string[] =>
  [...bar.toolbar.querySelectorAll("button"), ...bar.actionBar.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "",
  );

const mount = (options: { readOnly?: boolean; layouts?: boolean } = {}): PlannerBar =>
  mountWith(options).bar;

/** The same, keeping hold of the action callbacks so a click can be observed. */
const mountWith = (
  options: { readOnly?: boolean; layouts?: boolean } = {},
): { bar: PlannerBar; fired: PlannerBarActions } => {
  const container = document.createElement("div");
  document.body.append(container);
  const fired = actions();
  return { bar: new PlannerBar(fired, options).mount(container), fired };
};

describe("the editing bar", () => {
  it("carries the actions that write to the yard", () => {
    const bar = mount();
    bar.update(stateOf());
    expect(labels(bar)).toContain("Apply");
    expect(labels(bar)).toContain("Layouts");
    expect(labels(bar)).toContain("Undo");
  });

  it("has no Layouts on an outpost, which keeps no layout slots (#191)", () => {
    const bar = mount({ layouts: false });
    bar.update(stateOf());
    const layouts = [...bar.actionBar.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Layouts",
    );
    expect(layouts?.hidden ?? true).toBe(true);
    expect(labels(bar)).toContain("Apply");
  });

  it("names the loaded slot and marks it unsaved", () => {
    const bar = mount();
    bar.update(stateOf({ slotName: "Turtle", dirty: true }));
    expect(bar.toolbar.querySelector(".planner-bar__slot")?.textContent).toBe("Turtle · unsaved");
  });
});

describe("the put-back chip (F14)", () => {
  /** The chip, which is in the DOM whether or not it is on screen. */
  const chip = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.actionBar.querySelector(".planner-bar__put-back");

  it("appears only while something is in hand", () => {
    const bar = mount();
    bar.update(stateOf());
    expect(chip(bar)?.hidden).toBe(true);

    bar.update(stateOf({ carrying: true, selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(false);

    bar.update(stateOf({ carrying: false, selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(true);
  });

  it("puts the selection back when it is pressed", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ carrying: true, selectionCount: 1 }));

    chip(bar)?.click();
    expect(fired.onPutBack).toHaveBeenCalledTimes(1);
  });

  it("is not mounted at all in a read-only session", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));
    expect(chip(bar)).toBeNull();
  });
});

describe("the read-only bar", () => {
  it("leaves out every control that would change the yard", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const shown = labels(bar);
    for (const gone of ["Apply", "Layouts", "Checklist", "Upgrade walls", "Undo", "Redo"]) {
      expect(shown).not.toContain(gone);
    }
    expect(bar.actionBar.querySelector(".planner-bar__rearm")).toBeNull();
  });

  it("keeps the tools that only answer questions", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const shown = labels(bar);
    for (const kept of ["Select", "Box", "Find", "3D", "Blueprint", "Leave planner"]) {
      expect(shown).toContain(kept);
    }
    // The bottom bar is buttons only now (owner, 2026-11-04): no cost cells.
    expect(bar.actionBar.querySelectorAll(".planner-cost__cell")).toHaveLength(0);
  });

  it("says Read-only where the slot name goes, and why in the tooltip", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const slot = bar.toolbar.querySelector(".planner-bar__slot");
    expect(slot?.textContent).toBe("Read-only");
    expect(slot?.classList.contains("planner-bar__slot--read-only")).toBe(true);
    expect(slot?.getAttribute("title")).toContain("build mode");
  });

  it("never offers Upgrade walls, which would change the yard", () => {
    const bar = mount({ readOnly: true });
    bar.setWallCount(12);
    expect(labels(bar)).not.toContain("Upgrade walls");
  });

  it("cannot be talked back into enabling an action", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    // The counts a selection would normally use to light these up.
    bar.setWallCount(12);
    bar.setRearmCount(4);
    bar.setBlocking(0);

    expect(labels(bar)).not.toContain("Upgrade walls");
    // The Cost button only opens the cost pop-up, which changes nothing.
    expect(bar.actionBar.querySelector("button:not([disabled]):not(.planner-bar__cost-line)")).toBeNull();
  });
});

/**
 * The demos that replaced the tooltips (#49).
 *
 * The owner's verdict on the old ones was "your words aren't exactly helpful",
 * and the fix is a picture of the move. What can be checked here is that the
 * picture reaches the player: on hover, on a disabled control as much as a
 * live one, and without the `title` a screen reader relies on going anywhere.
 */
describe("the tool demos", () => {
  const popovers = (): Element[] => [...document.querySelectorAll(".popover")];

  const hover = (element: Element): void => {
    element.dispatchEvent(new Event("pointerenter"));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    for (const stale of popovers()) stale.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a moving picture when Store is hovered", () => {
    const bar = mount();
    const tip = bar.toolbar.querySelector(".planner-tip");
    expect(tip).not.toBeNull();

    hover(tip!);
    // Not instantly: sweeping a pointer across the bar should not strobe.
    expect(popovers()).toHaveLength(0);
    vi.advanceTimersByTime(400);

    const [bubble] = popovers();
    expect(bubble).toBeDefined();
    expect(bubble?.querySelector("svg.planner-demo")).not.toBeNull();
    bar.destroy();
  });

  it("shows one for a tool that is off, with the reason it is off", () => {
    const bar = mount();
    const wrapper = bar.toolbar.querySelector<HTMLElement>(".planner-tip")!;
    expect(wrapper.querySelector("button")?.disabled).toBe(true);
    hover(wrapper);
    vi.advanceTimersByTime(400);

    const [bubble] = popovers();
    expect(bubble?.textContent).toContain("Select something to store");
    expect(bubble?.querySelector("svg.planner-demo")).not.toBeNull();
    bar.destroy();
  });

  it("leaves the native tooltip where the wrapper can still show it", () => {
    const bar = mount();
    const wrapper = bar.toolbar.querySelector<HTMLElement>(".planner-tip")!;
    const button = wrapper.querySelector("button");
    // A disabled button takes no pointer events, so the wrapper carries the
    // same words for the browser to show instead.
    expect(wrapper.title).toBe(button?.title);
    bar.destroy();
  });


  it("takes its bubbles down with it", () => {
    const bar = mount();
    hover(bar.toolbar.querySelector(".planner-tip")!);
    vi.advanceTimersByTime(400);
    expect(popovers()).toHaveLength(1);

    bar.destroy();
    expect(popovers()).toHaveLength(0);
  });
});

describe("store, clear and the drawer (issue #50)", () => {
  const storeButton = (bar: PlannerBar): HTMLButtonElement | null =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Store",
    ) ?? null;

  const chip = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.actionBar.querySelector(".planner-bar__store-chip");

  const drawer = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.toolbar.querySelector(".planner-bar__inventory");

  const yardMenu = (bar: PlannerBar): HTMLButtonElement | null =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>(".planner-menu__trigger")].find(
      (button) => button.textContent?.startsWith("Yard"),
    ) ?? null;

  it("keeps Store off until there is something to store, and says why", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 0 }));
    expect(storeButton(bar)?.disabled).toBe(true);
    expect(storeButton(bar)?.title).toContain("Select something");

    bar.update(stateOf({ selectionCount: 3 }));
    expect(storeButton(bar)?.disabled).toBe(false);
    expect(storeButton(bar)?.title).toContain("all 3");
  });

  it("shows the chip beside the selection, and takes it away mid-carry", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 0 }));
    expect(chip(bar)?.hidden).toBe(true);

    bar.update(stateOf({ selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(false);

    // Something already in hand is not something to store, and the chip would
    // sit next to Put back saying the opposite thing.
    bar.update(stateOf({ selectionCount: 2, carrying: true }));
    expect(chip(bar)?.hidden).toBe(true);
  });

  it("fires the same action from the toolbar and from the chip", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ selectionCount: 1 }));

    storeButton(bar)?.click();
    chip(bar)?.click();

    expect(fired.onStore).toHaveBeenCalledTimes(2);
  });

  it("offers Clear yard in a menu rather than as a bare button", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf());

    const trigger = yardMenu(bar);
    expect(trigger).not.toBeNull();
    trigger?.click();

    const items = [
      ...(trigger?.closest(".planner-menu")?.querySelectorAll<HTMLButtonElement>(
        ".planner-menu__item",
      ) ?? []),
    ];
    expect(items.map((item) => item.textContent)).toEqual(["Clear yard"]);

    items[0]?.click();
    expect(fired.onClearYard).toHaveBeenCalledTimes(1);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shuts the Yard menu while a preview is up", () => {
    const bar = mount();
    bar.update(stateOf({ previewing: true }));
    expect(yardMenu(bar)?.disabled).toBe(true);
    expect(yardMenu(bar)?.title).toContain("preview");
  });

  it("badges the drawer with what it holds, and opens only when it holds something", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ storedCount: 0 }));
    expect(drawer(bar)?.disabled).toBe(true);
    expect(drawer(bar)?.querySelector<HTMLElement>(".planner-bar__badge")?.hidden).toBe(true);

    bar.update(stateOf({ storedCount: 12 }));
    expect(drawer(bar)?.disabled).toBe(false);
    expect(drawer(bar)?.querySelector<HTMLElement>(".planner-bar__badge")?.hidden).toBe(false);
    expect(drawer(bar)?.querySelector(".planner-bar__badge")?.textContent).toBe("12");

    drawer(bar)?.click();
    expect(fired.onInventory).toHaveBeenCalledTimes(1);
  });

  it("gives a read-only session none of it", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true, storedCount: 2 }));

    expect(storeButton(bar)).toBeNull();
    expect(chip(bar)).toBeNull();
    expect(drawer(bar)).toBeNull();
    expect(yardMenu(bar)).toBeNull();
  });
});

describe("the View menu (issues #4 and #54)", () => {
  const viewMenu = (bar: PlannerBar): HTMLButtonElement | null =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>(".planner-menu__trigger")].find(
      (button) => button.textContent?.startsWith("View"),
    ) ?? null;

  const rows = (bar: PlannerBar): HTMLButtonElement[] => [
    ...(viewMenu(bar)
      ?.closest(".planner-menu")
      ?.querySelectorAll<HTMLButtonElement>(".planner-menu__item") ?? []),
  ];

  it("offers the two range families under one switch, the dead zones and the centre mark", () => {
    const bar = mount();
    expect(rows(bar).map((row) => row.textContent)).toEqual([
      "Tower ranges",
      "Land",
      "Air",
      "Dead zones",
      "Centre of yard",
    ]);
  });

  it("reports a press without deciding anything itself", () => {
    const { bar, fired } = mountWith();
    viewMenu(bar)?.click();
    const [ranges, land] = rows(bar);

    ranges?.click();
    land?.click();

    expect(fired.onOverlay).toHaveBeenNthCalledWith(1, "ranges");
    expect(fired.onOverlay).toHaveBeenNthCalledWith(2, "land");
    // A switch leaves the menu up, so two of them are one errand.
    expect(viewMenu(bar)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("ticks what is being drawn, and dims the families while their parent is off", () => {
    const bar = mount();
    const [ranges, land, air, deadZones, centre] = rows(bar);

    bar.setOverlays({ ranges: false, land: true, air: false, centre: true, deadZones: false });
    expect(ranges?.getAttribute("aria-checked")).toBe("false");
    expect(land?.getAttribute("aria-checked")).toBe("true");
    expect(land?.classList.contains("planner-menu__item--dim")).toBe(true);
    expect(air?.getAttribute("aria-checked")).toBe("false");
    expect(centre?.getAttribute("aria-checked")).toBe("true");

    bar.setOverlays({ ranges: true, land: true, air: true, centre: false, deadZones: false });
    expect(ranges?.getAttribute("aria-checked")).toBe("true");
    expect(land?.classList.contains("planner-menu__item--dim")).toBe(false);
    expect(centre?.getAttribute("aria-checked")).toBe("false");
    expect(deadZones?.getAttribute("aria-checked")).toBe("false");

    // Dead zones read Land and Air too (#55), so they are not dimmed then.
    bar.setOverlays({ ranges: false, land: true, air: true, centre: false, deadZones: true });
    expect(deadZones?.getAttribute("aria-checked")).toBe("true");
    expect(land?.classList.contains("planner-menu__item--dim")).toBe(false);
  });

  it("stays in a read-only session, because it changes nothing in the yard", () => {
    const bar = mount({ readOnly: true });
    expect(viewMenu(bar)).not.toBeNull();
    expect(rows(bar)).toHaveLength(5);
  });
});

describe("the Blueprint button (2026-09-30)", () => {
  const blueprint = (bar: PlannerBar): HTMLButtonElement =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>("button")].find(
      (one) => one.textContent === "Blueprint",
    )!;

  it("is off with the reason as its tooltip, and back on with null", () => {
    const bar = mount();
    bar.setBlueprintBlocked("Blueprint view isn't available in outposts");
    expect(blueprint(bar).disabled).toBe(true);
    expect(blueprint(bar).title).toBe("Blueprint view isn't available in outposts");
    expect(blueprint(bar).getAttribute("aria-label")).toBe(
      "Blueprint. Blueprint view isn't available in outposts",
    );

    bar.setBlueprintBlocked(null);
    expect(blueprint(bar).disabled).toBe(false);
    expect(blueprint(bar).title).toContain("Tab switches");
  });
});
/* ── Phones (#45) ─────────────────────────────────────────────────────── */

describe("the phone layout (#45)", () => {
  const phone = (
    layout: PlannerLayout,
    options: { readOnly?: boolean } = {},
  ): { bar: PlannerBar; fired: PlannerBarActions; container: HTMLElement } => {
    const container = document.createElement("div");
    document.body.append(container);
    const fired = { ...actions(), onTool: vi.fn(), onView: vi.fn(), onFind: vi.fn(), onHelp: vi.fn(), onMore: vi.fn() };
    const bar = new PlannerBar(fired, options).mount(container);
    bar.update(stateOf({ view: YardView.ISO }));
    bar.setLayout(layout, true);
    return { bar, fired, container };
  };

  const texts = (root: Element, selector = "button"): string[] =>
    [...root.querySelectorAll<HTMLElement>(selector)].map((element) => element.textContent?.trim() ?? "");

  /** The top bar's buttons a phone shows: those not in a hidden tool group. */
  const topShown = (bar: PlannerBar): string[] =>
    [...bar.toolbar.children]
      .filter((child) => !child.classList.contains("planner-bar__group") || child.classList.contains("planner-bar__group--history"))
      .flatMap((child) => (child instanceof HTMLButtonElement ? [child] : [...child.querySelectorAll("button")]))
      .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "");

  /** The bottom row's button labels, a count badge left out. */
  const actionRow = (bar: PlannerBar): string[] =>
    [...(bar.actionBar.querySelector(".planner-bar__actions") ?? bar.actionBar).querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.firstChild?.textContent?.trim() ?? "",
    );

  it("puts none of the phone's controls on a desktop", () => {
    const bar = mount();
    expect(labels(bar)).not.toContain("More");
    expect(bar.moreElement.isConnected).toBe(false);
  });

  it("upright: Leave, the name, the view switch, then Undo and Redo at the right end of the top bar", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT);
    expect(topShown(bar)).toEqual(["Leave planner", "Showing the 3D yard. Switch to the blueprint", "Undo", "Redo"]);
    // Straight in the bar, not in the hidden history group.
    expect(bar.toolbar.querySelector(":scope > button[data-icon='undo'] + button[data-icon='redo']")).not.toBeNull();
    // Glyphs on the buttons, names for anything that reads them.
    const exit = bar.toolbar.querySelector(".planner-bar__exit");
    expect(exit?.textContent).toBe("✕");
    expect(bar.toolbar.querySelector(".planner-bar__heading .planner-bar__slot")).not.toBeNull();
  });

  it("upright: the presses a session is made of along the bottom, under the thumb", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT);
    // Exactly five, so they fit 360 px: Box 44 + Upgrade walls 44 + Stored
    // ~88 + More 44 + Apply ~88 = 308, four 2 px gaps and 8 px padding each
    // side = 332. No test here lays out pixels; keep this sum when adding one.
    expect(actionRow(bar)).toEqual(["Box", "Upgrade walls", "Stored", "More", "Apply"]);
    expect(bar.actionBar.querySelector("[data-icon='undo'], [data-icon='redo']")).toBeNull();
    // Buttons only: no cost line, no readouts (owner, 2026-11-04).
    expect(bar.actionBar.querySelector(".planner-bar__cost-line")).toBeNull();
    expect(bar.actionBar.querySelector(".planner-cost__cell")).toBeNull();
  });

  it("draws Box, Undo, Redo and Upgrade walls as painted icons, their words for screen readers", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT);
    for (const name of ["box", "undo", "redo", "wallupgrade"]) {
      const icon =
        bar.actionBar.querySelector<HTMLButtonElement>(`button[data-icon="${name}"]`) ??
        bar.toolbar.querySelector<HTMLButtonElement>(`button[data-icon="${name}"]`);
      expect(icon, name).not.toBeNull();
      expect(icon?.getAttribute("aria-label")).toBeTruthy();
      expect(icon?.querySelector("img, .game-icon")).not.toBeNull();
    }
  });

  it("puts everything else in More", () => {
    const { bar, container } = phone(PlannerLayout.PORTRAIT);
    const more = container.querySelector(".planner-more");
    expect(more).toBe(bar.moreElement);
    expect(texts(more!, ".planner-more__list > .btn")).toEqual([
      "Find",
      "Checklist",
      "Layouts",
      "Re-arm traps",
      "Help",
    ]);
    // The View switches and Clear yard, shown as their rows.
    expect(texts(more!, ".planner-menu--inline .planner-menu__item")).toEqual([
      "Tower ranges",
      "Land",
      "Air",
      "Dead zones",
      "Centre of yard",
      "Clear yard",
    ]);
    expect(more!.querySelectorAll(".planner-menu__list[hidden]")).toHaveLength(0);
  });

  it("sideways: one bar, Leave at its start, then the same row with the view switch", () => {
    const { bar } = phone(PlannerLayout.LANDSCAPE);
    expect(bar.toolbar.dataset["layout"]).toBe("landscape");
    const buttons = [...bar.actionBar.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent?.trim(),
    );
    expect(buttons[0]).toBe("Leave planner");
    expect(actionRow(bar)).toEqual(["Box", "Undo", "Redo", "Upgrade walls", "Showing the 3D yard. Switch to the blueprint", "Stored", "More", "Apply"]);
  });

  it("brings Undo and Redo down when turned sideways, and back up when upright again", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT);
    bar.setLayout(PlannerLayout.LANDSCAPE, true);
    expect(actionRow(bar).slice(0, 3)).toEqual(["Box", "Undo", "Redo"]);
    bar.setLayout(PlannerLayout.PORTRAIT, true);
    expect(actionRow(bar)).toEqual(["Box", "Upgrade walls", "Stored", "More", "Apply"]);
    expect(topShown(bar).slice(-2)).toEqual(["Undo", "Redo"]);
  });

  it("puts every control back where it was when the window turns back into a desktop", () => {
    const desk = mount();
    desk.update(stateOf({ view: YardView.ISO }));
    const before = labels(desk);
    const { bar, container } = phone(PlannerLayout.PORTRAIT);
    bar.setLayout(PlannerLayout.LANDSCAPE, true);
    bar.setLayout(PlannerLayout.DESKTOP, false);
    expect(labels(bar)).toEqual(before);
    expect(container.querySelectorAll(".planner-more")).toHaveLength(0);
    // The phone rules key off this, so a desktop must not keep it.
    expect(bar.toolbar.dataset["layout"]).toBeUndefined();
    expect(bar.actionBar.dataset["layout"]).toBeUndefined();
  });

  it("makes Box a switch, since Select has no button of its own", () => {
    const { bar, fired } = phone(PlannerLayout.PORTRAIT);
    const box = [...bar.actionBar.querySelectorAll("button")].find((one) => one.getAttribute("aria-label") === "Box")!;
    box.click();
    expect(fired.onTool).toHaveBeenLastCalledWith(PlannerTool.BOX);
    bar.update(stateOf({ tool: PlannerTool.BOX }));
    box.click();
    expect(fired.onTool).toHaveBeenLastCalledWith(PlannerTool.SELECT);
  });

  it("switches the view with one button", () => {
    const { bar, fired } = phone(PlannerLayout.PORTRAIT);
    const swap = bar.toolbar.querySelector<HTMLButtonElement>(".planner-bar__view-switch")!;
    expect(swap.textContent).toBe("3D ⇄");
    swap.click();
    expect(fired.onView).toHaveBeenLastCalledWith(YardView.BLUEPRINT);
    bar.update(stateOf({ view: YardView.BLUEPRINT }));
    expect(swap.textContent).toBe("Blueprint ⇄");
  });

  it("opens More, leaves it up for a switch and closes it on a choice", () => {
    const { bar, fired } = phone(PlannerLayout.PORTRAIT);
    const moreButton = [...bar.actionBar.querySelectorAll("button")].find((one) => one.getAttribute("aria-label") === "More")!;
    moreButton.click();
    expect(bar.isMoreOpen).toBe(true);
    expect(bar.moreElement.hidden).toBe(false);
    expect(fired.onMore).toHaveBeenLastCalledWith(true);

    const ranges = [...bar.moreElement.querySelectorAll<HTMLButtonElement>(".planner-menu__item")].find(
      (one) => one.textContent === "Tower ranges",
    )!;
    ranges.click();
    expect(fired.onOverlay).toHaveBeenCalledWith("ranges");
    expect(bar.isMoreOpen).toBe(true);

    const find = [...bar.moreElement.querySelectorAll<HTMLButtonElement>("button")].find(
      (one) => (one.getAttribute("aria-label") ?? one.textContent) === "Find",
    )!;
    find.click();
    expect(fired.onFind).toHaveBeenCalledTimes(1);
    expect(bar.isMoreOpen).toBe(false);
    expect(fired.onMore).toHaveBeenLastCalledWith(false);
  });

  it("keeps Clear yard off while a preview is up, as the Yard menu does", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT);
    bar.update(stateOf({ previewing: true }));
    const clear = [...bar.moreElement.querySelectorAll<HTMLButtonElement>(".planner-menu__item")].find(
      (one) => one.textContent === "Clear yard",
    )!;
    expect(clear.disabled).toBe(true);
    bar.update(stateOf());
    expect(clear.disabled).toBe(false);
  });

  it("puts the selection row at the top of More, and follows its hidden flag", () => {
    const { bar, container } = phone(PlannerLayout.PORTRAIT);
    const section = container.querySelector<HTMLElement>(".planner-more__section--selection")!;
    expect(section.hidden).toBe(true);

    const tools = document.createElement("div");
    tools.append(Object.assign(document.createElement("button"), { textContent: "Select all" }));
    bar.setSelectionTools(tools);
    expect(section.hidden).toBe(false);
    expect(texts(section)).toContain("Select all");

    tools.hidden = true;
    bar.setSelectionTools(tools);
    expect(section.hidden).toBe(true);

    bar.setSelectionTools(null);
    expect(section.hidden).toBe(true);
    expect(texts(section)).not.toContain("Select all");
  });

  it("keeps the selection section hidden off a phone", () => {
    const { bar, container } = phone(PlannerLayout.PORTRAIT);
    bar.setLayout(PlannerLayout.DESKTOP, false);
    bar.setSelectionTools(document.createElement("div"));
    const section = container.querySelector<HTMLElement>(".planner-more__section--selection");
    expect(section?.hidden ?? true).toBe(true);
  });

  it("gives a read-only session the view switches, Find and Help, and nothing that edits", () => {
    const { bar } = phone(PlannerLayout.PORTRAIT, { readOnly: true });
    expect(texts(bar.moreElement, ".planner-more__list > .btn")).toEqual(["Find", "Help"]);
    expect(texts(bar.moreElement, ".planner-menu__item")).not.toContain("Clear yard");
    expect(texts(bar.actionBar)).not.toContain("Apply");
  });
});

/* ── Upgrade walls: pressed first, walls picked after (owner, 2026-11-04) ─── */

describe("PlannerBar Upgrade walls", () => {
  const wallsButton = (bar: PlannerBar): HTMLButtonElement => {
    const found = bar.actionBar.querySelector<HTMLButtonElement>(".planner-bar__walls");
    if (!found) throw new Error("no Upgrade walls button");
    return found;
  };

  it("is live whenever the yard has walls, with nothing selected", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf());
    bar.setWallCount(0);
    expect(wallsButton(bar).disabled).toBe(true);

    bar.setWallCount(30);
    expect(wallsButton(bar).disabled).toBe(false);
    wallsButton(bar).click();
    expect(fired.onUpgradeWalls).toHaveBeenCalledTimes(1);
  });

  it("shows pressed while walls are picked", () => {
    const bar = mount();
    bar.setWallCount(30);
    bar.update(stateOf({ wallPicking: true, selectionCount: 12 }));

    expect(wallsButton(bar).getAttribute("aria-pressed")).toBe("true");

    bar.update(stateOf());
    expect(wallsButton(bar).getAttribute("aria-pressed")).toBe("false");
  });

  it("marks the bottom bar while picking, so the stylesheet keeps only the actions", () => {
    const bar = mount();
    bar.update(stateOf({ wallPicking: true, selectionCount: 12 }));
    expect(bar.actionBar.classList.contains("planner-bar--wall-pick")).toBe(true);

    bar.update(stateOf());
    expect(bar.actionBar.classList.contains("planner-bar--wall-pick")).toBe(false);
  });
});

describe("the yard picture button (owner, 2026-11-11)", () => {
  const withSnapshot = (
    options: { readOnly?: boolean } = {},
  ): { bar: PlannerBar; onSnapshot: ReturnType<typeof vi.fn> } => {
    const container = document.createElement("div");
    document.body.append(container);
    const onSnapshot = vi.fn();
    const bar = new PlannerBar({ ...actions(), onSnapshot }, options).mount(container);
    return { bar, onSnapshot };
  };

  const snapshotButton = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.toolbar.querySelector<HTMLButtonElement>("button[data-icon='snapshot']") ??
    bar.moreElement.querySelector<HTMLButtonElement>("button[data-icon='snapshot']");

  it("sits in the top bar before Help, named, and takes the picture when pressed", () => {
    const { bar, onSnapshot } = withSnapshot();
    const button = snapshotButton(bar)!;
    expect(button.parentElement).toBe(bar.toolbar);
    expect(button.getAttribute("aria-label")).toBe("Yard picture");
    // A painted camera (owner, 12 Nov), not the words.
    expect(button.querySelector("img.game-icon--camera")).not.toBeNull();
    expect(button.querySelector(".planner-bar__face--words")).toBeNull();
    expect(button.nextElementSibling?.getAttribute("aria-label")).toBe("How the planner works, and every shortcut");
    button.click();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
  });

  it("is not there without a handler, or on a yard the player cannot edit", () => {
    expect(snapshotButton(mount())).toBeNull();
    expect(snapshotButton(withSnapshot({ readOnly: true }).bar)).toBeNull();
  });

  it("goes into a phone's More sheet, and comes back to the bar on a desktop", () => {
    const { bar } = withSnapshot();
    bar.update(stateOf({ view: YardView.ISO }));
    bar.setLayout(PlannerLayout.PORTRAIT, true);
    expect(bar.moreElement.contains(snapshotButton(bar))).toBe(true);
    bar.setLayout(PlannerLayout.DESKTOP, false);
    expect(snapshotButton(bar)!.parentElement).toBe(bar.toolbar);
  });
});
