// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { TEST_ROSTER } from "@/game/baiter/baiterSession";
import { BaiterPanel, resetBaiterMemory, type BaiterPanelOptions } from "./BaiterPanel";

/**
 * The Baiter's test-army controls (issues #126 and #22, WP1): a row for each
 * of the 18 surface monsters at its level, the level shortcuts, the attack
 * size against the level's cap, and Run handing the test army over.
 */

const save = {
  error: 0,
  baseid: "3510",
  buildingdata: {},
  academy: { C1: { level: 6 } },
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

const rowOf = (name: string) =>
  [...host.querySelectorAll<HTMLElement>(".baiter__row")].find((row) =>
    row.querySelector(".baiter__monster")?.textContent === name,
  )!;

const fillRow = (name: string): void => {
  rowOf(name).querySelector<HTMLButtonElement>(".baiter__fill")!.click();
};

const shortcut = (label: string): void => {
  [...host.querySelectorAll<HTMLButtonElement>(".baiter-switch__option")]
    .find((button) => button.textContent === label)!
    .click();
};

const figures = (): string => host.querySelector(".baiter__figures")!.textContent ?? "";

const run = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".baiter__run")!;

beforeEach(() => {
  resetBaiterMemory();
  host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => host.remove());

describe("BaiterPanel", () => {
  it("lists the 18 surface monsters, each at the player's own level to start", () => {
    const { panel } = open();
    expect(host.querySelectorAll(".baiter__row")).toHaveLength(18);
    expect(TEST_ROSTER).toHaveLength(18);
    expect(panel.army.monsters.C1).toEqual({ count: 0, level: 6 });
    expect(rowOf("Pokey").querySelector(".baiter__each")!.textContent).toBe("Level 6 · 7 space each");
    expect(run().disabled).toBe(true);
  });

  it("fills a row only as far as the level's cap", () => {
    const { panel } = open({ level: 1 });
    fillRow("Pokey");
    // 600 space at Baiter level 1; a level-6 Pokey takes 7, so 85 fit.
    expect(panel.army.monsters.C1).toEqual({ count: 85, level: 6 });
    expect(figures()).toBe("Attack size 595 / 600");
    expect(run().disabled).toBe(false);
    host.replaceChildren();
    resetBaiterMemory();
    const bigger = open({ level: 3 });
    fillRow("Pokey");
    // 1,200 at level 3.
    expect(bigger.panel.army.monsters.C1!.count).toBe(171);
  });

  it("changes every level with a shortcut, and cuts the army back to what fits", () => {
    const { panel } = open({ level: 1 });
    fillRow("Pokey");
    shortcut("All level 1");
    // A level-1 Pokey takes 10: 85 no longer fit, 60 do.
    expect(panel.army.monsters.C1).toEqual({ count: 60, level: 1 });
    expect(figures()).toBe("Attack size 600 / 600");
    expect(rowOf("Pokey").querySelector(".baiter__each")!.textContent).toBe("Level 1 · 10 space each");
    shortcut("All max");
    expect(panel.army.monsters.C1!.level).toBe(6);
    expect(panel.army.monsters.C2!.level).toBeGreaterThan(1);
    shortcut("My levels");
    expect(panel.army.monsters.C1!.level).toBe(6);
    expect(panel.army.monsters.C2!.level).toBe(1);
  });

  it("runs the own yard against the test army, at the Baiter's level", () => {
    const { options } = open({ level: 3 });
    shortcut("All level 1");
    fillRow("Pokey");
    run().click();
    expect(options.onRun).toHaveBeenCalledTimes(1);
    const handed = vi.mocked(options.onRun).mock.calls[0]![0];
    expect(handed.save).toBe(save);
    expect(handed.baiterLevel).toBe(3);
    expect(handed.army.monsters.C1).toEqual({ count: 120, level: 1 });
    expect(handed.army.champions).toEqual([]);
  });

  it("clears the army", () => {
    const { panel } = open();
    fillRow("Pokey");
    host.querySelector<HTMLButtonElement>(".baiter__actions .btn--ghost")!.click();
    expect(panel.army.monsters.C1).toEqual({ count: 0, level: 6 });
    expect(run().disabled).toBe(true);
  });

  it("keeps the army for the next panel this session, cut to that panel's cap", () => {
    open({ level: 3 });
    fillRow("Pokey");
    host.replaceChildren();
    const { panel } = open({ level: 1 });
    expect(panel.army.monsters.C1).toEqual({ count: 85, level: 6 });
  });

  it("says why no attack can come, and will not run", () => {
    const { options } = open({ blocked: "Repair the Baiter to bring an attack." });
    fillRow("Pokey");
    expect(host.textContent).toContain("Repair the Baiter to bring an attack.");
    expect(run().disabled).toBe(true);
    run().click();
    expect(options.onRun).not.toHaveBeenCalled();
  });
});
