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

const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));

describe("ChamberPanel", () => {
  it("freezes the champion in the cage in one tap", () => {
    const { element, freeze } = setup([champ()]);
    const button = buttonNamed(element, "Freeze Gorgo")!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("No champion is frozen yet.");
  });

  it("will not freeze an injured or hungry champion, and says why", () => {
    const hurt = setup([champ({ hp: 100 })]);
    expect(buttonNamed(hurt.element, "Freeze Gorgo")!.disabled).toBe(true);
    expect(hurt.element.textContent).toContain("Heal Gorgo to full health");
    const hungry = setup([champ({ ft: T0 - 1 })]);
    expect(hungry.element.textContent).toContain("Feed Gorgo before you freeze it.");
  });

  it("lists frozen champions with Thaw, once the cage is empty", () => {
    const { element, thaw } = setup([champ({ t: 2, status: 1, ft: 5 * HOUR, hp: 12_000, nm: "Rex" })]);
    const row = element.querySelector<HTMLElement>(".chamber__row")!;
    expect(row.dataset["champion"]).toBe("G2");
    expect(row.textContent).toContain("fed for 5h 0m after thawing");
    expect(row.querySelector("img")!.getAttribute("src")).toBe("/assets/monsters/G2_L1-150.png");
    buttonNamed(element, "Thaw Rex")!.click();
    expect(thaw).toHaveBeenCalledWith(2);
  });

  it("will not thaw while the cage holds a champion or the chamber is damaged", () => {
    const full = setup([champ(), champ({ t: 2, status: 1, ft: HOUR, hp: 12_000 })]);
    expect(buttonNamed(full.element, "Thaw Drull")!.disabled).toBe(true);
    expect(full.element.textContent).toContain("Freeze Gorgo first");
    const damaged = setup([champ({ t: 2, status: 1, ft: HOUR, hp: 12_000 })], [CAGE, { ...CHAMBER, hp: 500 }]);
    expect(buttonNamed(damaged.element, "Thaw Drull")!.disabled).toBe(true);
    expect(damaged.element.textContent).toContain("damaged");
  });
});
