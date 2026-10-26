// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { SiegeSnapshot } from "@/game/combat/rules/engine";
import { TICKS_PER_SECOND } from "@/game/combat/rules/stats";
import { SiegePanel, siegeOnField, type SiegeView } from "./SiegePanel";

/** Flash's one-weapon siege popup: Fire, Cancel, and the weapon on the field. */

const view = (overrides: Partial<SiegeView> = {}): SiegeView => ({
  state: "ready",
  live: true,
  canFire: true,
  onField: null,
  ...overrides,
});

const fireOf = (panel: SiegePanel): HTMLButtonElement =>
  panel.element.querySelector<HTMLButtonElement>("[data-fire]")!;

describe("SiegePanel", () => {
  it("shows the one weapon with its level, tooltip and stat lines at that level", () => {
    const panel = new SiegePanel({ weapon: { id: "decoy", level: 2, quantity: 1 }, onFire: () => {} }).mount(
      document.body,
    );
    const text = panel.element.textContent ?? "";
    expect(text).toContain("Marilyn Monstroe");
    expect(text).toContain("Level 2");
    expect(text).toContain("Drop Marilyn Monstroe near enemy bunkers");
    expect([...panel.element.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Damage: Does up to 1500 damage when she explodes",
      "Attraction Range: Attracts all defending monsters within a range of 270",
      "Countdown: Marilyn Monstroe blows up after 11 seconds",
    ]);
    expect(panel.element.querySelector("img")!.getAttribute("src")).toBe("/assets/siegebuttons/decoy.png");
    expect(text).not.toMatch(/no effect yet/i);
    panel.destroy();
  });

  it("reads Fire, then Cancel with where to tap while armed, then hides once fired", () => {
    const onFire = vi.fn();
    const panel = new SiegePanel({ weapon: { id: "jars", level: 1, quantity: 1 }, onFire }).mount(document.body);
    expect(fireOf(panel).textContent).toBe("Fire");
    fireOf(panel).click();
    expect(onFire).toHaveBeenCalledTimes(1);

    panel.update(view({ state: "armed" }));
    expect(fireOf(panel).textContent).toBe("Cancel");
    expect(panel.element.textContent).toContain("Select Target Towers");

    panel.update(view({ state: "fired", onField: { secondsLeft: null, health: 0.5 } }));
    expect(fireOf(panel).hidden).toBe(true);
    expect(panel.element.querySelector<HTMLElement>(".attack-siege__time")!.hidden).toBe(true);
    expect(panel.element.querySelector(".attack-siege__bar")!.getAttribute("aria-valuenow")).toBe("50");

    panel.update(view({ state: "fired", onField: null }));
    expect(panel.element.textContent).toContain("Used this attack.");
    panel.destroy();
  });

  it("greys Fire when the Vacuum has no Town Hall left, or the attack is over", () => {
    const panel = new SiegePanel({ weapon: { id: "vacuum", level: 1, quantity: 1 }, onFire: () => {} }).mount(
      document.body,
    );
    panel.update(view({ canFire: false }));
    expect(fireOf(panel).disabled).toBe(true);
    expect(panel.element.textContent).toContain("No Town Hall left");
    panel.update(view({ live: false }));
    expect(fireOf(panel).disabled).toBe(true);
    panel.update(view());
    expect(fireOf(panel).disabled).toBe(false);
    panel.destroy();
  });

  it("glows the seconds left red under ten", () => {
    const panel = new SiegePanel({ weapon: { id: "vacuum", level: 1, quantity: 1 }, onFire: () => {} }).mount(
      document.body,
    );
    const time = (): HTMLElement => panel.element.querySelector<HTMLElement>(".attack-siege__time")!;
    panel.update(view({ state: "fired", onField: { secondsLeft: 12, health: 1 } }));
    expect(time().textContent).toBe("12s");
    expect(time().classList.contains("attack-siege__time--low")).toBe(false);
    panel.update(view({ state: "fired", onField: { secondsLeft: 9, health: 1 } }));
    expect(time().classList.contains("attack-siege__time--low")).toBe(true);
    panel.destroy();
  });
});

describe("siegeOnField", () => {
  const none: SiegeSnapshot = { active: null, decoy: null, vacuum: null, jars: [] };

  it("counts the Decoy down in whole seconds and gives it no health", () => {
    const snapshot: SiegeSnapshot = {
      ...none,
      active: "decoy",
      decoy: { x: 0, y: 0, droppedAt: 0, landsAt: 48, explodesAt: 10 * TICKS_PER_SECOND, range: 250 },
    };
    expect(siegeOnField(snapshot, 1)).toEqual({ secondsLeft: 10, health: null });
    expect(siegeOnField(snapshot, 9 * TICKS_PER_SECOND)).toEqual({ secondsLeft: 1, health: null });
  });

  it("gives the Vacuum its time and hose health, the Jars their health over all jars", () => {
    expect(
      siegeOnField(
        {
          ...none,
          active: "vacuum",
          vacuum: { buildingId: 1, droppedAt: 0, endsAt: 30 * TICKS_PER_SECOND, health: 3000, durability: 6000 },
        },
        0,
      ),
    ).toEqual({ secondsLeft: 30, health: 0.5 });
    const jar = { buildingId: 2, landsAt: 80, frame: 0, breaking: false, durability: 2000 };
    expect(
      siegeOnField(
        {
          ...none,
          active: "jars",
          jars: [
            { ...jar, health: 1000 },
            { ...jar, buildingId: 3, health: null, breaking: true },
            { ...jar, buildingId: 4, health: null },
          ],
        },
        100,
      ),
    ).toEqual({ secondsLeft: null, health: 3000 / 6000 });
    expect(siegeOnField(none, 0)).toBeNull();
  });
});
