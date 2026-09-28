import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources } from "@/api/types";
import { rowOf } from "./buildingCosts";
import {
  allowedAt,
  BUILD_CATALOGUE,
  BUILDABLE_TYPES,
  BuildCategory,
  buildOffer,
  buildOffers,
  buildsAtOnce,
  nextHallAllowing,
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
  } as unknown as BaseLoadResponse;
  const yard = readYard(save);
  return {
    yard,
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
      category: BuildCategory.DEFENCES,
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
  it("a tab's tiles in the tab's order; decorations are empty for now", () => {
    const context = contextOf({ buildings: [HALL(3)] });
    expect(buildOffers(BuildCategory.RESOURCES, context).map((offer) => offer.type)).toEqual([
      1, 2, 3, 4, 6,
    ]);
    expect(buildOffers(BuildCategory.DECORATIONS, context)).toEqual([]);
  });
});
