import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources } from "@/api/types";
import { outpostTraitsOf, quantityOf, rowOf } from "./buildingCosts";
import { OUTPOST_COST_ROWS } from "./buildingCostData";
import {
  allowedAt,
  BUILD_CATALOGUE,
  BUILDABLE_TYPES,
  buildableTypesFor,
  BuildCategory,
  buildOffer,
  buildOffers,
  buildsAtOnce,
  catalogueFor,
  categoryOf,
  nextHallAllowing,
  OUTPOST_BUILD_CATALOGUE,
  OUTPOST_BUILDABLE_TYPES,
  pageCount,
  pageOf,
  sortOffers,
  type BuildContext,
} from "./buildCatalogue";
import { readYard } from "./yardModel";

/**
 * The build menu's tiles and their one reason, in the server's order
 * (`server/src/services/yard/build.ts`): the hall's allowance, the limit, the
 * prerequisites, the resources, a free worker (not for walls and traps).
 *
 * Costs from the generated table: Cannon Tower `costs[0]` = 2,000 / 1,500 /
 * 500, 30 s, four at Town Hall 3; Block 1,000 twigs, 5 s; the Monster Academy
 * needs a level 2 Monster Locker; the Monster Lab needs Town Hall 5.
 */

const T0 = 2_000_000;
const RICH: Resources = { r1: 1e8, r2: 1e8, r3: 1e8, r4: 1e8 };
const CAPS: ResourceCaps = { r1: 5e8, r2: 5e8, r3: 5e8, r4: 5e8 };

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t,
  X: id * 100,
  Y: 0,
  ...extra,
});

interface Fixture {
  readonly buildings: BuildingData[];
  readonly resources?: Resources;
  readonly caps?: ResourceCaps | null;
  readonly credits?: number;
  readonly storedata?: BaseLoadResponse["storedata"];
  readonly researchdata?: BaseLoadResponse["researchdata"];
  readonly outpost?: boolean;
}

const contextOf = (fixture: Fixture): BuildContext => {
  const save = {
    error: 0,
    currenttime: T0,
    savetime: T0,
    resources: fixture.resources ?? RICH,
    credits: fixture.credits ?? 1_000,
    buildingdata: Object.fromEntries(fixture.buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: {},
    storedata: fixture.storedata ?? {},
    researchdata: fixture.researchdata ?? {},
  } as unknown as BaseLoadResponse;
  const yard = readYard(save);
  return {
    yard,
    ...(fixture.outpost ? { kind: "outpost" as const } : {}),
    save,
    resources: save.resources ?? {},
    credits: save.credits ?? 0,
    caps: fixture.caps === undefined ? CAPS : fixture.caps,
    workers: yard.workers,
    now: () => T0,
  };
};

const HALL = (level: number) => building(1, 14, { l: level });
const CANNON = 20;
const BLOCK = 17;

describe("the catalogue", () => {
  it("lists the server's buildable set exactly, each type once", () => {
    // `BUILDABLE_TYPES` in server/src/services/yard/build.ts.
    expect([...BUILDABLE_TYPES].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26, 51, 114,
      115, 116, 117, 118, 119,
    ]);
    const all = BUILD_CATALOGUE.flatMap((category) => category.types);
    expect(new Set(all).size).toBe(all.length);
  });

  it("leaves out the Radio, the Inferno types, Map Room 3 structures and the Town Hall", () => {
    for (const type of [14, 18, 113, 129, 132, 133, 134, 136, 137, 138, 139, 140]) {
      expect(BUILDABLE_TYPES.has(type)).toBe(false);
    }
  });

  it("has the original's four tabs, filed by the props table's group (#157)", () => {
    // `YARD_PROPS.as` `group` 1 to 4, in `order` within each.
    expect(BUILD_CATALOGUE.map((category) => category.label)).toEqual([
      "Resources",
      "Buildings",
      "Defensive",
      "Decorations",
    ]);
    const buildings = BUILD_CATALOGUE.find((category) => category.id === BuildCategory.BUILDINGS);
    // The monster buildings sit under Buildings…
    for (const type of [8, 13, 15, 26]) expect(buildings?.types).toContain(type);
    // …and so do the Champion Cage and Chamber, beside them, not under
    // Defensive where the props table's `group` files them (#159).
    expect(buildings?.types.slice(5, 8)).toEqual([16, 114, 119]);
    const defensive = BUILD_CATALOGUE.find((category) => category.id === BuildCategory.DEFENSIVE);
    for (const type of [114, 119]) expect(defensive?.types).not.toContain(type);
  });

  it("every listed type has a build step", () => {
    for (const type of BUILDABLE_TYPES) expect(rowOf(type)?.[4][0]).toBeDefined();
  });

  it("walls and traps build at once; towers do not", () => {
    expect(buildsAtOnce(17)).toBe(true);
    expect(buildsAtOnce(24)).toBe(true);
    expect(buildsAtOnce(117)).toBe(true);
    expect(buildsAtOnce(20)).toBe(false);
  });

  it("reads quantity[hall], the last entry past the end", () => {
    expect(allowedAt([0, 2, 3], 1)).toBe(2);
    expect(allowedAt([0, 2, 3], 9)).toBe(3);
    expect(allowedAt([], 3)).toBe(0);
    expect(nextHallAllowing([0, 2, 3, 3, 4], 2, 3)).toBe(4);
    expect(nextHallAllowing([0, 2, 3], 2, 3)).toBeNull();
  });
});

