import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GetAreaResponse, MapCell, PlayerCell, WildMonsterCell } from "@/api/types";
import {
  attackRefusal,
  cellDistance,
  cellReach,
  hasAnythingToSend,
  mainYardReach,
  outpostReach,
  ownCellsIn,
  rosterInRange,
  targetKind,
} from "./attackEntry";

/** A real area response around the first seeded player's home cell. */
const area = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../test/fixtures/getarea-710-347.json", import.meta.url)),
    "utf8",
  ),
) as GetAreaResponse;

const NOW = 1_790_000_000;

const playerCell = (overrides: Partial<PlayerCell> = {}): PlayerCell => ({
  uid: 7,
  b: 2,
  i: 150,
  bid: "22222710347",
  aid: null,
  n: "someone",
  l: 20,
  v: 100,
  f: 0,
  c: 0,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 0,
  pic_square: null,
  pi: 0,
  fr: 0,
  ...overrides,
});

const ownCell = (col: number, row: number, overrides: Partial<PlayerCell> = {}) => ({
  col,
  row,
  cell: playerCell({ mine: 1, uid: 1, f: 4, m: { housed: { C1: 10, C4: 2 } }, ...overrides }),
});

const camp: WildMonsterCell = { uid: 0, b: 1, i: 140, bid: "21970243208", n: "Abunakki", l: 30, dm: 0, d: 0 };

const champion = (hp: number, status = 0) => ({ t: 5, hp, l: 5, ft: 0, fd: 0, fb: 0, pl: 2, status });

