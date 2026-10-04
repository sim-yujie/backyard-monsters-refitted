// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { setDevDetails } from "@/app/devDetails";
import { YardStore, type YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { BuildingPanel, recycledMessage, type BuildingPanelOptions } from "./BuildingPanel";

/**
 * The panel as a player meets it: which buttons each building shows, what
 * the gate line and the Cancel confirmation say, and that each button calls
 * the store's route. The rules behind them are `buildingActions.test.ts`'s;
 * this checks the drawing and the wiring.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  l,
  X: id * 40,
  Y: 0,
  ...extra,
});

const loadOf = (buildings: BuildingData[], extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 1e8, r2: 1e8, r3: 1e8, r4: 1e8 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: { BEW: { q: 4 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

/** A request that never answers, so the test can look at the panel mid-flight. */
const pendingForever = <R>() => new Promise<YardResponse<R>>(() => undefined);

const fakeApi = () =>
  ({
    state: vi.fn(() => pendingForever<null>()),
    upgrade: vi.fn(() => pendingForever()),
    cancelUpgrade: vi.fn(() => pendingForever()),
    instantUpgrade: vi.fn(() => pendingForever()),
    speedUp: vi.fn(() => pendingForever()),
    shopBuy: vi.fn(() => pendingForever()),
  }) as unknown as YardApi & Record<keyof YardApi, ReturnType<typeof vi.fn>>;

const setup = (
  buildings: BuildingData[],
  id: number,
  options: {
    load?: Partial<BaseLoadResponse>;
    own?: boolean;
    panel?: Partial<BuildingPanelOptions>;
    scene?: Partial<YardUiBinding["scene"]>;
  } = {},
) => {
  const api = fakeApi();
  const store = new YardStore({
    save: loadOf(buildings, options.load),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const binding: YardUiBinding = {
    store,
    scene: { selectBuilding: vi.fn(), ...options.scene },
    notices: {} as Notices,
  };
  const panel = new BuildingPanel({
    onClose: vi.fn(),
    ...(options.own === false ? {} : { yard: binding }),
    ...options.panel,
  }).mount(document.body);
  const shown = store.building(id);
  if (!shown) throw new Error(`no building ${id}`);
  panel.show(shown);
  return { panel, api, store, element: panel.element };
};

const buttons = (root: HTMLElement): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>(".building-panel__actions button"),
];
const buttonNamed = (root: HTMLElement, text: string): HTMLButtonElement | undefined =>
  buttons(root).find((one) => one.textContent?.startsWith(text));

const HALL = building(1, 14, 5);

/** The info rows as "Label value" lines. */
const infoLines = (root: HTMLElement): string[] =>
  [...root.querySelectorAll(".building-panel__info dt")].map(
    (term) => `${term.textContent} ${spokenText(term.nextElementSibling!)}`,
  );

describe("BuildingPanel: a tower at rest", () => {
  it("titles itself with name and level and shows the tower numbers", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2);
    expect(element.querySelector(".panel__title")?.textContent).toBe("Cannon Tower · Level 4");
    expect(infoLines(element)).toEqual([
      "Health 17,640 / 17,640",
      "Range 190 → 200",
      "Damage 80/s → 100/s",
    ]);
  });

  it("offers Upgrade with its cost and time, and Instant", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2);
    const block = element.querySelector(".building-upgrade")!;
    const words = spokenText(block);
    expect(words).toContain("Upgrade to 5");
    expect(words).toContain("6h 45m");
    expect(words).toContain("Twigs");
    expect(words).toContain("Pebbles");
    expect(buttonNamed(element, "Upgrade")?.disabled).toBe(false);
    expect(buttonNamed(element, "Instant")).toBeDefined();
    // Every cost chip is held in full here, so every one reads green, never
    // the gold that read backwards to the owner (#278).
    const chips = block.querySelectorAll(".build-info__fact");
    expect(chips.length).toBeGreaterThan(0);
    expect(block.querySelectorAll(".build-info__fact--ok")).toHaveLength(chips.length);
    expect(block.querySelector(".build-info__fact--short")).toBeNull();
  });

  it("marks only the short resource red on an upgrade the yard cannot afford (#278)", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2, {
      load: { resources: { r1: 500, r2: 1e8, r3: 1e8, r4: 1e8 } },
    });
    const block = element.querySelector(".building-upgrade")!;
    expect(spokenText(block.querySelector(".build-info__fact--short")!)).toBe("Twigs 1,250,000");
    expect(spokenText(block.querySelector(".build-info__fact--ok")!)).toBe("Pebbles 937,500");
    expect(buttonNamed(element, "Upgrade")?.disabled).toBe(true);
  });

  it("Upgrade calls the upgrade route and is disabled while it runs", () => {
    const { element, api } = setup([HALL, building(2, 20, 4)], 2);
    buttonNamed(element, "Upgrade")!.click();
    expect(api.upgrade).toHaveBeenCalledWith(2);
    expect(buttonNamed(element, "Upgrade")?.disabled).toBe(true);
  });

  it("Instant needs a second tap before it calls the route", () => {
    const { element, api } = setup([HALL, building(2, 20, 4)], 2);
    const instant = buttonNamed(element, "Instant")!;
    instant.click();
    expect(api.instantUpgrade).not.toHaveBeenCalled();
    expect(instant.textContent).toContain("Tap again");
    instant.click();
    expect(api.instantUpgrade).toHaveBeenCalledWith(2);
  });

  it("a shortfall disables Upgrade and says how much more, with the resource icon", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2, {
      load: { resources: { r1: 1_000_000, r2: 1e8, r3: 1e8, r4: 1e8 } },
    });
    expect(buttonNamed(element, "Upgrade")?.disabled).toBe(true);
    const gate = element.querySelector(".building-panel__gate")!;
    expect(spokenText(gate)).toMatch(/^Need Twigs [\d.,K]+ more\.$/);
  });

  it("a Town Hall gate reads as one sentence", () => {
    const { element } = setup([building(1, 14, 4), building(2, 21, 4)], 2);
    expect(element.querySelector(".building-panel__gate")?.textContent).toBe("Needs Town Hall 5.");
  });

  it("keeps Details collapsed, with the full field list inside", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2);
    const details = element.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("Type id");
    expect(details.textContent).toContain("Footprint");
  });

  it("shows a player's Details without the developer fields (#150)", () => {
    setDevDetails(false);
    try {
      const { element } = setup([HALL, building(2, 20, 4)], 2);
      const text = element.querySelector("details")!.textContent ?? "";
      for (const field of ["Type id", "Footprint", "Position", "Building id", "Art", "save omits"]) {
        expect(text).not.toContain(field);
      }
      expect(text).toContain("Level4");
      expect(text).toContain("Health");
    } finally {
      setDevDetails(null);
    }
  });
});

