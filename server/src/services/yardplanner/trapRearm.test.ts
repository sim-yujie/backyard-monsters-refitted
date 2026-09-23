import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { TrapPlacement } from "../../schemas/YardPlannerSchemas.js";
import type { BuildingData, BuildingDataMap, FiredTrap } from "../../types/BuildingData.js";
import { parseTrapPlacements, planTrapRearm, type TrapRearmSave } from "./trapRearm.js";

/** The same 575-building sandbox capture the wall tests run against. */
const FIXTURE = "../../../../web/test/fixtures/baseload-sandbox-yard.json";

interface Fixture {
  buildingdata: BuildingDataMap;
  resources: Record<string, number>;
  storedata: Record<string, unknown>;
  mushrooms: { l: unknown[]; s: number };
}

const loadFixture = (): Fixture =>
  JSON.parse(readFileSync(new URL(FIXTURE, import.meta.url), "utf8"));

const sandbox = (): TrapRearmSave => {
  const fixture = loadFixture();
  return {
    buildingdata: structuredClone(fixture.buildingdata),
    resources: structuredClone(fixture.resources),
    storedata: structuredClone(fixture.storedata),
    mushrooms: structuredClone(fixture.mushrooms),
    firedtraps: [],
  };
};

/** Where a trap of `type` stands in the yard, and its id. */
const trapsOfType = (buildings: BuildingDataMap, type: number) =>
  Object.values(buildings)
    .filter((building) => Number(building.t) === type)
    .map((building) => ({
      id: Number(building.id),
      t: type,
      x: Number(building.X),
      y: Number(building.Y),
    }));

/**
 * Takes `count` traps of `type` off the yard and hands back where they were, as
 * an attack that set them off would.
 */
const fire = (save: TrapRearmSave, type: number, count: number): TrapPlacement[] => {
  const gone = trapsOfType(save.buildingdata!, type).slice(0, count);
  for (const trap of gone) delete save.buildingdata![String(trap.id)];
  return gone.map(({ t, x, y }) => ({ t, x, y }));
};

const rejection = (run: () => unknown): ClientSafeError => {
  try {
    run();
  } catch (err) {
    if (err instanceof ClientSafeError) return err;
    throw err;
  }
  throw new Error("expected planTrapRearm to reject");
};

describe("parseTrapPlacements", () => {
  test("reads a JSON list of placements", () => {
    expect(parseTrapPlacements('[{"t":24,"x":-10,"y":15}]')).toEqual([{ t: 24, x: -10, y: 15 }]);
  });

  test("refuses a missing or unreadable field", () => {
    expect(rejection(() => parseTrapPlacements(undefined)).status).toBe(400);
    expect(rejection(() => parseTrapPlacements("nope")).status).toBe(400);
  });

  test("refuses an empty list", () => {
    expect(rejection(() => parseTrapPlacements("[]")).status).toBe(400);
  });

  test("refuses the wrong shape", () => {
    expect(rejection(() => parseTrapPlacements('[{"t":24}]')).data).toHaveProperty("issues");
  });

  test("refuses more traps than one batch may carry", () => {
    const traps = JSON.stringify(Array.from({ length: 201 }, () => ({ t: 24, x: 0, y: 0 })));
    expect(rejection(() => parseTrapPlacements(traps)).data).toMatchObject({ traps: 201 });
  });

  test("offGrid: a position off the 5-unit grid", () => {
    const err = rejection(() => parseTrapPlacements('[{"t":24,"x":0,"y":0},{"t":24,"x":3,"y":0}]'));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ offGrid: [1] });
  });
});

describe("planTrapRearm over the sandbox yard", () => {
  test("ids continue from the highest the yard holds", () => {
    const save = sandbox();
    const traps = fire(save, 24, 2);

    const plan = planTrapRearm(save, traps);

    // The fixture's highest building id is 600.
    expect(plan.ids).toEqual([601, 602]);
    expect(plan.placed).toBe(2);
  });

  test("a rebuilt trap is finished: no level, no build countdown", () => {
    const save = sandbox();
    const [trap] = fire(save, 24, 1);

    const plan = planTrapRearm(save, [trap!]);

    expect(plan.buildingdata["601"]).toEqual({
      id: 601,
      t: 24,
      X: trap!.x,
      Y: trap!.y,
    } as unknown as BuildingData);
  });

  test("cost and points come from the build step", () => {
    const save = sandbox();
    const booby = fire(save, 24, 2);
    const heavy = fire(save, 117, 1);

    const plan = planTrapRearm(save, [...booby, ...heavy]);

    // Booby Trap costs[0] is 1,000 of each of twigs, pebbles and putty; the
    // Heavy Trap is 50,000 of each.
    expect(plan.cost).toEqual({ r1: 52_000, r2: 52_000, r3: 52_000, r4: 0 });
    // floor(time / 2 + (r1 + r2 + r3 + r4) / 10): 302 per Booby Trap, 15,002
    // for the Heavy Trap (`client/scripts/BFOUNDATION.as:2913-2914`).
    expect(plan.points).toBe(302 * 2 + 15_002);
  });

  test("firedtraps loses only the entries the batch answers", () => {
    const save = sandbox();
    const gone = fire(save, 24, 2);
    const stranger: FiredTrap = { t: 117, X: 0, Y: 0, at: 5 };
    const recorded = (trap: TrapPlacement, at: number): FiredTrap => ({
      t: trap.t,
      X: trap.x,
      Y: trap.y,
      at,
    });
    save.firedtraps = [recorded(gone[0]!, 1), stranger, recorded(gone[1]!, 2)];

    const plan = planTrapRearm(save, [gone[0]!]);

    expect(plan.firedtraps).toHaveLength(2);
    expect(plan.firedtraps).toContainEqual(stranger);
    expect(plan.firedtraps.some((entry) => entry.X === gone[0]!.x && entry.Y === gone[0]!.y)).toBe(
      false
    );
  });

  test("the caller's own buildingdata is left alone", () => {
    const save = sandbox();
    const traps = fire(save, 24, 1);
    const before = structuredClone(save.buildingdata!);

    planTrapRearm(save, traps);

    expect(save.buildingdata).toEqual(before);
  });
});

