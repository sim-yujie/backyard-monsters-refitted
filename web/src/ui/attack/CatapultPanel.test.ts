// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { BOMBS, type BombStats } from "@/game/combat/rules";
import { CatapultPanel, defaultTier } from "./CatapultPanel";
import { SiegePanel } from "./SiegePanel";

/** The two pickers: what is offered, what is greyed, what arming looks like. */

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

  const row = (panel: CatapultPanel, resource: number): HTMLElement =>
    panel.element.querySelector<HTMLElement>(`[data-resource="${resource}"]`)!;
  const arm = (panel: CatapultPanel, resource: number): HTMLButtonElement =>
    row(panel, resource).querySelector<HTMLButtonElement>("[data-arm]")!;
  const tier = (panel: CatapultPanel, id: string): HTMLButtonElement =>
    panel.element.querySelector<HTMLButtonElement>(`[data-bomb="${id}"]`)!;
  const selected = (panel: CatapultPanel, resource: number): string[] =>
    [...row(panel, resource).querySelectorAll<HTMLButtonElement>("[data-bomb]")]
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.dataset["bomb"] ?? "");

  it("lays out one row per resource with every tier as a segment, not a tile each", () => {
    const panel = new CatapultPanel({ catapultLevel: 3, onPick: () => {} }).mount(document.body);
    panel.update(view());
    const rows = [...panel.element.querySelectorAll<HTMLElement>(".attack-catapult__row")];
    expect(rows.map((one) => one.dataset["resource"])).toEqual(["1", "2", "3"]);
    expect(visible(tiles(panel, "bomb"))).toEqual([
      "tw0", "tw1", "tw2", "pb0", "pb1", "pb2", "pb3", "pu0", "pu1", "pu2", "pu3",
    ]);
    // Three Arm buttons, one per row, and the cost on each segment.
    expect(panel.element.querySelectorAll("[data-arm]")).toHaveLength(3);
    expect(tier(panel, "pb3").textContent).toBe("Massive10M");
    expect(tier(panel, "tw1").textContent).toBe("Big100K");
    // The putty row carries the engine-gap badge once.
    expect(panel.element.querySelectorAll(".attack-picker__badge")).toHaveLength(1);
    panel.destroy();
  });

  it("opens each row on the largest affordable tier up to 2,000,000, as Flash did", () => {
    expect(defaultTier(BOMBS.filter((one) => one.resource === 2), 200_000).id).toBe("pb1");
    // 10M in the pool still defaults to the 2M tier, never the 10M one.
    expect(defaultTier(BOMBS.filter((one) => one.resource === 2), 20_000_000).id).toBe("pb2");
    // Twigs have nothing between 100K and 5M, so a rich twig pool stops at 100K.
    expect(defaultTier(BOMBS.filter((one) => one.resource === 1), 20_000_000).id).toBe("tw1");
    // Nothing affordable: the smallest, which the row then greys.
    expect(defaultTier(BOMBS.filter((one) => one.resource === 1), 5_000).id).toBe("tw0");
    expect(defaultTier(BOMBS.filter((one) => one.resource === 1), null).id).toBe("tw0");

    const panel = new CatapultPanel({ catapultLevel: 2, onPick: () => {} }).mount(document.body);
    panel.update(view({ pool: { r1: 50_000, r2: 3_000_000, r3: 0 } }));
    expect(selected(panel, 1)).toEqual(["tw0"]);
    expect(selected(panel, 2)).toEqual(["pb2"]);
    panel.destroy();
  });

  it("locks a row the catapult has not unlocked, and says which level it needs", () => {
    const panel = new CatapultPanel({ catapultLevel: 1, onPick: () => {} }).mount(document.body);
    panel.update(view({ creepsAlive: 3 }));
    expect(arm(panel, 1).disabled).toBe(false);
    for (const resource of [2, 3]) {
      expect(row(panel, resource).classList).toContain("attack-catapult__row--locked");
      expect(arm(panel, resource).disabled).toBe(true);
    }
    expect(row(panel, 2).textContent).toContain("Needs a level 2 Catapult");
    expect(row(panel, 3).textContent).toContain("Needs a level 3 Catapult");
    expect(tier(panel, "pb0").disabled).toBe(true);
    panel.destroy();
  });

  it("greys what cannot be paid for or was already fired, and says why", () => {
    const panel = new CatapultPanel({ catapultLevel: 2, onPick: () => {} }).mount(document.body);
    panel.update(view({ pool: { r1: 50_000, r2: 0, r3: 0 }, used: new Set([2]) }));
    expect(tier(panel, "tw0").disabled).toBe(false);
    expect(tier(panel, "tw1").disabled).toBe(true);
    expect(tier(panel, "tw1").title).toContain("costs");
    expect(row(panel, 1).textContent).toContain("50.0K twigs");
    expect(arm(panel, 2).disabled).toBe(true);
    expect(row(panel, 2).textContent).toContain("Already fired");
    panel.update(view({ pool: { r1: 5_000, r2: 0, r3: 0 } }));
    expect(arm(panel, 1).disabled).toBe(true);
    expect(row(panel, 1).textContent).toContain("Not enough");
    panel.update(view({ pool: null }));
    expect(arm(panel, 1).disabled).toBe(true);
    expect(row(panel, 1).textContent).toContain("could not be read");
    panel.destroy();
  });

  it("keeps putty locked until something is on the field", () => {
    const panel = new CatapultPanel({ catapultLevel: 3, onPick: () => {} }).mount(document.body);
    panel.update(view());
    expect(arm(panel, 3).disabled).toBe(true);
    expect(row(panel, 3).textContent).toContain("once your monsters are on the field");
    panel.update(view({ creepsAlive: 2 }));
    expect(arm(panel, 3).disabled).toBe(false);
    panel.destroy();
  });

  it("arms the selected tier, re-arms a new size, and un-arms on a second press", () => {
    const picks: (BombStats | null)[] = [];
    const panel = new CatapultPanel({ catapultLevel: 1, onPick: (bomb) => picks.push(bomb) }).mount(
      document.body,
    );
    panel.update(view());
    // A tier press only selects while nothing is armed.
    tier(panel, "tw0").click();
    expect(picks).toEqual([]);
    expect(selected(panel, 1)).toEqual(["tw0"]);
    arm(panel, 1).click();
    expect(picks[0]?.id).toBe("tw0");
    panel.update(view({ armed: "tw0" }));
    expect(arm(panel, 1).getAttribute("aria-pressed")).toBe("true");
    expect(arm(panel, 1).textContent).toBe("Armed");
    expect(arm(panel, 1).title).toContain("tap the yard to fire");
    // Changing size while armed arms the new size straight away.
    tier(panel, "tw1").click();
    expect(picks[1]?.id).toBe("tw1");
    panel.update(view({ armed: "tw1" }));
    arm(panel, 1).click();
    expect(picks[2]).toBeNull();
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
