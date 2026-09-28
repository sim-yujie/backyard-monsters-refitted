// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { LabActions } from "@/api/yardLab";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { LabTab } from "./LabTab";
import { MONSTERS_TABS } from "./tabs";

/**
 * The Lab tab as a player meets it: the Lab slot, the ten abilities with
 * rank, next rank, effect and the reason one cannot start, the card with
 * Research and Instant, and the running research's Finish now and Cancel
 * confirmation, each wired to its Lab action. The rules are in
 * `lab.test.ts`; this checks the drawing and the wiring.
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

/** Town Hall 7 and a level 2 Lab (id 9). Bolt (C3) is ready for rank 1; Fang (C8) is untrained. */
const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1_000_000, r4: 5_000 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 7), "9": building(9, 116, 2) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C3: { t: 2 }, C4: { t: 2 }, C8: { t: 2 }, C12: { t: 2 } },
    academy: {
      C3: { level: 2 },
      C4: { level: 3, powerup: 1 },
      C8: { level: 1 },
      C12: { level: 6, powerup: 3 },
    },
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
    start: vi.fn((monster: string) =>
      ok({ monster, rank: 1, lab: 9, endsAt: T0 + 86_400, cost: { r3: 48_000 } }),
    ),
    cancel: vi.fn(() => ok({ monster: "C3", rank: 1, refund: { r3: 48_000 } })),
    finish: vi.fn(() => ok({ monster: "C3", rank: 1, credits: 20 })),
    instant: vi.fn((monster: string) => ok({ monster, rank: 1, credits: 306 })),
  } satisfies LabActions;
  const tab = new LabTab(
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

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".lab-row")];
const row = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLButtonElement>(`.lab-row[data-monster="${id}"]`)!;
const slot = (root: HTMLElement) => root.querySelector<HTMLElement>(".train-slot")!;
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) =>
    one.textContent?.startsWith(text),
  );

describe("LabTab: slot and list", () => {
  it("is the Monsters screen's Lab tab, opened by the Lab", () => {
    expect(MONSTERS_TABS.find((tab) => tab.id === "lab")!.buildings).toEqual([116]);
  });

  it("the Lab's slot, then the ten abilities with rank, next rank, effect and gate", () => {
    const { element } = setup();
    expect(spokenText(slot(element))).toBe("Monster Lab · level 2 Idle");
    expect(rows(element).map((one) => one.dataset["monster"])).toEqual([
      "C3",
      "C4",
      "C7",
      "C8",
      "C5",
      "C9",
      "C11",
      "C13",
      "C14",
      "C12",
    ]);
    expect(spokenText(row(element, "C3"))).toBe(
      "Bolt Rank 0/3 → 1: Putty 48,000 · 1d 0h Blink range: none → 150",
    );
    expect(spokenText(row(element, "C8"))).toBe(
      "Fang Rank 0/3 → 1: Putty 2,000,000 · 1d 12h Venom: none → 10% of its damage Needs Fang at level 2",
    );
    expect(row(element, "C12").textContent).toContain("Fully researched");
    expect(row(element, "C12").textContent).toContain("Rocket range: 220 (top rank)");
    expect(row(element, "C7").textContent).toContain("Unlock it in the Monster Locker first");
    expect(row(element, "C7").classList.contains("locker-row--locked")).toBe(true);
  });

  it("a rank above the Lab's level says which level it needs", () => {
    const { element } = setup({ buildingdata: { "1": building(1, 14, 7), "9": building(9, 116, 1) } });
    expect(row(element, "C4").querySelector(".lab-row__gate")!.textContent).toBe("Needs Lab level 2");
  });

  it("opens on the first ability that can start and fills the card", () => {
    const { element } = setup();
    expect(row(element, "C3").getAttribute("aria-pressed")).toBe("true");
    const card = element.querySelector<HTMLElement>(".locker__detail")!;
    expect(card.querySelector(".locker-detail__name")!.textContent).toBe("Bolt");
    expect(card.querySelector(".locker-detail__facts")!.textContent).toBe("Teleportation · rank 0 of 3");
    expect(card.querySelector(".locker-detail__stats")!.textContent).toBe("Blink range: none → 150");
    expect(spokenText(card.querySelector(".locker-detail__note")!)).toBe("Rank 1: Putty 48,000 · 1d 0h");
  });
});

