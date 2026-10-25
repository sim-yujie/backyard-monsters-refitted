// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { siegeActions, type SiegeActions, type SiegeApi } from "@/api/yardSiege";
import { resourcesPrice } from "@/game/siege/siege";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { SiegeScreen } from "./SiegeScreen";

/**
 * The Siege screen as a player meets it: the Chaos Lab and Chaos Factory
 * tabs, the weapon rows, the chosen weapon's stats and offer, and each
 * button wired to its route. The rules are in `siege.test.ts`.
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

const PURSE = { r1: 1e6, r2: 1e6, r3: 1e6, r4: 0, r1max: 2e6, r2max: 2e6, r3max: 2e6, r4max: 2e6 };

const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 7), "20": building(20, 134, 3), "21": building(21, 133, 1) },
    buildinghealthdata: {},
    storedata: {},
    siege: {},
    iresources: PURSE,
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const ok = <R>(report: R): Promise<YardActionResult<R>> => Promise.resolve({ ok: true, report, completed: [] });

const stateReport = { siege: {}, purse: { r1: 0, r2: 0, r3: 0, r4: 0, caps: { r1: 0, r2: 0, r3: 0, r4: 0 } } };

const fakeActions = () =>
  ({
    start: vi.fn((weapon) =>
      ok({ ...stateReport, site: "lab" as const, weapon, building: 20, endsAt: T0 + 14_400, cost: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 }, credits: 0 }),
    ),
    cancel: vi.fn(() => ok({ ...stateReport, site: "lab" as const, weapon: "decoy" as const, refund: { r1: 1, r2: 0, r3: 0, r4: 0 } })),
    finish: vi.fn(() => ok({ ...stateReport, site: "lab" as const, weapon: "decoy" as const, credits: 20 })),
    instant: vi.fn((weapon) => ok({ ...stateReport, site: "lab" as const, weapon, credits: 143 })),
  }) satisfies SiegeActions;

const setup = (load: Partial<BaseLoadResponse> = {}, openMap = vi.fn()) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(load),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const actions = { lab: fakeActions(), factory: fakeActions() };
  const screen = new SiegeScreen({
    binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices },
    openMap,
    actions,
  }).mount(document.body);
  return { screen, store, actions, element: screen.element, openMap };
};

// jsdom has no media: the weapon's video only needs to exist.
beforeAll(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
});

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".siege-row")];
const row = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`.siege-row[data-weapon="${id}"]`)!;
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.trim().startsWith(text));
const onStars = (root: HTMLElement) => root.querySelectorAll(".siege-stars__star--on").length;

describe("SiegeScreen: the Chaos Lab", () => {
  it("opens on its tab with the three weapons, Locked ones without stars, and the Inferno purse", () => {
    const { screen, element } = setup({ siege: { vacuum: { level: 2, quantity: 0 } } });
    screen.open("lab");
    expect(element.hidden).toBe(false);
    expect(element.querySelector('[aria-selected="true"]')?.textContent).toBe("Chaos Lab");
    expect(rows(element).map((one) => one.querySelector(".siege-row__name")?.textContent)).toEqual([
      "Marilyn Monstroe",
      "Loot-O-Tron 5000",
      "Candy Jars",
    ]);
    expect(row(element, "decoy").querySelector(".siege-row__state")?.textContent).toBe("Locked");
    expect(onStars(row(element, "vacuum"))).toBe(2);
    expect(element.querySelector(".siege-purse")?.textContent).toContain("Bone 1,000,000 / 2,000,000");
    expect(element.querySelector(".siege-purse")?.textContent).toContain("Magma 0 / 2,000,000");
  });

  it("the chosen weapon: title, description, stats, the instant box and the cost box", () => {
    const { screen, element } = setup();
    screen.open("lab");
    expect(element.querySelector(".siege-detail__title")?.textContent).toBe("Marilyn Monstroe");
    expect(element.querySelector("video")?.getAttribute("src")).toBe("/assets/assets/videos/decoy400x175.mp4");
    expect([...element.querySelectorAll(".siege-stats__label")].map((one) => one.textContent)).toEqual([
      "Damage:",
      "Attraction Range:",
      "Countdown:",
    ]);
    expect(element.querySelector(".siege-stats__figure")?.textContent).toBe("1,000");
    expect(element.querySelector(".siege-box--instant")?.textContent).toContain("Keep your resources and unlock instantly");
    expect(element.querySelector(".shiny-button__price")?.textContent).toContain("143");
    expect(element.querySelector(".siege-costs")?.textContent).toBe("Bone37,599Coal43,866Sulfur43,866Time4h 0m");
    expect(buttonNamed(element, "Start Unlocking")).toBeDefined();
  });

  it("Start with everything held starts it", async () => {
    const { screen, element, actions } = setup();
    screen.open("lab");
    buttonNamed(element, "Start Unlocking")!.click();
    await vi.waitFor(() => expect(actions.lab.start).toHaveBeenCalledWith("decoy", undefined));
    await vi.waitFor(() => expect(element.querySelector(".monsters-status")?.textContent).toContain("Unlocking Marilyn Monstroe"));
  });

  it("short, Start asks Flash's question and Get Resources sends the top-up", async () => {
    const { screen, element, actions } = setup({ iresources: { ...PURSE, r1: 30_000 } });
    screen.open("lab");
    expect(element.querySelector('.siege-costs__value--short[data-resource="r1"]')).not.toBeNull();
    buttonNamed(element, "Start Unlocking")!.click();
    expect(actions.lab.start).not.toHaveBeenCalled();
    const confirm = element.querySelector(".siege-confirm")!;
    expect(confirm.textContent).toContain("You need 7,600 more resources to build.");
    const topUp = resourcesPrice(37_599.9587467407 - 30_000);
    expect(confirm.textContent).toContain(`Get the resources and start building for ${topUp} Shiny?`);
    const buy = buttonNamed(element, "Get Resources")!;
    buy.click();
    buy.click();
    await vi.waitFor(() => expect(actions.lab.start).toHaveBeenCalledWith("decoy", topUp));
  });

  it("over a cap, Start says the Resource Pods are too small", () => {
    const { screen, element, actions } = setup({ iresources: { ...PURSE, r1: 0, r1max: 10 } });
    screen.open("lab");
    buttonNamed(element, "Start Unlocking")!.click();
    expect(actions.lab.start).not.toHaveBeenCalled();
    expect(element.querySelector('[role="alert"]')?.textContent).toBe(
      "You need to build more or upgrade your Resource Pods in your Inferno Yard to hold enough resources to unlock this.",
    );
  });

  it("a running job: Unlocking on its row, Finish Now with Flash's words, and Cancel's confirm", async () => {
    const { screen, element, actions } = setup({
      buildingdata: { "20": building(20, 134, 3, { unlockingWeapons: { decoy: T0 + 3_600 } }) },
    });
    screen.open("lab");
    expect(row(element, "decoy").querySelector(".siege-row__state")?.textContent).toContain("Unlocking");
    expect(row(element, "decoy").querySelector(".siege-time__left")?.textContent).toBe("1h 0m");
    expect(element.querySelector(".siege-offer .siege-box__text")?.textContent).toBe("Use 20 Shiny to Finish Now!");
    const finish = buttonNamed(element, "Finish Now")!;
    finish.click();
    finish.click();
    await vi.waitFor(() => expect(actions.lab.finish).toHaveBeenCalled());

    buttonNamed(element, "Cancel")!.click();
    expect(element.querySelector(".siege-confirm")?.textContent).toContain(
      "Are you sure you want to stop upgrading Marilyn Monstroe?",
    );
    buttonNamed(element, "Stop Upgrading")!.click();
    await vi.waitFor(() => expect(actions.lab.cancel).toHaveBeenCalled());
  });

  it("another weapon picked while one runs shows the one-weapon warning", () => {
    const { screen, element } = setup({
      buildingdata: { "20": building(20, 134, 3, { unlockingWeapons: { decoy: T0 + 3_600 } }) },
    });
    screen.open("lab");
    row(element, "jars").click();
    expect(element.querySelector(".siege-offer__warning")?.textContent).toBe(
      "The Chaos Lab can only upgrade or unlock one weapon at a time.",
    );
  });

  it("a damaged Lab shows Flash's notice instead of the lists", () => {
    const { screen, element } = setup({ buildingdata: { "20": building(20, 134, 3, { hp: 1 }) } });
    screen.open("lab");
    expect(rows(element)).toHaveLength(0);
    expect(element.querySelector(".siege-notice")?.textContent).toBe(
      "Your Chaos Lab is damaged! You must repair it before it can be used.",
    );
  });
});

describe("SiegeScreen: the Chaos Factory", () => {
  it("no weapon researched: Flash's notice", () => {
    const { screen, element } = setup();
    screen.open("factory");
    expect(element.querySelector(".siege-notice")?.textContent).toContain("No weapons unlocked yet.");
  });

  it("lists the researched weapons; one held reads Ready! and offers Open Map", () => {
    const { screen, element, openMap } = setup({
      siege: { decoy: { level: 2, quantity: 0 }, jars: { level: 1, quantity: 1 } },
    });
    screen.open("factory");
    expect(rows(element).map((one) => one.dataset["weapon"])).toEqual(["decoy", "jars"]);
    expect(row(element, "jars").querySelector(".siege-row__ready")?.textContent).toBe("Ready!");
    row(element, "jars").click();
    expect(element.querySelector(".siege-detail__ready")?.textContent).toBe("Ready!");
    buttonNamed(element, "Open Map")!.click();
    expect(openMap).toHaveBeenCalled();
    expect(screen.isOpen).toBe(false);
  });

  it("builds at the weapon's level with Flash's words", async () => {
    const { screen, element, actions } = setup({ siege: { decoy: { level: 2, quantity: 0 } } });
    screen.open("factory");
    expect(element.querySelector(".siege-box--instant")?.textContent).toContain("Keep your resources and build instantly.");
    expect(element.querySelector(".siege-costs")?.textContent).toBe("Bone27,493Coal54,987Sulfur54,987Time1h 15m");
    buttonNamed(element, "Start Building")!.click();
    await vi.waitFor(() => expect(actions.factory.start).toHaveBeenCalledWith("decoy", undefined));
  });
});

describe("siegeActions", () => {
  const storeOf = (load: Partial<BaseLoadResponse> = {}) =>
    new YardStore({
      save: loadOf(load),
      api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
      clock: () => T0,
      timers: { set: () => 0, clear: () => undefined },
    });
  const apiOf = () => ({
    start: vi.fn(() => never()),
    cancel: vi.fn(() => never()),
    finish: vi.fn(() => never()),
    instant: vi.fn(() => never()),
  });

  it("refuses locally what the client can see, in the server's words, and sends the rest", async () => {
    const api = apiOf();
    const actions = siegeActions(storeOf({ iresources: { ...PURSE, r1: 0 } }), "lab", api as unknown as SiegeApi);
    const topUp = resourcesPrice(37_599.9587467407);
    const short = await actions.start("decoy");
    expect(short).toMatchObject({ ok: false, refusal: { reason: "shortfall", local: true, detail: { topUp } } });
    expect(api.start).not.toHaveBeenCalled();
    void actions.start("decoy", topUp);
    await vi.waitFor(() => expect(api.start).toHaveBeenCalledWith("lab", "decoy", topUp));
  });

  it("cancel and finish need a job; the Factory refuses an unresearched weapon", async () => {
    const api = apiOf();
    const store = storeOf();
    expect(await siegeActions(store, "lab", api as unknown as SiegeApi).cancel()).toMatchObject({
      ok: false,
      refusal: { reason: "notBusy" },
    });
    expect(await siegeActions(store, "factory", api as unknown as SiegeApi).instant("decoy")).toMatchObject({
      ok: false,
      refusal: { reason: "locked" },
    });
  });
});