describe("buildOffer", () => {
  it("a tower: cost, time, owned / allowed, the instant price, no gate", () => {
    const context = contextOf({ buildings: [HALL(3), building(2, CANNON)] });
    expect(buildOffer(CANNON, context)).toMatchObject({
      type: CANNON,
      category: BuildCategory.DEFENSIVE,
      cost: { r1: 2000, r2: 1500, r3: 500, r4: 0 },
      seconds: 30,
      atOnce: false,
      owned: 1,
      allowed: 4,
      instantPrice: 17,
      gate: null,
      instantGate: null,
    });
  });

  it("Sharper Tools shortens the time shown", () => {
    const context = contextOf({
      buildings: [HALL(3)],
      storedata: { BST: { q: 1, e: T0 + 60 } },
    });
    expect(buildOffer(CANNON, context)?.seconds).toBe(24);
  });

  it("a wall shows no time and needs no worker", () => {
    // The one worker is busy upgrading the hall.
    const context = contextOf({ buildings: [HALL(3), building(2, CANNON, { l: 1, cU: 500 })] });
    expect(buildOffer(BLOCK, context)).toMatchObject({ seconds: 0, atOnce: true, gate: null });
    expect(buildOffer(CANNON, context)?.gate).toEqual({ reason: "workers", total: 1, busy: 1 });
  });

  it("no hall: Build a Town Hall first", () => {
    expect(buildOffer(CANNON, contextOf({ buildings: [] }))?.gate).toEqual({
      reason: "townHall",
      have: 0,
      need: 1,
    });
  });

  it("the hall allows none yet: the Lab needs Town Hall 5", () => {
    const offer = buildOffer(116, contextOf({ buildings: [HALL(3)] }));
    expect(offer?.gate).toEqual({ reason: "townHall", have: 3, need: 5 });
    expect(offer?.instantGate).toEqual(offer?.gate);
    expect(offer?.allowed).toBe(0);
  });

  it("at the limit, before the prerequisites and the resources, naming the next hall", () => {
    const cannons = [2, 3, 4, 5].map((id) => building(id, CANNON));
    const offer = buildOffer(
      CANNON,
      contextOf({ buildings: [HALL(3), ...cannons], resources: { r1: 0, r2: 0, r3: 0, r4: 0 } }),
    );
    expect(offer?.gate).toEqual({ reason: "limit", have: 4, allowed: 4, next: 4 });
    expect(offer?.instantGate).toEqual(offer?.gate);
  });

  it("one still being built counts towards the limit", () => {
    const cannons = [2, 3, 4].map((id) => building(id, CANNON));
    const offer = buildOffer(
      CANNON,
      contextOf({ buildings: [HALL(3), ...cannons, building(5, CANNON, { cB: 20 })] }),
    );
    expect(offer?.gate?.reason).toBe("limit");
  });

  it("prerequisites before resources: the Academy needs a level 2 Locker", () => {
    const offer = buildOffer(
      26,
      contextOf({
        buildings: [HALL(3), building(2, 8, { l: 1 })],
        resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      }),
    );
    expect(offer?.gate).toEqual({ reason: "requirements", requirements: [[8, 1, 2]] });
  });

  it("short of resources: the shortfall, and whether it is over the cap", () => {
    const poor = contextOf({ buildings: [HALL(3)], resources: { r1: 500, r2: 1500, r3: 0, r4: 0 } });
    expect(buildOffer(CANNON, poor)?.gate).toEqual({
      reason: "shortfall",
      shortfall: { r1: 1500, r2: 0, r3: 500, r4: 0 },
      overCap: false,
    });

    const capped = contextOf({
      buildings: [HALL(3)],
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      caps: { r1: 1000, r2: 1e6, r3: 1e6, r4: 1e6 },
    });
    expect(buildOffer(CANNON, capped)?.gate).toMatchObject({ reason: "shortfall", overCap: true });
    // Instant charges no resources.
    expect(buildOffer(CANNON, capped)?.instantGate).toBeNull();
  });

  it("counts the Map Room the server adds to a Map Room 2 yard: 1 of 1, no second (owner 2026-09-28)", () => {
    // As `migrateYard` writes it: level 2, finished, placed by the server.
    const mapRoom = building(601, 11, { l: 2, X: -90, Y: -50 });
    const offer = buildOffer(11, contextOf({ buildings: [HALL(8), mapRoom] }));
    expect(offer).toMatchObject({ owned: 1, allowed: 1 });
    expect(offer?.gate).toEqual({ reason: "limit", have: 1, allowed: 1, next: null });
    expect(buildOffer(11, contextOf({ buildings: [HALL(8)] }))).toMatchObject({ owned: 0, allowed: 1 });
  });

  it("instant needs the Shiny", () => {
    const offer = buildOffer(CANNON, contextOf({ buildings: [HALL(3)], credits: 5 }));
    expect(offer?.gate).toBeNull();
    expect(offer?.instantGate).toEqual({ reason: "credits", need: 12 });
  });

  it("types the menu does not offer have no tile", () => {
    const context = contextOf({ buildings: [HALL(3)] });
    expect(buildOffer(113, context)).toBeNull();
    expect(buildOffer(14, context)).toBeNull();
    expect(buildOffer(999, context)).toBeNull();
  });
});