describe("planTrapRearm rejections", () => {
  test("notTraps: a type that is not 24 or 117", () => {
    const save = sandbox();
    const err = rejection(() => planTrapRearm(save, [{ t: 17, x: 0, y: 0 }]));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ notTraps: [0] });
  });

  test("capReached: the yard is already at quantity[townHallLevel]", () => {
    const save = sandbox();
    // The fixture holds 75 Booby Traps, which is the Town Hall 10 cap.
    const [where] = trapsOfType(save.buildingdata!, 24);

    const err = rejection(() =>
      planTrapRearm(save, [{ t: 24, x: where!.x + 1_000, y: where!.y }])
    );
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ capReached: { type: 24, have: 75, max: 75 } });
  });

  test("townHall: the trap's own prerequisite", () => {
    const save = sandbox();
    const traps = fire(save, 117, 1);
    save.buildingdata!["0"]!.l = 3;

    const err = rejection(() => planTrapRearm(save, traps));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ townHall: { have: 3, need: 4 } });
  });

  test("townHall: a yard with no hall at all", () => {
    const save = sandbox();
    const traps = fire(save, 24, 1);
    delete save.buildingdata!["0"];

    expect(rejection(() => planTrapRearm(save, traps)).data).toMatchObject({
      townHall: { have: 0, need: 1 },
    });
  });

  test("outOfBounds: a position outside the plot the player owns", () => {
    const save = sandbox();
    fire(save, 24, 1);

    const err = rejection(() => planTrapRearm(save, [{ t: 24, x: 10_000, y: 0 }]));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ outOfBounds: [0], expansion: 6 });
  });

  test("overlapping: on top of another building", () => {
    const save = sandbox();
    fire(save, 24, 1);
    const wall = Object.values(save.buildingdata!).find((building) => Number(building.t) === 17)!;

    const err = rejection(() =>
      planTrapRearm(save, [{ t: 24, x: Number(wall.X), y: Number(wall.Y) }])
    );
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ overlapping: [0] });
  });

  test("overlapping: on top of a mushroom", () => {
    const save = sandbox();
    const [trap] = fire(save, 24, 1);
    save.mushrooms = { l: [[0, trap!.x, trap!.y]], s: 1 };

    expect(rejection(() => planTrapRearm(save, [trap!])).data).toMatchObject({ overlapping: [0] });
  });

  test("overlapping: two requested traps on the same spot", () => {
    const save = sandbox();
    const [trap] = fire(save, 24, 2);

    const err = rejection(() => planTrapRearm(save, [trap!, trap!]));
    expect(err.status).toBe(400);
    expect(err.data).toMatchObject({ overlapping: [0, 1] });
  });

  test("two existing buildings overlapping each other are not this route's problem", () => {
    const save = sandbox();
    const [trap] = fire(save, 24, 2);
    const other = Object.values(save.buildingdata!).find((building) => Number(building.t) === 17)!;
    // Drop a decoration straight on top of an existing wall.
    save.buildingdata!["9001"] = {
      id: 9001,
      t: 28,
      X: Number(other.X),
      Y: Number(other.Y),
    } as unknown as BuildingData;

    expect(() => planTrapRearm(save, [trap!])).not.toThrow();
  });

  test("shortfall names only the resources that are short", () => {
    const save = sandbox();
    const traps = fire(save, 24, 2);
    save.resources!.r3 = 500;

    const err = rejection(() => planTrapRearm(save, traps));
    expect(err.status).toBe(409);
    expect(err.data).toMatchObject({ shortfall: { r1: 0, r2: 0, r3: 1_500, r4: 0 } });
  });
});
