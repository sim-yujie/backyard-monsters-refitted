import { afterEach, describe, expect, test } from "bun:test";

import { Terrain } from "../../../enums/MapRoom.js";
import { MAP_HEIGHT, MAP_WIDTH, hexNeighbours, type HexShape } from "../../../game-rules/maproom/range.js";
import { generateNoise, getTerrainHeight } from "./generateMap.js";
import {
  activeRiverEdges,
  buildRiverNetwork,
  cornerCells,
  cornerLinks,
  neighbourIndex,
  riverNetwork,
  type RiverNetwork,
} from "./rivers.js";

/**
 * Map Room 2 rivers (`rivers.ts`, look plan step 7): along cell edges only,
 * never uphill, always ending at water, the same for the same world on every
 * run, on both hex shapes.
 */

const SHAPES: HexShape[] = ["pointy", "flat"];
const WORLDS = ["river-test-world-1", "6f1d2c9e-0b7a-4c55-9a51-3d2f0e8c7b14"];
const CORNERS = MAP_WIDTH * MAP_HEIGHT * 2;

const envWas = { rivers: process.env.MR2_RIVERS, shape: process.env.MR2_HEX_SHAPE };
afterEach(() => {
  if (envWas.rivers === undefined) delete process.env.MR2_RIVERS;
  else process.env.MR2_RIVERS = envWas.rivers;
  if (envWas.shape === undefined) delete process.env.MR2_HEX_SHAPE;
  else process.env.MR2_HEX_SHAPE = envWas.shape;
});

/** Cells sampled across the world, the seams included. */
const sampleCells = (): number[] => {
  const cells: number[] = [];
  for (const x of [0, 1, 2, 57, 398, 399, 400, 798, 799]) {
    for (const y of [0, 1, 2, 131, 398, 399, 400, 798, 799]) cells.push(y * MAP_WIDTH + x);
  }
  return cells;
};

/** The two cells either side of edge `cell * 3 + d`. */
const edgeCells = (edge: number, shape: HexShape): [number, number] => {
  const cell = Math.floor(edge / 3);
  return [cell, neighbourIndex(cell, edge % 3, shape)];
};

describe.each(SHAPES)("the corner graph on %s-top hexes", (shape) => {
  test("a cell's neighbours are the range rules' neighbours", () => {
    for (const cell of sampleCells()) {
      const x = cell % MAP_WIDTH;
      const y = Math.floor(cell / MAP_WIDTH);
      const expected = hexNeighbours(x, y, shape).map((n) => n.y * MAP_WIDTH + n.x);
      expect([0, 1, 2, 3, 4, 5].map((d) => neighbourIndex(cell, d, shape))).toEqual(expected);
    }
  });

  test("corners touch three cells that all touch each other", () => {
    for (const cell of sampleCells()) {
      for (const corner of [cell * 2, cell * 2 + 1]) {
        const [a, b, c] = cornerCells(corner, shape);
        const around = (one: number) => [0, 1, 2, 3, 4, 5].map((d) => neighbourIndex(one, d, shape));
        expect(around(a)).toContain(b);
        expect(around(a)).toContain(c);
        expect(around(b)).toContain(c);
      }
    }
  });

  test("links go both ways along the same edge, and an edge joins two corners it touches", () => {
    const links = [0, 0, 0];
    const edges = [0, 0, 0];
    const back = [0, 0, 0];
    const backEdges = [0, 0, 0];
    for (const cell of sampleCells()) {
      for (const corner of [cell * 2, cell * 2 + 1]) {
        cornerLinks(corner, shape, links, edges);
        expect(new Set(links).size).toBe(3);
        const mine = cornerCells(corner, shape);
        for (let i = 0; i < 3; i++) {
          cornerLinks(links[i]!, shape, back, backEdges);
          const at = back.indexOf(corner);
          expect(at).toBeGreaterThanOrEqual(0);
          expect(backEdges[at]).toBe(edges[i]!);
          // The edge's two cells are the two cells both corners touch.
          const theirs = cornerCells(links[i]!, shape);
          const shared = mine.filter((one) => theirs.includes(one)).sort((p, q) => p - q);
          expect([...edgeCells(edges[i]!, shape)].sort((p, q) => p - q)).toEqual(shared as number[]);
        }
      }
    }
  });
});

/** Every river edge, from the network's `next` links. */
const riverEdges = (network: RiverNetwork): { from: number; to: number; edge: number }[] => {
  const links = [0, 0, 0];
  const edges = [0, 0, 0];
  const found: { from: number; to: number; edge: number }[] = [];
  for (let corner = 0; corner < CORNERS; corner++) {
    const to = network.next[corner]!;
    if (to === -1) continue;
    cornerLinks(corner, network.shape, links, edges);
    const at = links.indexOf(to);
    found.push({ from: corner, to, edge: at === -1 ? -1 : edges[at]! });
  }
  return found;
};