describe("buildOffers", () => {
  it("a tab's tiles in the tab's order; decorations are what storage holds", () => {
    const context = contextOf({ buildings: [HALL(3)] });
    expect(buildOffers(BuildCategory.RESOURCES, context).map((offer) => offer.type)).toEqual([
      1, 2, 3, 4, 6,
    ]);
    expect(buildOffers(BuildCategory.DECORATIONS, context)).toEqual([]);
  });

  it("the Decorations tab lists every stored decoration, free and at once (#128)", () => {
    const context = contextOf({
      buildings: [HALL(3)],
      researchdata: { b121: 1, bl121: 4, b28: 3, b20: 5, b30: 0, other: 1 },
    });
    const offers = buildOffers(BuildCategory.DECORATIONS, context);

    expect(offers.map((offer) => [offer.type, offer.stored])).toEqual([
      [28, 3],
      [121, 1],
    ]);
    expect(offers[0]).toMatchObject({
      category: BuildCategory.DECORATIONS,
      cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
      atOnce: true,
      status: "ready",
      gate: null,
    });
    expect(buildOffer(28, context)?.stored).toBe(3);
    expect(buildOffer(30, context)).toBeNull();
    // Not a decoration: a stored count means nothing, and it is built as ever.
    expect(buildOffer(20, context)?.stored).toBeNull();
  });

  it("an outpost has no decoration storage", () => {
    const context = contextOf({ buildings: [], researchdata: { b28: 3 }, outpost: true });
    expect(buildOffers(BuildCategory.DECORATIONS, context)).toEqual([]);
    expect(buildOffer(28, context)).toBeNull();
  });
});

