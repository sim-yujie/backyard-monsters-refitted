// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import type { BunkerActions, BunkerFillReport, BunkerRemoveReport } from "@/api/yardBunker";
import { YardStore } from "@/game/yard/YardStore";
import { spokenText } from "@/ui/resourceIcon";
import { BunkerPanel } from "./BunkerPanel";

/**
 * The bunker's controls as a player meets them: the room, the fill list from
 * housing and from the shop, the steppers' limits, Move and Buy, and taking
 * monsters out (juiced or removed) behind a confirmation. The rules are
 * `game/monsters/bunker.test.ts`'s; this checks the drawing and the wiring.
 */

const T0 = 2_000_000;

const bunker = (extra: Partial<BuildingData> = {}): BuildingData => ({
  id: 8,
  t: 22,
  l: 1,
  X: 0,
  Y: 0,
  m: { C3: 6 },
  ...extra,
});

const juicer: BuildingData = { id: 9, t: 9, l: 1, X: 200, Y: 0 };

const loadOf = (extra: Partial<BaseLoadResponse> = {}, buildings: BuildingData[] = [bunker()]): BaseLoadResponse =>
  ({
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: { r1: 0, r2: 0, r3: 100_000, r4: 0 },
    credits: 100,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: {},
    monsters: { housed: { C1: 30, C2: 5, C14: 3 } },
    lockerdata: { C1: { t: 2 }, C2: { t: 2 } },
    academy: {},
    ...extra,
  }) as unknown as BaseLoadResponse;

const never = <R>() => new Promise<R>(() => undefined);

const setup = (load: Partial<BaseLoadResponse> = {}, buildings?: BuildingData[], actions?: Partial<BunkerActions>) => {
  const api = { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi;
  const store = new YardStore({
    save: loadOf(load, buildings),
    api,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const fill = vi.fn(actions?.fill ?? (() => never()));
  const remove = vi.fn(actions?.remove ?? (() => never()));
  const panel = new BunkerPanel({ store, bunkerId: 8, actions: { fill, remove } as BunkerActions });
  document.body.replaceChildren(panel.element);
  panel.show();
  return { panel, store, fill, remove, element: panel.element };
};

afterEach(() => {
  document.body.replaceChildren();
});

const fillRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".bunker__part--in .bunker__row")];
const outRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".bunker__part--out .bunker__row")];
const rowFor = (rows: HTMLElement[], id: string) => rows.find((row) => row.dataset["monster"] === id)!;
const plus = (row: HTMLElement) => row.querySelector<HTMLButtonElement>(".bunker__step--plus")!;
const countOf = (row: HTMLElement) => row.querySelector<HTMLInputElement>("input")!.value;
const buttonNamed = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((one) => one.textContent?.startsWith(text));
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("BunkerPanel: the room", () => {
  it("shows the space used against the bunker's room", () => {
    const { element } = setup();
    // Six Bolts at 15 each; a level 1 bunker holds 380.
    expect(element.querySelector(".bunker__figures")!.textContent).toBe("90 / 380 space used");
    expect(element.querySelector(".bunker__bar")!.getAttribute("aria-valuenow")).toBe("90");
  });
});

describe("BunkerPanel: putting monsters in from housing", () => {
  it("lists only the housed monsters a bunker takes, with what each costs in room", () => {
    const { element } = setup();
    const rows = fillRows(element);
    expect(rows.map((row) => row.dataset["monster"])).toEqual(["C1", "C2"]);
    expect(rowFor(rows, "C1").querySelector(".bunker__sub")!.textContent).toBe("30 housed · 10 space");
  });

  it("limits each row to what is housed and what the room allows after the rest", () => {
    const { element } = setup();
    const rows = fillRows(element);
    // 290 free: Fill on Pokey takes 29 of the 30 housed.
    rowFor(rows, "C1").querySelector<HTMLButtonElement>(".bunker__fill")!.click();
    expect(countOf(rowFor(rows, "C1"))).toBe("29");
    expect(plus(rowFor(rows, "C2")).disabled).toBe(true);
    // Giving one back makes room for one Octo-ooze.
    rowFor(rows, "C1").querySelector<HTMLButtonElement>(".bunker__step--minus")!.click();
    expect(plus(rowFor(rows, "C2")).disabled).toBe(false);
  });

  it("prices the move in putty and sends the whole selection in one request", async () => {
    const report: BunkerFillReport = {
      bunker: 8,
      source: "housing",
      added: { C1: 2, C2: 1 },
      cost: { r3: 500 },
      credits: 0,
      used: 120,
      capacity: 380,
    };
    const { element, fill } = setup({}, undefined, {
      fill: () => Promise.resolve({ ok: true as const, report, completed: [] }),
    });
    const move = element.querySelector<HTMLButtonElement>(".bunker__move")!;
    expect(move.disabled).toBe(true);
    const rows = fillRows(element);
    plus(rowFor(rows, "C1")).click();
    plus(rowFor(rows, "C1")).click();
    plus(rowFor(rows, "C2")).click();
    // 2 × floor(250 × 0.5) + floor(500 × 0.5).
    expect(spokenText(move)).toBe("Move 3 · Putty 500");
    expect(element.querySelector(".bunker__figures")!.textContent).toBe("90 / 380 space used · 30 selected");
    move.click();
    expect(fill).toHaveBeenCalledWith(8, { C1: 2, C2: 1 }, "housing");
    await settle();
    expect(spokenText(element.querySelector(".bunker__status")!)).toBe(
      "Moved 2 Pokey and 1 Octo-ooze into the bunker for Putty 500.",
    );
  });

  it("says when the putty is short", () => {
    const { element } = setup({ resources: { r1: 0, r2: 0, r3: 100, r4: 0 } });
    plus(rowFor(fillRows(element), "C1")).click();
    expect(element.querySelector<HTMLButtonElement>(".bunker__move")!.disabled).toBe(true);
    expect(element.querySelector(".bunker__gate")!.textContent).toBe("Not enough putty.");
  });

  it("says why nothing can be offered", () => {
    expect(setup({ monsters: { housed: { C14: 3 } } }).element.querySelector(".bunker__gate")!.textContent).toContain(
      "None of your housed monsters can go in a bunker",
    );
    const building = setup({}, [bunker({ l: 0, cB: 600 })]).element;
    expect(building.querySelector(".bunker__figures")!.textContent).toContain("still being built");
  });
});

