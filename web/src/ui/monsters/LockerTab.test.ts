// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { LockerActions } from "@/api/yardMonsters";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { spokenText } from "@/ui/resourceIcon";
import { describe as describeBlurb, LockerTab } from "./LockerTab";

/**
 * The Unlock tab as a player meets it: the list, the card, the one reason
 * Start is disabled, the running unlock's controls and the Cancel
 * confirmation, each wired to its locker action. The rules are
 * `lockerModel.test.ts`'s; this checks the drawing and the wiring.
 */

const T0 = 2_000_000;

const building = (id: number, t: number, l: number): BuildingData => ({ id, t, l, X: id * 40, Y: 0 });

const loadOf = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 1e8, r4: 5_000 },
    credits: 1_000,
    caps: { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 },
    buildingdata: { "1": building(1, 14, 6), "2": building(2, 8, 2) },
    buildinghealthdata: {},
    storedata: {},
    lockerdata: { C1: { t: 2 } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (load: Partial<BaseLoadResponse> = {}) => {
  const api = {
    state: vi.fn(() => never<YardResponse<null>>()),
  } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(load),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const ok = <R>(report: R): Promise<YardActionResult<R>> =>
    Promise.resolve({ ok: true, report, completed: [] });
  const actions = {
    start: vi.fn((monster: string) => ok({ monster, endsAt: T0 + 100, cost: { r3: 64_000 } })),
    cancel: vi.fn(() => ok({ monster: "C4", refund: { r3: 32_000 } })),
    finish: vi.fn(() => ok({ monster: "C4", credits: 40 })),
    instant: vi.fn((monster: string) => ok({ monster, credits: 99 })),
    overdrive: vi.fn(() => ok({ item: "CLOD", credits: 60, q: 1, endsAt: T0 + 14_400 })),
  } satisfies LockerActions;
  const showTab = vi.fn();
  const tab = new LockerTab(
    { binding: { store, scene: { selectBuilding: vi.fn() }, notices: {} as Notices }, showTab },
    actions,
  );
  document.body.replaceChildren(tab.element);
  tab.show({});
  return { tab, store, actions, showTab, element: tab.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>(".locker-row")];
const row = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLButtonElement>(`.locker-row[data-monster="${id}"]`)!;
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) =>
    one.textContent?.startsWith(text),
  );

describe("LockerTab: the list", () => {
  it("shows every obtainable monster, Vorg, Slimeattikus and Rezghul with prices, never the Mini", () => {
    const { element } = setup();
    const ids = rows(element).map((one) => one.dataset["monster"]);
    expect(ids).toHaveLength(18);
    expect(ids).not.toContain("C18");
    expect(spokenText(row(element, "C16"))).toBe("Vorg Putty 384,000 · 1d 12h");
    expect(spokenText(row(element, "C17"))).toMatch(/^Slimeattikus Needs Locker 3$/);
    expect(spokenText(row(element, "C19"))).toMatch(/^Rezghul Needs Locker 3$/);
    expect(spokenText(row(element, "C1"))).toBe("Pokey Unlocked");
    expect(row(element, "C16").querySelector("img")!.getAttribute("src")).toBe(
      "/portraits/C16-icon.webp",
    );
  });

  it("opens on the first monster that can be started and fills the card on a click", () => {
    const { element } = setup();
    expect(row(element, "C2").getAttribute("aria-pressed")).toBe("true");
    row(element, "C16").click();
    expect(row(element, "C16").getAttribute("aria-pressed")).toBe("true");
    const card = element.querySelector<HTMLElement>(".locker__detail")!;
    expect(card.querySelector(".locker-detail__name")!.textContent).toBe("Vorg");
    expect(card.querySelector("img")!.getAttribute("src")).toBe("/portraits/C16.webp");
    expect(spokenText(card.querySelector(".locker-detail__facts")!)).toBe(
      "Locker level 2 · Putty 384,000 · 1d 12h",
    );
    // Vorg's damage is negative: it heals.
    expect(card.querySelector(".locker-detail__stats")!.textContent).toBe(
      "Health 750 · Heals 60 · Space 60",
    );
    row(element, "C3").click();
    expect(card.querySelector(".locker-detail__stats")!.textContent).toMatch(
      /^Health [\d,]+ · Damage [\d,]+ · Space 15$/,
    );
  });
});

