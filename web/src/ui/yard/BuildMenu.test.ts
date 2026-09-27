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

describe("BuildMenu", () => {
  it("is hidden until opened, then shows the tab strip with Resources selected", () => {
    const { menu } = setup([HALL]);
    expect(menu.element.hidden).toBe(true);
    menu.open();
    expect(menu.element.hidden).toBe(false);
    const tabs = [...menu.element.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Resources",
      "Buildings",
      "Monsters",
      "Defences",
      "Decorations",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect([...menu.element.querySelectorAll(".build-tile")].map((one) => one.getAttribute("data-type"))).toEqual(
      ["1", "2", "3", "4", "6"],
    );
  });

  it("a tile: name, owned / allowed, cost with icons, time, Build and Instant", () => {
    const { menu } = setup([HALL, building(2, 20)]);
    menu.open(BuildCategory.DEFENCES);
    const cannon = tile(menu, 20);
    expect(cannon.querySelector(".build-tile__name")?.textContent).toBe("Cannon Tower");
    expect(cannon.querySelector(".build-tile__count")?.textContent).toBe("1 / 4");
    expect(spokenText(cannon.querySelector(".build-tile__cost")!)).toBe(
      "Twigs 2,000 Pebbles 1,500 Putty 500 takes 30s",
    );
    expect(cannon.querySelector<HTMLButtonElement>(".build-tile__build")?.disabled).toBe(false);
    expect(cannon.querySelector(".build-tile__instant")).not.toBeNull();
    expect(tile(menu, 17).querySelector(".build-tile__time")?.textContent).toBe(" built at once");
  });

  it("a blocked tile gives its one reason and cannot be built", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.MONSTERS);
    const lab = tile(menu, 116);
    expect(lab.querySelector(".build-tile__gate")?.textContent).toBe("Needs Town Hall 5.");
    const build = lab.querySelector<HTMLButtonElement>(".build-tile__build")!;
    expect(build.disabled).toBe(true);
    expect(build.getAttribute("aria-label")).toBe("Build Monster Lab. Needs Town Hall 5.");
    // Instant is not offered while the hall refuses the building altogether.
    expect(lab.querySelector(".build-tile__instant")).toBeNull();
    expect(tile(menu, 26).querySelector(".build-tile__gate")?.textContent).toBe(
      "Needs a Monster Locker at level 2.",
    );
  });

  it("short of resources: Need … more, with icons", () => {
    const { menu } = setup([HALL], { resources: { r1: 500, r2: 1500, r3: 500, r4: 0 } });
    menu.open(BuildCategory.DEFENCES);
    expect(spokenText(tile(menu, 20).querySelector(".build-tile__gate")!)).toBe("Need Twigs 1,500 more.");
  });

  it("Build hands the type over; Instant only on the second tap", () => {
    const { menu, onPick } = setup([HALL]);
    menu.open(BuildCategory.DEFENCES);
    tile(menu, 20).querySelector<HTMLButtonElement>(".build-tile__build")!.click();
    expect(onPick).toHaveBeenCalledWith(20, false);

    const instant = tile(menu, 20).querySelector<HTMLButtonElement>(".build-tile__instant")!;
    instant.click();
    expect(onPick).toHaveBeenCalledTimes(1);
    instant.click();
    expect(onPick).toHaveBeenLastCalledWith(20, true);
  });

  it("decorations say they come later", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DECORATIONS);
    expect(menu.element.querySelector(".build-menu__empty")?.textContent).toMatch(/later update/);
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
    expect(spotSentence({ x: 0, y: 0, problem: "mushroom", blockedBy: null }, nameOf)).toBe(
      "A mushroom is in the way.",
    );
  });
});