describe("reach tables", () => {
  it("match the server's main-yard ladder", () => {
    expect([0, 1, 2, 3, 4, 5].map(mainYardReach)).toEqual([0, 4, 6, 8, 10, 10]);
  });

  it("match the server's outpost ladder", () => {
    expect([0, 1, 2, 3, 4, 5].map(outpostReach)).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it("add Declare War's two cells to any non-zero reach, as the server does", () => {
    expect(cellReach(playerCell({ f: 1 }))).toBe(6);
    expect(cellReach(playerCell({ b: 3, f: 1 }))).toBe(3);
    expect(cellReach(playerCell({ f: 0 }))).toBe(0);
  });
});

describe("cellDistance", () => {
  it("is the larger of the two axis distances", () => {
    expect(cellDistance({ col: 10, row: 10 }, { col: 13, row: 11 })).toBe(3);
  });

  it("wraps around the toroidal world", () => {
    expect(cellDistance({ col: 1, row: 1 }, { col: 798, row: 799 })).toBe(3);
  });
});

describe("rosterInRange", () => {
  it("sums the housed monsters of every own cell that reaches the target", () => {
    const roster = rosterInRange(
      { col: 100, row: 100 },
      [ownCell(95, 100), ownCell(104, 96, { m: { housed: { C1: 5 } } })],
      null,
    );
    expect(roster.monsters).toEqual({ C1: 15, C4: 2 });
    expect(roster.flingerLevel).toBe(4);
  });

  it("ignores an own cell whose flinger falls short", () => {
    // Main yard at level 1 reaches 4 + 2 = 6; this one is 7 away.
    const roster = rosterInRange({ col: 100, row: 100 }, [ownCell(107, 100, { f: 1 })], null);
    expect(roster.monsters).toEqual({});
    expect(roster.flingerLevel).toBe(0);
  });

  it("ignores a zero-level flinger even next door", () => {
    const roster = rosterInRange({ col: 100, row: 100 }, [ownCell(101, 100, { f: 0 })], null);
    expect(roster.flingerLevel).toBe(0);
  });

  it("takes champions, levels and the catapult from the own-yard load", () => {
    const roster = rosterInRange({ col: 100, row: 100 }, [ownCell(100, 101)], {
      champion: [champion(100)],
      academy: { C1: { level: 6 }, C4: { level: 3 } },
      catapult: 2,
    });
    expect(roster.champions).toEqual([champion(100)]);
    expect(roster.levels).toEqual({ C1: 6, C4: 3 });
    expect(roster.catapultLevel).toBe(2);
  });

  it("drops non-positive and non-numeric counts", () => {
    const roster = rosterInRange(
      { col: 100, row: 100 },
      [ownCell(100, 101, { m: { housed: { C1: 0, C2: -1, C3: "x", C4: 1 } } })],
      null,
    );
    expect(roster.monsters).toEqual({ C4: 1 });
  });

  it("keeps each contributing cell's whole housing blob as a source, ordered by base id", () => {
    const outpostHousing = { housed: { C1: 5 }, hid: [7], space: 900, hcc: [], h: [], hstage: [0] };
    const mainHousing = { housed: { C1: 10, C4: 2 }, hid: [1, 2], space: 2160 };
    const roster = rosterInRange(
      { col: 100, row: 100 },
      [
        ownCell(104, 96, { b: 3, bid: "9002", m: outpostHousing }),
        ownCell(95, 100, { bid: "3502", m: mainHousing }),
      ],
      null,
    );
    expect(roster.sources).toEqual([
      { baseid: "3502", m: mainHousing },
      { baseid: "9002", m: outpostHousing },
    ]);
    // Verbatim, not reduced to `housed`: the save writes `m` back whole.
    expect(roster.sources?.[1]?.m).toBe(outpostHousing);
  });

  it("leaves out of range cells and cells without housing out of the sources", () => {
    const roster = rosterInRange(
      { col: 100, row: 100 },
      [
        ownCell(107, 100, { f: 1, bid: "far" }),
        { col: 101, row: 100, cell: playerCell({ mine: 1, uid: 1, f: 4, bid: "bare" }) },
        ownCell(100, 101, { bid: "near" }),
      ],
      null,
    );
    expect((roster.sources ?? []).map((source) => source.baseid)).toEqual(["near"]);
  });

  it("carries the siege inventory from the own-yard load, and null when there is none", () => {
    const siege = { decoy: { quantity: 2 }, jars: { quantity: 1 } };
    const cells = [ownCell(100, 101)];
    expect(rosterInRange({ col: 100, row: 100 }, cells, { siege }).siege).toBe(siege);
    expect(rosterInRange({ col: 100, row: 100 }, cells, { siege: null }).siege).toBeNull();
    expect(rosterInRange({ col: 100, row: 100 }, cells, {}).siege).toBeNull();
    expect(rosterInRange({ col: 100, row: 100 }, cells, null).siege).toBeNull();
  });
});

describe("hasAnythingToSend", () => {
  const base = {
    monsters: {},
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
  };

  it("is true with a monster", () => {
    expect(hasAnythingToSend({ ...base, monsters: { C1: 1 } })).toBe(true);
  });

  it("is true with a healthy champion and false with a dead or frozen one", () => {
    expect(hasAnythingToSend({ ...base, champions: [champion(1)] })).toBe(true);
    expect(hasAnythingToSend({ ...base, champions: [champion(0)] })).toBe(false);
    expect(hasAnythingToSend({ ...base, champions: [champion(10, 1)] })).toBe(false);
  });
});

describe("attackRefusal", () => {
  const armed = {
    monsters: { C1: 5 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
  };
  const unarmed = { ...armed, monsters: {} };
  const outOfRange = { ...armed, flingerLevel: 0 };

  it("allows a wild monster camp in range with monsters to send", () => {
    expect(attackRefusal(camp, armed, NOW)).toBeNull();
  });

  it("allows another player's unprotected yard", () => {
    expect(attackRefusal(playerCell(), armed, NOW)).toBeNull();
  });

  it("refuses while the zone is loading", () => {
    expect(attackRefusal(undefined, armed, NOW)).toMatch(/load/);
  });

  it("refuses water", () => {
    const water: MapCell = { i: 40 };
    expect(attackRefusal(water, armed, NOW)).toMatch(/Water/);
  });

  it("refuses the player's own cell", () => {
    expect(attackRefusal(playerCell({ mine: 1 }), armed, NOW)).toMatch(/your own/);
  });

  it("refuses a protected yard", () => {
    expect(attackRefusal(playerCell({ p: 1 }), armed, NOW)).toMatch(/protection/);
  });

  it("refuses an active truce and ignores an expired one", () => {
    expect(attackRefusal(playerCell({ t: NOW + 60 }), armed, NOW)).toMatch(/truce/);
    expect(attackRefusal(playerCell({ t: NOW - 60 }), armed, NOW)).toBeNull();
  });

  it("refuses when no flinger reaches the cell", () => {
    expect(attackRefusal(camp, outOfRange, NOW)).toMatch(/reach/);
  });

  it("refuses when there is nothing to send", () => {
    expect(attackRefusal(camp, unarmed, NOW)).toMatch(/no monsters/);
  });
});

describe("ownCellsIn and targetKind", () => {
  it("finds the one own cell in the seeded area response", () => {
    const own = ownCellsIn([{ data: area.data }]);
    expect(own.map((entry) => [entry.col, entry.row, entry.cell.bid])).toEqual([[710, 347, "1000"]]);
  });

  it("names the load mode family a cell takes", () => {
    expect(targetKind(camp)).toBe("wild");
    expect(targetKind(playerCell())).toBe("main");
    expect(targetKind(playerCell({ b: 3 }))).toBe("outpost");
    expect(targetKind({ i: 10 })).toBeNull();
  });
});
