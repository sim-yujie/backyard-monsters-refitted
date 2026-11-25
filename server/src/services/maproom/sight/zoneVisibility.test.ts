import { describe, expect, test } from "bun:test";

import { MAP_HEIGHT, MAP_WIDTH, type HexShape } from "../../../game-rules/maproom/range.js";
import { isVisible, type RevealedCell, type SightSource } from "../../../game-rules/maproom/sight.js";
import { sightNear, zoneCellKey, zoneVisibility } from "./zoneVisibility.js";

/**
 * `zoneVisibility` must give exactly the answers `getarea` gave before it
 * (every cell tested against the whole sight with the shared `isVisible`),
 * on every cell of the world, for an owner-size sight (map-lag diagnosis,
 * 25 Nov 2026: 80 own outposts plus an alliance of 30 owning ~1,400, so
 * ~1,600 circles and ~1,600 always-visible cells), in both hex shapes.
 */

/** Deterministic random numbers, so a failure names the same world every run. */
const seeded = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

const wrapTo = (n: number, size: number): number => ((n % size) + size) % size;

/** An owner-size sight, laid out the way `archive/map-lag/seed.mjs` builds the test world. */
const ownerSizeSight = (seed: number): { sources: SightSource[]; revealed: RevealedCell[] } => {
  const random = seeded(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const sources: SightSource[] = [];
  const revealed: RevealedCell[] = [];
  const base = (cx: number, cy: number, spread: number, reach: number) => {
    const x = wrapTo(cx + int(-spread, spread), MAP_WIDTH);
    const y = wrapTo(cy + int(-spread, spread), MAP_HEIGHT);
    sources.push({ x, y, reach });
    revealed.push({ x, y });
  };

  // The player: home (reach 10, plus Conquest's +1) and 80 outposts round it.
  base(400, 400, 0, 11);
  for (let i = 0; i < 80; i++) base(400, 400, 40, int(0, 5));
  // The alliance union holds the player's own bases a second time (they are a member too).
  const own = sources.length;
  sources.push(...sources.slice(0, own));
  revealed.push(...revealed.slice(0, own));
  // 29 alliance mates, each with a home and 49 outposts round it.
  for (let m = 0; m < 29; m++) {
    const hx = 400 + int(-70, 70);
    const hy = 400 + int(-70, 70);
    base(hx, hy, 0, [0, 5, 7, 9, 11][int(0, 4)]!);
    for (let i = 0; i < 49; i++) base(hx, hy, 30, int(0, 5));
  }
  // Across the world's wrap on both axes and in the corners, the widest reach.
  for (const [x, y] of [[0, 0], [799, 799], [0, 799], [799, 0], [3, 400], [796, 400], [400, 2], [400, 797], [805, -4]]) {
    sources.push({ x: x!, y: y!, reach: 12 });
  }
  // Attackers' bases: single cells anywhere, seams included, some twice.
  for (let i = 0; i < 60; i++) revealed.push({ x: int(0, 799), y: int(0, 799) });
  revealed.push({ x: 0, y: 0 }, { x: 799, y: 799 }, { x: 0, y: 0 }, { x: 799, y: 0 }, { x: 0, y: 799 });

  return { sources, revealed };
};

/** Every zone origin `getarea` accepts on the 10-cell grid the client asks on. */
const ZONE = 10;

const compareEveryCell = (sight: ReturnType<typeof ownerSizeSight>, shape: HexShape) => {
  // The old answer, once per world cell: the whole sight, every cell.
  const before = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      before[x * MAP_HEIGHT + y] = isVisible({ x, y }, sight.sources, sight.revealed, shape) ? 1 : 0;
    }
  }

  let checked = 0;
  let visible = 0;
  const mismatches: string[] = [];
  for (let zx = 0; zx < MAP_WIDTH; zx += ZONE) {
    for (let zy = 0; zy < MAP_HEIGHT; zy += ZONE) {
      const after = zoneVisibility(sight, zx, zy, ZONE, ZONE, shape);
      for (let x = zx; x <= zx + ZONE; x++) {
        for (let y = zy; y <= zy + ZONE; y++) {
          const old = before[wrapTo(x, MAP_WIDTH) * MAP_HEIGHT + wrapTo(y, MAP_HEIGHT)] === 1;
          const now = after.get(zoneCellKey(x, y));
          checked++;
          if (now) visible++;
          if (now !== old && mismatches.length < 10) mismatches.push(`zone ${zx},${zy} cell ${x},${y}: was ${old}, now ${now}`);
        }
      }
    }
  }
  return { checked, visible, mismatches };
};

describe("zoneVisibility", () => {
  const sight = ownerSizeSight(12345);

  test("the seeded sight is owner size", () => {
    expect(sight.sources.length).toBeGreaterThan(1600);
    expect(sight.revealed.length).toBeGreaterThan(1600);
  });

  for (const shape of ["pointy", "flat"] as const) {
    test(
      `matches the whole-sight answer on every cell of the world (${shape})`,
      () => {
        const { checked, visible, mismatches } = compareEveryCell(sight, shape);
        expect(mismatches).toEqual([]);
        // 6,400 zones of 11 x 11 cells, and the sight really lights part of it.
        expect(checked).toBe((MAP_WIDTH / ZONE) * (MAP_HEIGHT / ZONE) * 121);
        expect(visible).toBeGreaterThan(10_000);
        expect(visible).toBeLessThan(checked);
      },
      // ~640,000 whole-sight checks, most of them on fogged cells that test every circle.
      240_000,
    );
  }

  test("keeps a circle that reaches across the world's wrap and drops ones that cannot reach", () => {
    const sources: SightSource[] = [
      { x: 798, y: 5, reach: 3 }, // reaches the zone at 0,0 across the x seam
      { x: 5, y: 797, reach: 4 }, // ... across the y seam
      { x: 100, y: 100, reach: 12 }, // far away
      { x: 6, y: 6, reach: 0 }, // no reach lights nothing
    ];
    const revealed: RevealedCell[] = [{ x: 0, y: 0 }, { x: 799, y: 799 }, { x: 50, y: 50 }];
    const near = sightNear(sources, revealed, 0, 0, 10, 10);
    expect(near.sources).toEqual([sources[0]!, sources[1]!]);
    expect(near.revealed).toEqual([{ x: 0, y: 0 }]);
    // The zone at 790 covers column 800, which wraps to column 0.
    const seam = sightNear(sources, revealed, 790, 790, 10, 10);
    expect(seam.revealed).toEqual([{ x: 0, y: 0 }, { x: 799, y: 799 }]);
  });

  test("answers a zone quickly at owner size", () => {
    for (const shape of ["pointy", "flat"] as const) {
      const zones: Array<[number, number]> = [];
      for (let zx = 300; zx < 500; zx += ZONE) for (let zy = 300; zy < 500; zy += ZONE) zones.push([zx, zy]);
      for (let zx = 500; zx < 700; zx += ZONE) zones.push([zx, 100]);
      zoneVisibility(sight, 400, 400, ZONE, ZONE, shape); // warm up
      const started = performance.now();
      for (const [zx, zy] of zones) zoneVisibility(sight, zx, zy, ZONE, ZONE, shape);
      const perZone = (performance.now() - started) / zones.length;
      // Generous for a slow CI machine; locally it is a few hundredths of a millisecond.
      expect(perZone).toBeLessThan(2);
    }
  });
});