describe("BuildingPanel: an upgrade running", () => {
  const upgrading = () => setup([HALL, building(2, 20, 4, { cU: 5_400 })], 2);

  it("shows the countdown, the bar and the three speed-ups, and no Upgrade", () => {
    const { element } = upgrading();
    expect(element.querySelector(".building-job__countdown")?.textContent).toBe("1h 30m");
    expect(element.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("78");
    expect(buttonNamed(element, "Finish now")?.disabled).toBe(false);
    expect(buttonNamed(element, "−1 h")?.disabled).toBe(false);
    // Under two hours left: −2 h is refused, with the reason on the button.
    expect(buttonNamed(element, "−2 h")?.disabled).toBe(true);
    expect(buttonNamed(element, "−2 h")?.title).toMatch(/two hours/);
    expect(buttonNamed(element, "Upgrade")).toBeUndefined();
  });

  it("Cancel asks once, stating the refund, then calls the cancel route", () => {
    const { element, api } = upgrading();
    buttonNamed(element, "Cancel upgrade")!.click();
    const confirm = element.querySelector(".building-cancel--confirming")!;
    expect(spokenText(confirm)).toMatch(/^Cancel and get back Twigs .+ Pebbles .+ Putty .+\? Progress is lost\./);
    expect(api.cancelUpgrade).not.toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>(".building-cancel__confirm")!.click();
    expect(api.cancelUpgrade).toHaveBeenCalledWith(2);
  });

  it("Keep upgrading closes the confirmation without calling anything", () => {
    const { element, api } = upgrading();
    buttonNamed(element, "Cancel upgrade")!.click();
    element.querySelector<HTMLButtonElement>(".building-cancel__keep")!.click();
    expect(element.querySelector(".building-cancel--confirming")).toBeNull();
    expect(api.cancelUpgrade).not.toHaveBeenCalled();
  });

  it("Finish now spends only on the second tap, through SP4", () => {
    const { element, api } = upgrading();
    const finish = buttonNamed(element, "Finish now")!;
    finish.click();
    expect(api.speedUp).not.toHaveBeenCalled();
    finish.click();
    expect(api.speedUp).toHaveBeenCalledWith(2, "SP4");
  });
});

describe("BuildingPanel: buildings without an Upgrade here", () => {
  it("a wall points at the layout planner and offers no Upgrade", () => {
    const { element } = setup([HALL, building(2, 17, 1)], 2);
    expect(buttonNamed(element, "Upgrade")).toBeUndefined();
    expect(element.querySelector(".building-panel__note")?.textContent).toMatch(/layout planner/);
  });

  it("a Map Room 2 opens the map", () => {
    const openMap = vi.fn();
    const { element } = setup([building(1, 14, 6), building(2, 11, 2)], 2, {
      panel: { openMap },
    });
    expect(buttonNamed(element, "Upgrade")).toBeUndefined();
    buttonNamed(element, "Open map")!.click();
    expect(openMap).toHaveBeenCalled();
  });

  it("a level 1 Map Room offers Upgrade without Instant, and opens its map (Map Room 1, #162)", () => {
    const openMap = vi.fn();
    const { element } = setup([building(1, 14, 6), building(2, 11, 1)], 2, {
      panel: { openMap },
    });
    expect(buttonNamed(element, "Upgrade")).toBeDefined();
    expect(buttonNamed(element, "Instant")).toBeUndefined();
    const open = buttonNamed(element, "Open map")!;
    expect(open.disabled).toBe(false);
    open.click();
    expect(openMap).toHaveBeenCalledTimes(1);
  });

  it("the Yard Planner opens the planner", () => {
    const open = vi.fn();
    const { element } = setup([HALL, building(2, 10, 1)], 2, {
      panel: { planner: { label: "Open layout planner", title: "", open } },
    });
    buttonNamed(element, "Open layout planner")!.click();
    expect(open).toHaveBeenCalled();
  });

  it("a foreign yard shows the numbers and no actions", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2, { own: false });
    expect(buttons(element)).toHaveLength(0);
    expect(infoLines(element)).toContain("Range 190 → 200");
  });
});

