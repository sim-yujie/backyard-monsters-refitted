// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { BaiterPanel, resetBaiterMemory, type BaiterPanelOptions } from "./BaiterPanel";

/**
 * The Baiter's practice-attack controls (issue #126): the directions a level
 * offers, the attack size against its budget, the level-1 / academy switch
 * (Q5), and Run handing the attack over.
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

const directions = (): string[] =>
  [...host.querySelectorAll<HTMLButtonElement>(".baiter-compass [role=radio]")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );

const stepperOf = (name: string) =>
  [...host.querySelectorAll<HTMLElement>(".baiter__row")].find((row) =>
    row.querySelector(".baiter__monster")?.textContent === name,
  )!;

const fillRow = (name: string): void => {
  stepperOf(name).querySelector<HTMLButtonElement>(".baiter__fill")!.click();
};

const run = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".baiter__run")!;

beforeEach(() => {
  resetBaiterMemory();
  host = document.body.appendChild(document.createElement("div"));
});

afterEach(() => host.remove());

describe("BaiterPanel", () => {
  it("offers the four corners below level 3 and all eight directions from it", () => {
    open({ level: 2 });
    expect(directions()).toEqual(["Top left", "Top right", "Bottom left", "Bottom right"]);
    host.replaceChildren();
    open({ level: 3 });
    expect(directions()).toHaveLength(8);
  });

  it("lists C1 to C14 and fills a row to the budget", () => {
    const { panel } = open({ level: 1 });
    expect(host.querySelectorAll(".baiter__row")).toHaveLength(14);
    expect(run().disabled).toBe(true);
    fillRow("Pokey");
    // 600 space at level 1, 10 a Pokey.
    expect(panel.army).toEqual({ C1: 60 });
    expect(host.querySelector(".baiter__figures")!.textContent).toBe("Attack size 600 / 600");
    expect(run().disabled).toBe(false);
  });

  it("switches to the player's academy levels, where a Pokey takes less room (Q5)", () => {
    const { panel } = open({ level: 1 });
    host.querySelectorAll<HTMLButtonElement>(".baiter-switch__option")[1]!.click();
    fillRow("Pokey");
    // Level 6 Pokeys take 7: 85 fit in 600.
    expect(panel.army).toEqual({ C1: 85 });
    // Back to level 1: the army is cut to what fits again.
    host.querySelectorAll<HTMLButtonElement>(".baiter-switch__option")[0]!.click();
    expect(panel.army).toEqual({ C1: 60 });
  });

  it("runs the picked army from the chosen direction", () => {
    const { options } = open({ level: 3 });
    host.querySelector<HTMLButtonElement>(".baiter-compass [aria-label='Bottom']")!.click();
    fillRow("Pokey");
    run().click();
    expect(options.onRun).toHaveBeenCalledWith(
      expect.objectContaining({
        save,
        picks: { C1: 120 },
        direction: expect.objectContaining({ id: "b" }),
        levels: "wild",
        baiterLevel: 3,
      }),
    );
  });

  it("keeps the army for the next panel this session", () => {
    open({ level: 1 });
    fillRow("Pokey");
    host.replaceChildren();
    const { panel } = open({ level: 1 });
    expect(panel.army).toEqual({ C1: 60 });
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
