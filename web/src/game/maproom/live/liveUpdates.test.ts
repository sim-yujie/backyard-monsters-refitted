import { describe, expect, it } from "vitest";
import type { MapCell } from "@/api/types";
import type { ZoneRecord } from "../ZoneStore";
import { LiveUpdates, ringTier } from "./liveUpdates";
import { changeOf, zoneChanges } from "./cellChanges";

/** The live map in the scene (beta 9): pushes become spread-out re-asks; live answers ring. */

const player = (over: Record<string, unknown> = {}) =>
  ({ uid: 5, b: 2, n: "bob", mine: 0, p: 0, lo: 0, l: 30, dm: 0, d: 0, ...over }) as unknown as MapCell;

const zone = (cells: Record<string, MapCell>): ZoneRecord => {
  const data: ZoneRecord["data"] = {};
  for (const [key, cell] of Object.entries(cells)) {
    const [x, y] = key.split(",");
    (data[x!] ??= {})[y!] = cell;
  }
  return { id: 0, originX: 0, originY: 0, data, fetchedAt: 0 };
};

const setup = () => {
  const applied: [number, number][][] = [];
  const delays: number[] = [];
  const rings: { col: number; row: number; kind: string; tier: string }[] = [];
  const shownUpdates: (MapCell | undefined)[] = [];
  const cells = new Map<string, MapCell>();
  let pending: (() => void)[] = [];
  const live = new LiveUpdates({
    store: {
      applyVersions: (pairs) => {
        applied.push([...pairs] as [number, number][]);
        return pairs.length;
      },
      watchList: () => [],
      getCell: (x, y) => cells.get(`${x},${y}`),
      pump: async () => {},
    },
    rings: { add: (cell, kind, tier) => (rings.push({ ...cell, kind, tier }), true) },
    refreshSight: () => {},
    shownCell: () => ({ col: 1, row: 1 }),
    updateShown: (payload) => shownUpdates.push(payload),
    tierOf: () => "far",
    token: () => "t",
    random: () => 0.5,
    delay: (fn, ms) => {
      delays.push(ms);
      pending.push(fn);
    },
  });
  const flush = () => {
    const run = pending;
    pending = [];
    for (const fn of run) fn();
  };
  return { live, applied, delays, rings, shownUpdates, cells, flush, versions: (live as unknown as { versions: (p: [number, number][], all: boolean) => void }).versions.bind(live) };
};

describe("LiveUpdates", () => {
  it("a push is applied after a short random wait; a watch answer at once", () => {
    const t = setup();
    t.versions([[1, 2]], false);
    expect(t.applied).toEqual([]);
    expect(t.delays).toEqual([200]);
    t.flush();
    expect(t.applied).toEqual([[[1, 2]]]);
    t.versions([[3, 4]], true);
    expect(t.applied).toHaveLength(2);
  });

  it("a live answer rings each changed cell and updates the open panel's", () => {
    const t = setup();
    const before = zone({ "1,1": player(), "2,2": player(), "3,3": player() });
    const after = zone({ "1,1": player({ uid: 9, n: "eve" }), "2,2": player({ atk: 2_000_000_000 }), "3,3": player({ m: { x: 1 } }) });
    t.cells.set("1,1", after.data["1"]!["1"]!);
    t.live.zoneArrived(after, before, true);
    expect(t.rings.map((r) => `${r.col},${r.row}:${r.kind}`)).toEqual(["1,1:taken", "2,2:attack"]);
    expect(t.shownUpdates).toHaveLength(1);
  });

  it("an answer nobody pushed, or a first answer, rings nothing", () => {
    const t = setup();
    const before = zone({ "1,1": player() });
    const after = zone({ "1,1": player({ uid: 9 }) });
    t.live.zoneArrived(after, before, false);
    t.live.zoneArrived(after, undefined, true);
    expect(t.rings).toEqual([]);
  });
});

describe("cell changes", () => {
  it("names the change: taken, attack and its end, shield and its end, else minor", () => {
    expect(changeOf(player(), player({ uid: 2 }))).toBe("taken");
    expect(changeOf(player(), { uid: 0, b: 1, dm: 0, d: 0 } as unknown as MapCell)).toBe("taken");
    expect(changeOf(player(), player({ atk: 5 }))).toBe("attack");
    expect(changeOf(player({ atk: 5 }), player())).toBe("attackEnd");
    expect(changeOf(player(), player({ p: 1, pe: 5 }))).toBe("shield");
    expect(changeOf(player({ p: 1 }), player())).toBe("shieldEnd");
    expect(changeOf(player(), player({ n: "renamed" }))).toBe("minor");
    expect(changeOf(player(), player({ r: { r1: 5 }, m: {}, nh: 9 }))).toBeNull();
  });

  it("counts only the cells that belong to the zone, not its shared edge", () => {
    const before = zone({ "10,5": player() });
    const after = zone({ "10,5": player({ uid: 3 }) });
    expect(zoneChanges(0, 0, before.data, after.data)).toEqual([]);
  });

  it("ring tiers: own, then selected, then in range", () => {
    const cell = { col: 1, row: 1 };
    expect(ringTier(cell, player({ mine: 1 }), null, () => false)).toBe("own");
    expect(ringTier(cell, player(), cell, () => false)).toBe("selected");
    expect(ringTier(cell, player(), null, () => true)).toBe("range");
    expect(ringTier(cell, player(), null, () => false)).toBe("far");
  });
});
