// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, ShopBuyReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { HousingTab } from "./HousingTab";

/**
 * The Housing tab as a player meets it: the army table, the bar, the
 * buildings and why one counts zero, the stalled-hatchery line and the
 * expansion. The arithmetic is `housing.test.ts`'s; this checks the drawing
 * and the wiring.
 */

const T0 = 2_000_000;

const housing = (id: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: 15,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    credits: 1_000,
    buildingdata: {
      "1": housing(1, 6),
      "2": housing(2, 6),
      "3": housing(3, 6),
      "4": housing(4, 6),
    },
    buildinghealthdata: {},
    storedata: {},
    monsters: { housed: { C15: 2, C14: 25 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (load: Partial<BaseLoadResponse> = {}, focus: { buildingId?: number } = {}) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  let now = T0;
  const store = new YardStore({
    save: loadOf(load),
    api,
    clock: () => now,
    timers: { set: () => 0, clear: () => undefined },
  });
  const showTab = vi.fn();
  const selectBuilding = vi.fn();
  const tab = new HousingTab({
    binding: { store, scene: { selectBuilding }, notices: {} as Notices },
    showTab,
  });
  document.body.replaceChildren(tab.element);
  tab.show(focus);
  return {
    tab,
    store,
    showTab,
    selectBuilding,
    element: tab.element,
    setNow: (t: number) => (now = t),
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

const armyRows = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLTableRowElement>(".housing-table--army tbody tr")].map((tr) =>
    [...tr.children].map((cell) => spokenText(cell).trim()),
  );
const buildingRows = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLTableRowElement>(".housing-table--buildings tbody tr")];
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));

describe("HousingTab: the army", () => {
  it("lists each type in list order with count, space each and total, under the bar", () => {
    const { element } = setup();
    expect(armyRows(element)).toEqual([
      ["Zafreeti", "2", "200", "400"],
      ["Teratorn", "25", "70", "1,750"],
    ]);
    const foot = element.querySelector(".housing-table--army tfoot tr")!;
    expect([...foot.children].map((cell) => cell.textContent)).toEqual(["Total", "27", "", "2,150"]);
    expect(element.querySelector(".housing__figures")!.textContent).toBe("2,150 / 2,160 housed · 10 free");
    const bar = element.querySelector(".housing__bar")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("2150");
    expect(bar.getAttribute("aria-valuemax")).toBe("2160");
    expect(element.querySelector<HTMLImageElement>(".housing-table--army img")!.getAttribute("src")).toBe(
      "/assets/monsters/C15-small.png",
    );
  });

  it("says when there is no army and offers the Hatch tab", () => {
    const { element, showTab } = setup({ monsters: { housed: {} } });
    expect(element.querySelector(".housing-table--army")).toBeNull();
    expect(element.querySelector(".housing__empty")!.textContent).toContain("No monsters housed yet.");
    buttonNamed(element, "Hatch some")!.click();
    expect(showTab).toHaveBeenCalledWith("hatch");
  });

  it("names an army over capacity as over", () => {
    const { element } = setup({ buildingdata: { "1": housing(1, 1) } });
    expect(element.querySelector(".housing__figures")!.textContent).toBe("2,150 / 200 housed · 1,950 over");
  });
});

describe("HousingTab: the buildings", () => {
  it("gives each Housing its level and room, and says why one houses nothing", () => {
    const { element } = setup({
      buildingdata: {
        "1": housing(1, 6),
        "2": housing(2, 4, { cU: 900 }),
        "3": housing(3, 3),
        "4": housing(4, 1, { cB: 120 }),
      },
      buildinghealthdata: { "3": 8 },
    });
    const rows = buildingRows(element).map((tr) => [...tr.children].slice(0, 3).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["Housing", "6", "540"],
      ["HousingUpgrading: houses at level 4 until it finishes.", "4", "380"],
      ["HousingToo damaged to house monsters: repair it.", "3", "0"],
      ["HousingStill being built: houses nothing yet.", "1", "0"],
    ]);
    expect(buildingRows(element)[2]!.classList.contains("housing-table__row--zero")).toBe(true);
  });

  it("marks the building the tab was opened from, and Show pans to a building", () => {
    const { element, selectBuilding } = setup({}, { buildingId: 3 });
    const marked = element.querySelectorAll(".housing-table__row--focus");
    expect(marked).toHaveLength(1);
    expect((marked[0] as HTMLElement).dataset["building"]).toBe("3");
    buildingRows(element)[1]!.querySelector<HTMLButtonElement>(".housing-table__show")!.click();
    expect(selectBuilding).toHaveBeenCalledWith(2);
  });
});