describe.each(SHAPES)("a world's rivers on %s-top hexes", (shape) => {
  const networks = WORLDS.map((world) => riverNetwork(world, shape));

  test("run only along cell edges, between two land cells", () => {
    for (const [index, network] of networks.entries()) {
      const noise = generateNoise(WORLDS[index]!);
      for (const { edge } of riverEdges(network)) {
        expect(edge).toBeGreaterThanOrEqual(0);
        for (const cell of edgeCells(edge, shape)) {
          const x = cell % MAP_WIDTH;
          const y = Math.floor(cell / MAP_WIDTH);
          expect(getTerrainHeight(noise, x, y)).toBeGreaterThan(Terrain.WATER3);
        }
      }
    }
  });

  test("never run uphill", () => {
    for (const network of networks) {
      for (const { from, to } of riverEdges(network)) {
        expect(network.elevation[to]!).toBeLessThanOrEqual(network.elevation[from]!);
      }
    }
  });

  test("every river ends at water, with no loops", () => {
    for (const network of networks) {
      expect(network.sources.length).toBeGreaterThan(0);
      for (const source of network.sources) {
        let at = source;
        let steps = 0;
        while (network.next[at] !== -1 && steps < 10_000) {
          at = network.next[at]!;
          steps += 1;
        }
        expect(steps).toBeGreaterThanOrEqual(1);
        expect(network.water[at]).toBe(1);
      }
    }
  });

  test("the cells' rv holds exactly the river edges, nothing on water", () => {
    for (const [index, network] of networks.entries()) {
      const fromRiver = new Set(riverEdges(network).map(({ edge }) => edge));
      const fromRv = new Set<number>();
      const noise = generateNoise(WORLDS[index]!);
      for (let cell = 0; cell < network.rv.length; cell++) {
        const rv = network.rv[cell]!;
        if (rv === 0) continue;
        expect(getTerrainHeight(noise, cell % MAP_WIDTH, Math.floor(cell / MAP_WIDTH))).toBeGreaterThan(
          Terrain.WATER3,
        );
        expect(rv).toBeLessThan(64);
        for (let d = 0; d < 3; d++) if ((rv >> (2 * d)) & 3) fromRv.add(cell * 3 + d);
      }
      expect(fromRv).toEqual(fromRiver);
    }
  });

  test("get wider downstream", () => {
    for (const network of networks) {
      let widened = 0;
      for (const source of network.sources) {
        const widths: number[] = [];
        const links = [0, 0, 0];
        const edges = [0, 0, 0];
        for (let at = source; network.next[at] !== -1; at = network.next[at]!) {
          cornerLinks(at, shape, links, edges);
          const edge = edges[links.indexOf(network.next[at]!)]!;
          widths.push((network.rv[Math.floor(edge / 3)]! >> (2 * (edge % 3))) & 3);
        }
        for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
        if (widths[widths.length - 1]! > widths[0]!) widened += 1;
      }
      expect(widened).toBeGreaterThan(0);
    }
  });

  test("a few rivers a world: not everywhere, not nowhere", () => {
    for (const network of networks) {
      // Measured: about 2,600 rivers on 800 x 800 cells, about four on a 36 x 27 screen.
      expect(network.sources.length).toBeGreaterThan(1_500);
      expect(network.sources.length).toBeLessThan(4_000);
      let edges = 0;
      for (const rv of network.rv) for (let d = 0; d < 3; d++) if ((rv >> (2 * d)) & 3) edges += 1;
      // Under one cell edge in fifty.
      expect(edges / (MAP_WIDTH * MAP_HEIGHT * 3)).toBeLessThan(0.02);
    }
  });
});

describe("the same rivers every time", () => {
  test("rebuilt from scratch, a world gets the same rivers; another world gets others", () => {
    for (const shape of SHAPES) {
      const first = buildRiverNetwork(WORLDS[0]!, shape);
      expect(buildRiverNetwork(WORLDS[0]!, shape).rv).toEqual(first.rv);
      expect(riverNetwork(WORLDS[1]!, shape).rv).not.toEqual(first.rv);
    }
  });

  test("the two shapes give different rivers for one world", () => {
    expect(riverNetwork(WORLDS[0]!, "pointy").rv).not.toEqual(riverNetwork(WORLDS[0]!, "flat").rv);
  });
});

describe("the MR2_RIVERS switch", () => {
  const riverCell = (shape: HexShape): { x: number; y: number; rv: number } => {
    const { rv } = riverNetwork(WORLDS[0]!, shape);
    const cell = rv.findIndex((value) => value !== 0);
    return { x: cell % MAP_WIDTH, y: Math.floor(cell / MAP_WIDTH), rv: rv[cell]! };
  };

  test("off (the default) sends nothing", () => {
    delete process.env.MR2_RIVERS;
    process.env.MR2_HEX_SHAPE = "pointy";
    const { x, y } = riverCell("pointy");
    expect(activeRiverEdges(WORLDS[0]!, x, y, 150)).toBe(0);
  });

  test("on sends the cell's river edges for the world's shape; never on water", () => {
    process.env.MR2_RIVERS = "on";
    for (const shape of SHAPES) {
      process.env.MR2_HEX_SHAPE = shape;
      const { x, y, rv } = riverCell(shape);
      expect(activeRiverEdges(WORLDS[0]!, x, y, 150)).toBe(rv);
      expect(activeRiverEdges(WORLDS[0]!, x, y, Terrain.WATER3)).toBe(0);
    }
  });
});