describe("BunkerPanel: buying monsters in", () => {
  it("lists the buyable monsters at their Shiny price, locked ones without a stepper", () => {
    const { element } = setup();
    buttonNamed(element, "Buy with Shiny")!.click();
    const rows = fillRows(element);
    expect(rows.map((row) => row.dataset["monster"]).sort()).toEqual(
      ["C2", "C5", "C6", "C7", "C8", "C10", "C11", "C12", "C13", "C17"].sort(),
    );
    expect(rowFor(rows, "C2").querySelector(".bunker__sub")!.textContent).toBe("2 Shiny each · 10 space");
    expect(rowFor(rows, "C5").classList.contains("bunker__row--locked")).toBe(true);
    expect(rowFor(rows, "C5").querySelector("input")).toBeNull();
  });

  it("buys on the second tap of the Shiny button", () => {
    const { element, fill } = setup();
    buttonNamed(element, "Buy with Shiny")!.click();
    const rows = fillRows(element);
    plus(rowFor(rows, "C2")).click();
    plus(rowFor(rows, "C2")).click();
    const buy = element.querySelector<HTMLButtonElement>(".bunker__buy")!;
    expect(spokenText(buy)).toContain("4");
    buy.click();
    expect(fill).not.toHaveBeenCalled();
    buy.click();
    expect(fill).toHaveBeenCalledWith(8, { C2: 2 }, "buy");
  });
});

describe("BunkerPanel: taking monsters out", () => {
  it("juices them with a working Juicer, after a confirmation stating the goo", async () => {
    const report: BunkerRemoveReport = { bunker: 8, monster: "C3", removed: 2, juiced: true, goo: 420, lost: 0 };
    const { element, remove } = setup({}, [bunker(), juicer], {
      remove: () => Promise.resolve({ ok: true as const, report, completed: [] }),
    });
    expect(element.querySelector(".bunker__part--out .bunker__note")!.textContent).toContain("juices it for goo");
    const row = rowFor(outRows(element), "C3");
    expect(row.querySelector(".bunker__sub")!.textContent).toBe("6 inside · 90 space");
    const take = row.querySelector<HTMLButtonElement>(".bunker__take")!;
    expect(take.textContent).toBe("Juice");
    expect(take.disabled).toBe(true);
    plus(row).click();
    plus(row).click();
    take.click();
    expect(remove).not.toHaveBeenCalled();
    // Bolt: ceil(350 × 0.6) = 210 each.
    expect(spokenText(element.querySelector(".bunker__question")!)).toBe(
      "Juice 2 Bolt for Goo 420? They are gone for good.",
    );
    buttonNamed(element, "Yes, juice")!.click();
    expect(remove).toHaveBeenCalledWith(8, "C3", 2);
    await settle();
    expect(spokenText(element.querySelector(".bunker__status")!)).toBe("Juiced 2 Bolt: Goo 420 added.");
  });

  it("removes them without a Juicer, saying nothing is refunded, and can back out", () => {
    const { element, remove } = setup();
    expect(element.querySelector(".bunker__part--out .bunker__note")!.textContent).toContain("deletes it");
    const row = rowFor(outRows(element), "C3");
    row.querySelector<HTMLButtonElement>(".bunker__fill")!.click();
    const take = row.querySelector<HTMLButtonElement>(".bunker__take")!;
    expect(take.textContent).toBe("Remove");
    take.click();
    expect(element.querySelector(".bunker__question")!.textContent).toBe(
      "Remove 6 Bolt? They are deleted and nothing is refunded.",
    );
    buttonNamed(element, "Keep them")!.click();
    expect(element.querySelector(".bunker__confirm")).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("says the bunker is empty", () => {
    const { element } = setup({}, [bunker({ m: {} })]);
    expect(element.querySelector(".bunker__part--out .bunker__note")!.textContent).toBe("The bunker is empty.");
    expect(outRows(element)).toHaveLength(0);
  });
});
