// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { BuildCategory } from "@/game/yard/buildCatalogue";
import { YardStore, type YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { BuildMenu, PlacementBar, spotSentence } from "./BuildMenu";

/**
 * The build menu as a player meets it: the tabs, each tile's cost, count and
 * one reason, and that Build and Instant hand the type to the scene. The rules
 * behind the tiles are `buildCatalogue.test.ts`'s; this checks the drawing.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  X: id * 100,
  Y: 0,
  ...extra,
});

const pendingForever = <R>() => new Promise<YardResponse<R>>(() => undefined);

const setup = (buildings: BuildingData[], extra: Partial<BaseLoadResponse> = {}) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 1e6, r2: 1e6, r3: 1e6, r4: 1e6 },
      credits: 100,
      caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
      buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
      buildinghealthdata: {},
      storedata: {},
      ...extra,
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn(() => pendingForever<null>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const binding: YardUiBinding = { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices };
  const onPick = vi.fn();
  const onClose = vi.fn();
  const menu = new BuildMenu({ binding, onPick, onClose }).mount(document.body);
  return { menu, onPick, onClose, store };
};

const tile = (menu: BuildMenu, type: number): HTMLElement =>
  menu.element.querySelector<HTMLElement>(`.build-tile[data-type="${type}"]`)!;

const HALL = building(1, 14, { l: 3 });

afterEach(() => {
  document.body.replaceChildren();
});

const info = (menu: BuildMenu): HTMLElement => menu.element.querySelector<HTMLElement>(".build-info")!;

/** The info's cost, time and worker, one entry per list item. */
const facts = (menu: BuildMenu): string[] =>
  [...info(menu).querySelectorAll(".build-info__fact")].map((one) => spokenText(one));

const tileTypes = (menu: BuildMenu): string[] =>
  [...menu.element.querySelectorAll(".build-tile")].map((one) => one.getAttribute("data-type") ?? "");

const STATUSES = ["ready", "locked", "limit", "maxed"];

/** Each tile's place in the sort, read off its class. */
const tileRanks = (menu: BuildMenu): number[] =>
  [...menu.element.querySelectorAll(".build-tile")].map((one) =>
    STATUSES.findIndex((status) => one.classList.contains(`build-tile--${status}`)),
  );

describe("BuildMenu", () => {
  it("is hidden until opened, then shows the original's four tabs with Resources selected", () => {
    const { menu } = setup([HALL]);
    expect(menu.element.hidden).toBe(true);
    menu.open();
    expect(menu.element.hidden).toBe(false);
    const tabs = [...menu.element.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Resources",
      "Buildings",
      "Defensive",
      "Decorations",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tileTypes(menu)).toEqual(["1", "2", "3", "4", "6"]);
    expect(menu.element.querySelector(".build-menu__meta")?.textContent).toBe(
      "1 of 1 worker free · Town Hall level 3",
    );
  });

  it("a tile: the original's picture, name and N of M built", () => {
    const { menu } = setup([HALL, building(2, 20)]);
    menu.open(BuildCategory.DEFENSIVE);
    const cannon = tile(menu, 20);
    expect(cannon.tagName).toBe("BUTTON");
    expect(cannon.querySelector("img")?.getAttribute("src")).toBe("/assets/buildingbuttons/20.jpg");
    expect(cannon.querySelector(".build-tile__name")?.textContent).toBe("Cannon Tower");
    expect(cannon.querySelector(".build-tile__count")?.textContent).toBe("1 of 4 built");
  });

  it("a locked tile: the silhouette, a lock, and the hall that unlocks it", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.BUILDINGS);
    menu.turn(1);
    const lab = tile(menu, 116);
    expect(lab.classList.contains("build-tile--locked")).toBe(true);
    expect(lab.querySelector("img")?.getAttribute("src")).toBe(
      "/assets/buildingbuttons/116.silhouette.jpg",
    );
    expect(lab.querySelector(".build-badge--locked")).not.toBeNull();
    expect(lab.querySelector(".build-tile__count")?.textContent).toBe("Unlocks at Town Hall 5");
  });

  it("a tile locked by a building says which; one with no silhouette on disk is shaded", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.BUILDINGS);
    expect(tile(menu, 26).querySelector(".build-tile__count")?.textContent).toBe(
      "Needs a Monster Locker at level 2",
    );
    // The Hatchery needs a Housing; 13.2.silhouette.jpg is on disk.
    expect(tile(menu, 13).querySelector("img")?.getAttribute("src")).toMatch(/13\.2\.silhouette/);

    document.body.replaceChildren();
    const { menu: bare } = setup([]);
    bare.open(BuildCategory.RESOURCES);
    const snapper = tile(bare, 1);
    expect(snapper.querySelector(".build-tile__count")?.textContent).toBe("Needs a Town Hall");
    expect(snapper.querySelector(".build-tile__picture--shade")).not.toBeNull();
  });

  it("a type the yard has all of for good wears the tick", () => {
    const { menu } = setup([HALL, building(2, 8)]);
    menu.open(BuildCategory.BUILDINGS);
    menu.turn(1);
    const locker = tile(menu, 8);
    expect(locker.querySelector(".build-badge--maxed")).not.toBeNull();
    expect(locker.querySelector(".build-tile__count")?.textContent).toBe("1 of 1 · all built");
  });

  it("sorts ready, then locked, then all built, ten to a page", () => {
    const { menu } = setup([HALL, building(2, 8), building(3, 15)]);
    menu.open(BuildCategory.BUILDINGS);
    const first = tileTypes(menu);
    const firstRanks = tileRanks(menu);
    expect(first).toHaveLength(10);
    expect(menu.element.querySelector(".build-menu__page")?.textContent).toBe("Page 1 of 2");
    const previous = menu.element.querySelector<HTMLButtonElement>(".build-menu__turn--previous")!;
    const next = menu.element.querySelector<HTMLButtonElement>(".build-menu__turn--next")!;
    expect(previous.disabled).toBe(true);
    next.click();
    expect(menu.element.querySelector(".build-menu__page")?.textContent).toBe("Page 2 of 2");
    expect(next.disabled).toBe(true);
    const second = tileTypes(menu);
    expect(first.length + second.length).toBe(15);
    const ranks = [...firstRanks, ...tileRanks(menu)];
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // The General Store leads; the Monster Locker, all built, comes last.
    expect(first[0]).toBe("12");
    expect(second.at(-1)).toBe("8");
  });

  it("opens on the first tile's info beside the tiles; a pick shows another", () => {
    const { menu } = setup([HALL, building(2, 15)]);
    menu.open(BuildCategory.BUILDINGS);
    expect(menu.pickedType).toBe(12);
    tile(menu, 13).click();
    expect(menu.pickedType).toBe(13);
    expect(tile(menu, 13).getAttribute("aria-pressed")).toBe("true");
    const panel = info(menu);
    expect(panel.querySelector(".build-info__name")?.textContent).toBe("Hatchery");
    expect(panel.querySelector(".build-info__count")?.textContent).toBe("0 of 3 built");
    expect(panel.querySelector(".build-info__blurb")?.textContent).toMatch(/Goo into the monsters/);
    expect([...panel.querySelectorAll(".build-need")].map((line) => spokenText(line))).toEqual([
      "Done: Town Hall level 1",
      "Done: A Housing",
    ]);
    expect(facts(menu)).toEqual(["Twigs 2,000", "Pebbles 2,000", "15m 0s", "1 worker"]);
  });

  it("a locked building's info lists what it still needs, and Build is off", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.BUILDINGS);
    menu.pick(116);
    const panel = info(menu);
    expect(spokenText(panel.querySelector(".build-need--unmet")!)).toBe("Not yet: Town Hall level 5");
    const build = panel.querySelector<HTMLButtonElement>(".build-info__build")!;
    expect(build.disabled).toBe(true);
    expect(build.getAttribute("aria-label")).toBe("Build Monster Lab. Needs Town Hall 5.");
    // Build instantly is not offered while the hall refuses the building altogether.
    expect(panel.querySelector(".build-info__instant")).toBeNull();
  });

  it("short of resources: the short amount marked, and Need … more", () => {
    const { menu } = setup([HALL], { resources: { r1: 500, r2: 1500, r3: 500, r4: 0 } });
    menu.open(BuildCategory.DEFENSIVE);
    tile(menu, 20).click();
    const panel = info(menu);
    expect(spokenText(panel.querySelector(".build-info__gate")!)).toBe("Need Twigs 1,500 more.");
    expect(spokenText(panel.querySelector(".build-info__fact--short")!)).toBe("Twigs 2,000");
    expect(panel.querySelector(".build-info__build")?.getAttribute("aria-describedby")).toBe(
      "build-gate-20",
    );
  });

  it("Build hands the type over; Build instantly only on the second tap", () => {
    const { menu, onPick } = setup([HALL]);
    menu.open(BuildCategory.DEFENSIVE);
    tile(menu, 20).click();
    info(menu).querySelector<HTMLButtonElement>(".build-info__build")!.click();
    expect(onPick).toHaveBeenCalledWith(20, false);

    const instant = info(menu).querySelector<HTMLButtonElement>(".build-info__instant")!;
    instant.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    instant.click();
    expect(onPick).toHaveBeenLastCalledWith(20, true);
  });

  it("walls: at once, no worker", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DEFENSIVE);
    menu.pick(17);
    expect(facts(menu)).toEqual(["Twigs 1,000", "At once", "No worker"]);
  });

  it("Upgrade Town Hall is there when the scene can show the hall", () => {
    const { menu, store } = setup([HALL]);
    menu.open();
    expect(menu.element.querySelector(".build-menu__hall")).toBeNull();

    const onTownHall = vi.fn();
    const withHall = new BuildMenu({
      binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices },
      onPick: vi.fn(),
      onTownHall,
    }).mount(document.body);
    withHall.open();
    withHall.element.querySelector<HTMLButtonElement>(".build-menu__hall")!.click();
    expect(onTownHall).toHaveBeenCalledTimes(1);
  });

  it("with nothing stored, the Decorations tab says how to fill it", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DECORATIONS);
    expect(menu.element.querySelector(".build-menu__empty")?.textContent).toBe(
      "No decorations in storage. Recycle one to keep it here, then place it again from this tab.",
    );
    expect(menu.element.querySelector(".build-menu__page")?.textContent).toBe("Page 1 of 1");
  });

  it("stored decorations: a tile each with the count, free, and Place hands the type over (#128)", () => {
    const { menu, onPick } = setup([HALL], { researchdata: { b28: 3, b121: 1, bl121: 2 } });
    menu.open(BuildCategory.DECORATIONS);

    expect(tileTypes(menu)).toEqual(["28", "121"]);
    expect(tile(menu, 28).querySelector(".build-tile__count")?.textContent).toBe("3 in storage");
    expect(info(menu).querySelector(".build-info__count")?.textContent).toBe("3 in storage");
    expect(facts(menu)).toEqual(["Free", "At once", "No worker"]);
    expect(info(menu).querySelector(".build-info__needs")).toBeNull();
    expect(info(menu).querySelector(".shiny-button")).toBeNull();
    expect(menu.element.querySelector(".build-menu__legend")?.textContent).toBe(
      "Your stored decorations. Placing one is free.",
    );

    const place = info(menu).querySelector<HTMLButtonElement>(".build-info__build")!;
    expect(place.getAttribute("aria-label")).toMatch(/^Place .+ from storage$/);
    place.click();
    expect(onPick).toHaveBeenCalledWith(28, false);
  });

  it("reopens on the tab and page it was left on", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.BUILDINGS);
    menu.turn(1);
    menu.close();
    menu.open();
    expect(menu.activeTab).toBe(BuildCategory.BUILDINGS);
    expect(menu.element.querySelector(".build-menu__page")?.textContent).toBe("Page 2 of 2");
  });

  it("closes on its close button and on Escape", () => {
    const { menu, onClose } = setup([HALL]);
    menu.open();
    menu.element.querySelector<HTMLButtonElement>(".build-menu__close")!.click();
    expect(menu.isOpen).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);

    menu.open();
    menu.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu.element.hidden).toBe(true);
  });

  it("arrow keys move along the tab strip", () => {
    const { menu } = setup([HALL]);
    menu.open();
    const strip = menu.element.querySelector(".build-menu__tabs")!;
    strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(menu.activeTab).toBe(BuildCategory.DECORATIONS);
  });
});