describe("BuildingPanel: the General Store (§8.2)", () => {
  it("opens the Shop from Open Shop", () => {
    const openShop = vi.fn();
    const { element } = setup([HALL, building(2, 12, 1)], 2, { scene: { openShop } });
    buttonNamed(element, "Open Shop")!.click();
    expect(openShop).toHaveBeenCalledOnce();
  });

  it("offers no Open Shop where the scene has no Shop", () => {
    const { element } = setup([HALL, building(2, 12, 1)], 2);
    expect(buttonNamed(element, "Open Shop")).toBeUndefined();
  });
});

describe("BuildingPanel: the monster buildings", () => {
  it("opens the Monster Locker's Unlock tab from Open, with the building named", () => {
    const openMonsters = vi.fn();
    const { element } = setup([HALL, building(2, 8, 2)], 2, { scene: { openMonsters } });
    const open = buttonNamed(element, "Open")!;
    expect(open).toBeDefined();
    open.click();
    expect(openMonsters).toHaveBeenCalledWith("unlock", { buildingId: 2 });
  });

  it("opens a Hatchery on Hatch", () => {
    const openMonsters = vi.fn();
    const { element } = setup([HALL, building(3, 13, 1)], 3, { scene: { openMonsters } });
    buttonNamed(element, "Open")!.click();
    expect(openMonsters).toHaveBeenCalledWith("hatch", { buildingId: 3 });
  });

  it("offers no Open where the scene has no Monsters screen", () => {
    const { element } = setup([HALL, building(2, 8, 2)], 2);
    expect(buttonNamed(element, "Open")).toBeUndefined();
  });
});

