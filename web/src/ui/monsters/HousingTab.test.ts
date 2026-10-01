// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, ShopBuyReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { JuiceActions, JuiceReport } from "@/api/yardJuice";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { HousingTab } from "./HousingTab";

/**
 * The Housing tab as a player meets it: the space over one block per Housing
 * and why one counts zero, the monsters waiting for room, the army as
 * pictures (the Housing panel's view, #170), the Juicer and the expansion.
 * The arithmetic is `housing.test.ts`'s and `housingPanel.test.ts`'s; this
 * checks the drawing and the wiring.
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

const setup = (
  load: Partial<BaseLoadResponse> = {},
  focus: { buildingId?: number } = {},
  juice?: JuiceActions,
) => {
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
  const openMonsters = vi.fn();
  const tab = new HousingTab(
    {
      binding: { store, scene: { selectBuilding, openMonsters }, notices: {} as Notices },
      showTab,
    },
    juice,
  );
  document.body.replaceChildren(tab.element);
  tab.show(focus);
  return {
    tab,
    store,
    showTab,
    selectBuilding,
    openMonsters,
    element: tab.element,
    setNow: (t: number) => (now = t),
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

const tiles = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLButtonElement>(".housing-living__tile")].map((tile) => [
    tile.querySelector(".housing-living__name")!.textContent,
    tile.querySelector(".housing-living__badge")!.textContent,
    tile.querySelector(".housing-living__space")!.textContent,
  ]);
const blocks = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".housing-space__block")];
const figures = (root: HTMLElement) =>
  `${root.querySelector(".housing-space__figures")!.textContent} · ${root.querySelector(".housing-space__free")!.textContent}`;
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));

describe("HousingTab: the army", () => {
  it("shows each type as a picture with its count and space, biggest space first", () => {
    const { element } = setup();
    expect(tiles(element)).toEqual([
      ["Teratorn", "×25", "1,750 space"],
      ["Zafreeti", "×2", "400 space"],
    ]);
    expect(element.querySelector(".housing-living__count")!.textContent).toBe("27 monsters · 2 kinds");
    const first = element.querySelector<HTMLButtonElement>(".housing-living__tile")!;
    expect(first.getAttribute("aria-label")).toBe("Teratorn: 25 housed, 70 spaces each, 1,750 in total");
    expect(first.querySelector("img")!.getAttribute("src")).toBe("/portraits/C14-icon.webp");
    expect(figures(element)).toBe("2,150/ 2,160 spaces · 10 free");
  });

  it("opens a monster's card from its picture, and the Hatch tab from Hatch more", () => {
    const { element, openMonsters, showTab } = setup();
    element.querySelector<HTMLButtonElement>(".housing-living__tile")!.click();
    expect(openMonsters).toHaveBeenCalledWith("unlock", { monster: "C14" });
    buttonNamed(element, "Hatch more")!.click();
    expect(showTab).toHaveBeenCalledWith("hatch");
  });

  it("says when there is no army and still offers Hatch more", () => {
    const { element, showTab } = setup({ monsters: { housed: {} } });
    expect(tiles(element)).toEqual([]);
    expect(element.querySelector(".housing-living__count")!.textContent).toBe("No monsters yet");
    buttonNamed(element, "Hatch more")!.click();
    expect(showTab).toHaveBeenCalledWith("hatch");
  });

  it("names an army over capacity as over", () => {
    const { element } = setup({ buildingdata: { "1": housing(1, 1) } });
    expect(figures(element)).toBe("2,150/ 200 spaces · 1,950 over");
    expect(element.querySelector(".housing-space--tight")).not.toBeNull();
  });
});

describe("HousingTab: the buildings", () => {
  it("draws one block per Housing, filled in id order, and says why one houses nothing", () => {
    const { element } = setup({
      buildingdata: {
        "1": housing(1, 6),
        "2": housing(2, 4, { cU: 900 }),
        "3": housing(3, 3),
        "4": housing(4, 1, { cB: 120 }),
      },
      buildinghealthdata: { "3": 8 },
    });
    const drawn = blocks(element);
    expect(drawn.map((block) => block.dataset["building"])).toEqual(["1", "2", "3", "4"]);
    expect(drawn.map((block) => block.querySelector<HTMLElement>(".housing-space__fill")!.style.width)).toEqual([
      "100%",
      "100%",
      "0%",
      "0%",
    ]);
    expect(drawn[0]!.getAttribute("aria-label")).toBe("Housing 1 of 4: 540 of 540 spaces used");
    expect(drawn[1]!.getAttribute("aria-label")).toBe(
      "Housing 2 of 4: 380 of 380 spaces used. Upgrading: houses at level 4 until it finishes.",
    );
    expect(drawn[2]!.getAttribute("aria-label")).toBe(
      "Housing 3 of 4: 0 of 0 spaces used. Too damaged to house monsters: repair it.",
    );
    expect(drawn[3]!.classList.contains("housing-space__block--zero")).toBe(true);
    expect(element.querySelector(".housing-space__legend")!.textContent).toBe("Each block is one Housing");
  });

  it("rings the building the tab was opened from, and a block pans to its Housing", () => {
    const { element, selectBuilding } = setup({}, { buildingId: 3 });
    const marked = element.querySelectorAll(".housing-space__block--this");
    expect(marked).toHaveLength(1);
    expect((marked[0] as HTMLElement).dataset["building"]).toBe("3");
    expect(element.querySelector(".housing-space__legend")!.textContent).toBe(
      "Each block is one Housing, 540 spacesThis one",
    );
    blocks(element)[1]!.click();
    expect(selectBuilding).toHaveBeenCalledWith(2);
  });
});

describe("HousingTab: monsters waiting for room", () => {
  it("names what waits and how much room it needs, and hides the card when nothing does", () => {
    const card = (hstage: number[], h: string[] = hstage.map(() => "C14")) =>
      setup({
        monsters: {
          housed: { C14: 25, C15: 2 },
          h: h.map((id) => [id, 0, []] as const),
          hid: hstage.map((_, i) => 100 + i),
          hstage,
        },
      } as Partial<BaseLoadResponse>).element.querySelector<HTMLElement>(".housing-waiting")!;
    const two = card([2, 2, 1], ["C14", "C3", "C1"]);
    expect(two.hidden).toBe(false);
    expect(two.querySelector(".housing-waiting__title")!.textContent).toBe("2 monsters are waiting for room");
    expect(two.querySelector(".housing-waiting__line")!.textContent).toBe(
      "A Teratorn (70) and a Bolt (15) have hatched. They move in by themselves once 85 spaces are free. Until then those 2 hatcheries are paused.",
    );
    expect(two.querySelectorAll(".housing-waiting__picture")).toHaveLength(2);
    // The tab has its own expansion section; the card offers only the Juicer.
    expect(two.querySelector(".housing-waiting__expand")).toBeNull();
    expect(card([2, 0]).querySelector(".housing-waiting__title")!.textContent).toBe(
      "1 monster is waiting for room",
    );
    expect(card([1, 0]).hidden).toBe(true);
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
    expect(figures(element)).toBe("2,150/ 2,700 spaces · 550 free");
    setNow(T0 + 1_800);
    tab.tick();
    expect(element.querySelector(".housing-expansion__clock")!.textContent).toBe("30m 0s");
    setNow(T0 + 3_600);
    tab.tick();
    expect(element.querySelector(".housing-expansion__buy")).not.toBeNull();
    expect(figures(element)).toBe("2,150/ 2,160 spaces · 10 free");
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

describe("HousingTab: the Monster Juicer", () => {
  const juicer = (extra: Partial<BuildingData> = {}): BuildingData => ({
    id: 9,
    t: 9,
    l: 2,
    X: 400,
    Y: 0,
    ...extra,
  });
  const withJuicer = (extra: Partial<BuildingData> = {}, load: Partial<BaseLoadResponse> = {}) => ({
    buildingdata: { ...loadOf().buildingdata, "9": juicer(extra) },
    ...load,
  });
  const juiceRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".housing-juice__row")];
  const plus = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".housing-juice__step--plus")!;
  const note = (root: HTMLElement) =>
    [...root.querySelectorAll(".housing-juice__note")].map((one) => one.textContent).join(" | ");

  it("says to build one when there is none, and why one cannot juice", () => {
    expect(note(setup().element)).toBe("Build a Monster Juicer to turn monsters back into goo.");
    expect(note(setup(withJuicer({ cU: 600 })).element)).toContain("being upgraded");
    expect(note(setup(withJuicer({ cB: 600, l: 0 })).element)).toContain("still being built");
    // Level 2 Juicer: 32,000 health, so 16,000 is half and too damaged.
    const damaged = setup(withJuicer({}, { buildinghealthdata: { "9": 16_000 } })).element;
    expect(note(damaged)).toContain("too damaged");
    expect(juiceRows(damaged)).toHaveLength(0);
  });

  it("lists each housed type with a stepper and prices the selection at the Juicer's rate", () => {
    const { element } = setup(withJuicer());
    expect(note(element)).toContain("Level 2 Juicer: each monster gives back 80% of its hatch cost in goo.");
    const rows = juiceRows(element);
    expect(rows.map((row) => row.dataset["monster"])).toEqual(["C15", "C14"]);
    const go = element.querySelector<HTMLButtonElement>(".housing-juice__go")!;
    expect(go.disabled).toBe(true);
    expect(go.textContent).toBe("Juice selected");

    // Teratorn: ceil(70,000 × 0.8) = 56,000 each.
    plus(rows[1]!).click();
    plus(rows[1]!).click();
    expect(rows[1]!.querySelector<HTMLInputElement>("input")!.value).toBe("2");
    expect(go.disabled).toBe(false);
    expect(spokenText(go)).toBe("Juice 2 · Goo 112,000");

    // Fill ("All") takes every one of that type, and no more.
    rows[0]!.querySelector<HTMLButtonElement>(".housing-juice__fill")!.click();
    expect(rows[0]!.querySelector<HTMLInputElement>("input")!.value).toBe("2");
    expect(plus(rows[0]!).disabled).toBe(true);
    expect(spokenText(go)).toBe("Juice 4 · Goo 304,000");
  });

  it("Select all and Clear", () => {
    const { element } = setup(withJuicer());
    buttonNamed(element, "Select all")!.click();
    const go = element.querySelector<HTMLButtonElement>(".housing-juice__go")!;
    expect(spokenText(go)).toBe(`Juice 27 · Goo ${(2 * 96_000 + 25 * 56_000).toLocaleString("en-US")}`);
    expect(buttonNamed(element, "Select all")!.disabled).toBe(true);
    buttonNamed(element, "Clear")!.click();
    expect(go.textContent).toBe("Juice selected");
  });

  it("confirms before juicing, states what the cap would swallow, and can back out", () => {
    const juice = vi.fn();
    const { element } = setup(
      withJuicer({}, { resources: { r1: 0, r2: 0, r3: 0, r4: 90_000 } }),
      {},
      { juice },
    );
    const rows = juiceRows(element);
    plus(rows[1]!).click();
    element.querySelector<HTMLButtonElement>(".housing-juice__go")!.click();
    expect(juice).not.toHaveBeenCalled();
    const confirm = element.querySelector(".housing-juice__confirm")!;
    expect(spokenText(confirm.querySelector(".housing-juice__question")!)).toBe(
      "Juice 1 monster for Goo 56,000? They are gone for good.",
    );
    expect(confirm.querySelector(".housing-juice__lost")).toBeNull();
    buttonNamed(element, "Keep them")!.click();
    expect(element.querySelector(".housing-juice__confirm")).toBeNull();
    expect(juice).not.toHaveBeenCalled();
  });

  it("says what the goo cap would swallow", () => {
    const { element, store } = setup(withJuicer({}, { resources: { r1: 0, r2: 0, r3: 0, r4: 90_000 } }));
    vi.spyOn(store, "caps", "get").mockReturnValue({ r1: 100_000, r2: 100_000, r3: 100_000, r4: 100_000 });
    plus(juiceRows(element)[1]!).click();
    element.querySelector<HTMLButtonElement>(".housing-juice__go")!.click();
    expect(spokenText(element.querySelector(".housing-juice__question")!)).toBe(
      "Juice 1 monster for Goo 10,000? They are gone for good.",
    );
    expect(spokenText(element.querySelector(".housing-juice__lost")!)).toBe(
      "Your goo storage is full: Goo 46,000 will not fit and is lost.",
    );
  });

  it("juices the selection on Yes and reports the goo", async () => {
    const report: JuiceReport = { juiced: { C14: 3 }, goo: 168_000, lost: 0, rate: 0.8 };
    const juice = vi.fn(() => Promise.resolve({ ok: true as const, report, completed: [] }));
    const { element } = setup(withJuicer(), {}, { juice });
    const row = juiceRows(element)[1]!;
    const input = row.querySelector<HTMLInputElement>("input")!;
    input.value = "3";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new Event("change"));
    element.querySelector<HTMLButtonElement>(".housing-juice__go")!.click();
    buttonNamed(element, "Yes, juice")!.click();
    expect(juice).toHaveBeenCalledWith({ C14: 3 });
    await Promise.resolve();
    await Promise.resolve();
    expect(spokenText(element.querySelector(".monsters-status")!)).toBe("Juiced 3 monsters: Goo 168,000 added.");
    expect(element.querySelector(".housing-juice__confirm")).toBeNull();
  });

  it("shows a refusal on the status line", async () => {
    const juice = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        refusal: { reason: "damaged", message: "Your Monster Juicer is too damaged to work.", detail: {} },
      }),
    );
    const { element } = setup(withJuicer(), {}, { juice });
    plus(juiceRows(element)[0]!).click();
    element.querySelector<HTMLButtonElement>(".housing-juice__go")!.click();
    buttonNamed(element, "Yes, juice")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(element.querySelector(".monsters-status")!.textContent).toBe(
      "Your Monster Juicer is too damaged to work.",
    );
  });
});