describe("PlacementBar", () => {
  it("says what is in hand and why a spot is refused, and cancels", () => {
    const onCancel = vi.fn();
    const bar = new PlacementBar({
      type: 20,
      instant: false,
      instantPrice: 17,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      onCancel,
    }).mount(document.body);
    expect(spokenText(bar.element.querySelector(".build-placing__what")!)).toBe(
      "Cannon Tower Twigs 2,000 Pebbles 1,500 Putty 500",
    );
    bar.setSpot("Outside your yard.");
    expect(bar.element.classList.contains("build-placing--blocked")).toBe(true);
    expect(bar.element.querySelector(".build-placing__hint")?.textContent).toBe(
      "Can't build here: Outside your yard.",
    );
    bar.element.querySelector<HTMLButtonElement>(".build-placing__cancel")!.click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows the time and puts the building down with Build here, off on a refused spot", () => {
    const onBuildHere = vi.fn();
    const bar = new PlacementBar({
      type: 20,
      instant: false,
      instantPrice: 17,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      time: "30s",
      onCancel: vi.fn(),
      onBuildHere,
    }).mount(document.body);
    expect(spokenText(bar.element.querySelector(".build-placing__price")!)).toBe(
      "Twigs 2,000 Pebbles 1,500 Putty 500 · 30s",
    );
    const here = bar.element.querySelector<HTMLButtonElement>(".build-placing__here")!;
    here.click();
    expect(onBuildHere).toHaveBeenCalledTimes(1);
    bar.setSpot("On top of your Hatchery.");
    expect(here.disabled).toBe(true);
    bar.setSpot(null);
    expect(here.disabled).toBe(false);
    bar.setBuiltAgain();
    expect(bar.element.querySelector(".build-placing__message")?.textContent).toBe(
      "Built. Click again for another.",
    );
  });

  it("says Building… with Cancel out of the way until the answer, and gives the line back on a refusal (#277)", () => {
    const bar = new PlacementBar({
      type: 20,
      instant: false,
      instantPrice: 17,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      onCancel: vi.fn(),
      onBuildHere: vi.fn(),
    }).mount(document.body);
    const hint = bar.element.querySelector(".build-placing__hint")!;
    const buttons = bar.element.querySelector<HTMLElement>(".build-placing__buttons")!;
    const placing = hint.textContent;

    bar.setBuilding(true);
    expect(hint.textContent).toBe("Building…");
    expect(buttons.hidden).toBe(true);
    // The spot changing underneath does not take the line back.
    bar.setSpot("Something is already there.");
    expect(hint.textContent).toBe("Building…");
    expect(bar.element.classList.contains("build-placing--blocked")).toBe(false);
    bar.setSpot(null);

    bar.setBuilding(false);
    bar.setMessage("You do not have enough resources for that.", "bad");
    expect(hint.textContent).toBe(placing);
    expect(buttons.hidden).toBe(false);
    expect(bar.element.querySelector(".build-placing__message")?.textContent).toBe(
      "You do not have enough resources for that.",
    );
  });

  it("without onBuildHere there is no Build here", () => {
    const bar = new PlacementBar({
      type: 20,
      instant: false,
      instantPrice: 17,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      onCancel: vi.fn(),
    });
    expect(bar.element.querySelector(".build-placing__here")).toBeNull();
  });

  it("an instant placement shows the Shiny price", () => {
    const bar = new PlacementBar({
      type: 20,
      instant: true,
      instantPrice: 17,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      onCancel: vi.fn(),
    });
    expect(spokenText(bar.element.querySelector(".build-placing__price")!)).toBe(
      "Finished at once for Shiny 17",
    );
  });

  it("spotSentence names what is in the way", () => {
    const nameOf = (id: number) => (id === 4 ? "Sniper Tower" : null);
    expect(spotSentence({ x: 0, y: 0, problem: "overlap", blockedBy: 4 }, nameOf)).toBe(
      "On top of your Sniper Tower.",
    );
    expect(spotSentence({ x: 0, y: 0, problem: "overlap", blockedBy: null }, nameOf)).toBe(
      "Something is already there.",
    );
  });
});
