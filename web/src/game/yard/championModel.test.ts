import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import {
  cageView,
  chamberView,
  championPortraitUrl,
  freezeGate,
  predictedHealth,
  thawGate,
} from "./championModel";
import { championEntry } from "./championCatalogue";

/**
 * What the Champion Cage panel is drawn from (`championModel.ts`): the cage's
 * state, hunger, the recipe against housing, the Shiny prices and the health
 * the passive heal has reached. The rules match `server/src/services/yard/champion.ts`.
 */

const NOW = 1_800_000_000;
const HOUR = 3_600;

const gorgo = (overrides: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t: 1,
  hp: 40_000,
  l: 1,
  ft: NOW + HOUR,
  fd: 0,
  fb: 0,
  pl: 1,
  status: 0,
  ...overrides,
});

const saveOf = (champion: ChampionSaveEntry[], extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    savetime: NOW,
    buildingdata: { "3": { id: 3, t: 114, X: 0, Y: 0, l: 1 } },
    monsters: { housed: { C2: 12, C6: 30 } },
    champion,
    ...extra,
  }) as unknown as BaseLoadResponse;

const active = (save: BaseLoadResponse, now = NOW) => {
  const view = cageView(save, now);
  if (view.kind !== "active") throw new Error(`expected a champion, got ${view.kind}`);
  return view.view;
};

describe("cageView", () => {
  it("says when there is no cage or it is still being built", () => {
    expect(cageView(saveOf([], { buildingdata: {} }), NOW).kind).toBe("noCage");
    const building = { "3": { id: 3, t: 114, X: 0, Y: 0, l: 0, cB: 500 } };
    expect(cageView(saveOf([], { buildingdata: building } as never), NOW).kind).toBe("building");
  });

  it("offers Gorgo, Drull and Fomor with no champion, marking a frozen one", () => {
    const view = cageView(saveOf([gorgo({ t: 3, status: 1, ft: HOUR })]), NOW);
    expect(view.kind).toBe("empty");
    if (view.kind !== "empty") return;
    expect(view.choices.map((one) => [one.entry.name, one.frozen])).toEqual([
      ["Gorgo", false],
      ["Drull", false],
      ["Fomor", true],
    ]);
  });

  it("a juiced champion leaves the cage empty", () => {
    expect(cageView(saveOf([gorgo({ status: 2 })]), NOW).kind).toBe("empty");
  });
});

describe("championView", () => {
  it("fed: not hungry, Evolve on offer, no Shiny feed", () => {
    const view = active(saveOf([gorgo({ fd: 1 })]));
    expect(view.hunger).toBe("fed");
    expect(view.feedCount).toBe(3);
    expect(view.feedShiny).toBeNull();
    expect(view.evolveShiny).toBe(26 * 2 * 2);
  });

  it("hungry: the recipe against housing and the Shiny feed", () => {
    const view = active(saveOf([gorgo({ ft: NOW - 10 })]));
    expect(view.hunger).toBe("hungry");
    expect(view.starvesAt).toBe(NOW - 10 + 24 * HOUR);
    expect(view.recipe).toEqual([{ monster: "C2", name: "Octo-ooze", need: 15, have: 12 }]);
    expect(view.canFeedMonsters).toBe(false);
    expect(view.feedShiny).toBe(26);
  });

  it("starving once the grace has run out", () => {
    expect(active(saveOf([gorgo({ ft: NOW - 25 * HOUR })])).hunger).toBe("starving");
  });

  it("at the top level: the food-bonus recipe, doubled Shiny while fed, none at rank 3", () => {
    const fed = active(saveOf([gorgo({ l: 6, hp: 212_500, fb: 1 })]));
    expect(fed.top).toBe(true);
    expect(fed.evolveShiny).toBeNull();
    expect(fed.recipe.map((row) => [row.monster, row.need])).toEqual([["C10", 20]]);
    expect(fed.feedShiny).toBe(272);
    expect(fed.maxHealth).toBe(212_500);
    expect(active(saveOf([gorgo({ l: 6, hp: 250_000, fb: 3 })])).feedShiny).toBeNull();
  });

  it("uses the player's name when there is one", () => {
    expect(active(saveOf([gorgo({ nm: "Kong" })])).name).toBe("Kong");
    expect(active(saveOf([gorgo({ nm: "  " })])).name).toBe("Gorgo");
  });
});

