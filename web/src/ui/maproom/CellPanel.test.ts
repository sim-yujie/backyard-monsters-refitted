// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { MapCell, PlayerCell, WildMonsterCell } from "@/api/types";
import { CellPanel, type CellPanelOptions } from "./CellPanel";

/**
 * The slim cell panel (issue #174): a picture, a name and level, what and
 * where, chips only for what is true, and the actions; the rest behind "More
 * about this yard", and the old debugging rows gone.
 */

const camp = (overrides: Partial<WildMonsterCell> = {}): WildMonsterCell => ({
  uid: 0,
  b: 1,
  i: 150,
  bid: "2000241208",
  n: "Kozu",
  l: 38,
  dm: 0,
  d: 0,
  ...overrides,
});

const player = (overrides: Partial<PlayerCell> = {}): PlayerCell => ({
  uid: 77,
  b: 2,
  i: 150,
  bid: "3510",
  aid: null,
  n: "Bramblefoot",
  l: 24,
  v: 123_456,
  f: 3,
  c: 2,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 0,
  pic_square: "/avatars/bee.webp",
  pi: 0,
  fr: 0,
  ...overrides,
});

const open = (
  payload: MapCell | undefined,
  overrides: Partial<CellPanelOptions> = {},
  cell = { col: 241, row: 208 },
) => {
  const options: CellPanelOptions = {
    onClose: vi.fn(),
    onBookmark: vi.fn(),
    canBookmark: () => true,
    onViewYard: vi.fn(),
    attackRefusal: () => null,
    onAttack: vi.fn(),
    reach: () => ({ text: "In range · next to your yard", inRange: true }),
    ownFlinger: () => ({ level: 4, reach: 10, bonus: 0 }),
    onRangeToggle: vi.fn(),
    ...overrides,
  };
  const host = document.createElement("div");
  const panel = new CellPanel(options).mount(host);
  panel.show(cell, payload);
  return { panel, host, options };
};

const text = (host: HTMLElement, selector: string): string =>
  host.querySelector(selector)?.textContent ?? "";

const shown = (host: HTMLElement, selector: string): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>(selector)].filter((node) => !node.closest("[hidden]"));

const buttonNamed = (host: HTMLElement, name: string): HTMLButtonElement | undefined =>
  shown(host, "button").find((node) => node.textContent?.trim() === name) as
    | HTMLButtonElement
    | undefined;

describe("a wild monster camp", () => {
  it("shows its tribe picture, name, level and where, with the range chip", () => {
    const { host } = open(camp());
    expect(text(host, ".mr2-cell__title")).toBe("Kozu camp");
    expect(text(host, ".mr2-cell__level")).toBe("Level 38");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Wild monsters · 241, 208");
    expect(host.querySelector<HTMLImageElement>(".mr2-cell__picture img")?.src).toContain(
      "tribes/kozu-256.png",
    );
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "In range · next to your yard",
    ]);
    expect(buttonNamed(host, "Attack")?.disabled).toBe(false);
    expect(buttonNamed(host, "Look inside")).toBeDefined();
    expect(shown(host, "[aria-label='Bookmark']")).toHaveLength(1);
  });

  it("drops the old debugging rows", () => {
    const { host } = open(camp({ dm: 0 }));
    const all = host.textContent ?? "";
    for (const gone of ["Axial", "Terrain height", "Base id", "Coordinates", "Damage0%", "None"]) {
      expect(all).not.toContain(gone);
    }
    expect(shown(host, ".mr2-cell__more")).toHaveLength(0);
  });

  it("says out of range as a warning chip, and a destroyed camp as a chip", () => {
    const { host } = open(camp({ d: 1, dm: 100 }), {
      reach: () => ({ text: "Out of range · 2 cells too far", inRange: false }),
      attackRefusal: () => "None of your flingers can reach this cell.",
    });
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "Out of range · 2 cells too far",
      "Destroyed",
    ]);
    expect(shown(host, ".mr2-chip--warning")).toHaveLength(1);
    expect(buttonNamed(host, "Attack")?.disabled).toBe(true);
    // The chip already says why; the refusal is not repeated under the button.
    expect(shown(host, ".mr2-cell__note")).toHaveLength(0);
  });

  it("says any other refusal once, under the button", () => {
    const { host } = open(camp(), { attackRefusal: () => "You have no monsters in range." });
    expect(shown(host, ".mr2-cell__note").map((node) => node.textContent)).toEqual([
      "You have no monsters in range.",
    ]);
  });
});

describe("another player's yard", () => {
  it("shows their critter picture (#175), name and level, and only the chips that are true", () => {
    const { host } = open(player({ dm: 35, p: 1, lo: 9 }));
    expect(text(host, ".mr2-cell__title")).toBe("Bramblefoot");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Main yard · 241, 208");
    expect(host.querySelector<HTMLImageElement>(".mr2-cell__picture img")?.src).toContain(
      "avatars/bee.webp",
    );
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "In range · next to your yard",
      "Damaged 35%",
      "Protected",
      "Busy",
    ]);
    expect(buttonNamed(host, "View yard")).toBeDefined();
  });

  it("keeps empire value, alliance, Flinger and Catapult behind More about this yard", () => {
    const { host } = open(player({ aid: 12 }));
    const more = host.querySelector<HTMLDetailsElement>(".mr2-cell__more")!;
    expect(more.hidden).toBe(false);
    expect(more.open).toBe(false);
    expect([...more.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "Empire value",
      "Alliance",
      "Flinger",
      "Catapult",
    ]);
    expect(host.textContent).not.toContain("user 77");
    expect(host.textContent).not.toContain("/avatars/");
  });

  it("counts protection down when the server says when it ends (#187)", () => {
    const now = Date.now() / 1000;
    const { host, panel } = open(player({ p: 1, pe: now + 7_300 }));
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Protected 2h 1m");
    panel.tick(now + 7_290);
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Protected 10s");
  });

  it("counts a truce down", () => {
    const now = Date.now() / 1000;
    const { host, panel } = open(player({ t: now + 3_700 }));
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Truce 1h 1m");
    panel.tick(now + 3_590);
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Truce 1m 50s");
  });
});

