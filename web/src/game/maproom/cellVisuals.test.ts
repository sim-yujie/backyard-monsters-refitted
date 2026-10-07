import { describe, expect, it } from "vitest";
import { CELL_HEIGHT, CELL_WIDTH } from "@/config";
import type { MapCell, PlayerCell } from "@/api/types";
import {
  CellMarker,
  KitFilter,
  LOADING_COLOUR,
  OutpostKit,
  RELATION_ALLIANCE_COLOUR,
  RELATION_OTHER_COLOUR,
  RELATION_YOU_COLOUR,
  UNEXPLORED_PERIOD,
  UNEXPLORED_STRIPE,
  UNEXPLORED_STRIPE_COLOUR,
  appearanceOf,
  hexWidthAt,
  kitOf,
  plateName,
  terrainColour,
  unexploredColour,
  type MapViewerContext,
} from "./cellVisuals";

/**
 * The calm map (#176): camps carry their level on a badge and no name;
 * players keep a plate; the ground is toned down.
 */

const player = (overrides: Partial<PlayerCell> = {}): MapCell =>
  ({
    uid: 7,
    b: 2,
    i: 150,
    bid: "2",
    aid: null,
    n: "Bramblefoot",
    l: 24,
    v: 0,
    f: 1,
    c: 1,
    dm: 0,
    d: 0,
    lo: 0,
    p: 0,
    mine: 0,
    pic_square: "/avatars/owl.webp",
    pi: 0,
    fr: 0,
    ...overrides,
  }) as PlayerCell;

describe("appearanceOf", () => {
  it("gives a camp its tribe and level badge, and no plate", () => {
    const camp = { uid: 0, b: 1, i: 150, bid: "1", n: "Kozu", l: 38, dm: 0, d: 0 } as MapCell;
    expect(appearanceOf(camp, 0)).toMatchObject({
      marker: CellMarker.CAMP,
      tribe: "Kozu",
      badge: "38",
      plate: "",
    });
  });

  it("gives a player a name plate with their level, and the same level on their gold star (#334)", () => {
    expect(appearanceOf(player(), 0)).toMatchObject({
      marker: CellMarker.YARD,
      plate: "Bramblefoot  24",
      badge: "",
      own: false,
      star: "24",
    });
  });

  it("puts a player's level on the star whether the cell is the viewer's own or not (#334)", () => {
    expect(appearanceOf(player({ mine: 1, l: 5 }), 0).star).toBe("5");
    expect(appearanceOf(player({ mine: 0, l: 99 }), 0).star).toBe("99");
  });

  it("plates the player's own yard You and their outpost Outpost", () => {
    expect(appearanceOf(player({ mine: 1 }), 0)).toMatchObject({ plate: "You", own: true });
    expect(appearanceOf(player({ mine: 1, b: 3 }), 0)).toMatchObject({
      marker: CellMarker.OUTPOST,
      plate: "Outpost",
    });
  });

  it("marks protection and a running truce, and not an expired one", () => {
    expect(appearanceOf(player({ p: 1 }), 0).shielded).toBe(true);
    expect(appearanceOf(player({ t: 100 }), 50).shielded).toBe(true);
    expect(appearanceOf(player({ t: 100 }), 150).shielded).toBe(false);
  });

  it("dots the player's own outpost while an invitation to move onto it waits, and nothing else (#205)", () => {
    expect(appearanceOf(player({ mine: 1, b: 3, pi: 12 }), 0).invitePending).toBe(true);
    expect(appearanceOf(player({ mine: 1, b: 3, pi: 0 }), 0).invitePending).toBe(false);
    expect(appearanceOf(player({ mine: 0, b: 3, pi: 12 }), 0).invitePending).toBe(false);
    expect(appearanceOf(player({ mine: 1, b: 2, pi: 12 }), 0).invitePending).toBe(false);
  });
});

