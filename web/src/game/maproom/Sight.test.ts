import { afterEach, describe, expect, it, vi } from "vitest";
import { Sight } from "./Sight";
import type { RevealedSightCell, SightResponse, SightSource } from "@/api/types";
import { setHexShape } from "@/game/HexGrid";
import { ZONE_COLUMNS, ZONE_ROWS, type ZoneRef } from "./zones";

/**
 * The client's fog of war sight cache (issue #331): whether a cell or a zone
 * is inside it, and when a `/worldmapv2/sight` refetch is owed.
 */

const response = (over: Partial<SightResponse> = {}): SightResponse => ({
  error: 0,
  sv: "v1",
  sources: [{ x: 101, y: 101, reach: 6, kind: "own" }],
  revealed: [{ x: 500, y: 500 }],
  ...over,
});

describe("Sight", () => {
  it("sees nothing and answers every zone fogged before the first fetch lands", () => {
    const sight = new Sight({ fetcher: vi.fn() });

    expect(sight.loaded).toBe(false);
    expect(sight.isCellVisible(101, 101)).toBe(false);
    // Fetching normally until sight loads matters more than fog accuracy for
    // the opening frame: a zone is never reported fogged before then.
    expect(sight.isZoneFullyFogged({ id: 0, originX: 100, originY: 100 })).toBe(false);
  });

  it("sees a cell inside an own circle, and one only reachable through a revealed cell", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    expect(sight.isCellVisible(101, 102)).toBe(true); // 1 step from the source
    expect(sight.isCellVisible(500, 500)).toBe(true); // revealed
    expect(sight.isCellVisible(400, 400)).toBe(false);
  });

  it("reports a zone fully outside every circle and reveal as fully fogged", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    // Zone 400..410, nowhere near the one source (reach 6 around 101,101) or
    // the one reveal (500,500).
    expect(sight.isZoneFullyFogged({ id: 0, originX: 400, originY: 400 })).toBe(true);
  });

  it("reports a zone touching a circle as not fully fogged", async () => {
    const sight = new Sight({ fetcher: async () => response() });
    await sight.refresh();

    // Zone 100..110 covers the source cell itself.
    expect(sight.isZoneFullyFogged({ id: 0, originX: 100, originY: 100 })).toBe(false);
  });

  it("refresh fires onChange only when sv actually moved", async () => {
    const onChange = vi.fn();
    let current = response({ sv: "v1" });
    const sight = new Sight({ fetcher: async () => current, onChange });

    await sight.refresh();
    expect(onChange).toHaveBeenCalledTimes(1);

    await sight.refresh(); // same sv again
    expect(onChange).toHaveBeenCalledTimes(1);

    current = response({ sv: "v2" });
    await sight.refresh();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("syncVersion is a no-op for an unchanged or missing sv, and refetches when it moved", async () => {
    const fetcher = vi.fn(async () => response({ sv: "v1" }));
    const sight = new Sight({ fetcher });
    await sight.refresh();
    fetcher.mockClear();

    await sight.syncVersion(undefined);
    await sight.syncVersion("v1");
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(response({ sv: "v2" }));
    await sight.syncVersion("v2");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sight.sv).toBe("v2");
  });

  it("keeps the sight it holds when a fetch fails, and never rejects (the map calls it with void)", async () => {
    const fetcher = vi.fn(async () => response({ sv: "v1" }));
    const onChange = vi.fn();
    const sight = new Sight({ fetcher, onChange });
    await sight.refresh();
    onChange.mockClear();

    fetcher.mockRejectedValueOnce(new Error("offline"));
    await expect(sight.refresh()).resolves.toBeUndefined();
    fetcher.mockRejectedValueOnce(new Error("timeout"));
    await expect(sight.syncVersion("v2")).resolves.toBeUndefined();

    expect(sight.sv).toBe("v1");
    expect(sight.loaded).toBe(true);
    expect(sight.isCellVisible(101, 101)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();

    // The next sv that disagrees asks again, and lands.
    fetcher.mockResolvedValueOnce(response({ sv: "v2" }));
    await sight.syncVersion("v2");
    expect(sight.sv).toBe("v2");
  });

  it("stays unloaded when the very first fetch fails, so zones are still fetched", async () => {
    const sight = new Sight({ fetcher: async () => Promise.reject(new Error("offline")) });
    await sight.refresh();
    expect(sight.loaded).toBe(false);
    expect(sight.isZoneFullyFogged({ id: 0, originX: 700, originY: 700 })).toBe(false);
  });
});

