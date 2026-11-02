import { describe, expect, mock, test } from "bun:test";

import { MapRoomCell, Terrain } from "../../../enums/MapRoom.js";

const found: unknown[] = [];
const queries: unknown[] = [];
mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      find: async (_entity: unknown, where: unknown) => {
        queries.push(where);
        return found;
      },
    },
  },
}));

const { friendlyNeighbourCount, loadFriendlyNeighbourCount, mr2NeighbourCoords } = await import(
  "./neighbourDefence.js"
);
const { mr2NeighbourBonusEnabled } = await import("../../../config/MapRoom2Config.js");

const LAND = Terrain.LAND2;
const land = () => LAND;
const key = (cells: Array<{ x: number; y: number }>) => cells.map(({ x, y }) => `${x},${y}`).sort();

describe("MR2_NEIGHBOUR_BONUS", () => {
  test("is off unless on or true", () => {
    expect(mr2NeighbourBonusEnabled({})).toBe(false);
    expect(mr2NeighbourBonusEnabled({ MR2_NEIGHBOUR_BONUS: "off" })).toBe(false);
    expect(mr2NeighbourBonusEnabled({ MR2_NEIGHBOUR_BONUS: "yes" })).toBe(false);
    expect(mr2NeighbourBonusEnabled({ MR2_NEIGHBOUR_BONUS: "on" })).toBe(true);
    expect(mr2NeighbourBonusEnabled({ MR2_NEIGHBOUR_BONUS: " TRUE " })).toBe(true);
  });
});

describe("mr2NeighbourCoords", () => {
  test("an even column's side neighbours are on its row and the row above", () => {
    expect(key(mr2NeighbourCoords(10, 20))).toEqual(
      key([
        { x: 10, y: 19 },
        { x: 10, y: 21 },
        { x: 9, y: 20 },
        { x: 11, y: 20 },
        { x: 9, y: 19 },
        { x: 11, y: 19 },
      ])
    );
  });

  test("an odd column's side neighbours are on its row and the row below", () => {
    expect(key(mr2NeighbourCoords(11, 20))).toEqual(
      key([
        { x: 11, y: 19 },
        { x: 11, y: 21 },
        { x: 10, y: 20 },
        { x: 12, y: 20 },
        { x: 10, y: 21 },
        { x: 12, y: 21 },
      ])
    );
  });

  test("agrees with the takeover's adjacency both ways", async () => {
    const { isAdjacentToMainYard } = await import("./takeoverCost.js");
    for (const [x, y] of [[10, 20], [11, 20], [400, 401]] as const) {
      for (const cell of mr2NeighbourCoords(x, y)) {
        expect(isAdjacentToMainYard(x, y, cell.x, cell.y)).toBe(true);
        expect(isAdjacentToMainYard(cell.x, cell.y, x, y)).toBe(true);
      }
    }
  });

  test("wraps round the world's edges", () => {
    const around = mr2NeighbourCoords(0, 0);
    expect(around.every(({ x, y }) => x >= 0 && x < 800 && y >= 0 && y < 800)).toBe(true);
    expect(key(around)).toContain("799,799");
    expect(key(around)).toContain("0,799");
  });
});

describe("a wild monster camp", () => {
  const camp = { x: 10, y: 20, uid: 0, base_type: MapRoomCell.WM };

  test("has one same-tribe neighbour on open land: the side cell whose x + y matches", () => {
    // Even column 10: (11, 19) has the same x + y, so the same tribe.
    expect(friendlyNeighbourCount(camp, [], land)).toBe(1);
    // Odd column 11: (10, 21).
    expect(friendlyNeighbourCount({ ...camp, x: 11 }, [], land)).toBe(1);
  });

  test("loses it to water", () => {
    const heightAt = (x: number, y: number) => (x === 11 && y === 19 ? Terrain.WATER2 : LAND);
    expect(friendlyNeighbourCount(camp, [], heightAt)).toBe(0);
  });

  test("loses it to a player who holds that cell", () => {
    const taken = [{ x: 11, y: 19, uid: 7, base_type: MapRoomCell.OUTPOST, terrainHeight: LAND }];
    expect(friendlyNeighbourCount(camp, taken, land)).toBe(0);
  });

  test("keeps it when the cell's stored row is another camp", () => {
    const stored = [{ x: 11, y: 19, uid: 0, base_type: MapRoomCell.WM, terrainHeight: LAND }];
    expect(friendlyNeighbourCount(camp, stored, () => Terrain.WATER1)).toBe(1);
  });
});

describe("a player's cell", () => {
  const outpost = { x: 10, y: 20, uid: 7, base_type: MapRoomCell.OUTPOST };

  test("counts that player's own main yard and outposts around it", () => {
    const stored = [
      { x: 10, y: 19, uid: 7, base_type: MapRoomCell.HOMECELL },
      { x: 10, y: 21, uid: 7, base_type: MapRoomCell.OUTPOST },
      { x: 9, y: 20, uid: 8, base_type: MapRoomCell.OUTPOST },
      { x: 11, y: 20, uid: 0, base_type: MapRoomCell.WM },
      // Not a neighbour: two rows down.
      { x: 10, y: 22, uid: 7, base_type: MapRoomCell.OUTPOST },
    ];
    expect(friendlyNeighbourCount(outpost, stored, land)).toBe(2);
  });

  test("counts six when ringed by its own cells, and no camps", () => {
    const stored = mr2NeighbourCoords(10, 20).map(({ x, y }) => ({ x, y, uid: 7, base_type: MapRoomCell.OUTPOST }));
    expect(friendlyNeighbourCount({ ...outpost, base_type: MapRoomCell.HOMECELL }, stored, land)).toBe(6);
    expect(friendlyNeighbourCount(outpost, [], land)).toBe(0);
  });
});

describe("loadFriendlyNeighbourCount", () => {
  test("asks for the six cells of this world's Map Room 2 and counts what comes back", async () => {
    found.length = 0;
    queries.length = 0;
    found.push({ x: 10, y: 19, uid: 7, base_type: MapRoomCell.HOMECELL, terrainHeight: LAND });
    const count = await loadFriendlyNeighbourCount({ x: 10, y: 20, uid: 7, base_type: MapRoomCell.OUTPOST }, "w-1");
    expect(count).toBe(1);
    const where = queries[0] as { $and: Array<Record<string, unknown>> };
    expect(where.$and).toContainEqual({ map_version: 2 });
    expect(where.$and).toContainEqual({ world: "w-1" });
    expect((where.$and[0]!.$or as unknown[]).length).toBe(6);
  });
});