describe("BuildingPanel: the Monster Bunker (§7.1)", () => {
  it("Open bunker shows the bunker's controls under the actions, and Close bunker hides them", () => {
    const { element } = setup([HALL, building(2, 22, 1, { m: { C1: 3 } })], 2, {
      load: { monsters: { housed: { C2: 4 } } } as Partial<BaseLoadResponse>,
    });
    expect(element.querySelector(".bunker")).toBeNull();
    buttonNamed(element, "Open bunker")!.click();
    const bunker = element.querySelector(".bunker")!;
    expect(bunker.querySelector(".bunker__figures")!.textContent).toBe("30 / 380 space used");
    expect(buttonNamed(element, "Close bunker")!.getAttribute("aria-expanded")).toBe("true");
    buttonNamed(element, "Close bunker")!.click();
    expect(element.querySelector(".bunker")).toBeNull();
    expect(buttonNamed(element, "Open bunker")).toBeDefined();
  });

  it("closes the bunker's controls when another building is shown", () => {
    const { element, panel, store } = setup([HALL, building(2, 22, 1)], 2);
    buttonNamed(element, "Open bunker")!.click();
    panel.show(store.building(1)!);
    expect(element.querySelector(".bunker")).toBeNull();
  });
});

describe("BuildingPanel: the Champion Cage (§7.2)", () => {
  it("Open cage shows the cage's controls under the actions, and Close cage hides them", () => {
    const { element, panel, store } = setup([HALL, building(2, 114, 1)], 2);
    expect(element.querySelector(".champion")).toBeNull();
    buttonNamed(element, "Open cage")!.click();
    expect(element.querySelector(".champion .champion-card")).not.toBeNull();
    expect(buttonNamed(element, "Close cage")!.getAttribute("aria-expanded")).toBe("true");
    buttonNamed(element, "Close cage")!.click();
    expect(element.querySelector(".champion")).toBeNull();
    buttonNamed(element, "Open cage")!.click();
    panel.show(store.building(1)!);
    expect(element.querySelector(".champion")).toBeNull();
  });

  it("Open chamber shows the chamber's controls (#125)", () => {
    const { element } = setup([HALL, building(2, 119, 1)], 2);
    buttonNamed(element, "Open chamber")!.click();
    expect(element.querySelector(".chamber")).not.toBeNull();
    buttonNamed(element, "Close chamber")!.click();
    expect(element.querySelector(".chamber")).toBeNull();
  });
});