describe("status and needs (#157)", () => {
  it("ready: the count, and the hall and prerequisites ticked", () => {
    const context = contextOf({ buildings: [HALL(3), building(2, 15)] });
    const hatchery = buildOffer(13, context);
    expect(hatchery).toMatchObject({ status: "ready", owned: 0, allowed: 3, most: 5 });
    expect(hatchery?.needs).toEqual([
      { kind: "townHall", level: 1, met: true },
      { kind: "building", type: 15, count: 1, level: 1, met: true },
    ]);
  });

  it("locked by the hall: the hall the first one needs, unticked", () => {
    const lab = buildOffer(116, contextOf({ buildings: [HALL(3)] }));
    expect(lab?.status).toBe("locked");
    expect(lab?.needs[0]).toEqual({ kind: "townHall", level: 5, met: false });
  });

  it("locked by a prerequisite: the Control Centre wants three level 2 Hatcheries", () => {
    const hatcheries = [2, 3].map((id) => building(id, 13, { l: 2 }));
    const hcc = buildOffer(16, contextOf({ buildings: [HALL(3), ...hatcheries] }));
    expect(hcc?.status).toBe("locked");
    expect(hcc?.needs).toContainEqual({ kind: "building", type: 13, count: 3, level: 2, met: false });
  });

  it("at the limit for now: the next one needs the next hall", () => {
    const cannons = [2, 3, 4, 5].map((id) => building(id, CANNON));
    const offer = buildOffer(CANNON, contextOf({ buildings: [HALL(3), ...cannons] }));
    expect(offer?.status).toBe("limit");
    expect(offer?.needs[0]).toEqual({ kind: "townHall", level: 4, met: false });
  });

  it("all any hall allows: maxed, which earns the tick", () => {
    const locker = buildOffer(8, contextOf({ buildings: [HALL(3), building(2, 8)] }));
    expect(locker).toMatchObject({ status: "maxed", owned: 1, most: 1 });
  });

  it("sorts ready, locked, at the limit, all built; the tab's order within each", () => {
    const context = contextOf({
      buildings: [HALL(3), building(2, 8), building(3, 15), ...[4, 5, 6].map((id) => building(id, 13))],
    });
    const sorted = sortOffers(buildOffers(BuildCategory.BUILDINGS, context));
    const statuses = sorted.map((offer) => offer.status);
    expect(statuses).toEqual([...statuses].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
    expect(sorted.at(-1)?.type).toBe(8);
    expect(sorted.find((offer) => offer.type === 13)?.status).toBe("limit");
    // The General Store leads the tab and is ready, so it leads the sort too.
    expect(sorted[0]?.type).toBe(12);
  });
});

const ORDER = ["ready", "locked", "limit", "maxed"];

describe("pages", () => {
  it("ten to a page; an empty tab is one page; the page is clamped", () => {
    const items = Array.from({ length: 13 }, (_, index) => index);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(10)).toBe(1);
    expect(pageCount(13)).toBe(2);
    expect(pageOf(items, 0)).toHaveLength(10);
    expect(pageOf(items, 1)).toEqual([10, 11, 12]);
    expect(pageOf(items, 7)).toEqual([10, 11, 12]);
    expect(pageOf([], 0)).toEqual([]);
  });
});

