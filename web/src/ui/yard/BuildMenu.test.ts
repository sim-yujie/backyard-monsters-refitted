// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { setClassicLook } from "@/game/classicLook";
import { buildPicture } from "@/game/yard/buildButtonArt";
import { BuildCategory } from "@/game/yard/buildCatalogue";
import { DecorKind } from "@/game/yard/decorShop";
import { YardStore, type YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import type { LinePlan } from "@/game/yard/wallLine";
import { BuildMenu, lineHint, PlacementBar, spotSentence } from "./BuildMenu";

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
  setClassicLook(false);
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
    const tabs = [...menu.element.querySelectorAll('.build-menu__tabs [role="tab"]')];
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

  it("a tile: the original's picture with the Classic look, name and N of M built", () => {
    setClassicLook(true);
    const { menu } = setup([HALL, building(2, 20)]);
    menu.open(BuildCategory.DEFENSIVE);
    const cannon = tile(menu, 20);
    expect(cannon.tagName).toBe("BUTTON");
    expect(cannon.querySelector("img")?.getAttribute("src")).toBe("/assets/buildingbuttons/20.jpg");
    expect(cannon.querySelector(".build-tile__name")?.textContent).toBe("Cannon Tower");
    expect(cannon.querySelector(".build-tile__count")?.textContent).toBe("1 of 4 built");
  });

  it("a locked tile: the silhouette, a lock, and the hall that unlocks it", () => {
    setClassicLook(true);
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
    setClassicLook(true);
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

  it("with the Modern look, a tile shows the building's new look, shaded from itself while locked", () => {
    const { menu } = setup([HALL, building(2, 20)]);
    menu.open(BuildCategory.DEFENSIVE);
    const cannon = tile(menu, 20);
    expect(cannon.querySelector("img")?.getAttribute("src")).toBe(buildPicture(20, "main", false).url);
    expect(cannon.querySelector("img")?.getAttribute("src")).toMatch(/^\/assets\/buildingbuttons\/modern\/20\.main\./);
    expect(cannon.querySelector(".build-tile__picture--modern")).not.toBeNull();

    menu.open(BuildCategory.BUILDINGS);
    // The Monster Locker has no new look yet: Flash's button, as before.
    expect(tile(menu, 8).querySelector("img")?.getAttribute("src")).toBe("/assets/buildingbuttons/8.jpg");
    expect(tile(menu, 8).querySelector(".build-tile__picture--modern")).toBeNull();
    menu.turn(1);
    const lab = tile(menu, 116);
    expect(lab.classList.contains("build-tile--locked")).toBe(true);
    // Not Flash's silhouette, which is of Flash's art: the new picture, drawn dark.
    expect(lab.querySelector("img")?.getAttribute("src")).toBe(buildPicture(116, "main", false).url);
    expect(lab.querySelector(".build-tile__picture--modern.build-tile__picture--shade")).not.toBeNull();
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
    // Affordable: green, not the gold that read backwards to the owner (#278).
    expect(panel.querySelectorAll(".build-info__fact--ok")).toHaveLength(2);
    expect(panel.querySelector(".build-info__fact--short")).toBeNull();
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
    // Pebbles and Putty are held in full, so they read green while Twigs reads red.
    expect([...panel.querySelectorAll(".build-info__fact--ok")].map((one) => spokenText(one))).toEqual([
      "Pebbles 1,500",
      "Putty 500",
    ]);
    expect(panel.querySelector(".build-info__build")?.getAttribute("aria-describedby")).toBe(
      "build-gate-20",
    );
  });

  it("every worker busy: Build still picks the building up, and the box waits for the spot (#345)", () => {
    const { menu, onPick } = setup([HALL, building(2, 20, { l: 1, cU: 600 })]);
    menu.open(BuildCategory.DEFENSIVE);
    tile(menu, 20).click();
    const build = info(menu).querySelector<HTMLButtonElement>(".build-info__build")!;
    expect(build.disabled).toBe(false);
    expect(build.getAttribute("aria-label")).toContain("busy");
    build.click();
    expect(onPick).toHaveBeenCalledWith(20, false);
    expect(document.body.querySelector(".workers-busy")).toBeNull();
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

  it("no Build instantly while the guided start pays for the building, only for the others", () => {
    const onboarding = { v: 1, guide: { state: "active", step: "build-maproom" } };
    const { menu } = setup([HALL], { onboarding } as unknown as Partial<BaseLoadResponse>);
    menu.open(BuildCategory.BUILDINGS);
    menu.pick(11);
    expect(info(menu).querySelector(".build-info__build")).not.toBeNull();
    expect(info(menu).querySelector(".build-info__instant")).toBeNull();

    menu.pick(15);
    expect(info(menu).querySelector(".build-info__instant")).not.toBeNull();
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

  it("with nothing stored, the Decorations tab sells Flash's 73 for Shiny under its five sub-tabs", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DECORATIONS);
    expect(menu.element.querySelector(".build-menu__empty")).toBeNull();
    const kinds = menu.element.querySelector<HTMLElement>(".build-menu__kinds")!;
    expect(kinds.hidden).toBe(false);
    expect(kinds.getAttribute("role")).toBe("tablist");
    const buttons = [...kinds.querySelectorAll<HTMLButtonElement>(".build-menu__kind")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Evil", "Plants", "Good", "Flags", "Premium"]);
    // Flash opened on Evil: the Monster Skull first, 14 on two pages.
    expect(menu.activeKind).toBe(DecorKind.EVIL);
    expect(buttons[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tileTypes(menu)).toEqual(["107", "74", "75", "76", "77", "78", "79", "81", "82", "83"]);
    expect(menu.element.querySelector(".build-menu__page")?.textContent).toBe("Page 1 of 2");
    expect(info(menu).querySelector(".build-info__name")?.textContent).toBeTruthy();

    const pages: string[] = [];
    for (const button of buttons) {
      button.click();
      pages.push(menu.element.querySelector(".build-menu__page")!.textContent!);
      expect(button.getAttribute("aria-selected")).toBe("true");
      expect(menu.pickedType).toBe(Number(tileTypes(menu)[0]));
    }
    expect(pages).toEqual(["Page 1 of 2", "Page 1 of 2", "Page 1 of 2", "Page 1 of 3", "Page 1 of 1"]);
    expect(tileTypes(menu)).toEqual(["96", "97", "98", "99", "100", "101"]);
    expect(menu.element.querySelector(".build-menu__legend")?.textContent).toBe(
      "Stored ones first, free to place. The rest cost Shiny.",
    );
  });

  it("an outpost's Decorations tab says they go in the main yard", () => {
    const store = new YardStore({
      save: {
        error: 0,
        currenttime: T0,
        savetime: T0,
        resources: {},
        credits: 1_000,
        buildingdata: { "1": building(1, 112) },
        buildinghealthdata: {},
        storedata: {},
        researchdata: { b28: 1 },
      } as unknown as BaseLoadResponse,
      target: { baseid: "9", kind: "outpost" },
      api: { state: vi.fn(() => pendingForever<null>()) } as unknown as YardApi,
      clock: () => T0,
      timers: { set: () => 0, clear: () => undefined },
    });
    const binding: YardUiBinding = { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices };
    const menu = new BuildMenu({ binding, onPick: vi.fn() }).mount(document.body);
    menu.open(BuildCategory.DECORATIONS);
    expect(menu.element.querySelector(".build-menu__empty")?.textContent).toBe("Decorations go in your main yard.");
    expect(menu.element.querySelector<HTMLElement>(".build-menu__kinds")!.hidden).toBe(true);
  });

  it("a decoration for sale: the Shiny icon and price, and Buy picks it up on the second tap", () => {
    const { menu, onPick } = setup([HALL], { credits: 1_000 });
    menu.open(BuildCategory.DECORATIONS);

    const skull = tile(menu, 107);
    expect(skull.querySelector(".build-tile__count .res-amount")?.getAttribute("data-resource")).toBe("shiny");
    expect(spokenText(skull.querySelector(".build-tile__count")!)).toBe("Shiny 20");
    expect(skull.getAttribute("aria-label")).toMatch(/, 20 Shiny$/);

    skull.click();
    expect(facts(menu)).toEqual(["Shiny 20", "At once", "No worker"]);
    expect(info(menu).querySelector(".build-info__gate")).toBeNull();
    const buy = info(menu).querySelector<HTMLButtonElement>(".build-info__buy")!;
    expect(buy.disabled).toBe(false);
    buy.click();
    expect(onPick).not.toHaveBeenCalled();
    buy.click();
    expect(onPick).toHaveBeenCalledWith(107, false);
  });

  it("short of Shiny: the price is marked, Buy is blocked and the line says how much more", () => {
    const { menu, onPick } = setup([HALL], { credits: 100 });
    menu.open(BuildCategory.DECORATIONS);
    menu.openKind(DecorKind.FLAGS);
    menu.turn(2);
    // Page 3 ends the flags: the European Flag (32) costs 150.
    tile(menu, 32).click();

    expect(tile(menu, 32).querySelector(".build-tile__count--short")).not.toBeNull();
    expect(spokenText(info(menu).querySelector(".build-info__gate")!)).toBe("Need Shiny 50 more.");
    const buy = info(menu).querySelector<HTMLButtonElement>(".build-info__buy")!;
    buy.click();
    buy.click();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("stored decorations: a tile each with the count, free, and Place hands the type over (#128)", () => {
    const { menu, onPick } = setup([HALL], { researchdata: { b28: 3, b121: 1, bl121: 2 } });
    menu.open(BuildCategory.DECORATIONS);

    // Each sub-tab with some in storage counts them on its corner.
    const counts = [...menu.element.querySelectorAll<HTMLElement>(".build-menu__kind-count")];
    expect(counts.map((count) => (count.hidden ? "" : count.textContent))).toEqual(["", "", "", "3", "1"]);
    expect(menu.element.querySelector("#build-kind-flags")?.getAttribute("aria-label")).toBe("Flags, 3 in storage");
    expect(menu.element.querySelector("#build-kind-evil")?.hasAttribute("aria-label")).toBe(false);
    expect(tileTypes(menu)).not.toContain("28");

    menu.openKind(DecorKind.PREMIUM);
    expect(tileTypes(menu)[0]).toBe("121");
    menu.openKind(DecorKind.FLAGS);
    // Stored first, then the ones for sale (the stored American Flag not again).
    expect(tileTypes(menu).slice(0, 3)).toEqual(["28", "49", "50"]);
    expect(menu.element.querySelectorAll('.build-tile[data-type="28"]')).toHaveLength(1);
    expect(tile(menu, 28).querySelector(".build-tile__count")?.textContent).toBe("3 in storage");
    expect(info(menu).querySelector(".build-info__count")?.textContent).toBe("3 in storage");
    expect(facts(menu)).toEqual(["Free", "At once", "No worker"]);
    expect(info(menu).querySelector(".build-info__needs")).toBeNull();
    expect(info(menu).querySelector(".shiny-button")).toBeNull();
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

  it("reopens on the decoration sub-tab it was left on; arrow keys move along the sub-tabs", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DECORATIONS);
    menu.openKind(DecorKind.GOOD);
    menu.close();
    menu.open();
    expect(menu.activeKind).toBe(DecorKind.GOOD);
    const kinds = menu.element.querySelector(".build-menu__kinds")!;
    kinds.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(menu.activeKind).toBe(DecorKind.FLAGS);
    expect(menu.activeTab).toBe(BuildCategory.DECORATIONS);
    kinds.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    kinds.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    kinds.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    kinds.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(menu.activeKind).toBe(DecorKind.PREMIUM);
  });

  it("opens another tab or sub-tab at its top; reopening the window keeps its place (owner, 6 Nov 2026)", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.DECORATIONS);
    const main = menu.element.querySelector<HTMLElement>(".build-menu__main")!;
    main.scrollTop = 283;
    menu.openKind(DecorKind.GOOD);
    expect(main.scrollTop).toBe(0);
    main.scrollTop = 120;
    menu.close();
    menu.open();
    expect(main.scrollTop).toBe(120);
    menu.open(BuildCategory.BUILDINGS);
    expect(main.scrollTop).toBe(0);
  });

  it("the sub-tabs show only on the Decorations tab, and not where there are none", () => {
    const { menu } = setup([HALL]);
    menu.open(BuildCategory.BUILDINGS);
    expect(menu.element.querySelector<HTMLElement>(".build-menu__kinds")!.hidden).toBe(true);
    menu.open(BuildCategory.DECORATIONS);
    expect(menu.element.querySelector<HTMLElement>(".build-menu__kinds")!.hidden).toBe(false);
  });

  it("arrow keys move along the tab strip", () => {
    const { menu } = setup([HALL]);
    menu.open();
    const strip = menu.element.querySelector(".build-menu__tabs")!;
    strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(menu.activeTab).toBe(BuildCategory.DECORATIONS);
  });

  it("keeps the Build button on screen when the info is taller than the window", () => {
    // At 1280x800 the Defensive tab's info ran past the window and took the
    // button with it, out of reach while Bob's guide pointed at it. jsdom lays
    // nothing out, so the rule that pins the button to the window's foot is
    // checked instead, on every screen size, with a solid ground under it.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles/build-menu.css"), "utf8");
    const rules = [...css.matchAll(/\.build-info__actions \{([^}]*)\}/g)].map((match) => match[1]!);
    expect(rules[0]).toMatch(/position: sticky;\s*bottom: 0;/);
    expect(rules[0]).toMatch(/background: [^;]*var\(--colour-surface-base\);/);
    // The phone layouts clear the info's own ground; the bar keeps one.
    expect(rules.slice(1)).toHaveLength(2);
    for (const rule of rules.slice(1)) expect(rule).toMatch(/background: var\(--colour-surface-base\);/);
    expect(css).not.toMatch(/\.build-info__actions \{[^}]*position: (static|relative)/);
  });
});

describe("PlacementBar", () => {
  it("a decoration bought for Shiny shows its price", () => {
    const bar = new PlacementBar({
      type: 28,
      instant: false,
      instantPrice: 0,
      price: 150,
      cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
      time: "At once",
      onCancel: vi.fn(),
    }).mount(document.body);
    expect(spokenText(bar.element.querySelector(".build-placing__price")!)).toBe("Shiny 150 · At once");
  });

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

  describe("line mode (walls Option B)", () => {
    const blockCost = { r1: 1000, r2: 0, r3: 0, r4: 0 };
    const plan = (build: number, blocked: number, short: number, shortReason: "limit" | "resources" | null): LinePlan => ({
      cells: [],
      build: Array.from({ length: build }, (_, i) => ({ x: i * 20, y: 0 })),
      blocked,
      short,
      shortReason,
      cost: { r1: build * 1000, r2: 0, r3: 0, r4: 0 },
    });
    const lineBar = (on = true) => {
      const line = { on, onToggle: vi.fn(), onConfirm: vi.fn(), onClear: vi.fn() };
      const bar = new PlacementBar({
        type: 17,
        instant: false,
        instantPrice: 0,
        cost: blockCost,
        onCancel: vi.fn(),
        onBuildHere: vi.fn(),
        line,
      }).mount(document.body);
      const q = <T extends HTMLElement>(selector: string) => bar.element.querySelector<T>(selector)!;
      return { bar, line, q };
    };

    it("draws the Line toggle, pressed when on, with ✓ and ✗ in place of Build here", () => {
      const { bar, line, q } = lineBar();
      const toggle = q<HTMLButtonElement>(".build-placing__line-toggle");
      expect(toggle.getAttribute("aria-pressed")).toBe("true");
      expect(bar.lineMode).toBe(true);
      expect(q<HTMLButtonElement>(".build-placing__here").hidden).toBe(true);
      expect(q<HTMLButtonElement>(".build-placing__line-confirm").hidden).toBe(false);
      expect(q<HTMLButtonElement>(".build-placing__line-clear").hidden).toBe(false);

      toggle.click();
      expect(line.onToggle).toHaveBeenCalledWith(false);
      expect(toggle.getAttribute("aria-pressed")).toBe("false");
      expect(q<HTMLButtonElement>(".build-placing__here").hidden).toBe(false);
      expect(q<HTMLButtonElement>(".build-placing__line-confirm").hidden).toBe(true);
      expect(q<HTMLElement>(".build-placing__line").hidden).toBe(true);
    });

    it("starts off when asked, and a bar without line options has no toggle", () => {
      const { q } = lineBar(false);
      expect(q<HTMLButtonElement>(".build-placing__line-toggle").getAttribute("aria-pressed")).toBe("false");
      const plain = new PlacementBar({
        type: 17,
        instant: false,
        instantPrice: 0,
        cost: blockCost,
        onCancel: vi.fn(),
      });
      expect(plain.element.querySelector(".build-placing__line-toggle")).toBeNull();
    });

    it("✓ is off with nothing green, on with greens, and off while building", () => {
      const { bar, line, q } = lineBar();
      const confirm = q<HTMLButtonElement>(".build-placing__line-confirm");
      const clear = q<HTMLButtonElement>(".build-placing__line-clear");
      expect(confirm.disabled).toBe(true);
      expect(clear.disabled).toBe(true);

      bar.setLine(plan(0, 2, 0, null), { empty: false, fixed: true, busy: false });
      expect(confirm.disabled).toBe(true);
      expect(clear.disabled).toBe(false);

      bar.setLine(plan(3, 0, 0, null), { empty: false, fixed: true, busy: false });
      expect(confirm.disabled).toBe(false);
      confirm.click();
      expect(line.onConfirm).toHaveBeenCalledTimes(1);
      clear.click();
      expect(line.onClear).toHaveBeenCalledTimes(1);

      bar.setLine(plan(3, 0, 0, null), { empty: false, fixed: true, busy: true });
      expect(confirm.disabled).toBe(true);
      expect(clear.disabled).toBe(true);
      expect(q<HTMLButtonElement>(".build-placing__line-toggle").disabled).toBe(true);
      expect(q(".build-placing__hint").textContent).toBe("Building…");
    });

    it("the summary: Block ×count, the cost, blocked and what is short", () => {
      const { bar, q } = lineBar();
      bar.setLine(plan(4, 2, 3, "resources"), { empty: false, fixed: true, busy: false });
      expect(q(".build-placing__line-count").textContent).toBe("×4");
      expect(spokenText(q(".build-placing__line-cost"))).toBe("Twigs 4,000");
      expect(q(".build-placing__line-skip").textContent).toBe("✕ 2");
      expect(q(".build-placing__line-short").textContent).toBe("3 can't afford");

      bar.setLine(plan(1, 0, 5, "limit"), { empty: false, fixed: true, busy: false });
      expect(q(".build-placing__line-short").textContent).toBe("5 over hall limit");
      expect(bar.element.querySelector(".build-placing__line-skip")).toBeNull();

      bar.setLine(plan(0, 1, 0, null), { empty: false, fixed: true, busy: false });
      expect(q(".build-placing__line-count").textContent).toBe("×0");
      expect(bar.element.querySelector(".build-placing__line-cost")).toBeNull();
    });

    it("a refused spot does not take the line's words", () => {
      const { bar, q } = lineBar();
      const hint = q(".build-placing__hint").textContent;
      bar.setSpot("Outside your yard.");
      expect(q(".build-placing__hint").textContent).toBe(hint);
      expect(bar.element.classList.contains("build-placing--blocked")).toBe(false);
    });

    it("lineHint says what to do next on a desktop and a phone", () => {
      const fresh = { empty: true, fixed: false, busy: false };
      const started = { empty: false, fixed: false, busy: false };
      const fixed = { empty: false, fixed: true, busy: false };
      expect(lineHint(false, null, null)).toBe("Drag from the first Block to the last. Esc cancels.");
      expect(lineHint(true, fresh, null)).toBe("Tap the first Block, then the last.");
      expect(lineHint(false, started, null)).toBe("Click the last Block.");
      expect(lineHint(true, started, null)).toBe("Tap the last Block.");
      expect(lineHint(false, fixed, plan(0, 3, 0, null))).toBe("Nothing here can be built.");
      expect(lineHint(true, fixed, plan(2, 0, 0, null))).toBe("✓ builds the green Blocks.");
      expect(lineHint(false, { ...fixed, busy: true }, plan(2, 0, 0, null))).toBe("Building…");
    });
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
