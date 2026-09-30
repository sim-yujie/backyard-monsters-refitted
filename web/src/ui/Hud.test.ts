// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResourceCaps } from "@/api/types";
import type { YardJob } from "@/game/yard/jobs";
import type { YardChange, YardListener, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { capState, exactLabel, formatDelta, FULL_NOTE, Hud, workersText } from "./Hud";
import { Notices } from "./maproom/Notices";
import { spokenText } from "./resourceIcon";

/**
 * The HUD's readouts: icons for the words (#93), and every change visible
 * however big the pool (#92) — the exact figure on hover and on a tap, and a
 * short float of the difference.
 */

describe("the HUD", () => {
  let hud: Hud;

  beforeEach(() => {
    vi.useFakeTimers();
    hud = new Hud({ scenes: [{ id: "yard", label: "Yard" }], onSceneSelect: () => {} }).mount(document.body);
  });

  afterEach(() => {
    hud.destroy();
    vi.useRealTimers();
  });

  const button = (key: string): HTMLButtonElement =>
    hud.element.querySelector<HTMLButtonElement>(`.hud__resource-button[data-resource="${key}"]`)!;
  const floats = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".hud__delta")];
  const bubble = (): HTMLElement | null => document.querySelector(".hud__exact");

  it("shows each resource as its icon and the amount in full, with the word kept for hover and screen readers", () => {
    hud.setResources({ r1: 11_163_050_000, r2: 2_500, r3: 0, r4: 999 }, 42);
    expect(hud.element.textContent).not.toMatch(/twigs|pebbles|putty|goo|shiny/i);
    const readouts = [...hud.element.querySelectorAll<HTMLButtonElement>(".hud__resource-button[data-resource]")];
    expect(readouts.map((one) => one.textContent)).toEqual(["11,163,050,000", "2,500", "0", "999", "42"]);
    expect(readouts.map((one) => one.querySelectorAll(".res-icon").length)).toEqual([1, 1, 1, 1, 1]);
    // The button's own name carries the word and the exact amount; the icon is
    // decorative inside it so the name is not read twice.
    expect(button("r1").getAttribute("aria-label")).toBe("Twigs: 11,163,050,000");
    expect(button("r1").title).toBe("Twigs: 11,163,050,000");
    expect(button("shiny").title).toBe("Shiny: 42");
    expect(button("r1").querySelector(".res-icon")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("starts as dashes and leaves a readout alone when its amount is missing", () => {
    expect(button("r2").textContent).toBe("—");
    expect(button("r2").title).toBe("Pebbles: not known yet");
    hud.setResources({ r1: 5 });
    expect(button("r2").textContent).toBe("—");
    expect(button("shiny").textContent).toBe("—");
  });

  it("floats the difference when an amount changes, but not when it first arrives", () => {
    hud.setResources({ r1: 11_163_050_000, r2: 100 });
    expect(floats()).toHaveLength(0);

    hud.setResources({ r1: 11_158_050_000, r2: 100 });
    expect(button("r1").textContent).toBe("11,158,050,000");
    expect(button("r1").title).toBe("Twigs: 11,158,050,000");
    const [float] = floats();
    expect(floats()).toHaveLength(1);
    expect(float?.textContent).toBe("−5.0M");
    expect(float?.classList.contains("hud__delta--down")).toBe(true);
    expect(float?.getAttribute("aria-hidden")).toBe("true");

    // A float lives briefly, then goes on its own.
    vi.advanceTimersByTime(2_000);
    expect(floats()).toHaveLength(0);

    hud.setResources({ r2: 350 });
    expect(floats().map((one) => one.textContent)).toEqual(["+250"]);
    expect(floats()[0]?.classList.contains("hud__delta--up")).toBe(true);
  });

  it("replaces a readout's float rather than stacking them, and takes them away with the bar", () => {
    hud.setResources({ r1: 1_000, r2: 10 });
    hud.setResources({ r1: 900, r2: 20 });
    hud.setResources({ r1: 800 });
    expect(floats().map((one) => one.textContent)).toEqual(["+10", "−100"]);
    hud.destroy();
    expect(floats()).toHaveLength(0);
  });

  it("opens the exact amount on a tap, follows changes, and closes on a second tap or Escape", () => {
    hud.setResources({ r1: 11_163_050_000 });
    button("r1").click();
    expect(spokenText(bubble()!)).toBe("Twigs 11,163,050,000");
    expect(button("r1").getAttribute("aria-expanded")).toBe("true");

    hud.setResources({ r1: 11_158_040_000 });
    expect(spokenText(bubble()!)).toBe("Twigs 11,158,040,000");

    button("r1").click();
    expect(bubble()).toBeNull();
    expect(button("r1").hasAttribute("aria-expanded")).toBe(false);

    button("r1").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bubble()).toBeNull();
  });

  it("moves the bubble to another readout, and closes it on its own after a while", () => {
    hud.setResources({ r1: 1, r2: 2 });
    button("r1").click();
    button("r2").click();
    expect(document.querySelectorAll(".hud__exact")).toHaveLength(1);
    expect(spokenText(bubble()!)).toBe("Pebbles 2");
    vi.advanceTimersByTime(6_000);
    expect(bubble()).toBeNull();
  });

  /**
   * jsdom lays nothing out, so the list reports the widths a browser would:
   * the brand gives the list 100 px when it goes, and short amounts need
   * less room than full ones.
   */
  const lay = (widths: { room: number; full: number; compact: number }): void => {
    const list = hud.element.querySelector<HTMLElement>(".hud__resources")!;
    const fit = (): string | undefined => hud.element.dataset["fit"];
    Object.defineProperty(list, "clientWidth", {
      configurable: true,
      get: () => widths.room + (fit() === "full" ? 0 : 100),
    });
    Object.defineProperty(list, "scrollWidth", {
      configurable: true,
      get: () => (fit() === "compact" ? widths.compact : widths.full),
    });
  };

  it("drops the brand, then falls back to short amounts, rather than overflow (#134)", () => {
    lay({ room: 600, full: 550, compact: 300 });
    hud.setResources({ r1: 15_000_000 }, 5);
    expect(hud.fitLevel).toBe("full");
    expect(button("r1").textContent).toBe("15,000,000");

    lay({ room: 500, full: 550, compact: 300 });
    window.dispatchEvent(new Event("resize"));
    expect(hud.fitLevel).toBe("no-brand");
    expect(hud.element.dataset["fit"]).toBe("no-brand");
    expect(button("r1").textContent).toBe("15,000,000");

    lay({ room: 300, full: 550, compact: 300 });
    window.dispatchEvent(new Event("resize"));
    expect(hud.fitLevel).toBe("compact");
    expect(button("r1").textContent).toBe("15.0M");
    // The name and the tap bubble keep the exact figure.
    expect(button("r1").title).toBe("Twigs: 15,000,000");
    button("r1").click();
    expect(spokenText(bubble()!)).toBe("Twigs 15,000,000");

    lay({ room: 900, full: 550, compact: 300 });
    hud.setResources({ r1: 15_000_001 });
    expect(hud.fitLevel).toBe("full");
    expect(button("r1").textContent).toBe("15,000,001");
  });

  it("closes the bubble on a press elsewhere", () => {
    hud.setResources({ r1: 1 });
    button("r1").click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(bubble()).toBeNull();
  });
});

describe("the HUD's Account control (#173)", () => {
  it("opens a menu with the player's name instead of leaving for the sign-in screen", () => {
    const onSceneSelect = vi.fn();
    const onSignOut = vi.fn();
    const hud = new Hud({
      scenes: [{ id: "yard", label: "Yard" }],
      onSceneSelect,
      onSignOut,
      accountName: "Agent Tester",
    }).mount(document.body);
    const account = hud.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
    expect(account.textContent).toBe("Account");
    expect(hud.element.querySelectorAll(".hud__scene-button").length).toBe(1);
    account.click();
    expect(onSceneSelect).not.toHaveBeenCalled();
    expect(onSignOut).not.toHaveBeenCalled();
    expect(hud.element.querySelector(".account-menu__name")?.textContent).toBe("Agent Tester");
    hud.element.querySelector<HTMLButtonElement>(".account-menu__item")!.click();
    expect(onSignOut).toHaveBeenCalledOnce();
    hud.destroy();
  });
});

describe("the yard's corner layout (#171)", () => {
  afterEach(() => document.body.replaceChildren());

  it("drops the brand and the screen tabs and keeps the readouts and Workers in one bar", () => {
    const hud = new Hud({
      scenes: [],
      layout: "corner",
      onSceneSelect: () => {},
      onSignOut: () => {},
      accountName: "agenttester",
    }).mount(document.body);
    expect(hud.element.classList.contains("hud--corner")).toBe(true);
    expect(hud.element.querySelector(".hud__brand")).toBeNull();
    expect(hud.element.querySelector(".hud__scenes")).toBeNull();
    const bar = hud.element.querySelector(".hud__bar")!;
    expect(bar.querySelector(".hud__resources")).not.toBeNull();
    expect(bar.querySelector(".hud__workers")).not.toBeNull();
    // The Account menu is the pill with the name, not the word "Account".
    const account = hud.element.querySelector<HTMLButtonElement>(".account-menu__button--pill")!;
    expect(account.textContent).toContain("agenttester");
    expect(account.getAttribute("aria-label")).toBe("Your account: agenttester");
    hud.destroy();
  });

  it("shows the bound yard's player level under the name, and drops it when unbound (#192)", () => {
    const hud = new Hud({
      scenes: [],
      layout: "corner",
      onSceneSelect: () => {},
      onSignOut: () => {},
      accountName: "agenttester",
    }).mount(document.body);
    const line = hud.element.querySelector<HTMLElement>(".account-menu__pill-level")!;
    expect(line.hidden).toBe(true);
    const store = {
      caps: null,
      workers: { total: 5, busy: 0 },
      playerLevel: 42,
      jobs: () => [],
      save: {},
      now: () => 0,
      isRunning: () => false,
      subscribe: () => () => undefined,
    };
    hud.bindYard({ store: store as unknown as YardStore, scene: { selectBuilding: () => {} }, notices: new Notices() });
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe("Level 42");
    hud.bindYard(null);
    expect(line.hidden).toBe(true);
    hud.destroy();
  });

  it("draws a cap as the fill bar alone, with the figure kept for the tooltip", () => {
    const hud = new Hud({ scenes: [], layout: "corner", onSceneSelect: () => {} }).mount(document.body);
    const store = {
      caps: { r1: 20, r2: 20, r3: 20, r4: 20 },
      workers: { total: 5, busy: 0 },
      jobs: () => [],
      save: {},
      now: () => 0,
      isRunning: () => false,
      subscribe: () => () => undefined,
    };
    hud.setResources({ r1: 10 });
    hud.bindYard({ store: store as unknown as YardStore, scene: { selectBuilding: () => {} }, notices: new Notices() });
    const r1 = hud.element.querySelector<HTMLButtonElement>('.hud__resource-button[data-resource="r1"]')!;
    expect(r1.textContent).toBe("10");
    expect(r1.title).toBe("Twigs: 10 of 20");
    expect(r1.querySelector<HTMLElement>(".hud__cap-bar")!.hidden).toBe(false);
    const workers = hud.element.querySelector<HTMLButtonElement>(".hud__workers-button")!;
    expect(workers.textContent).toBe("Workers5 / 5");
    expect(workers.querySelector<HTMLElement>(".hud__workers-name")!.hidden).toBe(true);
    hud.destroy();
  });

  it("uses short amounts on a phone, where the readouts share a row of four", () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === "(width <= 620px)" }));
    vi.stubGlobal("matchMedia", matchMedia);
    const hud = new Hud({ scenes: [], layout: "corner", onSceneSelect: () => {} }).mount(document.body);
    hud.setResources({ r1: 15_000_000 });
    expect(hud.fitLevel).toBe("compact");
    expect(hud.element.querySelector('.hud__resource-button[data-resource="r1"]')!.textContent).toBe("15.0M");
    hud.destroy();
    vi.unstubAllGlobals();
  });
});