describe("BuildingPanel: a building under construction (§5.3)", () => {
  it("offers Cancel build, which asks once and calls build/cancel", () => {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetch);
    try {
      const { element, api } = setup([HALL, building(2, 20, 0, { cB: 20 })], 2);
      buttonNamed(element, "Cancel build")!.click();
      const confirm = element.querySelector(".building-cancel--confirming")!;
      expect(spokenText(confirm)).toMatch(/^Cancel and get back Twigs 2,000 Pebbles 1,500 Putty 500\?/);
      expect(element.querySelector(".building-cancel__keep")?.textContent).toBe("Keep building");

      element.querySelector<HTMLButtonElement>(".building-cancel__confirm")!.click();
      expect(api.cancelUpgrade).not.toHaveBeenCalled();
      expect(String((fetch.mock.calls[0] as unknown[] | undefined)?.[0])).toMatch(/\/bm\/yard\/build\/cancel$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("BuildingPanel: a damaged building", () => {
  it("offers a free Repair above the upgrade, and Repair now over every damaged building", () => {
    // A Cannon Tower at half health and a snapper nobody is repairing.
    const { element } = setup(
      [HALL, building(2, 20, 4, { hp: 8_820 }), building(3, 1, 1, { hp: 100 })],
      2,
    );
    const block = element.querySelector(".building-repair")!;
    expect(block.querySelector(".building-panel__heading")?.textContent).toBe("Damaged");
    expect(block.querySelector(".building-repair__bar")?.getAttribute("aria-valuetext")).toBe(
      "8,820 of 17,640 health",
    );
    expect(block.querySelector<HTMLElement>(".building-repair__health")?.hidden).toBe(true);
    expect(buttonNamed(element, "Repair")?.disabled).toBe(false);
    expect(buttonNamed(element, "Repair all 2 now")).toBeDefined();
    // The upgrade says why it waits.
    expect(element.querySelector(".building-upgrade .building-panel__gate")?.textContent).toBe(
      "Repair first.",
    );
  });

  it("shows a running repair's countdown and no Repair button", () => {
    const { element } = setup([HALL, building(2, 20, 4, { hp: 8_820, rE: 1 })], 2);
    const block = element.querySelector(".building-repair")!;
    expect(block.querySelector(".building-panel__heading")?.textContent).toBe("Repairing");
    expect(block.querySelector(".building-repair__time")?.textContent).not.toBe("");
    expect(block.querySelector(".building-repair__health")?.textContent).toBe("Healed to 8,820 / 17,640");
    expect(buttons(element).some((one) => one.textContent === "Repair")).toBe(false);
  });

  it("draws no repair block for a building at full health", () => {
    const { element } = setup([HALL, building(2, 20, 4)], 2);
    expect(element.querySelector(".building-repair")).toBeNull();
  });
});

describe("BuildingPanel: recycle", () => {
  it("offers Recycle, and one confirmation that says what comes back", () => {
    // Twig Snapper level 2 refunds half of 750 + 1,575 pebbles.
    const { element } = setup([HALL, building(2, 1, 2)], 2);
    buttonNamed(element, "Recycle")!.click();
    const question = element.querySelector(".building-recycle__question")!;
    expect(spokenText(question)).toContain("Recycle this Twig Snapper and get back");
    expect(spokenText(question)).toContain("1,162");
    expect(element.querySelector(".building-recycle__confirm")?.textContent).toBe("Yes, recycle");
    buttonNamed(element, "Keep it")!.click();
    expect(element.querySelector(".building-recycle--confirming")).toBeNull();
  });

  it("shows the Housing cull before confirming", () => {
    const housing = [building(2, 15, 1), building(3, 15, 1)];
    const { element } = setup([HALL, ...housing], 3, {
      load: { monsters: { housed: { C1: 10_000 } } } as Partial<BaseLoadResponse>,
    });
    // A Housing keeps Recycle in its "···" menu (#170).
    element.querySelector<HTMLButtonElement>(".building-panel__more-button")!.click();
    [...element.querySelectorAll<HTMLButtonElement>(".building-panel__menu-item")]
      .find((item) => item.textContent === "Recycle this Housing")!
      .click();
    expect(element.querySelector(".building-recycle__cull")?.textContent).toMatch(
      /^Your monsters will no longer fit\. These are lost: \d+ × /,
    );
  });

  it("lists a Monster Bunker's contents as lost before confirming", () => {
    const { element } = setup([HALL, building(2, 22, 1, { m: { C1: 4, C5: 2 } })], 2);
    buttonNamed(element, "Recycle")!.click();
    expect(element.querySelector(".building-recycle__cull")?.textContent).toBe(
      "The monsters in this bunker go with it. These are lost: 4 × Pokey, 2 × Eye-ra.",
    );
  });

  it("says nothing about monsters for an empty bunker", () => {
    const { element } = setup([HALL, building(2, 22, 1)], 2);
    buttonNamed(element, "Recycle")!.click();
    expect(element.querySelector(".building-recycle--confirming")).not.toBeNull();
    expect(element.querySelector(".building-recycle__cull")).toBeNull();
  });

  it("names a bunker's lost monsters in the notice after recycling", () => {
    const report = { id: 2, t: 22, refund: { r1: 10, r2: 0, r3: 0, r4: 0 }, lost: {}, stored: null, culled: {} };
    const line = recycledMessage("Monster Bunker", report as never, { C1: 4 });
    expect(spokenText(line)).toMatch(/Monster Bunker recycled for .*\. 4 × Pokey lost with it\.$/);
  });

  it("stores a decoration instead, and offers nothing on the Town Hall", () => {
    const { element } = setup([HALL, building(2, 28, 1)], 2);
    expect(buttonNamed(element, "Put in storage")).toBeDefined();
    const hall = setup([HALL], 1);
    expect(buttonNamed(hall.element, "Recycle")).toBeUndefined();
  });

  it("disables Recycle, with the reason, where the server would refuse", () => {
    const { element } = setup([HALL, building(2, 13, 1)], 2, {
      load: { monsters: { h: [["C1", 10, [], 1]], hid: [2], hstage: [1] } } as Partial<BaseLoadResponse>,
    });
    const recycle = buttonNamed(element, "Recycle")!;
    expect(recycle.disabled).toBe(true);
    expect(element.querySelector(".building-recycle .building-panel__gate")?.textContent).toBe(
      "Take the monsters out of this hatchery first.",
    );
  });
});

describe("BuildingPanel: the Housing panel (#170)", () => {
  const HOUSINGS = [building(2, 15, 6), building(3, 15, 6), building(4, 15, 6), building(5, 15, 6)];
  const WAITING = {
    monsters: {
      housed: { C14: 10, C15: 2, C12: 2, C8: 8, C5: 3, C1: 16, C3: 10 },
      h: [["C14", 0], ["C3", 0]],
      hid: [20, 21],
      hstage: [2, 2],
    },
  } as unknown as Partial<BaseLoadResponse>;

  it("is one panel: Housing, its level as a chip, what lives there, and no plain card", () => {
    const { element } = setup([HALL, ...HOUSINGS], 3, { load: WAITING });
    expect(element.classList.contains("building-panel--housing")).toBe(true);
    expect(element.querySelector(".panel__title")!.textContent).toBe("Housing");
    const chip = element.querySelector<HTMLElement>(".building-panel__chip")!;
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe("Level 6 · max");
    expect(element.querySelector(".building-panel__blurb")!.textContent).toBe(
      "Where your monsters live. Your 4 Housings share one space: bigger space, bigger army.",
    );
    expect(element.querySelector<HTMLElement>(".building-panel__info")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".cell-kind")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".building-panel__details")!.hidden).toBe(true);
    // The plain card's Open and Recycle and its "highest level" note are gone.
    expect(buttonNamed(element, "Open")).toBeUndefined();
    expect(buttonNamed(element, "Recycle")).toBeUndefined();
    expect(element.querySelector(".building-panel__actions .building-panel__note")).toBeNull();

    expect(element.querySelector(".housing-space__figures")!.textContent).toBe("2,150/ 2,160 spaces");
    expect(element.querySelector(".housing-space__free")!.textContent).toBe("10 free");
    expect(element.querySelector<HTMLElement>(".housing-space__block--this")!.dataset["building"]).toBe("3");
    expect(element.querySelector(".housing-waiting__title")!.textContent).toBe("2 monsters are waiting for room");
    expect(
      [...element.querySelectorAll(".housing-living__name")].map((name) => name.textContent),
    ).toEqual(["Teratorn", "Zafreeti", "D.A.V.E.", "Fang", "Eye-ra", "Pokey", "Bolt"]);
    expect(element.querySelector(".housing-living__count")!.textContent).toBe("51 monsters · 7 kinds");
  });

  it("a Housing still on its first build shows the plain construction card, not the Housing panel (#281)", () => {
    const { element } = setup([HALL, building(3, 15, 0, { cB: 600 })], 3);
    expect(element.classList.contains("building-panel--housing")).toBe(false);
    expect(element.querySelector(".panel__title")!.textContent).toBe("Housing");
    expect(element.querySelector<HTMLElement>(".building-panel__chip")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".building-panel__housing")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".cell-kind")!.hidden).toBe(false);
    // The construction info: a running "build" job with its Cancel.
    expect(buttonNamed(element, "Cancel build")).toBeDefined();
    expect(buttonNamed(element, "Open")).toBeUndefined();
  });

  it("offers Housing Expansion in the waiting card, spent on the second tap", () => {
    const { element, store } = setup([HALL, ...HOUSINGS], 3, { load: WAITING });
    const buy = vi.spyOn(store, "buy").mockImplementation(() => new Promise(() => undefined));
    const expand = element.querySelector<HTMLButtonElement>(".housing-waiting__expand")!;
    expect(spokenText(expand)).toContain("+25% · 24 h");
    expect(spokenText(expand)).toContain("375");
    expand.click();
    expect(buy).not.toHaveBeenCalled();
    expand.click();
    expect(buy).toHaveBeenCalledWith("EXH");
  });

  it("opens the Juicer as a sheet of the panel, and goes back", () => {
    const { element } = setup([HALL, ...HOUSINGS], 3, { load: WAITING });
    element.querySelector<HTMLButtonElement>(".housing-waiting__juice")!.click();
    const sheet = element.querySelector<HTMLElement>(".building-panel__sheet")!;
    expect(sheet.hidden).toBe(false);
    expect(sheet.querySelector(".housing-juice")).not.toBeNull();
    expect(element.querySelector<HTMLElement>(".building-panel__housing")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".building-panel__foot")!.hidden).toBe(true);
    sheet.querySelector<HTMLButtonElement>(".building-panel__back")!.click();
    expect(element.querySelector<HTMLElement>(".building-panel__sheet")!.hidden).toBe(true);
    expect(element.querySelector<HTMLElement>(".building-panel__housing")!.hidden).toBe(false);
  });

  it("opens Monsters on Housing, Hatch more on Hatch, and a picture on its card", () => {
    const openMonsters = vi.fn();
    const selectBuilding = vi.fn();
    const { element } = setup([HALL, ...HOUSINGS], 3, { load: WAITING, scene: { openMonsters, selectBuilding } });
    element.querySelector<HTMLButtonElement>(".building-panel__open-monsters")!.click();
    expect(openMonsters).toHaveBeenLastCalledWith("housing", { buildingId: 3 });
    element.querySelector<HTMLButtonElement>(".housing-living__hatch")!.click();
    expect(openMonsters).toHaveBeenLastCalledWith("hatch");
    element.querySelector<HTMLButtonElement>(".housing-living__tile")!.click();
    expect(openMonsters).toHaveBeenLastCalledWith("unlock", { monster: "C14" });
    element.querySelectorAll<HTMLButtonElement>(".housing-space__block")[0]!.click();
    expect(selectBuilding).toHaveBeenCalledWith(2);
  });

  it("keeps Recycle and the Details behind the ··· menu", () => {
    const { element } = setup([HALL, ...HOUSINGS], 3);
    const more = element.querySelector<HTMLButtonElement>(".building-panel__more-button")!;
    expect(more.getAttribute("aria-label")).toBe("More: Recycle this Housing");
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const items = () => [...element.querySelectorAll<HTMLButtonElement>(".building-panel__menu-item")];
    expect(items().map((item) => item.textContent)).toEqual(["Recycle this Housing", "Show details"]);
    items()[1]!.click();
    expect(element.querySelector<HTMLElement>(".building-panel__details")!.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    items()[0]!.click();
    expect(element.querySelector(".building-recycle--confirming")).not.toBeNull();
    buttonNamed(element, "Keep it")!.click();
    expect(element.querySelector(".building-recycle")).toBeNull();
  });

  it("still offers the upgrade of a Housing that is not at the top", () => {
    const { element } = setup([HALL, building(2, 15, 2)], 2);
    expect(element.querySelector(".building-panel__chip")!.textContent).toBe("Level 2");
    expect(element.querySelector(".building-upgrade")).not.toBeNull();
    expect(element.querySelector(".building-panel__blurb")!.textContent).toMatch(/^Where your monsters live\./);
  });

  it("is the plain card on a foreign yard, and again for the next building", () => {
    const foreign = setup([HALL, ...HOUSINGS], 3, { own: false });
    expect(foreign.element.classList.contains("building-panel--housing")).toBe(false);
    expect(foreign.element.querySelector(".housing-view")).toBeNull();

    const { panel, store, element } = setup([HALL, ...HOUSINGS], 3);
    panel.show(store.building(1)!);
    expect(element.classList.contains("building-panel--housing")).toBe(false);
    expect(element.querySelector<HTMLElement>(".building-panel__chip")!.hidden).toBe(true);
    expect(element.querySelector(".panel__title")!.textContent).toBe("Town Hall · Level 5");
  });
});

describe("BuildingPanel: fortifying an outpost (#191)", () => {
  const OUTPOST = "2000242209";
  const CORE = building(1, 112, 1, { X: 0, Y: -50 });

  const onOutpost = (buildings: BuildingData[], id: number) => {
    const sent: { url: string; body: URLSearchParams }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        sent.push({ url, body: new URLSearchParams(String(init.body ?? "")) });
        return new Promise(() => undefined);
      }),
    );
    const store = new YardStore({
      save: loadOf(buildings, { type: "outpost", storedata: {} } as Partial<BaseLoadResponse>),
      target: { baseid: OUTPOST, kind: "outpost" },
      api: fakeApi(),
      clock: () => T0,
      timers: { set: () => 0, clear: () => undefined },
    });
    const binding: YardUiBinding = { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices };
    const panel = new BuildingPanel({ onClose: vi.fn(), yard: binding }).mount(document.body);
    panel.show(store.building(id)!);
    return { element: panel.element, sent, panel };
  };

  it("offers the core's next fortification with its price and time, and sends it for the outpost", async () => {
    const { element, sent, panel } = onOutpost([CORE], 1);
    const block = element.querySelector<HTMLElement>(".building-fortify")!;
    expect(block.querySelector("h3")?.textContent).toBe("Fortify to F1");
    expect(block.querySelector(".building-panel__time")?.textContent).toBe("4h 0m");
    // Plenty of every resource: every cost chip reads green, same as the
    // build tab's own chips (#278).
    const chips = block.querySelectorAll(".build-info__fact");
    expect(chips.length).toBeGreaterThan(0);
    expect(block.querySelectorAll(".build-info__fact--ok")).toHaveLength(chips.length);

    buttonNamed(element, "Fortify")!.click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/fortify$/);
    expect(Object.fromEntries(sent[0]!.body)).toEqual({ id: "1", baseid: OUTPOST });
    panel.close();
    vi.unstubAllGlobals();
  });

  it("says so when fully fortified", () => {
    const { element, panel } = onOutpost([{ ...CORE, fort: 4 }], 1);
    expect(element.querySelector(".building-fortify")).toBeNull();
    expect(element.textContent).toContain("Fully fortified: F4 of 4.");
    panel.close();
    vi.unstubAllGlobals();
  });

  it("stops a running fortification after one confirmation, for the step's price back", async () => {
    const { element, sent, panel } = onOutpost([{ ...CORE, cF: 3_600 }], 1);
    buttonNamed(element, "Stop fortifying")!.click();
    expect(element.textContent).toContain("Stop fortifying and get back");
    buttonNamed(element, "Yes, stop")!.click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.url).toMatch(/\/bm\/yard\/fortify\/cancel$/);
    panel.close();
    vi.unstubAllGlobals();
  });
});
