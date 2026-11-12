// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { ChampionTab } from "./ChampionTab";
import { MONSTERS_TABS, INFERNO_MONSTERS_TABS, OUTPOST_MONSTERS_TABS } from "./tabs";

/**
 * The Champion tab (owner, 12 Nov 2026): the Champion Cage's controls and the
 * Chamber's in the Monsters screen. The controls themselves are
 * `ChampionPanel.test.ts`'s and `ChamberPanel.test.ts`'s; this checks which
 * show and where an Open lands.
 */

const T0 = 2_000_000;

const building = (
  id: number,
  t: number,
  l: number,
  extra: Partial<BuildingData> = {},
): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const setup = (buildings: BuildingData[], focus: { buildingId?: number } = {}) => {
  const api = {
    state: vi.fn(() => new Promise<YardResponse<null>>(() => undefined)),
  } as unknown as YardApi;
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 1_000,
      buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
      buildinghealthdata: {},
      storedata: {},
      monsters: { housed: {} },
    } as unknown as BaseLoadResponse,
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const tab = new ChampionTab({
    binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices },
    showTab: vi.fn(),
  });
  document.body.replaceChildren(tab.element);
  tab.show(focus);
  return { tab, element: tab.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const HALL = building(1, 14, 6);
const CAGE = building(2, 114, 1);
const CHAMBER = building(3, 119, 1);

describe("Champion tab", () => {
  it("is the main yard's last tab; outposts and the Inferno have none", () => {
    expect(MONSTERS_TABS.map((tab) => tab.id).at(-1)).toBe("champion");
    expect(MONSTERS_TABS.find((tab) => tab.id === "champion")!.buildings).toEqual([114, 119]);
    expect(OUTPOST_MONSTERS_TABS.some((tab) => tab.id === "champion")).toBe(false);
    expect(INFERNO_MONSTERS_TABS.some((tab) => tab.id === "champion")).toBe(false);
  });

  it("shows the cage's controls, and no Chamber part without a Chamber", () => {
    const { element } = setup([HALL, CAGE]);
    expect(element.querySelector(".champion-tab__cage .champion")).not.toBeNull();
    expect(element.querySelector<HTMLElement>(".champion-tab__chamber")!.hidden).toBe(true);
    expect(element.querySelector(".chamber")).toBeNull();
  });

  it("shows the Chamber's champions under the cage's when the yard has both", () => {
    const { element } = setup([HALL, CAGE, CHAMBER]);
    expect(element.querySelector(".champion-tab__cage .champion")).not.toBeNull();
    expect(element.querySelector<HTMLElement>(".champion-tab__chamber")!.hidden).toBe(false);
    expect(element.querySelector(".champion-tab__chamber .chamber")).not.toBeNull();
  });

  it("brings the Chamber's part into view when opened from the Chamber, and starts at the top otherwise", () => {
    const scrolled: string[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this.className);
    };
    try {
      setup([HALL, CAGE, CHAMBER], { buildingId: 3 });
      setup([HALL, CAGE, CHAMBER], { buildingId: 2 });
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
    expect(scrolled).toEqual(["housing-section champion-tab__section champion-tab__chamber"]);
  });

  it("destroys its panels with it", () => {
    const { tab, element } = setup([HALL, CAGE, CHAMBER]);
    tab.destroy();
    expect(element.isConnected).toBe(false);
    expect(element.querySelector(".champion")).toBeNull();
  });

  it("fits six tabs across a phone, and the local Tribe editor button steps aside for the windows", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const css = (path: string) =>
      readFileSync(resolve(here, path), "utf8").replace(/\r\n/g, "\n");
    const skin = css("../styles/skin.css");
    // Inside the phone block of skin.css, which closes at the first unindented brace.
    const start = skin.indexOf("@media (width <= 620px), (height <= 500px) {");
    const phone = skin.slice(start, skin.indexOf("\n}\n", start));
    expect(phone).toMatch(
      /:root\[data-skin\] \.monsters-screen \.tab-row > \.tabs__tab \{\s*padding-inline: 2px;\s*font-size: min\(var\(--text-sm\), 3vw\);/,
    );
    expect(css("../styles/tribe-editor.css")).toMatch(
      /:root:has\(\.map-dock--right > :not\(\[hidden\]\), \.monsters-screen:not\(\[hidden\]\)\) \.tribe-editor-open \{\s*visibility: hidden;/,
    );
  });
});
