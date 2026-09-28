// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { AcademyActions } from "@/api/yardAcademy";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { statLine, TrainTab } from "./TrainTab";

/**
 * The Train tab as a player meets it: the academy slots, the list of unlocked
 * monsters, the card with the one reason Train is disabled, and the running
 * training's Finish now and Cancel confirmation, each wired to its academy
 * action. The rules are `training.test.ts`'s; this checks the drawing and the
 * wiring.
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

/** Town Hall 7, Academy 1 (id 5, level 3), Academy 2 (id 6, level 1). */
const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1_000_000, r4: 5_000 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 7), "5": building(5, 26, 3), "6": building(6, 26, 1) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 }, C2: { t: 2 }, C15: { t: 2 }, C12: { t: 2 } },
    academy: { C1: { level: 6 }, C2: { level: 3 }, C12: { level: 4 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(load),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const ok = <R>(report: R): Promise<YardActionResult<R>> =>
    Promise.resolve({ ok: true, report, completed: [] });
  const actions = {
    train: vi.fn((monster: string) =>
      ok({ monster, academy: 5, to: 4, endsAt: T0 + 36_000, cost: { r3: 24_000 } }),
    ),
    cancel: vi.fn((monster: string) => ok({ monster, refund: { r3: 24_000 } })),
    finish: vi.fn((monster: string) => ok({ monster, level: 4, credits: 20 })),
    instant: vi.fn((monster: string) => ok({ monster, level: 4, credits: 203 })),
  } satisfies AcademyActions;
  const tab = new TrainTab(
    { binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices }, showTab: vi.fn() },
    actions,
  );
  document.body.replaceChildren(tab.element);
  tab.show({});
  return { tab, store, actions, element: tab.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".train-row")];
const row = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLButtonElement>(`.train-row[data-monster="${id}"]`)!;
const slots = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".train-slot")];
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) =>
    one.textContent?.startsWith(text),
  );

describe("TrainTab: slots and list", () => {
  it("one slot per academy; every unlocked monster with its level and next step", () => {
    const { element } = setup();
    expect(slots(element).map((slot) => spokenText(slot))).toEqual([
      "Academy 1 · level 3 Idle",
      "Academy 2 · level 1 Idle",
    ]);
    expect(rows(element).map((one) => one.dataset["monster"])).toEqual(["C1", "C2", "C15", "C12"]);
    expect(spokenText(row(element, "C2"))).toBe("Octo-ooze Level 3/6 → 4: Putty 24,000 · 10h 0m");
    expect(spokenText(row(element, "C1"))).toBe("Pokey Level 6/6 Fully trained");
    expect(spokenText(row(element, "C15"))).toMatch(/^Zafreeti Level 1\/5 → 2: Putty /);
  });

  it("opens on the first monster that can go up and fills the card on a click", () => {
    const { element } = setup();
    expect(row(element, "C2").getAttribute("aria-pressed")).toBe("true");
    const card = element.querySelector<HTMLElement>(".locker__detail")!;
    expect(card.querySelector(".locker-detail__name")!.textContent).toBe("Octo-ooze");
    expect(card.querySelector(".locker-detail__facts")!.textContent).toBe("Level 3 of 6");
    expect(card.querySelector(".locker-detail__stats")!.textContent).toBe(statLine("C2", 3, 4));
    expect(spokenText(card.querySelector(".locker-detail__note")!)).toBe(
      "Level 4: Putty 24,000 · 10h 0m · at Academy 1",
    );
    row(element, "C1").click();
    expect(card.querySelector(".locker-detail__note")!.textContent).toBe("Pokey is fully trained.");
    expect(buttonNamed(element, "Train to level")).toBeUndefined();
  });

  it("names the lowest academy that can train it and says training covers every one (#180)", () => {
    const { element } = setup({ resources: { r1: 0, r2: 0, r3: 10_000_000, r4: 5_000 } });
    const card = element.querySelector<HTMLElement>(".locker__detail")!;
    const notes = () => [...card.querySelectorAll(".locker-detail__note")].map((one) => spokenText(one));
    // Octo-ooze at level 3 needs Academy 1 (level 3); Zafreeti at level 1 fits
    // both, and Academy 2 (level 1) is the lower.
    expect(notes()[1]).toBe("Training upgrades every Octo-ooze, now and in future.");
    row(element, "C15").click();
    expect(notes()[0]).toMatch(/ · at Academy 2$/);
    expect(notes()[1]).toBe("Training upgrades every Zafreeti, now and in future.");
  });

  it("says what to do when nothing is unlocked", () => {
    const { element } = setup({ lockerdata: {} });
    expect(element.querySelector(".train__empty")!.textContent).toMatch(/Unlock one in the Monster Locker/);
  });
});

