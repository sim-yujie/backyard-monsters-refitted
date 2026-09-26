// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BombStats } from "@/game/combat/rules";
import { CatapultPanel } from "./CatapultPanel";
import { SiegePanel } from "./SiegePanel";

/** The two pickers' tiles: what is offered, what is greyed, what arming looks like. */

const tiles = (panel: { element: HTMLElement }, attr: string): HTMLButtonElement[] =>
  [...panel.element.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`)];

const visible = (buttons: HTMLButtonElement[]): string[] =>
  buttons.filter((button) => !button.hidden).map((button) => button.dataset["bomb"] ?? "");

describe("CatapultPanel", () => {
  const view = (overrides: Partial<Parameters<CatapultPanel["update"]>[0]> = {}) => ({
    pool: { r1: 200_000, r2: 200_000, r3: 200_000 },
    used: new Set<number>(),
    creepsAlive: 0,
    live: true,
    armed: null,
    ...overrides,
  });

  it("offers the tiers the catapult level unlocks and hides putty until something is on the field", () => {
    const panel = new CatapultPanel({ catapultLevel: 3, onPick: () => {} }).mount(document.body);
    panel.update(view());
    expect(visible(tiles(panel, "bomb"))).toEqual(["tw0", "tw1", "tw2", "pb0", "pb1", "pb2", "pb3"]);
    panel.update(view({ creepsAlive: 2 }));
    expect(visible(tiles(panel, "bomb"))).toContain("pu0");
    expect(panel.element.querySelectorAll(".attack-picker__badge")).toHaveLength(4);
    panel.destroy();
  });

  it("greys what cannot be paid for or was already fired, and says why", () => {
    const panel = new CatapultPanel({ catapultLevel: 2, onPick: () => {} }).mount(document.body);
    panel.update(view({ pool: { r1: 50_000, r2: 0, r3: 0 }, used: new Set([2]) }));
    const byId = Object.fromEntries(tiles(panel, "bomb").map((button) => [button.dataset["bomb"], button]));
    expect(byId["tw0"]!.disabled).toBe(false);
    expect(byId["tw1"]!.disabled).toBe(true);
    expect(byId["tw1"]!.textContent).toContain("Not enough");
    expect(byId["pb0"]!.disabled).toBe(true);
    expect(byId["pb0"]!.textContent).toContain("already fired");
    panel.update(view({ pool: null }));
    expect(byId["tw0"]!.disabled).toBe(true);
    expect(byId["tw0"]!.textContent).toContain("could not be read");
    panel.destroy();
  });

  it("arms a tile on click, un-arms on a second click, and shows the armed state", () => {
    const picks: (BombStats | null)[] = [];
    const panel = new CatapultPanel({ catapultLevel: 1, onPick: (bomb) => picks.push(bomb) }).mount(
      document.body,
    );
    panel.update(view());
    const tile = tiles(panel, "bomb")[0]!;
    tile.click();
    expect(picks[0]?.id).toBe("tw0");
    panel.update(view({ armed: "tw0" }));
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(panel.element.textContent).toContain("armed");
    tile.click();
    expect(picks[1]).toBeNull();
    panel.destroy();
  });

  it("says so when there is no catapult", () => {
    const panel = new CatapultPanel({ catapultLevel: 0, onPick: () => {} }).mount(document.body);
    expect(tiles(panel, "bomb")).toHaveLength(0);
    expect(panel.element.textContent).toContain("no Catapult");
    panel.destroy();
  });
});

describe("SiegePanel", () => {
  it("lists the weapons the attacker owns with what is left, and none when there are none", () => {
    const onPick = vi.fn();
    const panel = new SiegePanel({
      stock: [
        { id: "decoy", level: 2, quantity: 2 },
        { id: "jars", level: 1, quantity: 0 },
      ],
      onPick,
    }).mount(document.body);
    panel.update({ used: { decoy: 1 }, live: true, armed: null });
    const buttons = tiles(panel, "weapon");
    expect(buttons.map((button) => button.dataset["weapon"])).toEqual(["decoy", "jars"]);
    expect(buttons[0]!.textContent).toContain("1 left");
    expect(buttons[0]!.disabled).toBe(false);
    expect(buttons[1]!.disabled).toBe(true);
    expect(panel.element.querySelectorAll(".attack-picker__badge")).toHaveLength(2);
    buttons[0]!.click();
    expect(onPick).toHaveBeenCalledWith({ spec: expect.objectContaining({ id: "decoy" }), level: 2 });
    panel.destroy();

    const empty = new SiegePanel({ stock: [], onPick }).mount(document.body);
    expect(tiles(empty, "weapon")).toHaveLength(0);
    expect(empty.element.textContent).toContain("no siege weapons");
    empty.destroy();
  });
});
