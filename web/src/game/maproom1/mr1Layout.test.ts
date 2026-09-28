import { describe, expect, it } from "vitest";
import { centreOn, clampScroll, layoutPlayers, MAP_SIZE, tribeSpot } from "./mr1Layout";
import { TRIBES } from "./tribes";

describe("layoutPlayers", () => {
  it("puts you on the Flash grid from your base id and seed", () => {
    // 1 + 3 % 15 = 4 across, 1 + 5 % 15 = 6 down, nudged 3 px across.
    const { own } = layoutPlayers({ baseid: "3", seed: 5 }, []);
    expect(own).toEqual({ x: 130 + 85 * 4 + 3, y: 130 + 85 * 6 });
  });

  it("spreads players with no seed over rows instead of piling them on row 1", () => {
    const neighbours = Array.from({ length: 12 }, (_, index) => ({
      key: `p${index}`,
      baseid: String(5000 + index * 37),
      seed: 0,
    }));
    const { neighbours: spots } = layoutPlayers({ baseid: "7", seed: 0 }, neighbours);
    const rows = new Set([...spots.values()].map((spot) => Math.floor((spot.y - 130) / 85)));
    expect(rows.size).toBeGreaterThan(4);
  });

  it("keeps the cells either side of a player empty while the map has room", () => {
    const neighbours = Array.from({ length: 20 }, (_, index) => ({
      key: `p${index}`,
      baseid: String(3 + index * 15),
      seed: 5,
    }));
    const { own, neighbours: spots } = layoutPlayers({ baseid: "3", seed: 5 }, neighbours);
    const cells = [own, ...spots.values()].map((spot) => [
      Math.floor((spot.x - 130) / 85),
      Math.floor((spot.y - 130) / 85),
    ]);
    const taken = new Set(cells.map(([col, row]) => `${col},${row}`));
    for (const [col, row] of cells) {
      expect(taken.has(`${col! + 1},${row}`)).toBe(false);
    }
  });

  it("is stable and never stacks two players on one cell", () => {
    const neighbours = Array.from({ length: 40 }, (_, index) => ({
      key: `p${index}`,
      baseid: String(1000 + index * 15),
      seed: 7,
    }));
    const first = layoutPlayers({ baseid: "1000", seed: 7 }, neighbours);
    const again = layoutPlayers({ baseid: "1000", seed: 7 }, neighbours);
    expect([...again.neighbours]).toEqual([...first.neighbours]);
    expect(first.neighbours.size).toBe(40);
    const cells = new Set(
      [first.own, ...first.neighbours.values()].map(
        (spot) => `${Math.floor((spot.x - 130) / 85)},${Math.floor((spot.y - 130) / 85)}`,
      ),
    );
    expect(cells.size).toBe(41);
  });

  it("keeps everyone on the map and out of the tribes' rectangles", () => {
    const neighbours = Array.from({ length: 120 }, (_, index) => ({
      key: `p${index}`,
      baseid: String(index * 7 + 3),
      seed: index * 11,
    }));
    const { neighbours: spots } = layoutPlayers({ baseid: "1", seed: 1 }, neighbours);
    for (const spot of spots.values()) {
      expect(spot.x).toBeGreaterThan(0);
      expect(spot.x).toBeLessThan(MAP_SIZE);
      expect(spot.y).toBeLessThan(MAP_SIZE);
      const cellX = spot.x - ((spot.x - 130) % 85);
      const cellY = spot.y - ((spot.y - 130) % 85);
      for (const {
        spot: [left, top, width, height],
      } of TRIBES) {
        const overlaps =
          cellX < left + width && cellX + 85 > left && cellY < top + height && cellY + 85 > top;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("reads a base id too long for a number without throwing", () => {
    const { own } = layoutPlayers({ baseid: "98765432109876543210", seed: 0 }, []);
    expect(Number.isFinite(own.x)).toBe(true);
  });
});

describe("tribeSpot", () => {
  it("is the middle of the tribe's reserved rectangle", () => {
    expect(tribeSpot({ tribe: "kozu" })).toEqual({ x: 605 + 93, y: 478 + 87 });
  });
});

describe("scrolling", () => {
  it("clamps inside the map and centres a small map", () => {
    expect(clampScroll({ x: -50, y: 5000 }, { width: 700, height: 400 })).toEqual({
      x: 0,
      y: MAP_SIZE - 400,
    });
    expect(clampScroll({ x: 10, y: 10 }, { width: 2000, height: 400 }).x).toBe(-120);
    expect(centreOn({ x: 880, y: 880 }, { width: 800, height: 600 })).toEqual({
      x: 480,
      y: 580,
    });
  });
});
