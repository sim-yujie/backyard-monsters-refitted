// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { HatcheryActions } from "@/api/yardHatchery";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { HOLD_DELAY_MS } from "@/ui/QuantityStepper";
import { spokenText } from "@/ui/resourceIcon";
import { HatchTab } from "./HatchTab";

/**
 * The Hatch tab as a player meets it: the chips (or the HCC strip), the grid,
 * the quantity control with Fill and the housing line, one Add per batch,
 * the queue's −1 and ×, Finish now and the Overdrive, each wired to its
 * hatchery action. The rules are `hatchPlan.test.ts`'s; this checks the
 * drawing and the wiring.
 *
 * Pokey (C1) at academy level 1: 250 goo, 15 s, 10 space. Two Housing L6: 1,080.
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

const loadOf = (extra: Partial<BaseLoadResponse> = {}, buildings: BuildingData[] = []): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: Object.fromEntries(
      [building(1, 15, 6), building(2, 15, 6), ...buildings].map((one) => [String(one.id), one]),
    ),
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C3: { t: 2 }, C4: { t: 1 } },
    academy: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const twoHatcheries = (extra: Partial<BaseLoadResponse> = {}) =>
  loadOf(
    {
      monsters: {
        saved: T0,
        housed: {},
        hid: [10, 11],
        h: [
          ["C3", 12, [["C1", 20, 1], ["C1", 5, 1]], 1],
          ["", 0, []],
        ],
        hstage: [1, 0],
      },
      ...extra,
    },
    [building(10, 13, 3), building(11, 13, 2)],
  );

const setup = (
  save: BaseLoadResponse = twoHatcheries(),
  focus: { buildingId?: number; monster?: string } = {},
  clock: () => number = () => T0,
) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi & {
    state: ReturnType<typeof vi.fn>;
  };
  const store = new YardStore({
    save,
    api,
    clock,
    timers: { set: () => 0, clear: () => undefined },
  });
  const ok = <R>(report: R): Promise<YardActionResult<R>> =>
    Promise.resolve({ ok: true, report, completed: [] });
  const actions = {
    add: vi.fn((hatchery: number | "hcc", monster: string, count: number) =>
      ok({ hatchery, monster, added: Math.min(count, 60), requested: count, stoppedBy: count > 60 ? ("goo" as const) : null, cost: { r4: Math.min(count, 60) * 250 } }),
    ),
    remove: vi.fn((hatchery: number | "hcc", slot: number, count: number | "all") =>
      ok({ hatchery, slot, monster: "C1", removed: count === "all" ? 20 : 1, refund: { r4: count === "all" ? 5_000 : 250 } }),
    ),
    finish: vi.fn((hatchery: number | "hcc") => ok({ hatchery, housed: { C3: 1, C1: 25 }, credits: 12, finishedAll: true })),
    overdrive: vi.fn((item: string) => ok({ item, credits: 30, q: 1, endsAt: T0 + 3600 })),
  } satisfies HatcheryActions;
  const showTab = vi.fn();
  const tab = new HatchTab(
    { binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices }, showTab },
    actions,
  );
  document.body.replaceChildren(tab.element);
  tab.show(focus);
  return { tab, store, api, actions, showTab, element: tab.element };
};

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const chips = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".hatch-chip")];
const chip = (root: HTMLElement, id: number) =>
  root.querySelector<HTMLButtonElement>(`.hatch-chip[data-hatchery="${id}"]`)!;
const monster = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLButtonElement>(`.hatch-monster[data-monster="${id}"]`)!;
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>(".hatch-add__count")!;
const addButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(".hatch-add__add")!;
const type = (input: HTMLInputElement, value: string) => {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
};
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));

describe("HatchTab: chips", () => {
  it("draws one chip per hatchery with level, what it makes, its countdown and queued/limit", () => {
    const { element } = setup();
    expect(chips(element)).toHaveLength(2);
    expect(spokenText(chip(element, 10))).toBe("#1 · L3 Bolt · 12s 25/80 queued");
    expect(spokenText(chip(element, 11))).toBe("#2 · L2 Idle 0/60 queued");
    expect(chip(element, 10).getAttribute("aria-pressed")).toBe("true");
  });

  it("opens with the clicked hatchery selected, and switches on a chip click", () => {
    const { element } = setup(twoHatcheries(), { buildingId: 11 });
    expect(chip(element, 11).getAttribute("aria-pressed")).toBe("true");
    chip(element, 10).click();
    expect(chip(element, 10).getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector(".hatch-queue__title")!.textContent).toBe("Queue · hatchery #1");
  });

  it("names a stalled, damaged or unbuilt hatchery's state", () => {
    const save = loadOf(
      {
        buildinghealthdata: { "11": 100 },
        monsters: { saved: T0, housed: {}, hid: [10], h: [["C1", 0, []]], hstage: [2] },
      },
      [building(10, 13, 3), building(11, 13, 3), building(12, 13, 1, { cB: 50 })],
    );
    const { element } = setup(save);
    expect(spokenText(chip(element, 10))).toContain("Pokey · Stalled — housing full");
    expect(spokenText(chip(element, 11))).toContain("Damaged — repair it");
    expect(spokenText(chip(element, 12))).toContain("Being built");
  });
});

describe("HatchTab: grid and add", () => {
  it("greys a locked monster and offers the Unlock tab instead of Add", () => {
    const { element, showTab } = setup();
    expect(monster(element, "C5").classList.contains("hatch-monster--locked")).toBe(true);
    expect(monster(element, "C4").textContent).toContain("Unlocking");
    monster(element, "C5").click();
    const gate = element.querySelector<HTMLElement>(".hatch-add .monsters-gate")!;
    expect(gate.textContent).toContain("Unlock Eye-ra in the Monster Locker first.");
    expect(addButton(element).disabled).toBe(true);
    buttonNamed(gate, "Go to Unlock")!.click();
    expect(showTab).toHaveBeenCalledWith("unlock", { monster: "C5" });
  });

  it("shows the selected monster's price, time and space", () => {
    const { element } = setup(twoHatcheries(), { monster: "C1" });
    expect(spokenText(element.querySelector(".hatch-add__selected")!)).toBe(
      "Pokey L1 · Goo 250 · 15s · space 10",
    );
  });

  it("fills to the smallest limit and warns when a typed count outgrows housing", () => {
    // Four Housing L6 = 2,160.
    const { element } = setup(
      loadOf(
        {
          monsters: {
            saved: T0,
            housed: { C1: 150 },
            hid: [10, 11],
            h: [
              ["C3", 12, [["C1", 5, 1]], 1],
              ["", 0, []],
            ],
            hstage: [1, 0],
          },
        },
        [building(3, 15, 6), building(4, 15, 6), building(10, 13, 3), building(11, 13, 2)],
      ),
      { buildingId: 11, monster: "C1" },
    );
    // 2,160 − 1,500 housed − 15 − 50 on the way = 595 → 59 Pokeys; the level 2 hatchery takes 61.
    buttonNamed(element, "Fill")!.click();
    expect(box(element).value).toBe("59");
    expect(element.querySelector<HTMLElement>(".hatch-add__warning")!.hidden).toBe(true);
    expect(spokenText(element.querySelector(".hatch-add__preview")!)).toBe(
      "Adds 59 · Goo 14,750 · 590 space — 1 starts now, 58 in 3 new stacks.",
    );
    type(box(element), "61");
    expect(box(element).value).toBe("61");
    expect(element.querySelector(".hatch-add__warning")!.textContent).toBe(
      "Housing fits 59 of these; the rest will wait.",
    );
    // More than the queue takes is clamped to it.
    type(box(element), "500");
    expect(box(element).value).toBe("61");
  });

  it("says why Fill came to nothing when housing is full", () => {
    const full = twoHatcheries({
      monsters: { saved: T0, housed: { C1: 108 }, hid: [10, 11], h: [["", 0, []], ["", 0, []]], hstage: [0, 0] },
    });
    const { element } = setup(full, { monster: "C1" });
    buttonNamed(element, "Fill")!.click();
    expect(box(element).value).toBe("0");
    expect(addButton(element).disabled).toBe(true);
    expect(element.querySelector(".hatch-add__warning")!.textContent).toBe(
      "Housing is full, so Fill adds none. Type a number to queue them anyway.",
    );
    type(box(element), "4");
    expect(element.querySelector(".hatch-add__warning")!.textContent).toBe(
      "Housing is full; these will wait for space.",
    );
    expect(addButton(element).disabled).toBe(false);
  });

  it("adds the whole batch in one request and reports a partial add", async () => {
    const { element, actions } = setup(twoHatcheries(), { buildingId: 11, monster: "C1" });
    type(box(element), "61");
    expect(addButton(element).textContent).toBe("Add 61");
    addButton(element).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(actions.add).toHaveBeenCalledOnce();
    expect(actions.add).toHaveBeenCalledWith(11, "C1", 61);
    expect(spokenText(element.querySelector(".monsters-status")!)).toBe(
      "Added 60 of 61 Pokey — out of goo: Goo 15,000 spent.",
    );
  });

  it("climbs faster while + is held", () => {
    vi.useFakeTimers();
    const { element } = setup(twoHatcheries(), { buildingId: 11, monster: "C1" });
    const plus = element.querySelector<HTMLButtonElement>(".hatch-add__step--plus")!;
    plus.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1 }));
    expect(box(element).value).toBe("2");
    vi.advanceTimersByTime(HOLD_DELAY_MS + 3000);
    const held = Number(box(element).value);
    expect(held).toBeGreaterThan(20);
    plus.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1 }));
    expect(addButton(element).textContent).toBe(`Add ${held}`);
  });
});

describe("HatchTab: countdowns", () => {
  it("ticks the chips, and asks the server once when monsters finish", () => {
    let now = T0;
    const save = loadOf(
      {
        monsters: {
          saved: T0,
          housed: {},
          hid: [10, 11],
          h: [
            ["C1", 5, []],
            ["C1", 5, []],
          ],
          hstage: [1, 1],
        },
      },
      [building(10, 13, 3), building(11, 13, 3)],
    );
    const { tab, api, element } = setup(save, {}, () => now);
    now = T0 + 3;
    tab.tick();
    expect(chip(element, 10).querySelector(".hatch-clock")!.textContent).toBe("2s");
    expect(api.state).not.toHaveBeenCalled();
    now = T0 + 5;
    tab.tick();
    tab.tick();
    expect(api.state).toHaveBeenCalledOnce();
  });
});

describe("HatchTab: queue", () => {
  it("removes one, a whole stack, or the monster in production, one request each", async () => {
    const { element, actions } = setup();
    const rows = [...element.querySelectorAll<HTMLElement>(".hatch-queue__row")];
    expect(rows.map((row) => spokenText(row.querySelector(".hatch-queue__label")!))).toEqual([
      "▶ Bolt · 12s",
      "Pokey ×20",
      "Pokey ×5",
    ]);
    expect(element.querySelector(".hatch-queue__room")!.textContent).toBe("2 stacks free");
    rows[1]!.querySelector<HTMLButtonElement>("[aria-label^='Remove all']")!.click();
    await Promise.resolve();
    expect(actions.remove).toHaveBeenLastCalledWith(10, 1, "all");
    rows[2]!.querySelector<HTMLButtonElement>("[aria-label^='One fewer']")!.click();
    await Promise.resolve();
    expect(actions.remove).toHaveBeenLastCalledWith(10, 2, 1);
    rows[0]!.querySelector<HTMLButtonElement>(".hatch-queue__remove")!.click();
    await Promise.resolve();
    expect(actions.remove).toHaveBeenLastCalledWith(10, 0, 1);
    expect(actions.remove).toHaveBeenCalledTimes(3);
  });
});

describe("HatchTab: with a Hatchery Control Centre", () => {
  const hccYard = () =>
    loadOf(
      {
        monsters: {
          saved: T0,
          housed: {},
          hid: [10, 11],
          h: [
            ["C1", 9, []],
            ["", 0, []],
          ],
          hstage: [1, 0],
          hcc: [["C3", 4, 1]],
        },
      },
      [building(10, 13, 3), building(11, 13, 3), building(20, 16, 1)],
    );

  it("shows the shared queue and each hatchery's monster with a ×, and adds to the shared queue", async () => {
    const { element, actions } = setup(hccYard(), { buildingId: 10, monster: "C1" });
    expect(chips(element)).toHaveLength(0);
    expect(element.querySelector(".hatch-hcc__queued")!.textContent).toBe("4/140 queued");
    const strip = [...element.querySelectorAll<HTMLElement>(".hatch-strip__item")];
    expect(strip.map((item) => spokenText(item.querySelector(".hatch-strip__label")!))).toEqual([
      "#1 · Pokey · 9s",
      "#2 · Idle",
    ]);
    strip[0]!.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
    expect(actions.remove).toHaveBeenLastCalledWith(10, 0, 1);
    expect(element.querySelector(".hatch-queue__title")!.textContent).toBe("Shared queue");

    type(box(element), "3");
    addButton(element).click();
    await Promise.resolve();
    expect(actions.add).toHaveBeenLastCalledWith("hcc", "C1", 3);
  });
});

describe("HatchTab: Finish now and Overdrive", () => {
  it("disables Finish now with the reason when housing is full", () => {
    const full = twoHatcheries({
      monsters: {
        saved: T0,
        housed: { C1: 108 },
        hid: [10],
        h: [["C1", 4, []]],
        hstage: [1],
      },
    });
    const { element } = setup(full);
    const finish = buttonNamed(element, "Finish now")!;
    expect(finish.disabled).toBe(true);
    expect(element.querySelector(".hatch-boosts__reason")!.textContent).toBe("Housing full");
  });

  it("spends on the second tap only", async () => {
    const { element, actions } = setup();
    const finish = buttonNamed(element, "Finish now")!;
    expect(finish.disabled).toBe(false);
    finish.click();
    expect(actions.finish).not.toHaveBeenCalled();
    finish.click();
    await Promise.resolve();
    expect(actions.finish).toHaveBeenCalledWith(10);
    expect(spokenText(element.querySelector(".monsters-status")!)).toBe(
      "Hatched 1 Bolt, 25 Pokey for Shiny 12.",
    );
  });

  it("offers the three Overdrives, or shows the one running", () => {
    const { element } = setup();
    const offers = [...element.querySelectorAll<HTMLButtonElement>(".hatch-boosts__overdrive .shiny-button")];
    expect(offers.map((button) => button.getAttribute("aria-label"))).toEqual([
      "4x, 30 Shiny",
      "6x, 50 Shiny",
      "10x, 100 Shiny",
    ]);
    const running = setup(twoHatcheries({ storedata: { HOD3: { q: 1, s: T0 - 600, e: T0 + 3000 } } }));
    expect(running.element.querySelector(".hatch-boosts__overdrive .shiny-button")).toBeNull();
    expect(running.element.querySelector(".hatch-boosts__running")!.textContent).toBe(
      "Overdrive 10x: every hatchery works 10 times as fast for 50m 0s.",
    );
  });
});
