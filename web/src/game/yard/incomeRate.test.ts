import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHealth } from "./buildingArt";
import { rowOf } from "./buildingCosts";
import { incomePerHour } from "./incomeRate";

/** What the player makes an hour (#280): the main yard's harvesters and the outposts' autobank. */

const T0 = 1_800_000_000;

const harvester = (id: number, t: number, overrides: Record<string, unknown> = {}): BuildingData =>
  ({ X: 0, Y: 0, id, t, l: 1, st: 0, pr: 1, ...overrides }) as unknown as BuildingData;

const saveOf = (
  buildings: BuildingData[],
  extra: Partial<BaseLoadResponse> = {},
): Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "storedata" | "buildingresources"> => ({
  buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
  buildinghealthdata: {},
  storedata: {},
  ...extra,
});

/** One harvester's hour at full health, from the props table the game fills buffers with. */
const hourOf = (type: number, level: number): number => {
  const stats = rowOf(type)![6]!;
  return ((stats.produce[level - 1] ?? 0) * 3600) / (stats.cycleTime[level - 1] ?? 1);
};

describe("incomePerHour", () => {
  it("makes 720 twigs an hour from a level 1 Twig Snapper: 2 every 10 s", () => {
    expect(incomePerHour(saveOf([harvester(1, 1)]), T0)).toEqual({ r1: 720, r2: 0, r3: 0, r4: 0 });
  });

  it("adds up a mix of types and levels, each into its own resource", () => {
    const save = saveOf([
      harvester(1, 1, { l: 3 }),
      harvester(2, 1, { l: 5 }),
      harvester(3, 2, { l: 4 }),
      harvester(4, 3, { l: 2 }),
      harvester(5, 4, { l: 6 }),
      harvester(6, 14, { l: 2 }), // a Town Hall makes nothing
    ]);
    expect(incomePerHour(save, T0)).toEqual({
      r1: Math.round(hourOf(1, 3) + hourOf(1, 5)),
      r2: Math.round(hourOf(2, 4)),
      r3: Math.round(hourOf(3, 2)),
      r4: Math.round(hourOf(4, 6)),
    });
  });

  it("leaves out a harvester being built, upgraded or fortified, or under half health", () => {
    const max = maxHealth(1, 1)!;
    const save = saveOf(
      [
        harvester(1, 1),
        harvester(2, 1, { cB: 100 }),
        harvester(3, 1, { cU: 100 }),
        harvester(4, 1, { cF: 100 }),
        harvester(5, 1),
      ],
      { buildinghealthdata: { "5": max / 2 - 1 } },
    );
    expect(incomePerHour(save, T0).r1).toBe(720);
  });

  it("slows a damaged harvester as its buffer does: at 3/4 health a cycle takes twice as long", () => {
    const max = maxHealth(1, 1)!;
    const save = saveOf([harvester(1, 1)], { buildinghealthdata: { "1": (max * 3) / 4 } });
    expect(incomePerHour(save, T0).r1).toBe(360);
  });

  it("counts a full buffer: the figure is what the harvester makes while it is banked", () => {
    expect(incomePerHour(saveOf([harvester(1, 1, { st: 720 })]), T0).r1).toBe(720);
  });

  it("adds the outposts' autobank, 360 ticks an hour of the rates the server wrote", () => {
    const save = saveOf([harvester(1, 1)], {
      buildingresources: { t: T0 - 5, b1234: { r1: 10, r2: 4, r3: 0, r4: 1 }, b99: { r1: 2, r2: 0, r3: 3, r4: 0 } },
    });
    expect(incomePerHour(save, T0)).toEqual({ r1: 720 + 12 * 360, r2: 4 * 360, r3: 3 * 360, r4: 360 });
  });

  it("counts no outposts the server pays nothing for yet: no `t` on record", () => {
    const save = saveOf([], { buildingresources: { b1234: { r1: 10, r2: 4, r3: 0, r4: 1 } } });
    expect(incomePerHour(save, T0)).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  it("doubles both while Production Overdrive runs, and not after it ends", () => {
    const save = saveOf([harvester(1, 1)], {
      buildingresources: { t: T0, b1: { r1: 1, r2: 0, r3: 0, r4: 0 } },
      storedata: { POD: { q: 1, e: T0 + 60 } },
    });
    expect(incomePerHour(save, T0).r1).toBe(2 * (720 + 360));
    expect(incomePerHour(save, T0 + 61).r1).toBe(720 + 360);
  });
});
