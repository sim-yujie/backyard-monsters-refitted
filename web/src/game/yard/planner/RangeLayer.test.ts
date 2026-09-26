// @vitest-environment jsdom
// The layer draws with `Graphics` and reads the view off `YardRenderer`, both
// of which load Pixi; nothing below touches a canvas, but the import needs a
// DOM to evaluate in.
import { describe, expect, it } from "vitest";
import { TOWER_STATS } from "@/game/combat/rules";
import { YardView } from "../YardRenderer";
import {
  DEFAULT_OVERLAYS,
  loadOverlays,
  OVERLAY_KEY,
  rangeRadii,
  saveOverlays,
  TOWER_MIN_RANGE,
  towerRange,
  type OverlayToggles,
} from "./RangeLayer";

/** A `Storage` backed by a map, with hooks for the two ways one can fail. */
const fakeStorage = (options: { readThrows?: boolean; writeThrows?: boolean } = {}): Storage => {
  const held = new Map<string, string>();
  return {
    get length() {
      return held.size;
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => {
      if (options.readThrows) throw new Error("blocked");
      return held.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (options.writeThrows) throw new Error("full");
      held.set(key, value);
    },
    removeItem: (key: string) => {
      held.delete(key);
    },
  } satisfies Storage;
};

describe("towerRange", () => {
  it("reads the level's range out of the stats table", () => {
    expect(towerRange(20, 1)?.range).toBe(160);
    expect(towerRange(20, 10)?.range).toBe(250);
    expect(towerRange(21, 1)?.range).toBe(300);
  });

  it("clamps a level past the end of the ladder, as the client does", () => {
    // The Laser Tower has eight levels; a plan for a ninth reads the eighth.
    expect(TOWER_STATS[23]).toHaveLength(8);
    expect(towerRange(23, 99)?.range).toBe(towerRange(23, 8)?.range);
    expect(towerRange(23, 0)?.range).toBe(towerRange(23, 1)?.range);
  });

  it("splits the towers into land, air and both", () => {
    const families = (type: number): string => {
      const reach = towerRange(type, 1);
      if (!reach) return "none";
      if (reach.land && reach.air) return "both";
      return reach.land ? "land" : "air";
    };

    // Ground only: everything with no `_targetFlyerMode` row.
    for (const type of [20, 22, 23, 118, 129, 136, 137, 138]) {
      expect(`${type}: ${families(type)}`).toBe(`${type}: land`);
    }
    // Both (mode 1): Sniper, Tesla and Magma.
    for (const type of [21, 25, 132]) {
      expect(`${type}: ${families(type)}`).toBe(`${type}: both`);
    }
    // Air only (mode 2): the Aerial Defense Tower, and nothing else.
    expect(families(115)).toBe("air");
  });

  it("refuses anything that is not a defence tower", () => {
    // A wall, a resource building, a trap, a mushroom and a type that does not
    // exist. The Siege Works carries a `range` and is a `special`: it is the
    // reason this asks the class rather than the stats table.
    for (const type of [17, 1, 24, 7, 134, 9999]) expect(towerRange(type, 1)).toBeNull();
  });

  it("draws no dead zone, because no tower has one", () => {
    // `YARD_PROPS.as` carries no minimum range and `targetInRange` tests one
    // bound. If a row ever appears in the table, the ring is already drawn —
    // but this test has to be read and changed first.
    expect(Object.keys(TOWER_MIN_RANGE)).toHaveLength(0);
    for (const type of Object.keys(TOWER_STATS).map(Number)) {
      expect(towerRange(type, 1)?.minRange ?? null).toBeNull();
    }
  });
});

describe("rangeRadii", () => {
  it("keeps the blueprint's circle a circle", () => {
    expect(rangeRadii(160, YardView.BLUEPRINT)).toEqual({ rx: 160, ry: 160 });
  });

  it("squashes the isometric view to 2:1", () => {
    const { rx, ry } = rangeRadii(160, YardView.ISO);
    expect(rx).toBeCloseTo(160 * Math.SQRT2, 10);
    expect(ry).toBeCloseTo((160 * Math.SQRT2) / 2, 10);
    expect(rx / ry).toBeCloseTo(2, 10);
  });

  it("matches what `toIso` does to the circle's extremes", () => {
    // `toIso(x, y) = (x - y, (x + y) / 2)`, so the furthest a point of the
    // circle travels is at t = -45° on x and t = 45° on y.
    const r = 100;
    const at = (t: number): { x: number; y: number } => {
      const x = r * Math.cos(t);
      const y = r * Math.sin(t);
      return { x: x - y, y: (x + y) / 2 };
    };
    const { rx, ry } = rangeRadii(r, YardView.ISO);
    expect(at(-Math.PI / 4).x).toBeCloseTo(rx, 10);
    expect(at(Math.PI / 4).y).toBeCloseTo(ry, 10);
  });

  it("scales linearly, so a level up is a bigger disc", () => {
    const small = rangeRadii(160, YardView.ISO);
    const big = rangeRadii(320, YardView.ISO);
    expect(big.rx).toBeCloseTo(small.rx * 2, 10);
    expect(big.ry).toBeCloseTo(small.ry * 2, 10);
  });
});

describe("the remembered toggles", () => {
  it("starts with ranges off and the centre mark on", () => {
    expect(DEFAULT_OVERLAYS).toEqual({ ranges: false, land: true, air: true, centre: true });
    expect(loadOverlays(fakeStorage())).toEqual(DEFAULT_OVERLAYS);
  });

  it("round-trips through a store", () => {
    const storage = fakeStorage();
    const wanted: OverlayToggles = { ranges: true, land: true, air: false, centre: false };
    saveOverlays(wanted, storage);
    expect(loadOverlays(storage)).toEqual(wanted);
    expect(storage.getItem(OVERLAY_KEY)).toBeTruthy();
  });

  it("takes the default for anything the stored value does not say", () => {
    const storage = fakeStorage();
    storage.setItem(OVERLAY_KEY, JSON.stringify({ ranges: true, air: "yes" }));
    expect(loadOverlays(storage)).toEqual({
      ranges: true,
      land: true,
      air: true,
      centre: true,
    });
  });

  it("survives a value that is not JSON, or not an object", () => {
    const storage = fakeStorage();
    storage.setItem(OVERLAY_KEY, "{ranges:");
    expect(loadOverlays(storage)).toEqual(DEFAULT_OVERLAYS);
    storage.setItem(OVERLAY_KEY, "7");
    expect(loadOverlays(storage)).toEqual(DEFAULT_OVERLAYS);
    storage.setItem(OVERLAY_KEY, "null");
    expect(loadOverlays(storage)).toEqual(DEFAULT_OVERLAYS);
  });

  it("survives a store that throws, and one that is not there at all", () => {
    expect(loadOverlays(fakeStorage({ readThrows: true }))).toEqual(DEFAULT_OVERLAYS);
    expect(loadOverlays(null)).toEqual(DEFAULT_OVERLAYS);
    expect(() => saveOverlays(DEFAULT_OVERLAYS, fakeStorage({ writeThrows: true }))).not.toThrow();
    expect(() => saveOverlays(DEFAULT_OVERLAYS, null)).not.toThrow();
  });
});
