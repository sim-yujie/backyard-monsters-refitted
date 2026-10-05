// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { TEST_ROSTER } from "@/game/baiter/baiterSession";
import { BaiterPanel, resetBaiterMemory, type BaiterPanelOptions } from "./BaiterPanel";

/**
 * The Baiter's test setup (issue #22, WP2, `docs/design/baiter-simulator.md`
 * §5.1 and §6 steps 1-5): a row for each of the 18 surface monsters with its
 * own level picker, unlocked ones first and locked ones tagged; the shortcuts;
 * the army size against the level's cap; the champions; and Start test
 * handing the test army over.
 */

const save = {
  error: 0,
  baseid: "3510",
  buildingdata: {},
  academy: { C1: { level: 6 } },
  lockerdata: { C1: { t: 2 }, C4: { t: 2 }, C2: { t: 1 } },
  monsters: { housed: { C1: 40, C4: 3 } },
} as unknown as BaseLoadResponse;

let host: HTMLElement;

const open = (overrides: Partial<BaiterPanelOptions> = {}) => {
  const options: BaiterPanelOptions = {
    level: 1,
    save: () => save,
    blocked: null,
    onRun: vi.fn(),
    ...overrides,
  };
  const panel = new BaiterPanel(options).mount(host);
  return { panel, options };
};

const rows = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".baiter__row")];

const nameOf = (row: HTMLElement): string => row.querySelector(".baiter__monster")?.textContent ?? "";

const rowOf = (name: string): HTMLElement => rows().find((row) => nameOf(row) === name)!;

const fillRow = (name: string): void => {
  rowOf(name).querySelector<HTMLButtonElement>(".baiter__fill")!.click();
};

const pickLevel = (name: string, level: number): void => {
  const picker = rowOf(name).querySelector<HTMLSelectElement>(".baiter__level")!;
  picker.value = String(level);
  picker.dispatchEvent(new Event("change"));
};

const shortcut = (label: string): void => {
  [...host.querySelectorAll<HTMLButtonElement>(".baiter__shortcut")]
    .find((button) => button.textContent === label)!
    .click();
};

const choose = (selector: string, value: string, which = 0): void => {
  const picker = host.querySelectorAll<HTMLSelectElement>(selector)[which]!;
  picker.value = value;
  picker.dispatchEvent(new Event("change"));
};

const krallenBox = (): HTMLInputElement => host.querySelector<HTMLInputElement>(".baiter-champion__krallen")!;

const figures = (): string => host.querySelector(".baiter__figures")!.textContent ?? "";

const run = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".baiter__run")!;

