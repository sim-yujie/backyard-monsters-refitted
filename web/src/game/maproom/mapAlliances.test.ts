import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Pixi from "pixi.js";
import type { MapCell, PlayerCell } from "@/api/types";
import { AllianceRoster, MapShields, parseAllianceRoster } from "./mapAlliances";
import { appearanceOf, KitFilter, type MapViewerContext } from "./cellVisuals";
import { ZoneStore, type AreaFetcher } from "./ZoneStore";

const load = vi.hoisted(() => vi.fn());
vi.mock("pixi.js", async (actual) => ({
  ...(await actual<typeof Pixi>()),
  Assets: { load },
}));

/** The map's alliances (beta 7, design v5 §12): roster, shields and plates. */

afterEach(() => {
  load.mockReset();
});

describe("parseAllianceRoster", () => {
  it("reads getarea's alliancedata rows", () => {
    expect(
      parseAllianceRoster([
        { alliance_id: 7, name: "Goo Gang", image: 12, relationships: {} },
        { alliance_id: "9", name: "Mud Men", image: "3" },
      ]),
    ).toEqual([
      { id: 7, name: "Goo Gang", image: 12 },
      { id: 9, name: "Mud Men", image: 3 },
    ]);
  });

  it("skips rows it cannot read and falls back to shield 1", () => {
    expect(
      parseAllianceRoster([null, 4, { alliance_id: 0, name: "x" }, { alliance_id: 5 }, { alliance_id: 6, name: "Six", image: 0 }]),
    ).toEqual([{ id: 6, name: "Six", image: 1 }]);
    expect(parseAllianceRoster({})).toEqual([]);
    expect(parseAllianceRoster(undefined)).toEqual([]);
  });
});

describe("AllianceRoster", () => {
  it("says when something it draws changed", () => {
    const roster = new AllianceRoster();
    expect(roster.merge([{ id: 7, name: "Goo Gang", image: 12 }])).toBe(true);
    expect(roster.merge([{ id: 7, name: "Goo Gang", image: 12 }])).toBe(false);
    expect(roster.merge([{ id: 7, name: "Goo Gang", image: 4 }])).toBe(true);
    expect(roster.get(7)).toEqual({ id: 7, name: "Goo Gang", image: 4 });
    roster.clear();
    expect(roster.get(7)).toBeUndefined();
  });
});

describe("MapShields", () => {
  it("fetches each shield once, from the small pictures, and says when it lands", async () => {
    const texture = { width: 25, height: 25 };
    load.mockResolvedValue(texture);
    const arrived = vi.fn();
    const shields = new MapShields(arrived);

    expect(shields.texture(12)).toBeNull();
    expect(shields.texture(12)).toBeNull();
    await vi.waitFor(() => expect(arrived).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]![0]).toMatchObject({ src: "/assets/alliances/12_small.png" });
    expect(shields.texture(12)).toBe(texture);
  });

  it("draws nothing for a shield that never loads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    load.mockRejectedValue(new Error("404"));
    const arrived = vi.fn();
    const shields = new MapShields(arrived);
    shields.texture(5);
    await vi.waitFor(() => expect(load).toHaveBeenCalled());
    await Promise.resolve();
    expect(arrived).not.toHaveBeenCalled();
    expect(shields.texture(5)).toBeNull();
  });
});

describe("a player cell's shield", () => {
  const player = (overrides: Partial<PlayerCell> = {}): MapCell =>
    ({ uid: 77, b: 2, i: 150, bid: "1", aid: null, n: "Ana", l: 24, v: 1, dm: 0, d: 0, lo: 0, p: 0, mine: 0, pi: 0, ...overrides }) as MapCell;
  const roster = new AllianceRoster();
  roster.merge([{ id: 7, name: "Goo Gang", image: 12 }]);
  const context: MapViewerContext = { myAlliance: null, kitFilter: KitFilter.ALL, allianceOf: (id) => roster.get(id) };

  it("is its alliance's shield, on a mate's cell and anyone else's alike", () => {
    expect(appearanceOf(player({ aid: 7 }), 0, context).shield).toBe(12);
    expect(appearanceOf(player({ aid: 7 }), 0, { ...context, myAlliance: 7 }).shield).toBe(12);
  });

  it("is none without an alliance, an unknown one, or no roster", () => {
    expect(appearanceOf(player({ aid: null }), 0, context).shield).toBe(0);
    expect(appearanceOf(player({ aid: 9 }), 0, context).shield).toBe(0);
    expect(appearanceOf(player({ aid: 7 }), 0).shield).toBe(0);
  });
});

describe("ZoneStore", () => {
  it("hands each answer's alliance roster on", async () => {
    const fetcher: AreaFetcher = (x, y) =>
      Promise.resolve({ error: 0, x, y, data: {}, alliancedata: [{ alliance_id: 7, name: "Goo Gang", image: 12 }] });
    const onAllianceRoster = vi.fn();
    const store = new ZoneStore({ fetcher, onAllianceRoster });
    store.ensureVisible({ minCol: 0, maxCol: 2, minRow: 0, maxRow: 2 });
    await store.pump();
    await vi.waitFor(() => expect(onAllianceRoster).toHaveBeenCalledWith([{ id: 7, name: "Goo Gang", image: 12 }]));
  });
});
