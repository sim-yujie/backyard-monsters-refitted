import { describe, expect, it, vi } from "vitest";
import type { GetAreaResponse } from "@/api/types";
import { ownCellsIn } from "@/game/attack/attackEntry";
import { ZoneStore, type AreaFetcher } from "./ZoneStore";
import { zoneFor } from "./zones";

/**
 * The store's own-cell index and its cap (map lag, 25 Nov 2026): `ownCells` must answer exactly
 * what `ownCellsIn` over every cached zone answers, however zones come, go and come again, and the
 * cap must never forget a zone on screen or one holding the viewer's own cells.
 */

const key = (c: { col: number; row: number }) => `${c.col},${c.row}`;
const sorted = (cells: readonly { col: number; row: number; cell: unknown }[]) =>
  [...cells].sort((a, b) => key(a).localeCompare(key(b))).map((c) => [key(c), c.cell]);

const drain = async (store: ZoneStore) => {
  for (let round = 0; round < 60 && store.pendingRequests > 0; round++) await store.pump();
};

describe("ZoneStore own cells", () => {
  it("answers exactly what ownCellsIn answers over random fetches, refetches, drops and evictions", async () => {
    let seed = 9;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let now = 1_000_000;
    // Each answer marks a few random cells (edges included) mine or someone else's.
    const fetcher: AreaFetcher = (x, y) => {
      const data: GetAreaResponse["data"] = {};
      for (let cx = x; cx <= x + 10; cx++) {
        data[String(cx)] = {};
        for (let cy = y; cy <= y + 10; cy++) {
          const roll = rnd();
          data[String(cx)]![String(cy)] = (
            roll < 0.08 ? { uid: 1, b: 3, i: 120, mine: 1, m: { n: rnd() } } : roll < 0.12 ? { uid: 2, b: 3, i: 120, mine: 0 } : { i: 120 }
          ) as never;
        }
      }
      return Promise.resolve({ error: 0, x, y, data, sv: "a" });
    };
    const store = new ZoneStore({ fetcher, now: () => now, maxConcurrent: 64, maxZones: 12 });
    for (let step = 0; step < 120; step++) {
      now += 1000 * Math.floor(rnd() * 3); // ties on purpose
      const action = rnd();
      if (action < 0.5) {
        const col = 100 + Math.floor(rnd() * 60);
        const row = 100 + Math.floor(rnd() * 60);
        store.ensureVisible({ minCol: col, maxCol: col + 12, minRow: row, maxRow: row + 12 });
      } else if (action < 0.85) {
        store.invalidateCell(100 + Math.floor(rnd() * 60), 100 + Math.floor(rnd() * 60));
      } else {
        store.applySight((zone) => (zone.originX + zone.originY) % 30 !== 0, "a");
      }
      await drain(store);
      expect(sorted(store.ownCells())).toEqual(sorted(ownCellsIn(store.loadedZoneRefs())));
    }
  });

  it("keeps at most the cap, forgetting the zones fetched longest ago but never one on screen or holding own cells", async () => {
    let now = 1_000_000;
    const own = zoneFor(500, 500).id;
    const fetcher: AreaFetcher = (x, y) => {
      const data: GetAreaResponse["data"] = {};
      for (let cx = x; cx <= x + 10; cx++) {
        data[String(cx)] = {};
        for (let cy = y; cy <= y + 10; cy++) data[String(cx)]![String(cy)] = { i: 120 } as never;
      }
      if (zoneFor(x, y).id === own) data[String(x + 3)]![String(y + 3)] = { uid: 1, b: 3, i: 120, mine: 1 } as never;
      return Promise.resolve({ error: 0, x, y, data });
    };
    const onEvict = vi.fn();
    const store = new ZoneStore({ fetcher, now: () => now, maxConcurrent: 64, maxZones: 4, onEvict });
    store.invalidateCell(503, 503);
    await drain(store);
    for (const x of [100, 200, 300, 400, 600, 700]) {
      now += 1000;
      store.ensureVisible({ minCol: x + 1, maxCol: x + 2, minRow: 101, maxRow: 102 });
      await drain(store);
      expect(store.loadedZones).toBeLessThanOrEqual(4);
      expect(store.getZone(zoneFor(x + 1, 101).id)).toBeDefined(); // on screen
      expect(store.getZone(own)).toBeDefined(); // own cells
    }
    const evicted = onEvict.mock.calls.flatMap((call) => call[0] as { id: number }[]).map((zone) => zone.id);
    expect(evicted).toEqual([zoneFor(101, 101).id, zoneFor(201, 101).id, zoneFor(301, 101).id]);
  });
});
