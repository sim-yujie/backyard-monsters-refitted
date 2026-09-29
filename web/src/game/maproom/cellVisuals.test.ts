import { describe, expect, it } from "vitest";
import type { MapCell, PlayerCell } from "@/api/types";
import { CellMarker, appearanceOf, plateName, terrainColour } from "./cellVisuals";

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
      avatar: null,
    });
  });

  it("gives a player their critter and a name plate with their level", () => {
    expect(appearanceOf(player(), 0)).toMatchObject({
      marker: CellMarker.YARD,
      avatar: "owl",
      plate: "Bramblefoot  24",
      badge: "",
      own: false,
    });
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
});

it("cuts a long name on its plate with dots the map's font can draw", () => {
  expect(plateName("Bramblefoot")).toBe("Bramblefoot");
  expect(plateName("AVeryLongPlayerName")).toBe("AVeryLongPla...");
});

it("keeps the server's height bands with the toned-down ground", () => {
  expect(terrainColour(99)).toBe(0x234565);
  expect(terrainColour(100)).toBe(0xb9ad86);
  expect(terrainColour(150)).toBe(0x43623a);
  expect(terrainColour(200)).toBe(0x64625c);
});
