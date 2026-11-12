import { describe, expect, test } from "bun:test";
import type { Save } from "../../database/models/save.model.js";
import { buildingDataHandler } from "../../controllers/base/save/handlers/buildingDataHandler.js";
import type { BuildingData, BuildingDataMap, FiredTrap } from "../../types/BuildingData.js";
import { liveFiredTraps } from "./firedTraps.js";
import { planTrapRearm } from "./trapRearm.js";

const building = (id: number, t: number, X: number, Y: number, l?: number): BuildingData =>
  ({ id, t, X, Y, ...(l === undefined ? {} : { l }) }) as unknown as BuildingData;

const fired = (t: number, X: number, Y: number, at = 1): FiredTrap => ({ t, X, Y, at });

/** Booby Traps allowed: 20 at Town Hall 4, 28 at 5, 75 at 10. Heavy: 4 at 4. */
const hall = (level: number): BuildingDataMap => ({ "0": building(0, 14, 5, -15, level) });

/** `count` Booby Traps in a row along y = 300, ids from `firstId`. */
const row = (count: number, firstId: number): BuildingDataMap => {
  const traps: BuildingDataMap = {};
  for (let i = 0; i < count; i++) traps[String(firstId + i)] = building(firstId + i, 24, -480 + i * 20, 300);
  return traps;
};

describe("liveFiredTraps", () => {
  test("a fired trap on a free spot, with room for it, stays", () => {
    const save = { buildingdata: hall(10), firedtraps: [fired(24, -300, 300)] };
    expect(liveFiredTraps(save)).toEqual([fired(24, -300, 300)]);
  });

  test("a trap rebuilt by hand on the spot answers the entry", () => {
    const save = {
      buildingdata: { ...hall(10), "9": building(9, 24, -300, 300) },
      firedtraps: [fired(24, -300, 300)],
    };
    expect(liveFiredTraps(save)).toEqual([]);
  });

  test("anything else standing on the spot answers it too", () => {
    const wall = { ...hall(10), "9": building(9, 17, -290, 310) };
    expect(liveFiredTraps({ buildingdata: wall, firedtraps: [fired(24, -300, 300)] })).toEqual([]);
    // A building that only touches the edge leaves the spot free.
    const beside = { ...hall(10), "9": building(9, 17, -280, 300) };
    expect(liveFiredTraps({ buildingdata: beside, firedtraps: [fired(24, -300, 300)] })).toHaveLength(1);
  });

  test("an older entry under a newer one goes, the newer one stays, order kept", () => {
    const list = [fired(24, -300, 300, 1), fired(24, 200, 200, 2), fired(117, -300, 300, 3), fired(24, -300, 300, 4)];
    expect(liveFiredTraps({ buildingdata: hall(10), firedtraps: list })).toEqual([
      fired(24, 200, 200, 2),
      fired(24, -300, 300, 4),
    ]);
  });

  test("no more than the Town Hall leaves room for, newest first", () => {
    // Town Hall 4 allows 20 Booby Traps; 18 stand elsewhere, so 2 can come back.
    const save = {
      buildingdata: { ...hall(4), ...row(18, 100) },
      firedtraps: [fired(24, -300, -300, 1), fired(24, -280, -300, 2), fired(24, -260, -300, 3)],
    };
    expect(liveFiredTraps(save)).toEqual([fired(24, -280, -300, 2), fired(24, -260, -300, 3)]);
  });

  test("a yard at its cap has nothing to put back", () => {
    const save = {
      buildingdata: { ...hall(4), ...row(20, 100) },
      firedtraps: [fired(24, -300, -300), fired(24, -280, -300)],
    };
    expect(liveFiredTraps(save)).toEqual([]);
  });

  test("an outpost counts against the outpost table (25 Booby Traps)", () => {
    const core = { "0": building(0, 112, 5, -15) };
    const save = {
      type: "outpost",
      buildingdata: { ...core, ...row(24, 100) },
      firedtraps: [fired(24, -300, -300, 1), fired(24, -280, -300, 2)],
    };
    expect(liveFiredTraps(save)).toEqual([fired(24, -280, -300, 2)]);
  });

  test("not a trap, or no usable position: dropped", () => {
    const list = [
      fired(17, -300, 300),
      { t: 24, X: Number.NaN, Y: 0, at: 1 },
      null as unknown as FiredTrap,
      fired(24, 200, 200),
    ];
    expect(liveFiredTraps({ buildingdata: hall(10), firedtraps: list })).toEqual([fired(24, 200, 200)]);
  });

  test("an empty or missing list is an empty list", () => {
    expect(liveFiredTraps({ buildingdata: hall(10) })).toEqual([]);
    expect(liveFiredTraps({ buildingdata: hall(10), firedtraps: null })).toEqual([]);
  });

  test("leaves the save alone", () => {
    const list = [fired(24, -300, 300, 1), fired(24, -300, 300, 2)];
    const save = { buildingdata: hall(10), firedtraps: list };
    liveFiredTraps(save);
    expect(save.firedtraps).toBe(list);
    expect(list).toHaveLength(2);
  });
});