describe("LabTab: Research and Instant", () => {
  it("researches the selected ability", () => {
    const { element, actions } = setup();
    buttonNamed(element, "Research rank 1")!.click();
    expect(actions.start).toHaveBeenCalledWith("C3");
  });

  it("disables Research with the one reason", () => {
    const { element } = setup();
    row(element, "C8").click();
    expect(buttonNamed(element, "Research rank 1")!.disabled).toBe(true);
    expect(element.querySelector(".locker__detail .monsters-gate")!.textContent).toBe(
      "Needs Fang at level 2",
    );
  });

  it("spends Shiny on Instant only on the second tap", () => {
    const { element, actions } = setup();
    const instant = element.querySelector<HTMLButtonElement>(".locker__detail .shiny-button")!;
    expect(instant.textContent).toMatch(/^Instant/);
    instant.click();
    expect(actions.instant).not.toHaveBeenCalled();
    instant.click();
    expect(actions.instant).toHaveBeenCalledWith("C3");
  });

  it("reports the outcome and stays put", async () => {
    const { element } = setup();
    buttonNamed(element, "Research rank 1")!.click();
    await Promise.resolve();
    await Promise.resolve();
    const status = element.querySelector<HTMLElement>(".monsters-status")!;
    expect(status.hidden).toBe(false);
    expect(spokenText(status)).toBe("Researching Teleportation rank 1 for Bolt: Putty 48,000 spent.");
  });
});

describe("LabTab: a running research", () => {
  const running = {
    buildingdata: {
      "1": building(1, 14, 7),
      "9": building(9, 116, 2, { upg: "C3", upt: T0 + 3_600, upl: 1 }),
    },
  };

  it("fills the Lab's slot with the countdown, Finish now at its price and Cancel", () => {
    const { element } = setup(running);
    const card = slot(element);
    expect(card.classList.contains("train-slot--training")).toBe(true);
    expect(card.querySelector(".train-slot__what")!.textContent).toBe("Bolt: Teleportation → rank 1");
    expect(card.querySelector(".train-slot__countdown")!.textContent).toBe("1h 0m");
    // 23 of 24 hours done.
    expect(card.querySelector(".train-slot__bar")!.getAttribute("aria-valuenow")).toBe("96");
    expect(spokenText(card.querySelector(".shiny-button")!)).toMatch(/^Finish now.*20$/);
    expect(spokenText(row(element, "C3"))).toMatch(/^Bolt Rank 0\/3 Researching → 1 · 1h 0m/);
    // It opens on the research, and nothing else can start.
    expect(row(element, "C3").getAttribute("aria-pressed")).toBe("true");
    row(element, "C4").click();
    expect(element.querySelector(".locker__detail .monsters-gate")!.textContent).toBe(
      "The Lab is already researching",
    );
  });

  it("Finish now needs a second tap", () => {
    const { element, actions } = setup(running);
    const finish = element.querySelector<HTMLButtonElement>(".train-slot .shiny-button")!;
    finish.click();
    expect(actions.finish).not.toHaveBeenCalled();
    finish.click();
    expect(actions.finish).toHaveBeenCalled();
  });

  it("confirms Cancel with the refund before cancelling", () => {
    const { element, actions } = setup(running);
    buttonNamed(element, "Cancel")!.click();
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(spokenText(element.querySelector(".locker-cancel__question")!)).toBe(
      "Cancel researching Teleportation for Bolt and get back Putty 48,000? Progress is lost.",
    );
    buttonNamed(element, "Keep researching")!.click();
    expect(element.querySelector(".locker-cancel__question")).toBeNull();
    buttonNamed(element, "Cancel")!.click();
    buttonNamed(element, "Yes, cancel")!.click();
    expect(actions.cancel).toHaveBeenCalled();
  });

  it("the countdown ticks", () => {
    let now = T0;
    const { element, tab, store } = setup(running);
    vi.spyOn(store, "now").mockImplementation(() => now);
    now = T0 + 60;
    tab.tick();
    expect(element.querySelector(".train-slot__countdown")!.textContent).toBe("59m 0s");
  });

  it("a Lab being upgraded says so", () => {
    const { element } = setup({
      buildingdata: { "1": building(1, 14, 7), "9": building(9, 116, 2, { cU: 600 }) },
    });
    expect(spokenText(slot(element))).toBe("Monster Lab · level 2 Upgrading");
  });
});