describe("the player's own yards", () => {
  it("shows how far the Flinger reaches, the range switch and Open yard", () => {
    const { host, options, panel } = open(player({ mine: 1, n: "agenttester", l: 12 }), {
      ownFlinger: () => ({ level: 4, reach: 12, bonus: 2 }),
    });
    expect(text(host, ".mr2-cell__title")).toBe("Your yard");
    expect(text(host, ".mr2-cell__flinger-title")).toBe("Your Flinger reaches 12 cells");
    expect(text(host, ".mr2-cell__flinger-detail")).toBe(
      "Flinger level 4 (10) + 2 Declare War bonus",
    );
    expect(buttonNamed(host, "Attack")).toBeUndefined();
    expect(shown(host, ".mr2-chip")).toHaveLength(0);
    const openYard = buttonNamed(host, "Open yard")!;
    openYard.click();
    expect(options.onViewYard).toHaveBeenCalledTimes(1);

    const toggle = host.querySelector<HTMLButtonElement>("[role='switch']")!;
    panel.setRangeOn(false);
    toggle.click();
    expect(options.onRangeToggle).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("opens an own outpost as one (#146)", () => {
    const { host } = open(player({ mine: 1, b: 3 }));
    expect(text(host, ".mr2-cell__title")).toBe("Your outpost");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Outpost · 241, 208");
    const openOutpost = buttonNamed(host, "Open outpost")!;
    expect(openOutpost.title).toBe("Open your outpost");
  });
});

describe("water and loading", () => {
  it("offers only a bookmark on water", () => {
    const { host, options } = open({ i: 60 } as MapCell);
    expect(text(host, ".mr2-cell__title")).toBe("Water");
    expect(buttonNamed(host, "Attack")).toBeUndefined();
    shown(host, "[aria-label='Bookmark']")[0]!.click();
    expect(options.onBookmark).toHaveBeenCalledWith({ col: 241, row: 208 });
  });

  it("waits for the zone", () => {
    const { host } = open(undefined);
    expect(text(host, ".mr2-cell__title")).toBe("Loading…");
    expect(shown(host, "button").map((node) => node.getAttribute("aria-label"))).toEqual(["Close"]);
  });
});

it("closes on its button, once", () => {
  const { host, options } = open(camp());
  host.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
  expect(options.onClose).toHaveBeenCalledTimes(1);
  expect(host.children).toHaveLength(0);
});

it("hosts Take over under Attack, with its line under the actions (#82)", () => {
  const action = {
    button: Object.assign(document.createElement("button"), { textContent: "Take over" }),
    detail: document.createElement("p"),
    setCell: vi.fn(),
    tick: vi.fn(),
  };
  const { host } = open(camp({ d: 1, dm: 100 }), { extraAction: action });
  const actions = host.querySelector(".mr2-cell__actions")!;
  expect([...actions.children].indexOf(action.button)).toBeGreaterThan(0);
  expect(action.setCell).toHaveBeenCalledWith({ col: 241, row: 208 }, camp({ d: 1, dm: 100 }));
  expect(action.detail.parentElement).toBe(host.firstElementChild);
});

describe("moving between the player's yards (#186)", () => {
  it("shows neither move without outposts", () => {
    const { host } = open(player({ mine: 1 }), {
      ownMoves: () => ({ monsters: false, relocate: false }),
    });
    expect(buttonNamed(host, "Move monsters")).toBeUndefined();
    expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
  });

  it("offers Move monsters on the main yard once there is an outpost", () => {
    const onMoveMonsters = vi.fn();
    const payload = player({ mine: 1 });
    const { host } = open(payload, {
      ownMoves: () => ({ monsters: true, relocate: false }),
      onMoveMonsters,
    });
    buttonNamed(host, "Move monsters")!.click();
    expect(onMoveMonsters).toHaveBeenCalledWith({ col: 241, row: 208 }, payload);
    expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
  });

  it("offers both on an own outpost", () => {
    const onRelocate = vi.fn();
    const payload = player({ mine: 1, b: 3 });
    const { host } = open(payload, {
      ownMoves: () => ({ monsters: true, relocate: true }),
      onRelocate,
    });
    expect(buttonNamed(host, "Move monsters")).toBeDefined();
    buttonNamed(host, "Move main yard here")!.click();
    expect(onRelocate).toHaveBeenCalledWith({ col: 241, row: 208 }, payload);
  });

  it("never offers them on someone else's yard or a camp", () => {
    const ownMoves = () => ({ monsters: true, relocate: true });
    for (const payload of [player(), camp()]) {
      const { host } = open(payload, { ownMoves });
      expect(buttonNamed(host, "Move monsters")).toBeUndefined();
      expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
    }
  });
});