describe("player report: 24 traps, rebuilt by hand, re-arm stuck at 41", () => {
  const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

  /** A stand-in for the entity: the handler reads and writes these fields only. */
  const saveOf = (buildingdata: BuildingDataMap, firedtraps: FiredTrap[] = []) =>
    ({ buildingdata, firedtraps, resources: { ...RICH } }) as unknown as Save;

  test("the old list, as live yards hold it, is cleaned and re-arm then works", () => {
    // Town Hall 5 (28 allowed) with 24 Booby Traps. Attack 1 sets them all off;
    // the player rebuilds all 24 by hand on the same spots; attack 2 sets 17 of
    // the new ones off. Before the fix the list held all 41 entries.
    const rebuilt = { ...hall(5), ...row(24, 200) };
    for (let i = 0; i < 17; i++) delete rebuilt[String(200 + i)];
    const oldList = [
      ...Object.values(row(24, 100)).map((trap) => fired(24, Number(trap.X), Number(trap.Y), 1)),
      ...Object.values(row(17, 200)).map((trap) => fired(24, Number(trap.X), Number(trap.Y), 2)),
    ];
    expect(oldList).toHaveLength(41);
    const save = saveOf(rebuilt, oldList);

    const live = liveFiredTraps(save);
    expect(live).toHaveLength(17);
    expect(live.every((entry) => entry.at === 2)).toBe(true);

    // Re-arm with what the planner now offers: all 17 go back, nothing is left.
    const plan = planTrapRearm(save, live.map(({ t, X, Y }) => ({ t, x: X, y: Y })));
    expect(plan.placed).toBe(17);
    expect(plan.firedtraps).toEqual([]);
  });

  test("before the second attack, the hand-built traps answer every entry", () => {
    const save = saveOf({ ...hall(5), ...row(24, 100) });
    buildingDataHandler({ "0": save.buildingdata!["0"] }, save);
    expect(save.firedtraps).toHaveLength(24);

    // Rebuilt by hand (the build route), same spots, new ids.
    save.buildingdata = { ...hall(5), ...row(24, 200) };
    expect(liveFiredTraps(save)).toEqual([]);
  });

  test("traps rebuilt on other spots: the yard is back at 24, so 4 more can come back at most", () => {
    // 24 fired along y = 300; 24 rebuilt along y = -300 instead. 28 allowed.
    const elsewhere: BuildingDataMap = { ...hall(5) };
    for (let i = 0; i < 24; i++) elsewhere[String(200 + i)] = building(200 + i, 24, -480 + i * 20, -300);
    const list = Object.values(row(24, 100)).map((trap, i) => fired(24, Number(trap.X), Number(trap.Y), i));
    const live = liveFiredTraps({ buildingdata: elsewhere, firedtraps: list });
    expect(live).toHaveLength(4);
    // The newest four.
    expect(live.map((entry) => entry.at)).toEqual([20, 21, 22, 23]);
  });
});
