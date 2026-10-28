// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, ChampionSaveEntry, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { ChampionActions } from "@/api/yardChampion";
import { YardStore } from "@/game/yard/YardStore";
import { ChamberPanel } from "./ChamberPanel";

/**
 * The Champion Chamber's controls (#125): the champion in the cage with
 * Freeze, the frozen ones with Thaw, and the reasons either cannot run. The
 * rules are `game/yard/championModel.test.ts`'s; this checks the wiring.
 */

const T0 = 2_000_000;
const HOUR = 3_600;

const CAGE: BuildingData = { id: 3, t: 114, l: 1, X: 0, Y: 0 };
const CHAMBER: BuildingData = { id: 4, t: 119, l: 1, X: 200, Y: 0 };

const champ = (overrides: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: T0 + 5 * HOUR,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const never = <R>() => new Promise<R>(() => undefined);

const setup = (champion: ChampionSaveEntry[], buildings: BuildingData[] = [CAGE, CHAMBER]) => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: {},
      credits: 0,
      buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
      buildinghealthdata: {},
      storedata: {},
      monsters: { housed: {} },
      champion,
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const freeze = vi.fn(() => never());
  const thaw = vi.fn(() => never());
  const panel = new ChamberPanel({ store, actions: { freeze, thaw } as unknown as ChampionActions });
  document.body.replaceChildren(panel.element);
  panel.show();
  return { element: panel.element, freeze, thaw };
};

afterEach(() => {
  document.body.replaceChildren();
});

/** A card's Freeze or Thaw tile. */
const tile = (root: HTMLElement, champion: string, act: "freeze" | "thaw") =>
  root.querySelector<HTMLButtonElement>(`[data-champion="${champion}"] .champion-act--${act}`)!;

const locked = (button: HTMLButtonElement) => button.getAttribute("aria-disabled") === "true";

describe("ChamberPanel", () => {
  it("freezes the champion in the cage in one tap", () => {
    const { element, freeze } = setup([champ()]);
    const card = element.querySelector<HTMLElement>(".chamber-card--caged")!;
    expect(card.dataset["champion"]).toBe("G1");
    const button = tile(element, "G1", "freeze");
    expect(locked(button)).toBe(false);
    expect(button.querySelector(".champion-act__short")!.textContent).toBe("Keeps its level");
    button.click();
    expect(freeze).toHaveBeenCalledTimes(1);
  });

  it("will not freeze an injured or hungry champion: a few words, the sentence on tap", () => {
    const hurt = setup([champ({ hp: 100 })]);
    const button = tile(hurt.element, "G1", "freeze");
    expect(locked(button)).toBe(true);
    expect(button.querySelector(".champion-act__short")!.textContent).toBe("Heal it first");
    expect(button.title).toContain("Heal Gorgo to full health");
    button.click();
    expect(hurt.freeze).not.toHaveBeenCalled();
    const hint = hurt.element.querySelector<HTMLElement>(".champion__act-hint")!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("Heal Gorgo to full health");
    const hungry = setup([champ({ ft: T0 - 1 })]);
    expect(tile(hungry.element, "G1", "freeze").title).toBe("Feed Gorgo before you freeze it.");
    expect(hungry.element.querySelector(".chamber-card__fed--hungry")!.textContent).toContain("Hungry");
  });

  it("shows each frozen champion iced over, with its stats as icon chips and Thaw", () => {
    const { element, thaw } = setup([champ({ t: 2, status: 1, ft: 5 * HOUR, hp: 12_000, nm: "Rex" })]);
    const card = element.querySelector<HTMLElement>(".chamber-card--frozen")!;
    expect(card.dataset["champion"]).toBe("G2");
    expect(card.querySelector(".chamber-card__picture")!.getAttribute("src")).toBe("/portraits/G2-L1.webp");
    expect(card.querySelector(".chamber-card__level")!.textContent).toBe("L1");
    expect(card.querySelector(".chamber-card__name")!.textContent).toContain("Rex");
    expect([...card.querySelectorAll<HTMLElement>(".champion__stat")].map((one) => one.dataset["stat"])).toEqual(
      expect.arrayContaining(["health", "damage", "speed"]),
    );
    expect(card.querySelectorAll('.champion__stat [data-icon]').length).toBeGreaterThanOrEqual(3);
    expect(card.querySelector(".chamber-card__fed")!.textContent).toContain("5h 0m");
    const button = tile(element, "G2", "thaw");
    expect(button.querySelector(".champion-act__short")!.textContent).toBe("Back to the cage");
    button.click();
    expect(thaw).toHaveBeenCalledWith(2);
  });

  it("lists the caged champion first, then the frozen ones", () => {
    const { element } = setup([champ(), champ({ t: 2, status: 1, ft: HOUR, hp: 12_000 }), champ({ t: 3, status: 1, ft: HOUR, hp: 9_000 })]);
    expect([...element.querySelectorAll<HTMLElement>(".chamber-card")].map((one) => one.dataset["champion"])).toEqual([
      "G1",
      "G2",
      "G3",
    ]);
  });

  it("will not thaw while the cage holds a champion or the chamber is damaged", () => {
    const full = setup([champ(), champ({ t: 2, status: 1, ft: HOUR, hp: 12_000 })]);
    const blocked = tile(full.element, "G2", "thaw");
    expect(locked(blocked)).toBe(true);
    expect(blocked.querySelector(".champion-act__short")!.textContent).toBe("Cage is full");
    expect(blocked.title).toContain("Freeze Gorgo first");
    blocked.click();
    expect(full.thaw).not.toHaveBeenCalled();
    const damaged = setup([champ({ t: 2, status: 1, ft: HOUR, hp: 12_000 })], [CAGE, { ...CHAMBER, hp: 500 }]);
    const repair = tile(damaged.element, "G2", "thaw");
    expect(locked(repair)).toBe(true);
    expect(repair.querySelector(".champion-act__short")!.textContent).toBe("Repair the Chamber");
    expect(repair.title).toContain("damaged");
  });

  it("shows the chamber's own picture when no champion is in it or the cage", () => {
    const { element } = setup([]);
    expect(element.querySelector(".chamber-card")).toBeNull();
    expect(element.querySelector(".chamber__empty-art")).not.toBeNull();
    expect(element.textContent).toContain("No champion on ice yet");
  });
});