/**
 * The zone lookup behind `isZoneFullyFogged` (the MR2 zoom-out lag fix, 15 Nov
 * 2026) must answer exactly as the per-cell scan it replaced: a zone wrongly
 * called fogged is never fetched, so a player would never see what is there.
 * Compared over many random sights, weighted towards the world's wrapping
 * edges and the zone edges where the 11 x 11 covers overlap.
 */
describe("Sight zone lookup matches the per-cell scan", () => {
  afterEach(() => {
    setHexShape("flat");
  });

  /** A small seeded generator, so a failure always replays the same way. */
  const generator = (seed: number) => {
    let a = seed >>> 0;
    const next = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
    const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!;
    return { next, int, pick };
  };

  // World edges (both parities), the wrap seam and zone edges.
  const EDGE_COORDS = [0, 1, 2, 3, 8, 9, 10, 11, 19, 20, 21, 399, 400, 401, 789, 790, 791, 796, 797, 798, 799];
  // Coordinates the server should never send, kept in to prove the lookup is
  // exact for any whole cell, not only well-formed ones.
  const ODD_COORDS = [-1, -11, 800, 801, 810];

  const coord = (rng: ReturnType<typeof generator>, allowOdd: boolean): number => {
    const roll = rng.next();
    if (allowOdd && roll < 0.04) return rng.pick(ODD_COORDS);
    if (roll < 0.5) return rng.pick(EDGE_COORDS);
    return rng.int(0, 799);
  };

  const randomSight = (rng: ReturnType<typeof generator>, maxSources: number): SightResponse => {
    const sources: SightSource[] = [];
    for (let i = rng.int(1, maxSources); i > 0; i--) {
      const roll = rng.next();
      const reach = roll < 0.08 ? 0 : roll < 0.16 ? rng.int(1, 11) + 0.5 : rng.int(1, 12);
      sources.push({ x: coord(rng, true), y: coord(rng, true), reach, kind: rng.next() < 0.5 ? "own" : "ally" });
    }
    const revealed: RevealedSightCell[] = [];
    for (let i = rng.int(0, 4); i > 0; i--) {
      revealed.push(rng.next() < 0.1 ? { x: 800, y: coord(rng, false) } : { x: coord(rng, false), y: coord(rng, false) });
    }
    return { error: 0, sv: `r${rng.next()}`, sources, revealed };
  };

  const zoneAt = (zx: number, zy: number): ZoneRef => {
    const x = ((zx % ZONE_COLUMNS) + ZONE_COLUMNS) % ZONE_COLUMNS;
    const y = ((zy % ZONE_ROWS) + ZONE_ROWS) % ZONE_ROWS;
    return { id: x * 10000 + y, originX: x * 10, originY: y * 10 };
  };

  /** Zones within two zones of every source and reveal (wrapping), plus a random few. */
  const zonesNear = (rng: ReturnType<typeof generator>, sight: SightResponse): ZoneRef[] => {
    const zones = new Map<number, ZoneRef>();
    const around = (x: number, y: number) => {
      const zx = Math.floor(x / 10);
      const zy = Math.floor(y / 10);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const zone = zoneAt(zx + dx, zy + dy);
          zones.set(zone.id, zone);
        }
      }
    };
    for (const cell of [...sight.sources, ...sight.revealed]) around(cell.x, cell.y);
    for (let i = 0; i < 20; i++) {
      const zone = zoneAt(rng.int(0, ZONE_COLUMNS - 1), rng.int(0, ZONE_ROWS - 1));
      zones.set(zone.id, zone);
    }
    return [...zones.values()];
  };

  const loadedSight = async (response: SightResponse): Promise<Sight> => {
    const sight = new Sight({ fetcher: async () => response });
    await sight.refresh();
    return sight;
  };

  for (const shape of ["flat", "pointy"] as const) {
    it(`agrees on every zone near 500 random ${shape} sights`, async () => {
      setHexShape(shape);
      const rng = generator(shape === "flat" ? 331 : 332);
      let compared = 0;
      let fogged = 0;
      for (let setup = 0; setup < 500; setup++) {
        const response = randomSight(rng, 4);
        const sight = await loadedSight(response);
        for (const zone of zonesNear(rng, response)) {
          const scan = sight.isZoneFullyFoggedByScan(zone);
          const lookup = sight.isZoneFullyFogged(zone);
          if (lookup !== scan) {
            throw new Error(
              `zone ${zone.originX},${zone.originY}: lookup ${lookup}, scan ${scan}, sight ${JSON.stringify(response)}`,
            );
          }
          compared++;
          if (scan) fogged++;
        }
      }
      // Both answers turn up often, so the comparison is not one-sided.
      expect(compared).toBeGreaterThan(50_000);
      expect(fogged).toBeGreaterThan(5_000);
      expect(compared - fogged).toBeGreaterThan(5_000);
    }, 60_000); // a few seconds alone; the scan it checks against is the slow part

    it(`agrees on all ${ZONE_COLUMNS * ZONE_ROWS} zones of a few ${shape} sights`, async () => {
      setHexShape(shape);
      const rng = generator(shape === "flat" ? 4331 : 4332);
      for (let setup = 0; setup < 4; setup++) {
        const response = randomSight(rng, 2);
        const sight = await loadedSight(response);
        for (let zx = 0; zx < ZONE_COLUMNS; zx++) {
          for (let zy = 0; zy < ZONE_ROWS; zy++) {
            const zone = zoneAt(zx, zy);
            expect(sight.isZoneFullyFogged(zone), `zone ${zx},${zy} of ${JSON.stringify(response)}`).toBe(
              sight.isZoneFullyFoggedByScan(zone),
            );
          }
        }
      }
    }, 60_000);
  }

  it("lights the far zones across the world's wrap from a source on the edge", async () => {
    const sight = await loadedSight(response({ sources: [{ x: 0, y: 0, reach: 4, kind: "own" }], revealed: [] }));

    expect(sight.isZoneFullyFogged(zoneAt(0, 0))).toBe(false);
    expect(sight.isZoneFullyFogged(zoneAt(79, 0))).toBe(false); // columns 796..799 and 800
    expect(sight.isZoneFullyFogged(zoneAt(0, 79))).toBe(false);
    expect(sight.isZoneFullyFogged(zoneAt(79, 79))).toBe(false);
    expect(sight.isZoneFullyFogged(zoneAt(40, 40))).toBe(true);
  });

  it("follows a new sight after refresh, and a change of hex shape", async () => {
    let current = response({ sv: "v1", sources: [{ x: 105, y: 105, reach: 3, kind: "own" }], revealed: [] });
    const sight = new Sight({ fetcher: async () => current });
    await sight.refresh();
    expect(sight.isZoneFullyFogged(zoneAt(10, 10))).toBe(false);
    expect(sight.isZoneFullyFogged(zoneAt(30, 30))).toBe(true);

    current = response({ sv: "v2", sources: [{ x: 305, y: 305, reach: 3, kind: "own" }], revealed: [] });
    await sight.refresh();
    expect(sight.isZoneFullyFogged(zoneAt(10, 10))).toBe(true);
    expect(sight.isZoneFullyFogged(zoneAt(30, 30))).toBe(false);

    // Reach 2 from (21, 22) touches zone 10..20 x 10..20 on pointy-top but
    // not on flat-top, so a lookup kept from before the switch would be wrong.
    current = response({ sv: "v3", sources: [{ x: 21, y: 22, reach: 2, kind: "own" }], revealed: [] });
    await sight.refresh();
    setHexShape("pointy");
    expect(sight.isZoneFullyFogged(zoneAt(1, 1))).toBe(false);
    setHexShape("flat");
    expect(sight.isZoneFullyFogged(zoneAt(1, 1))).toBe(true);
    setHexShape("pointy");
    expect(sight.isZoneFullyFogged(zoneAt(1, 1))).toBe(false);
  });

  it("falls back to the scan for a zone off the grid or a reach it will not index", async () => {
    const sight = await loadedSight(
      response({ sources: [{ x: 400, y: 400, reach: 1000, kind: "own" }], revealed: [] }),
    );
    expect(sight.isZoneFullyFogged(zoneAt(0, 0))).toBe(false);

    const small = await loadedSight(response({ sources: [{ x: 105, y: 105, reach: 3, kind: "own" }], revealed: [] }));
    const offGrid: ZoneRef = { id: 0, originX: 103, originY: 103 };
    expect(small.isZoneFullyFogged(offGrid)).toBe(small.isZoneFullyFoggedByScan(offGrid));
    expect(small.isZoneFullyFogged({ id: 0, originX: 800, originY: 0 })).toBe(true);
  });
});