describe("LockerTab: Start and Instant", () => {
  it("starts the selected monster", () => {
    const { element, actions } = setup();
    row(element, "C3").click();
    buttonNamed(element, "Start unlocking")!.click();
    expect(actions.start).toHaveBeenCalledWith("C3");
  });

  it("disables Start with the one §4.3 reason", () => {
    const { element } = setup({ resources: { r3: 900_000 }, buildingdata: {
      "1": building(1, 14, 6),
      "2": building(2, 8, 3),
    } });
    row(element, "C9").click();
    expect(buttonNamed(element, "Start unlocking")!.disabled).toBe(true);
    expect(spokenText(element.querySelector(".monsters-gate")!)).toBe("Need Putty 124,000 more");

    row(element, "C12").click();
    expect(element.querySelector(".monsters-gate")!.textContent).toBe(
      "Needs Monster Locker level 4",
    );
  });

  it("spends Shiny on Instant only on the second tap", () => {
    const { element, actions } = setup();
    row(element, "C3").click();
    const instant = element.querySelector<HTMLButtonElement>(".shiny-button")!;
    expect(instant.textContent).toMatch(/^Instant/);
    instant.click();
    expect(actions.instant).not.toHaveBeenCalled();
    instant.click();
    expect(actions.instant).toHaveBeenCalledWith("C3");
  });

  it("an unlocked monster's card offers the Hatch tab instead", () => {
    const { element, showTab } = setup();
    row(element, "C1").click();
    expect(buttonNamed(element, "Start unlocking")).toBeUndefined();
    buttonNamed(element, "Hatch")!.click();
    expect(showTab).toHaveBeenCalledWith("hatch", { monster: "C1" });
  });
});

describe("LockerTab: the running unlock", () => {
  const running = { lockerdata: { C1: { t: 2 }, C4: { t: 1, s: T0 - 400, e: T0 + 7_200 } } };

  it("shows the countdown, Finish now at its price, the Overdrive, and every Start says why not", () => {
    const { element } = setup(running);
    const block = element.querySelector<HTMLElement>(".locker-running")!;
    expect(block.querySelector(".locker-running__title")!.textContent).toBe("Unlocking Fink");
    expect(block.querySelector(".locker-running__countdown")!.textContent).toBe("2h 0m");
    const [finish, overdrive] = [...block.querySelectorAll<HTMLButtonElement>(".shiny-button")];
    expect(spokenText(finish!)).toMatch(/^Finish now Shiny? ?40$|^Finish now ?40$/);
    expect(finish!.disabled).toBe(false);
    expect(overdrive!.textContent).toMatch(/^Overdrive 4 h/);
    expect(overdrive!.disabled).toBe(false);
    // The running one is selected; the others cannot start.
    expect(row(element, "C4").getAttribute("aria-pressed")).toBe("true");
    expect(spokenText(row(element, "C4"))).toBe("Fink Unlocking · 2h 0m");
    row(element, "C2").click();
    expect(element.querySelector(".monsters-gate")!.textContent).toBe("Another unlock is running");
  });

  it("Finish now and the Overdrive each need a second tap", () => {
    const { element, actions } = setup(running);
    const [finish, overdrive] = [
      ...element.querySelectorAll<HTMLButtonElement>(".locker-running .shiny-button"),
    ];
    finish!.click();
    finish!.click();
    expect(actions.finish).toHaveBeenCalledTimes(1);
    overdrive!.click();
    overdrive!.click();
    expect(actions.overdrive).toHaveBeenCalledTimes(1);
  });

  it("an active Overdrive says so and cannot be bought again", () => {
    const { element } = setup({ ...running, storedata: { CLOD: { e: T0 + 3_600 } } });
    expect(element.querySelector(".locker-running__overdrive")!.textContent).toBe(
      "Overdrive: five times as fast for 1h 0m.",
    );
    const overdrive = element.querySelectorAll<HTMLButtonElement>(".locker-running .shiny-button")[1]!;
    expect(overdrive.disabled).toBe(true);
  });

  it("confirms Cancel with the refund before cancelling", () => {
    const { element, actions } = setup(running);
    buttonNamed(element, "Cancel unlock")!.click();
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(spokenText(element.querySelector(".locker-cancel__question")!)).toBe(
      "Cancel and get back Putty 32,000? Progress is lost.",
    );
    buttonNamed(element, "Keep unlocking")!.click();
    expect(element.querySelector(".locker-cancel__question")).toBeNull();
    buttonNamed(element, "Cancel unlock")!.click();
    buttonNamed(element, "Yes, cancel")!.click();
    expect(actions.cancel).toHaveBeenCalledTimes(1);
  });

  it("counts down on the tick", () => {
    let now = T0;
    const { element, tab, store } = setup(running);
    vi.spyOn(store, "now").mockImplementation(() => now);
    now = T0 + 60;
    tab.tick();
    expect(element.querySelector(".locker-running__countdown")!.textContent).toBe("1h 59m");
  });
});

describe("LockerTab: after an action", () => {
  it("reports the outcome and stays put", async () => {
    const { element } = setup();
    row(element, "C3").click();
    buttonNamed(element, "Start unlocking")!.click();
    await Promise.resolve();
    await Promise.resolve();
    const status = element.querySelector<HTMLElement>(".monsters-status")!;
    expect(status.hidden).toBe(false);
    expect(spokenText(status)).toBe("Unlocking Bolt: Putty 64,000 spent.");
  });
});

describe("the blurb", () => {
  it("draws <br> and <b> and nothing else as markup", () => {
    const holder = document.createElement("p");
    holder.append(...describeBlurb("One<br><b>Target:</b> <i>x</i>"));
    expect(holder.innerHTML).toBe("One<br><strong>Target:</strong> &lt;i&gt;x&lt;/i&gt;");
  });
});