describe("the outpost catalogue", () => {
  const CORE = building(1, 112, { l: 1 });
  const outpost = (fixture: Fixture): BuildContext => ({ ...contextOf(fixture), kind: "outpost" });

  it("lists every type the outpost table lets a menu offer, and nothing else", () => {
    // In a menu tab, not `block`ed, and allowed at core level 1
    // (`client/scripts/OUTPOST_YARD_PROPS.as`, research §1.2).
    const offered = OUTPOST_COST_ROWS.filter(([type, , , group]) => {
      const blocked = outpostTraitsOf(type)?.[1] ?? true;
      return group >= 1 && group <= 4 && !blocked && quantityOf(type, 1, "outpost") > 0;
    }).map(([type]) => type);
    expect([...OUTPOST_BUILDABLE_TYPES].sort((a, b) => a - b)).toEqual(offered);
    expect(offered).toEqual([
      1, 2, 3, 4, 5, 9, 10, 13, 15, 16, 17, 20, 21, 22, 23, 24, 25, 115, 117, 118,
    ]);
  });

  it("keeps the main menu's tabs and order", () => {
    for (const [index, tab] of OUTPOST_BUILD_CATALOGUE.entries()) {
      const main = BUILD_CATALOGUE[index];
      expect(tab.id).toBe(main?.id);
      expect(tab.types).toEqual(main?.types.filter((type) => OUTPOST_BUILDABLE_TYPES.has(type)));
    }
  });

  it("is picked by yard kind, the main yard by default", () => {
    expect(catalogueFor()).toBe(BUILD_CATALOGUE);
    expect(catalogueFor("outpost")).toBe(OUTPOST_BUILD_CATALOGUE);
    expect(buildableTypesFor("main")).toBe(BUILDABLE_TYPES);
    expect(buildableTypesFor("outpost")).toBe(OUTPOST_BUILDABLE_TYPES);
    expect(categoryOf(6)).toBe(BuildCategory.RESOURCES);
    expect(categoryOf(6, "outpost")).toBeNull();
    expect(categoryOf(51, "outpost")).toBeNull();
  });

  it("prices from the outpost table and caps at quantity[1] with the core as hall", () => {
    const offer = buildOffer(5, outpost({ buildings: [CORE] }));
    // Flinger, `OUTPOST_YARD_PROPS.as:605-611`.
    expect(offer?.cost).toEqual({ r1: 10000, r2: 10000, r3: 5000, r4: 0 });
    expect(offer?.allowed).toBe(1);
    expect(offer?.gate).toBeNull();
    const cannons = [2, 3, 4, 5].map((id) => building(id, CANNON, { l: 1 }));
    const full = buildOffer(CANNON, outpost({ buildings: [CORE, ...cannons] }));
    expect(full?.gate).toEqual({ reason: "limit", have: 4, allowed: 4, next: null });
    expect(full?.status).toBe("maxed");
  });

  it("names a missing Housing, not the hall, as what a Hatchery needs", () => {
    // `re: [[112, 1, 1], [15, 1, 1]]`, `OUTPOST_YARD_PROPS.as:885`.
    const offer = buildOffer(13, outpost({ buildings: [CORE] }));
    expect(offer?.gate).toEqual({ reason: "requirements", requirements: [[15, 1, 1]] });
    expect(offer?.needs[0]).toEqual({ kind: "townHall", level: 1, met: true });
  });

  it("offers nothing without the core", () => {
    const offer = buildOffer(CANNON, outpost({ buildings: [] }));
    expect(offer?.gate).toEqual({ reason: "townHall", have: 0, need: 1 });
  });

  it("lists the outpost tabs through buildOffers", () => {
    const types = buildOffers(BuildCategory.BUILDINGS, outpost({ buildings: [CORE] })).map(
      (offer) => offer.type,
    );
    expect(types).toEqual([15, 13, 16, 5, 10, 9]);
  });
});