beforeEach(() => {
  resetBaiterMemory();
  host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => host.remove());

describe("BaiterPanel", () => {
  it("lists the 18 surface monsters, unlocked ones first, locked ones tagged", () => {
    const { panel } = open();
    expect(rows()).toHaveLength(18);
    expect(TEST_ROSTER).toHaveLength(18);
    expect(rows().slice(0, 2).map(nameOf)).toEqual(["Pokey", "Fink"]);
    expect(rowOf("Pokey").querySelector(".baiter__tag")).toBeNull();
    expect(rowOf("Octo-ooze").querySelector(".baiter__tag")!.textContent).toBe("Not unlocked");
    expect(host.querySelectorAll(".baiter__tag")).toHaveLength(16);
    expect(panel.army.monsters.C1).toEqual({ count: 0, level: 6 });
    expect(rowOf("Pokey").querySelector<HTMLSelectElement>(".baiter__level")!.value).toBe("6");
    expect(rowOf("Pokey").querySelector(".baiter__each")!.textContent).toBe("7 space each");
    expect(run().textContent).toBe("Start test");
    expect(run().disabled).toBe(true);
  });

  it("offers a locked monster like any other", () => {
    const { panel } = open();
    fillRow("Octo-ooze");
    expect(panel.army.monsters.C2!.count).toBeGreaterThan(0);
    expect(run().disabled).toBe(false);
  });

  it("fills a row only as far as the level's cap", () => {
    const { panel } = open({ level: 1 });
    fillRow("Pokey");
    // 600 space at Baiter level 1; a level-6 Pokey takes 7, so 85 fit.
    expect(panel.army.monsters.C1).toEqual({ count: 85, level: 6 });
    expect(figures()).toBe("Army size 595 / 600");
    expect(run().disabled).toBe(false);
    host.replaceChildren();
    resetBaiterMemory();
    const bigger = open({ level: 3 });
    fillRow("Pokey");
    // 1,200 at level 3.
    expect(bigger.panel.army.monsters.C1!.count).toBe(171);
  });

  it("changes a row's size with its level picker, cutting the count to what still fits", () => {
    const { panel } = open({ level: 1 });
    fillRow("Pokey");
    pickLevel("Pokey", 1);
    // A level-1 Pokey takes 10: 85 no longer fit, 60 do.
    expect(panel.army.monsters.C1).toEqual({ count: 60, level: 1 });
    expect(figures()).toBe("Army size 600 / 600");
    expect(rowOf("Pokey").querySelector(".baiter__each")!.textContent).toBe("10 space each");
    pickLevel("Pokey", 6);
    // Smaller again: the count stays.
    expect(panel.army.monsters.C1).toEqual({ count: 60, level: 6 });
    expect(figures()).toBe("Army size 420 / 600");
  });

  it("changes every level with a shortcut, and cuts the army back to what fits", () => {
    const { panel } = open({ level: 1 });
    fillRow("Pokey");
    shortcut("All level 1");
    expect(panel.army.monsters.C1).toEqual({ count: 60, level: 1 });
    expect(rowOf("Pokey").querySelector<HTMLSelectElement>(".baiter__level")!.value).toBe("1");
    shortcut("All max");
    expect(panel.army.monsters.C1!.level).toBe(6);
    expect(panel.army.monsters.C2!.level).toBeGreaterThan(1);
    shortcut("My levels");
    expect(panel.army.monsters.C1!.level).toBe(6);
    expect(panel.army.monsters.C2!.level).toBe(1);
  });

  it("copies the housed monsters with My army", () => {
    const { panel } = open({ level: 3 });
    fillRow("Octo-ooze");
    shortcut("My army");
    expect(panel.army.monsters.C1).toEqual({ count: 40, level: 6 });
    expect(panel.army.monsters.C4!.count).toBe(3);
    expect(panel.army.monsters.C2!.count).toBe(0);
  });

  it("picks an ordinary champion at a level, power level and Mode, and Krallen besides", () => {
    const { panel } = open();
    const details = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".baiter-champion__details")];
    expect(details().every((one) => one.hidden)).toBe(true);
    choose(".baiter-champion__type", "4");
    expect(panel.army.champions).toEqual([{ t: 4, l: 1, pl: 0 }]);
    expect(details()[0]!.hidden).toBe(false);
    expect(host.querySelector<HTMLSelectElement>(".baiter-champion__mode")!.value).toBe("hybrid");
    choose(".baiter-champion__level", "4");
    choose(".baiter-champion__power", "3");
    choose(".baiter-champion__mode", "defensive");
    expect(panel.army.champions).toEqual([{ t: 4, l: 4, pl: 3, s: "defensive" }]);
    // A champion alone is a test.
    expect(run().disabled).toBe(false);

    // Another ordinary champion takes the slot, keeping what fits.
    choose(".baiter-champion__type", "1");
    expect(panel.army.champions).toEqual([{ t: 1, l: 4, pl: 3, s: "defensive" }]);

    // Krallen as well, with her own ranges: levels 1-5, power 0-2.
    krallenBox().click();
    expect(panel.army.champions.map((one) => one.t)).toEqual([1, 5]);
    expect(details()[1]!.hidden).toBe(false);
    expect(host.querySelectorAll<HTMLSelectElement>(".baiter-champion__level")[1]!.options).toHaveLength(5);
    expect(host.querySelectorAll<HTMLSelectElement>(".baiter-champion__power")[1]!.options).toHaveLength(3);
    choose(".baiter-champion__level", "5", 1);
    expect(panel.army.champions[1]).toEqual({ t: 5, l: 5, pl: 0 });

    choose(".baiter-champion__type", "");
    expect(panel.army.champions.map((one) => one.t)).toEqual([5]);
    krallenBox().click();
    expect(panel.army.champions).toEqual([]);
    expect(run().disabled).toBe(true);
  });

  it("starts the own yard against the test army, at the Baiter's level", () => {
    const { options } = open({ level: 3 });
    shortcut("All level 1");
    fillRow("Pokey");
    choose(".baiter-champion__type", "4");
    choose(".baiter-champion__level", "4");
    run().click();
    expect(options.onRun).toHaveBeenCalledTimes(1);
    const handed = vi.mocked(options.onRun).mock.calls[0]![0];
    expect(handed.save).toBe(save);
    expect(handed.baiterLevel).toBe(3);
    expect(handed.army.monsters.C1).toEqual({ count: 120, level: 1 });
    expect(handed.army.champions).toEqual([{ t: 4, l: 4, pl: 0 }]);
  });

  it("clears the monsters and the champions", () => {
    const { panel } = open();
    fillRow("Pokey");
    choose(".baiter-champion__type", "2");
    host.querySelector<HTMLButtonElement>(".baiter__actions .btn--ghost")!.click();
    expect(panel.army.monsters.C1).toEqual({ count: 0, level: 6 });
    expect(panel.army.champions).toEqual([]);
    expect(host.querySelector<HTMLSelectElement>(".baiter-champion__type")!.value).toBe("");
    expect(run().disabled).toBe(true);
  });

  it("keeps the army for the next panel this session, cut to that panel's cap", () => {
    open({ level: 3 });
    fillRow("Pokey");
    pickLevel("Fink", 2);
    choose(".baiter-champion__type", "3");
    host.replaceChildren();
    const { panel } = open({ level: 1 });
    expect(panel.army.monsters.C1).toEqual({ count: 85, level: 6 });
    expect(panel.army.monsters.C4!.level).toBe(2);
    expect(panel.army.champions).toEqual([{ t: 3, l: 1, pl: 0 }]);
    expect(host.querySelector<HTMLSelectElement>(".baiter-champion__type")!.value).toBe("3");
  });

  it("says why no test can start, and will not start", () => {
    const { options } = open({ blocked: "Repair the Baiter to bring an attack." });
    fillRow("Pokey");
    expect(host.textContent).toContain("Repair the Baiter to bring an attack.");
    expect(run().disabled).toBe(true);
    run().click();
    expect(options.onRun).not.toHaveBeenCalled();
  });
});