describe("health", () => {
  it("heals int(max × 5 / healtime) every 5 seconds from savetime, as the server does", () => {
    const entry = championEntry(1)!;
    expect(predictedHealth(gorgo({ hp: 10_000 }), entry, NOW, NOW + 50)).toBe(10_000 + 55 * 10);
    expect(predictedHealth(gorgo({ hp: 10_000 }), entry, NOW, NOW + 10 * HOUR)).toBe(40_000);
  });

  it("prices Heal from the health reached and says when it is full", () => {
    const view = active(saveOf([gorgo({ hp: 20_000 })]));
    // Half health at level 1: 1,800 s → 10 Shiny.
    expect(view.healShiny).toBe(10);
    expect(view.fullAt).toBe(NOW + Math.ceil(20_000 / 55) * 5);
    const full = active(saveOf([gorgo()]));
    expect(full.healShiny).toBe(0);
    expect(full.fullAt).toBeNull();
  });
});

describe("championPortraitUrl", () => {
  it("points at the game's own art for the level", () => {
    expect(championPortraitUrl(championEntry(2)!, 4)).toBe("/assets/monsters/G2_L4-150.png");
    expect(championPortraitUrl(championEntry(2)!, 9)).toBe("/assets/monsters/G2_L6-150.png");
  });
});

describe("the Champion Chamber (#125)", () => {
  const CHAMBER = { id: 4, t: 119, X: 0, Y: 0, l: 1 };
  const withChamber = (champion: ChampionSaveEntry[], chamber: Record<string, unknown> = {}) =>
    saveOf(champion, {
      buildingdata: { "3": { id: 3, t: 114, X: 0, Y: 0, l: 1 }, "4": { ...CHAMBER, ...chamber } },
    } as never);

  it("lists the champion in the cage and the frozen ones, with their stopped clock", () => {
    const view = chamberView(withChamber([gorgo(), gorgo({ t: 3, status: 1, ft: 2 * HOUR, hp: 20_000, l: 3 })]), NOW);
    if (view.kind !== "ready") throw new Error(view.kind);
    expect(view.active?.entry.id).toBe("G1");
    expect(view.frozen.map((one) => [one.entry.id, one.level, one.fedFor, one.maxHealth])).toEqual([
      ["G3", 3, 2 * HOUR, 20_000],
    ]);
    expect(thawGate(view)).toMatch(/^Freeze Gorgo first/);
  });

  it("freezes only a champion at full health and fed, with a chamber", () => {
    const fed = active(withChamber([gorgo()]));
    expect(freezeGate(withChamber([gorgo()]), fed)).toBeNull();
    expect(freezeGate(saveOf([gorgo()]), fed)).toMatch(/Build a Champion Chamber/);
    const hurt = active(withChamber([gorgo({ hp: 1 })]));
    expect(freezeGate(withChamber([gorgo({ hp: 1 })]), hurt)).toMatch(/full health/);
    const hungry = active(withChamber([gorgo({ ft: NOW - 1 })]));
    expect(freezeGate(withChamber([gorgo({ ft: NOW - 1 })]), hungry)).toMatch(/^Feed Gorgo/);
  });

  it("thaws nothing while the chamber is damaged", () => {
    const view = chamberView(withChamber([gorgo({ status: 1 })], { hp: 10 }), NOW);
    expect(thawGate(view)).toMatch(/damaged/);
    expect(thawGate(chamberView(withChamber([gorgo({ status: 1 })]), NOW))).toBeNull();
    expect(chamberView(saveOf([]), NOW).kind).toBe("noChamber");
  });
});
