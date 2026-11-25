import { afterEach, describe, expect, it, vi } from "vitest";
import type { GetAreaResponse, SightResponse, SightSource } from "@/api/types";
import { setHexShape } from "@/game/HexGrid";
import { Sight } from "./Sight";
import { ZoneStore, type AreaFetcher, type ZoneRecord } from "./ZoneStore";
import { zoneFor } from "./zones";

/**
 * A sight change forgets only the zones it can reach (map lag, 25 Nov 2026). An alliance mate
 * taking one outpost used to empty the whole map cache (`dropAll`); now the zones the mate's new
 * circle touches are dropped and refetched, and every other zone stays. The "no memory" rule
 * (`fog-of-war.md` §6) still holds: a zone any of whose cells gained or lost sight is forgotten.
 */

afterEach(() => setHexShape("flat"));

const own: SightSource = { x: 105, y: 105, reach: 6, kind: "own" };
const mate: SightSource = { x: 305, y: 305, reach: 6, kind: "ally" };
const mateOutpost: SightSource = { x: 335, y: 305, reach: 3, kind: "ally" };

const sightOf = (sv: string, sources: SightSource[]): SightResponse => ({ error: 0, sv, sources, revealed: [] });

/** A store holding zones round both circles, every answer cut to sight `sv()`. */
const storeWith = async (sv: () => string, onDrop: (dropped: ZoneRecord[]) => void) => {
  const fetcher: AreaFetcher = (x, y) => {
    const data: GetAreaResponse["data"] = {};
    for (let cx = x; cx <= x + 10; cx++) {
      data[String(cx)] = {};
      for (let cy = y; cy <= y + 10; cy++) data[String(cx)]![String(cy)] = { i: 120 } as never;
    }
    return Promise.resolve({ error: 0, x, y, data, sv: sv() });
  };
  const store = new ZoneStore({ fetcher, maxConcurrent: 64 });
  const sight = new Sight({
    fetcher: async () => current,
    onChange: (keep, next) => onDrop(store.applySight(keep, next)),
  });
  let current = sightOf("a", [own, mate]);
  await sight.refresh();
  for (const range of [
    { minCol: 100, maxCol: 115, minRow: 100, maxRow: 115 },
    { minCol: 300, maxCol: 345, minRow: 300, maxRow: 315 },
  ]) {
    store.ensureVisible(range);
    for (let round = 0; round < 10 && store.pendingRequests > 0; round++) await store.pump();
  }
  return { store, sight, setSight: (next: SightResponse) => (current = next) };
};

const ids = (zones: readonly ZoneRecord[]) => zones.map((zone) => zone.id).sort((a, b) => a - b);

describe.each(["flat", "pointy"] as const)("a sight change on %s-top hexes", (shape) => {
  it("keeps the zones a mate's one new outpost cannot reach, and drops the ones it does", async () => {
    setHexShape(shape);
    let sv = "a";
    const onDrop = vi.fn();
    const { store, sight, setSight } = await storeWith(() => sv, onDrop);
    const before = store.loadedZones;
    expect(before).toBeGreaterThan(6);
    onDrop.mockClear();

    sv = "b";
    setSight(sightOf("b", [own, mate, mateOutpost]));
    await sight.syncVersion("b");

    expect(onDrop).toHaveBeenCalledTimes(1);
    const dropped: ZoneRecord[] = onDrop.mock.calls[0]![0];
    // The new circle (335,305 reach 3) lies in zones 330 and, at its edge, the ones beside.
    expect(ids(dropped)).toContain(zoneFor(335, 305).id);
    expect(dropped.every((zone) => zone.originX >= 320)).toBe(true);
    // The player's own zones and the mate's old ones stay, now stamped with the new sight.
    expect(store.getZone(zoneFor(105, 105).id)?.sv).toBe("b");
    expect(store.getZone(zoneFor(305, 305).id)?.sv).toBe("b");
    expect(store.loadedZones).toBe(before - dropped.length);
  });

  it("drops every zone a lost circle lit, and keeps the rest", async () => {
    setHexShape(shape);
    const onDrop = vi.fn();
    const { store, sight, setSight } = await storeWith(() => "a", onDrop);
    onDrop.mockClear();

    setSight(sightOf("c", [own]));
    await sight.syncVersion("c");

    const dropped: ZoneRecord[] = onDrop.mock.calls[0]![0];
    expect(ids(dropped)).toContain(zoneFor(305, 305).id);
    expect(store.getZone(zoneFor(305, 305).id)).toBeUndefined();
    expect(store.getZone(zoneFor(105, 105).id)?.sv).toBe("c");
  });

  it("forgets a zone cut to some other sight than the one held (it may show anything)", async () => {
    setHexShape(shape);
    let sv = "a";
    const onDrop = vi.fn();
    const { store, sight, setSight } = await storeWith(() => sv, onDrop);
    // One zone refetched while the server was already on a sight the client never saw.
    sv = "x";
    store.invalidateCell(105, 105);
    await store.pump();
    onDrop.mockClear();

    setSight(sightOf("b", [own, mate, mateOutpost]));
    await sight.syncVersion("b");

    expect(store.getZone(zoneFor(105, 105).id)).toBeUndefined();
  });
});

describe.each(["flat", "pointy"] as const)("changedZoneLookup on %s-top hexes", (shape) => {
  it("never leaves out a zone one of whose cells gained or lost sight", async () => {
    setHexShape(shape);
    const { changedZoneLookup } = await import("./Sight");
    const { isVisible } = await import("./rules/sight");
    const { hexShape } = await import("@/game/HexGrid");
    const { ZONE_ROWS } = await import("./zones");
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const source = (): SightSource => ({ x: 20 + Math.floor(rnd() * 60), y: 20 + Math.floor(rnd() * 60), reach: 1 + Math.floor(rnd() * 8), kind: "ally" });
    for (let round = 0; round < 40; round++) {
      const before = Array.from({ length: 6 }, source);
      const after = rnd() < 0.5 ? [...before, source()] : before.slice(1);
      const revealedBefore = [{ x: 50, y: 50 }];
      const revealedAfter = rnd() < 0.5 ? [{ x: 50, y: 50 }, { x: 70, y: 33 }] : revealedBefore;
      const touched = changedZoneLookup({ sources: before, revealed: revealedBefore }, { sources: after, revealed: revealedAfter }, hexShape())!;
      for (let zx = 0; zx < 10; zx++) {
        for (let zy = 0; zy < 10; zy++) {
          if (touched[zx * ZONE_ROWS + zy] !== 0) continue;
          for (let x = zx * 10; x <= zx * 10 + 10; x++) {
            for (let y = zy * 10; y <= zy * 10 + 10; y++) {
              const was = isVisible({ x, y }, before, revealedBefore, hexShape());
              const now = isVisible({ x, y }, after, revealedAfter, hexShape());
              expect(now).toBe(was);
            }
          }
        }
      }
    }
  });
});
