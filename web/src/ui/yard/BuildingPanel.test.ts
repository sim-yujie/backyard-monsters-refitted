// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore, type YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { BuildingPanel, type BuildingPanelOptions } from "./BuildingPanel";

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
  options: { load?: Partial<BaseLoadResponse>; own?: boolean; panel?: Partial<BuildingPanelOptions> } = {},
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
    scene: { selectBuilding: vi.fn() },
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

  it("the Map Room opens the map and offers no Upgrade", () => {
    const openMap = vi.fn();
    const { element } = setup([building(1, 14, 6), building(2, 11, 1)], 2, {
      panel: { openMap },
    });
    expect(buttonNamed(element, "Upgrade")).toBeUndefined();
    buttonNamed(element, "Open map")!.click();
    expect(openMap).toHaveBeenCalled();
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