describe("HousingTab: stalled hatcheries", () => {
  it("names how many hatcheries wait for space, and hides the line when none do", () => {
    const stalled = (hstage: number[]) =>
      setup({
        monsters: {
          housed: { C14: 25, C15: 2 },
          h: hstage.map(() => ["C14", 0, []] as const),
          hid: hstage.map((_, i) => 100 + i),
          hstage,
        },
      }).element.querySelector<HTMLElement>(".housing__stalled")!;
    expect(stalled([2, 2, 1]).textContent).toBe("2 hatcheries are waiting for space.");
    expect(stalled([2, 0]).textContent).toBe("1 hatchery is waiting for space.");
    expect(stalled([1, 0]).hidden).toBe(true);
  });
});

describe("HousingTab: Housing Expansion", () => {
  const buyResult = (): Promise<YardActionResult<ShopBuyReport>> =>
    Promise.resolve({
      ok: true,
      report: { item: "EXH", credits: 375, q: 1, endsAt: T0 + 86_400 },
      completed: [],
    });

  it("buys EXH on the second tap only", async () => {
    const { element, store } = setup();
    const buy = vi.spyOn(store, "buy").mockImplementation(buyResult);
    const button = element.querySelector<HTMLButtonElement>(".housing-expansion__buy")!;
    expect(spokenText(button)).toContain("375");
    button.click();
    expect(buy).not.toHaveBeenCalled();
    button.click();
    expect(buy).toHaveBeenCalledWith("EXH");
    await Promise.resolve();
    await Promise.resolve();
    expect(spokenText(element.querySelector(".monsters-status")!)).toBe(
      "Housing Expansion on for 24 hours: Shiny 375 spent.",
    );
  });

  it("is blocked without 375 Shiny", () => {
    const { element } = setup({ credits: 374 });
    const button = element.querySelector<HTMLButtonElement>(".housing-expansion__buy")!;
    expect(button.disabled || button.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("shows the time left while one runs, the 1.25x room, and goes back to the button when it ends", () => {
    const { element, tab, setNow } = setup({ storedata: { EXH: { q: 1, s: T0 - 60, e: T0 + 3_600 } } });
    expect(element.querySelector(".housing-expansion__buy")).toBeNull();
    expect(element.querySelector(".housing-expansion__text")!.textContent).toBe(
      "On: every building houses 25% more for 1h 0m.",
    );
    expect(element.querySelector(".housing__figures")!.textContent).toBe("2,150 / 2,700 housed · 550 free");
    setNow(T0 + 1_800);
    tab.tick();
    expect(element.querySelector(".housing-expansion__clock")!.textContent).toBe("30m 0s");
    setNow(T0 + 3_600);
    tab.tick();
    expect(element.querySelector(".housing-expansion__buy")).not.toBeNull();
    expect(element.querySelector(".housing__figures")!.textContent).toBe("2,150 / 2,160 housed · 10 free");
  });

  it("reports a refusal on the status line", async () => {
    const { element, store } = setup();
    vi.spyOn(store, "buy").mockResolvedValue({
      ok: false,
      refusal: { reason: "credits", message: "Not enough Shiny.", detail: {}, status: 409 },
    });
    const button = element.querySelector<HTMLButtonElement>(".housing-expansion__buy")!;
    button.click();
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    const status = element.querySelector(".monsters-status")!;
    expect(status.textContent).toBe("Not enough Shiny.");
    expect(status.classList.contains("monsters-status--bad")).toBe(true);
  });
});