describe("TrainTab: Train and Instant", () => {
  it("trains the selected monster", () => {
    const { element, actions } = setup();
    buttonNamed(element, "Train to level 4")!.click();
    expect(actions.train).toHaveBeenCalledWith("C2");
  });

  it("disables Train with the one reason", () => {
    const { element } = setup({ resources: { r3: 20_000 } });
    expect(buttonNamed(element, "Train to level 4")!.disabled).toBe(true);
    expect(spokenText(element.querySelector(".monsters-gate")!)).toBe("Need Putty 4,000 more");
    // C12 at 4 needs an academy at level 4: neither is.
    row(element, "C12").click();
    expect(element.querySelector(".monsters-gate")!.textContent).toBe("Needs Monster Academy level 4");
  });

  it("spends Shiny on Instant only on the second tap", () => {
    const { element, actions } = setup();
    const instant = element.querySelector<HTMLButtonElement>(".locker__detail .shiny-button")!;
    expect(instant.textContent).toMatch(/^Instant/);
    instant.click();
    expect(actions.instant).not.toHaveBeenCalled();
    instant.click();
    expect(actions.instant).toHaveBeenCalledWith("C2");
  });

  it("reports the outcome and stays put", async () => {
    const { element } = setup();
    buttonNamed(element, "Train to level 4")!.click();
    await Promise.resolve();
    await Promise.resolve();
    const status = element.querySelector<HTMLElement>(".monsters-status")!;
    expect(status.hidden).toBe(false);
    expect(spokenText(status)).toBe("Training Octo-ooze to level 4: Putty 24,000 spent.");
  });
});

describe("TrainTab: a running training", () => {
  const training = {
    buildingdata: {
      "1": building(1, 14, 7),
      "5": building(5, 26, 3, { upg: "C2" }),
      "6": building(6, 26, 1),
    },
    academy: { C1: { level: 6 }, C2: { level: 3, time: T0 + 3_600, duration: 36_000 }, C12: { level: 4 } },
  };

  it("fills its academy's slot with the countdown, Finish now at its price and Cancel", () => {
    const { element } = setup(training);
    const [first, second] = slots(element);
    expect(first!.classList.contains("train-slot--training")).toBe(true);
    expect(first!.querySelector(".train-slot__what")!.textContent).toBe("Octo-ooze → 4");
    expect(first!.querySelector(".train-slot__countdown")!.textContent).toBe("1h 0m");
    const bar = first!.querySelector(".train-slot__bar")!;
    expect(bar.getAttribute("aria-valuenow")).toBe("90");
    const finish = first!.querySelector<HTMLButtonElement>(".shiny-button")!;
    expect(spokenText(finish)).toMatch(/^Finish now.*20$/);
    expect(spokenText(second!)).toBe("Academy 2 · level 1 Idle");
    expect(spokenText(row(element, "C2"))).toBe("Octo-ooze Level 3/6 Training → 4 · 1h 0m");
  });

  it("Finish now needs a second tap", () => {
    const { element, actions } = setup(training);
    const finish = element.querySelector<HTMLButtonElement>(".train-slot .shiny-button")!;
    finish.click();
    expect(actions.finish).not.toHaveBeenCalled();
    finish.click();
    expect(actions.finish).toHaveBeenCalledWith("C2");
  });

  it("confirms Cancel with the refund before cancelling", () => {
    const { element, actions } = setup(training);
    buttonNamed(element, "Cancel")!.click();
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(spokenText(element.querySelector(".locker-cancel__question")!)).toBe(
      "Cancel training Octo-ooze and get back Putty 24,000? Progress is lost.",
    );
    buttonNamed(element, "Keep training")!.click();
    expect(element.querySelector(".locker-cancel__question")).toBeNull();
    buttonNamed(element, "Cancel")!.click();
    buttonNamed(element, "Yes, cancel")!.click();
    expect(actions.cancel).toHaveBeenCalledWith("C2");
  });

  it("a clicked training academy opens on its monster; the countdown ticks", () => {
    let now = T0;
    const { element, tab, store } = setup(training);
    row(element, "C12").click();
    tab.show({ buildingId: 5 });
    expect(row(element, "C2").getAttribute("aria-pressed")).toBe("true");
    vi.spyOn(store, "now").mockImplementation(() => now);
    now = T0 + 60;
    tab.tick();
    expect(element.querySelector(".train-slot__countdown")!.textContent).toBe("59m 0s");
  });

  it("an academy being upgraded says so", () => {
    const { element } = setup({
      buildingdata: { "1": building(1, 14, 7), "5": building(5, 26, 3, { cU: 600 }) },
    });
    expect(spokenText(slots(element)[0]!)).toBe("Academy 1 · level 3 Upgrading");
    expect(element.querySelector(".monsters-gate")!.textContent).toBe("Every academy is busy");
  });
});