describe("the HUD's spellings", () => {
  it("signs a change with a real minus", () => {
    expect(formatDelta(-5_000_000)).toBe("−5.0M");
    expect(formatDelta(12)).toBe("+12");
    expect(formatDelta(1_500)).toBe("+1.5K");
  });

  it("writes the exact amount with thousands separators, whole units only", () => {
    expect(exactLabel("r1", 11_158_040_000.7)).toBe("Twigs: 11,158,040,000");
    expect(exactLabel("r4", undefined)).toBe("Goo: not known yet");
  });
});

/**
 * The own yard (#100): caps and fill bars, the Workers control and the job
 * notices, from a store stand-in that holds just what the HUD reads.
 */
describe("the HUD on the player's own yard", () => {
  interface FakeStore {
    caps: ResourceCaps | null;
    workers: { total: number; busy: number };
    jobList: YardJob[];
    listeners: Set<YardListener>;
    emit(change: Partial<YardChange>): void;
  }

  let hud: Hud;
  let notices: Notices;
  let store: FakeStore;
  let binding: YardUiBinding;
  let selectBuilding: ReturnType<typeof vi.fn<(id: number) => void>>;

  const job = (key: string, buildingId: number, endsAt: number): YardJob => ({
    kind: "upgrade",
    key,
    id: buildingId,
    buildingId,
    endsAt,
    holdsWorker: true,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    hud = new Hud({ scenes: [{ id: "yard", label: "Yard" }], onSceneSelect: () => {} }).mount(document.body);
    notices = new Notices().mount(document.body);
    selectBuilding = vi.fn<(id: number) => void>();
    const listeners = new Set<YardListener>();
    store = {
      caps: { r1: 23_050_000, r2: 23_050_000, r3: 23_050_000, r4: 23_050_000 },
      workers: { total: 5, busy: 2 },
      jobList: [job("upgrade:7", 7, 500), job("upgrade:3", 3, 900)],
      listeners,
      emit: (change) => {
        for (const listener of [...listeners]) {
          listener({ reason: "refresh", completed: [], predicted: [], ...change });
        }
      },
    };
    const fake = {
      get caps() {
        return store.caps;
      },
      get workers() {
        return store.workers;
      },
      jobs: () => store.jobList,
      // Collect all reads these; an empty yard keeps it hidden (`CollectAll.test.ts`).
      save: {},
      now: () => 0,
      isRunning: () => false,
      subscribe: (listener: YardListener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    binding = { store: fake as unknown as YardStore, scene: { selectBuilding }, notices };
  });

  afterEach(() => {
    hud.destroy();
    notices.destroy();
    vi.useRealTimers();
  });

  const button = (key: string): HTMLButtonElement =>
    hud.element.querySelector<HTMLButtonElement>(`.hud__resource-button[data-resource="${key}"]`)!;
  const bar = (key: string): HTMLElement => button(key).querySelector<HTMLElement>(".hud__cap-bar")!;
  const fill = (key: string): HTMLElement => button(key).querySelector<HTMLElement>(".hud__cap-fill")!;
  const workers = (): HTMLButtonElement => hud.element.querySelector<HTMLButtonElement>(".hud__workers-button")!;

  it("shows no caps and no workers without a binding, as on the map or a foreign yard", () => {
    hud.setResources({ r1: 15_000_000 });
    expect(button("r1").textContent).toBe("15,000,000");
    expect(bar("r1").hidden).toBe(true);
    expect(hud.element.querySelector<HTMLElement>(".hud__workers")!.hidden).toBe(true);
  });

  it("opens the Shop from the Shiny counter where the scene has one (§8.2)", () => {
    const openShop = vi.fn();
    hud.setResources({ r1: 15_000_000 }, 1_234);
    hud.bindYard({ ...binding, scene: { selectBuilding, openShop } });

    expect(button("shiny").getAttribute("aria-label")).toBe("Shiny: 1,234. Open the Shop");
    button("shiny").click();
    expect(openShop).toHaveBeenCalledOnce();
    expect(document.querySelector(".hud__exact")).toBeNull();

    // Without a Shop (an older binding, the map) the tap shows the exact amount again.
    hud.bindYard(binding);
    expect(button("shiny").getAttribute("aria-label")).toBe("Shiny: 1,234");
    button("shiny").click();
    expect(document.querySelector(".hud__exact")).not.toBeNull();
  });

  it("shows amount / cap with a fill bar once bound, and takes them away on unbind", () => {
    hud.setResources({ r1: 15_000_000, r2: 23_050_000, r3: 0, r4: 30_000_000 }, 7);
    hud.bindYard(binding);
    expect(button("r1").textContent).toBe("15,000,000 / 23,050,000");
    expect(bar("r1").hidden).toBe(false);
    expect(fill("r1").style.width).toBe("65.08%");
    expect(button("r1").classList.contains("hud__resource-button--full")).toBe(false);
    expect(button("r1").title).toBe("Twigs: 15,000,000 of 23,050,000");
    // Shiny has no silo.
    expect(button("shiny").textContent).toBe("7");
    expect(button("shiny").querySelector<HTMLElement>(".hud__cap-bar")!.hidden).toBe(true);

    hud.bindYard(null);
    expect(button("r1").textContent).toBe("15,000,000");
    expect(bar("r1").hidden).toBe(true);
    expect(button("r1").title).toBe("Twigs: 15,000,000");
  });

  it("turns the bar amber at the cap and says new income is lost", () => {
    hud.setResources({ r1: 23_050_000, r4: 30_000_000 });
    hud.bindYard(binding);
    for (const key of ["r1", "r4"]) {
      expect(button(key).classList.contains("hud__resource-button--full")).toBe(true);
      expect(fill(key).style.width).toBe("100%");
    }
    expect(button("r1").title).toBe(`Twigs: 23,050,000 of 23,050,000\n${FULL_NOTE}`);
    expect(button("r1").getAttribute("aria-label")).toBe(`Twigs: 23,050,000 of 23,050,000. ${FULL_NOTE}`);
    button("r1").click();
    const bubble = document.querySelector<HTMLElement>(".hud__exact")!;
    expect(spokenText(bubble)).toBe(`Twigs 23,050,000 / 23,050,000${FULL_NOTE}`);

    // Spending a little takes it off the cap.
    hud.setResources({ r1: 23_049_999 });
    expect(button("r1").classList.contains("hud__resource-button--full")).toBe(false);
  });

  it("waits for the caps the first state answer brings", () => {
    store.caps = null;
    hud.setResources({ r1: 100 });
    hud.bindYard(binding);
    expect(button("r1").textContent).toBe("100");
    store.caps = { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 };
    store.emit({ reason: "refresh" });
    expect(button("r1").textContent).toBe("100 / 1,000");
  });

  it("drops the cap text before the amounts when room runs short, keeping the bars", () => {
    hud.setResources({ r1: 15_000_000 });
    hud.bindYard(binding);
    const list = hud.element.querySelector<HTMLElement>(".hud__resources")!;
    Object.defineProperty(list, "clientWidth", { configurable: true, get: () => 400 });
    Object.defineProperty(list, "scrollWidth", {
      configurable: true,
      get: () => (button("r1").textContent!.includes("/") ? 700 : 350),
    });
    window.dispatchEvent(new Event("resize"));
    expect(hud.fitLevel).toBe("no-caps");
    expect(button("r1").textContent).toBe("15,000,000");
    expect(bar("r1").hidden).toBe(false);
    expect(button("r1").title).toBe("Twigs: 15,000,000 of 23,050,000");
    expect(hud.element.querySelector<HTMLElement>(".hud__workers-name")!.hidden).toBe(true);
  });

  it("shows workers free / total and goes to the job that ends soonest", () => {
    hud.bindYard(binding);
    expect(hud.element.querySelector<HTMLElement>(".hud__workers")!.hidden).toBe(false);
    expect(workers().textContent).toBe("Workers3 / 5");
    expect(workers().title).toBe(workersText(3, 5).label);
    expect(workers().getAttribute("aria-disabled")).toBe("false");
    workers().click();
    expect(selectBuilding).toHaveBeenCalledWith(7);

    store.workers = { total: 5, busy: 0 };
    store.jobList = [];
    store.emit({ reason: "predicted" });
    expect(workers().textContent).toBe("Workers5 / 5");
    expect(workers().getAttribute("aria-disabled")).toBe("true");
    workers().click();
    expect(selectBuilding).toHaveBeenCalledTimes(1);
  });

  it("toasts what the server says finished, and a click on a building selects it", () => {
    hud.bindYard(binding);
    store.emit({
      reason: "refresh",
      completed: [
        { kind: "upgrade", id: 7, t: 20, at: 1, detail: { from: 4, level: 5, points: 1 } },
        { kind: "upgrade", id: 3, t: 21, at: 1, detail: { from: 2, level: 3, points: 1 } },
      ],
    });
    const toasts = notices.element.querySelectorAll(".notice");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.textContent).toMatch(/^2 upgrades finished: /);
    toasts[0]!.querySelectorAll<HTMLButtonElement>(".job-notice__building")[1]!.click();
    expect(selectBuilding).toHaveBeenCalledWith(3);
  });

  it("toasts what finished while the player was away as one line, every kind in it (#135)", () => {
    hud.bindYard(binding);
    store.emit({
      reason: "away",
      completed: [
        { kind: "upgrade", id: 7, t: 20, at: 1, detail: { from: 4, level: 5, points: 1 } },
        { kind: "storeItem", id: "BST", t: null, at: 2, detail: {} },
      ],
    });
    const toasts = notices.element.querySelectorAll(".notice");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.textContent).toMatch(/^While you were away: upgrade finished: .* 5; ran out: Sharper Tools/);
    toasts[0]!.querySelector<HTMLButtonElement>(".job-notice__building")!.click();
    expect(selectBuilding).toHaveBeenCalledWith(7);
  });

  it("stops listening when unbound or destroyed", () => {
    hud.bindYard(binding);
    expect(store.listeners.size).toBe(1);
    hud.bindYard(binding);
    expect(store.listeners.size).toBe(1);
    hud.destroy();
    expect(store.listeners.size).toBe(0);
  });
});

describe("capState", () => {
  it("is nothing without a cap or an amount", () => {
    expect(capState(undefined, 100)).toBeNull();
    expect(capState(50, undefined)).toBeNull();
    expect(capState(50, 0)).toBeNull();
  });

  it("fills in proportion, and is full at the cap as well as over it", () => {
    expect(capState(25, 100)).toEqual({ fraction: 0.25, full: false });
    expect(capState(99.9, 100)).toEqual({ fraction: 0.99, full: false });
    expect(capState(100, 100)).toEqual({ fraction: 1, full: true });
    expect(capState(150, 100)).toEqual({ fraction: 1, full: true });
  });
});

describe("workersText", () => {
  it("counts free of total and says what a click does", () => {
    expect(workersText(2, 5)).toEqual({
      value: "2 / 5",
      label: "Workers: 2 of 5 free. Click to go to the job that finishes soonest.",
    });
    expect(workersText(0, 1).label).toBe("Workers: none of 1 free. Click to go to the job that finishes soonest.");
    expect(workersText(5, 5).label).toBe("Workers: all 5 free.");
  });
});
