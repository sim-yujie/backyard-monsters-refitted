// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { AcademyActions } from "@/api/yardAcademy";
import type { HatcheryActions } from "@/api/yardHatchery";
import type { LockerActions } from "@/api/yardMonsters";
import { INFERNO_YARD } from "@/game/yard/ownYards";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { HatchTab } from "./HatchTab";
import { LockerTab } from "./LockerTab";
import { MonstersTabId, type MonstersTabContext } from "./monstersTab";
import { monstersTabsFor } from "./tabs";
import { TrainTab } from "./TrainTab";

/**
 * The monster screens on the Inferno yard (Inferno WP 2.4): the same tabs as
 * the main yard's, listing only the Inferno monsters (IC1-IC8), selling only
 * what the Inferno shop sells, and in Flash's Inferno words (Strongbox,
 * Incubator, Compound, Infernal Academy, Magma, Sulfur).
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
});

/** An Inferno yard: Hall 6, Strongbox 2, Incubator 3 (id 10), a Compound, the Infernal Academy. */
const infernoLoad = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    type: "inferno",
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1e8, r4: 1e8 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: Object.fromEntries(
      [
        building(1, 14, 6),
        building(2, 8, 2),
        building(10, 13, 3),
        building(20, 128, 2),
        building(30, 26, 2),
      ].map((one) => [String(one.id), one]),
    ),
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { IC1: { t: 2 }, IC2: { t: 2 } },
    academy: {},
    monsters: { saved: T0, housed: {}, hid: [10], h: [["", 0, []]], hstage: [0] },
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);
const ok = <R>(report: R): Promise<YardActionResult<R>> =>
  Promise.resolve({ ok: true, report, completed: [] });

const contextOf = (save: BaseLoadResponse): MonstersTabContext => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  const store = new YardStore({
    save,
    api,
    target: INFERNO_YARD,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  return {
    binding: {
      store,
      scene: { selectBuilding: vi.fn(), markHatcheries: vi.fn() },
      notices: {} as Notices,
    },
    showTab: vi.fn(),
  };
};

const hatcheryActions = (): HatcheryActions => ({
  add: vi.fn(() => never<never>()),
  remove: vi.fn(() => never<never>()),
  finish: vi.fn(() => never<never>()),
  overdrive: vi.fn((item: string) => ok({ item, credits: 30, q: 1, endsAt: T0 + 3600 })),
});

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("Inferno monster screens: the tab strip", () => {
  it("offers Unlock, Hatch, Compound and Train, and no Lab", () => {
    const tabs = monstersTabsFor("inferno");
    expect(tabs.map((tab) => tab.id)).toEqual([
      MonstersTabId.UNLOCK,
      MonstersTabId.HATCH,
      MonstersTabId.HOUSING,
      MonstersTabId.TRAIN,
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual(["Unlock", "Hatch", "Compound", "Train"]);
    expect(tabs.find((tab) => tab.id === MonstersTabId.HOUSING)?.buildings).toEqual([128]);
    expect(tabs.find((tab) => tab.id === MonstersTabId.HATCH)?.buildings).toEqual([13]);
  });
});

describe("Inferno monster screens: Hatch", () => {
  const setup = (save = infernoLoad()) => {
    const actions = hatcheryActions();
    const tab = new HatchTab(contextOf(save), actions);
    document.body.replaceChildren(tab.element);
    tab.show({});
    return { tab, actions, element: tab.element };
  };

  it("lists only the Inferno monsters, the unlocked ones ready", () => {
    const { element } = setup();
    const ids = [...element.querySelectorAll<HTMLElement>(".hatch-monster")].map(
      (one) => one.dataset["monster"],
    );
    expect([...ids].sort()).toEqual(["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "IC8"]);
    const locked = element.querySelector<HTMLElement>('.hatch-monster[data-monster="IC3"]')!;
    expect(locked.className).toMatch(/locked/);
  });

  it("names the Incubator, the Strongbox and Magma", () => {
    const { element } = setup();
    const text = element.textContent ?? "";
    expect(text).toContain("Incubator 1");
    expect(text).toContain("Magma each");
    expect(text).toContain("Go to Strongbox");
    expect(text).toContain("Each monster moves into the Compound the moment it hatches.");
    expect(text).not.toMatch(/Hatchery|Monster Locker|goo/i);
  });

  it("sells the Incubator Overdrives, not the Hatchery ones", async () => {
    const { element, actions } = setup();
    const offers = [
      ...element.querySelectorAll<HTMLButtonElement>(".hatch-boosts__overdrive .shiny-button"),
    ];
    expect(offers).toHaveLength(3);
    expect(offers.map((button) => button.getAttribute("aria-label"))).toEqual([
      "4x, 30 Shiny",
      "6x, 50 Shiny",
      "10x, 100 Shiny",
    ]);
    offers[0]!.click();
    offers[0]!.click();
    await flush();
    expect(actions.overdrive).toHaveBeenCalledWith("HODI");
  });

  it("shows a running Incubator Overdrive", () => {
    const { element } = setup(
      infernoLoad({ storedata: { HOD2I: { q: 1, s: T0 - 600, e: T0 + 3000 } } }),
    );
    expect(element.querySelector(".hatch-boosts__overdrive .shiny-button")).toBeNull();
    expect(element.querySelector(".hatch-boosts__running")!.textContent).toBe(
      "Overdrive 6x: every incubator works 6 times as fast for 50m 0s.",
    );
  });
});

describe("Inferno monster screens: Unlock", () => {
  const setup = () => {
    const actions: LockerActions = {
      start: vi.fn(() => never<never>()),
      cancel: vi.fn(() => never<never>()),
      finish: vi.fn(() => never<never>()),
      instant: vi.fn(() => never<never>()),
      overdrive: vi.fn(() => never<never>()),
    };
    const save = infernoLoad({
      lockerdata: { IC1: { t: 2 }, IC2: { t: 1, s: T0 - 10, e: T0 + 1000 } },
    } as Partial<BaseLoadResponse>);
    const tab = new LockerTab(contextOf(save), actions);
    document.body.replaceChildren(tab.element);
    tab.show({});
    return { element: tab.element };
  };

  it("lists IC1-IC8 by the Strongbox and sells no Locker Overdrive", () => {
    const { element } = setup();
    const ids = [...element.querySelectorAll<HTMLElement>(".locker-row")].map(
      (one) => one.dataset["monster"],
    );
    expect([...ids].sort()).toEqual(["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "IC8"]);
    expect(element.textContent).toContain("Strongbox level");
    expect(element.textContent).not.toContain("Overdrive 4 h");
  });
});

describe("Inferno monster screens: Train", () => {
  it("lists only the unlocked Inferno monsters, in the Infernal Academy's words", () => {
    const actions: AcademyActions = {
      train: vi.fn(() => never<never>()),
      cancel: vi.fn(() => never<never>()),
      finish: vi.fn(() => never<never>()),
      instant: vi.fn(() => never<never>()),
    };
    const tab = new TrainTab(contextOf(infernoLoad()), actions);
    document.body.replaceChildren(tab.element);
    tab.show({});
    const ids = [...tab.element.querySelectorAll<HTMLElement>(".train-row")].map(
      (one) => one.dataset["monster"],
    );
    expect(ids).toEqual(["IC1", "IC2"]);
    expect(tab.element.textContent).toContain("Magma");
    expect(tab.element.textContent).toContain("Infernal Academy 1");
    expect(tab.element.textContent).not.toMatch(/\bgoo\b/);
  });
});