describe("player relation and kit (#334)", () => {
  it("colours and icons the viewer's own cell gold with a house", () => {
    expect(appearanceOf(player({ mine: 1 }), 0)).toMatchObject({
      plateColour: RELATION_YOU_COLOUR,
      relationIcon: "house",
    });
  });

  it("colours and icons an alliance-mate's cell green with a shield", () => {
    const context: MapViewerContext = { myAlliance: 5, kitFilter: KitFilter.ALL };
    expect(appearanceOf(player({ mine: 0, aid: 5 }), 0, context)).toMatchObject({
      plateColour: RELATION_ALLIANCE_COLOUR,
      relationIcon: "shield",
    });
  });

  it("leaves everyone else plain Flash blue with no icon", () => {
    expect(appearanceOf(player({ mine: 0, aid: null }), 0)).toMatchObject({
      plateColour: RELATION_OTHER_COLOUR,
      relationIcon: "none",
    });
    // A mismatched alliance id is still "other", not "alliance".
    const context: MapViewerContext = { myAlliance: 5, kitFilter: KitFilter.ALL };
    expect(appearanceOf(player({ mine: 0, aid: 9 }), 0, context)).toMatchObject({
      plateColour: RELATION_OTHER_COLOUR,
      relationIcon: "none",
    });
  });

  it("never reaches the attacker relation yet (#329 not merged - no cheap data source)", () => {
    // Every combination of inputs this payload can carry falls through to
    // "other" rather than "attacker"; there is nothing on PlayerCell today
    // that could select it.
    const context: MapViewerContext = { myAlliance: null, kitFilter: KitFilter.ALL };
    expect(appearanceOf(player({ mine: 0, aid: null }), 0, context).relationIcon).not.toBe("swords");
  });

  it("maps the server's kit id to a kit name, falling back to none", () => {
    expect(kitOf(0)).toBe(OutpostKit.NONE);
    expect(kitOf(1)).toBe(OutpostKit.REGULAR);
    expect(kitOf(2)).toBe(OutpostKit.MEGA);
    expect(kitOf(3)).toBe(OutpostKit.ULTRA);
    expect(kitOf(undefined)).toBe(OutpostKit.NONE);
    expect(kitOf(99)).toBe(OutpostKit.NONE);
  });

  it("gives an outpost its kit and a main yard none, regardless of the field", () => {
    expect(appearanceOf(player({ b: 3, kit: 2 }), 0).kit).toBe(OutpostKit.MEGA);
    expect(appearanceOf(player({ b: 2, kit: 2 }), 0).kit).toBeNull();
  });

  it("keeps everything bright when the kit filter is All", () => {
    const context: MapViewerContext = { myAlliance: null, kitFilter: KitFilter.ALL };
    expect(appearanceOf(player({ mine: 1, b: 3, kit: 2 }), 0, context).dimmed).toBe(false);
    expect(appearanceOf(player({ mine: 0, b: 3, kit: 2 }), 0, context).dimmed).toBe(false);
    expect(appearanceOf(player({ mine: 1, b: 2 }), 0, context).dimmed).toBe(false);
  });

  it("dims everything but the viewer's own matching-kit outpost when a kit is picked", () => {
    const context: MapViewerContext = { myAlliance: null, kitFilter: KitFilter.MEGA };
    // The viewer's own outpost with the matching kit stays bright.
    expect(appearanceOf(player({ mine: 1, b: 3, kit: 2 }), 0, context).dimmed).toBe(false);
    // The viewer's own outpost with a different kit dims.
    expect(appearanceOf(player({ mine: 1, b: 3, kit: 1 }), 0, context).dimmed).toBe(true);
    // Even the viewer's own main yard dims: only a matching outpost stays bright.
    expect(appearanceOf(player({ mine: 1, b: 2 }), 0, context).dimmed).toBe(true);
    // Someone else's outpost with the same kit still dims; the filter is "own only".
    expect(appearanceOf(player({ mine: 0, b: 3, kit: 2 }), 0, context).dimmed).toBe(true);
  });
});

it("cuts a long name on its plate with dots the map's font can draw", () => {
  expect(plateName("Bramblefoot")).toBe("Bramblefoot");
  expect(plateName("AVeryLongPlayerName")).toBe("AVeryLongPla...");
});

describe("hexWidthAt (#334): how much width a plate has before it spills into a neighbour hex", () => {
  const halfHeight = CELL_HEIGHT / 2;

  it("is the full cell width at the hex's centre line", () => {
    expect(hexWidthAt(0)).toBe(CELL_WIDTH);
  });

  it("narrows to half the cell width at the hex's top and bottom points", () => {
    expect(hexWidthAt(halfHeight)).toBe(CELL_WIDTH / 2);
    expect(hexWidthAt(-halfHeight)).toBe(CELL_WIDTH / 2);
  });

  it("is symmetric and narrows linearly in between", () => {
    expect(hexWidthAt(halfHeight / 2)).toBeCloseTo(CELL_WIDTH * 0.75);
    expect(hexWidthAt(-halfHeight / 2)).toBeCloseTo(CELL_WIDTH * 0.75);
  });

  it("clamps to the narrowest width past the hex's own vertical extent", () => {
    expect(hexWidthAt(halfHeight * 3)).toBe(CELL_WIDTH / 2);
  });
});

it("keeps the server's height bands with the toned-down ground", () => {
  expect(terrainColour(99)).toBe(0x234565);
  expect(terrainColour(100)).toBe(0xb9ad86);
  expect(terrainColour(150)).toBe(0x43623a);
  expect(terrainColour(200)).toBe(0x64625c);
});

describe("unexplored ground (#153)", () => {
  it("is striped on the diagonal, so the world view reads as not loaded rather than blank", () => {
    const row = Array.from({ length: UNEXPLORED_PERIOD }, (_, col) => unexploredColour(col, 0));
    expect(row.filter((colour) => colour === UNEXPLORED_STRIPE_COLOUR)).toHaveLength(UNEXPLORED_STRIPE);
    expect(row.filter((colour) => colour === LOADING_COLOUR)).toHaveLength(UNEXPLORED_PERIOD - UNEXPLORED_STRIPE);
    // A step right and a step up land on the same stripe.
    expect(unexploredColour(5, 3)).toBe(unexploredColour(6, 2));
    expect(unexploredColour(0, 0)).not.toBe(unexploredColour(UNEXPLORED_STRIPE, 0));
  });
});
