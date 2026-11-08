import { describe, expect, it } from "vitest";
import { CellType, type MapCell, type PlayerCell } from "@/api/types";
import { HexGrid } from "@/game/HexGrid";
import type { ZoneRecord } from "../ZoneStore";
import { PULSE_STEP_TICKS, pulseAt } from "./BorderLayer";
import { BORDER_FRAGMENT } from "./borderShader";
import { BorderData, BorderRelation, borderDistance, borderRelationOf, borderSides, sideEnds } from "./borders";
import { cellCentre, flatTopShape, pointyTopShape, type CellShape } from "./cellShape";
import { PAINTED_TAG_COLOUR, PAINTED_TAG_TEXT, TILE_TAG_STYLE, tagStyle } from "./markerStyle";

const player = (uid: number, extra: Partial<PlayerCell> = {}): PlayerCell => ({
  uid,
  b: CellType.HOME_CELL,
  i: 150,
  bid: "1",
  aid: null,
  n: `p${uid}`,
  l: 30,
  v: 0,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 0,
  pic_square: null,
  pi: 0,
  fr: 0,
  ...extra,
});

const camp = (): MapCell => ({ uid: 0, b: CellType.WILD_MONSTER, i: 150, bid: "2", n: "Legionnaire", l: 30, dm: 0, d: 0 });

const zone = (cells: [number, number, MapCell][]): ZoneRecord => {
  const data: ZoneRecord["data"] = {};
  for (const [x, y, cell] of cells) (data[x] ??= {})[y] = cell;
  return { id: 1, data, fetchedAt: 0 } as unknown as ZoneRecord;
};

const SHAPES: [string, CellShape][] = [
  ["flat", flatTopShape()],
  ["pointy", pointyTopShape()],
];

describe("border relation", () => {
  it("colours players by how they relate to the viewer, and gives tribes, water and fog none", () => {
    expect(borderRelationOf(player(5, { mine: 1 }), 9)).toBe(BorderRelation.YOU);
    expect(borderRelationOf(player(5, { aid: 9 }), 9)).toBe(BorderRelation.ALLIANCE);
    expect(borderRelationOf(player(5, { aid: 9, ho: 1 }), 9)).toBe(BorderRelation.ALLIANCE);
    expect(borderRelationOf(player(5, { ho: 1 }), 9)).toBe(BorderRelation.HOSTILE);
    expect(borderRelationOf(player(5, { ak: 1 }), 9)).toBe(BorderRelation.OTHER);
    expect(borderRelationOf(player(5, { fr: 1, ho: 1 }), 9)).toBe(BorderRelation.FRIEND);
    expect(borderRelationOf(player(5, { fr: 1, fp: 1 }), 9)).toBe(BorderRelation.PINNED);
    expect(borderRelationOf(player(5, { aid: 3 }), 9)).toBe(BorderRelation.OTHER);
    expect(borderRelationOf(player(5, { aid: 3 }), null)).toBe(BorderRelation.OTHER);
    expect(borderRelationOf(camp(), 9)).toBe(BorderRelation.NONE);
    expect(borderRelationOf({ i: 40 }, 9)).toBe(BorderRelation.NONE);
    expect(borderRelationOf({ fog: 1 }, 9)).toBe(BorderRelation.NONE);
    expect(borderRelationOf(undefined, 9)).toBe(BorderRelation.NONE);
  });
});

describe("border relation with the friends list", () => {
  it("takes the viewer's friends list over the flags, and never marks the viewer's own cells", () => {
    const viewer = { myAlliance: null, friendMark: (cell: PlayerCell) => (cell.uid === 5 ? ("pinned" as const) : ("none" as const)) };
    expect(borderRelationOf(player(5), viewer)).toBe(BorderRelation.PINNED);
    expect(borderRelationOf(player(6, { fr: 1, ho: 1 }), viewer)).toBe(BorderRelation.HOSTILE);
    expect(borderRelationOf(player(5, { mine: 1 }), viewer)).toBe(BorderRelation.YOU);
  });

  it("writes friends, pinned friends and hostile players' codes into the data texture", () => {
    const data = new BorderData("pointy", 40, 40);
    data.applyZone(
      zone([
        [10, 10, player(1, { fr: 1 })],
        [20, 10, player(2, { fr: 1, fp: 1 })],
        [30, 10, player(3, { ho: 1 })],
        [10, 20, player(4, { b: CellType.OUTPOST, fr: 1 })],
      ]),
      { myAlliance: null },
    );
    expect(data.relationAt(10, 10)).toBe(BorderRelation.FRIEND);
    expect(data.relationAt(20, 10)).toBe(BorderRelation.PINNED);
    expect(data.relationAt(30, 10)).toBe(BorderRelation.HOSTILE);
    expect(data.relationAt(10, 20)).toBe(BorderRelation.FRIEND);
  });
});

describe.each(SHAPES)("border sides on %s hexes", (_, shape) => {
  const kind = shape.kind;

  it("a lone player cell is bordered on all six sides", () => {
    const owners = (col: number, row: number) => (col === 10 && row === 10 ? 7 : 0);
    expect(borderSides(10, 10, kind, owners)).toBe(0b111111);
    expect(borderSides(11, 10, kind, owners)).toBe(0);
  });

  it("one outline round a player's group: no border between their own cells", () => {
    for (const side of [0, 1, 2, 3, 4, 5]) {
      const next = HexGrid.neighbours(10, 11, kind)[side]!;
      const mine = new Set([`10,11`, `${next.col},${next.row}`]);
      const owners = (col: number, row: number) => (mine.has(`${col},${row}`) ? 7 : 0);
      expect(borderSides(10, 11, kind, owners)).toBe(0b111111 & ~(1 << side));
      // The neighbour's side back towards the first cell is open too.
      const back = (side + 3) % 6;
      expect(borderSides(next.col, next.row, kind, owners)).toBe(0b111111 & ~(1 << back));
    }
  });

  it("two players side by side each keep a border on the shared side", () => {
    const next = HexGrid.neighbours(10, 11, kind)[0]!;
    const owners = (col: number, row: number) =>
      col === 10 && row === 11 ? 7 : col === next.col && row === next.row ? 8 : 0;
    expect(borderSides(10, 11, kind, owners) & 1).toBe(1);
    expect(borderSides(next.col, next.row, kind, owners) & (1 << 3)).toBe(1 << 3);
  });

  it("the data texture follows zones, refreshing cells round a zone that changed hands", () => {
    const data = new BorderData(kind, 30, 30);
    const [east] = HexGrid.neighbours(10, 11, kind);
    data.applyZone(zone([[10, 11, player(7, { mine: 1 })], [east!.col, east!.row, player(7, { mine: 1 })]]), null);
    expect(data.relationAt(10, 11)).toBe(BorderRelation.YOU);
    expect(data.sidesAt(10, 11)).toBe(0b111110);
    // A later zone takes the east cell away (a takeover): the yard's east side is a border again.
    data.applyZone(zone([[east!.col, east!.row, camp()]]), null);
    expect(data.relationAt(east!.col, east!.row)).toBe(BorderRelation.NONE);
    expect(data.sidesAt(east!.col, east!.row)).toBe(0);
    expect(data.sidesAt(10, 11)).toBe(0b111111);
    expect(data.flush()).toBe(true);
    expect(data.flush()).toBe(false);
    data.reset();
    expect(data.sidesAt(10, 11)).toBe(0);
  });

  it("the shader's distance is small only near the outer edge of a player's group", () => {
    const [east] = HexGrid.neighbours(10, 11, kind);
    const data = new BorderData(kind, 30, 30);
    data.applyZone(zone([[10, 11, player(7)], [east!.col, east!.row, player(7)]]), null);
    const a = cellCentre(shape, 10, 11);
    const b = cellCentre(shape, east!.col, east!.row);
    const sides = (col: number, row: number) => data.sidesAt(col, row);
    // The middle of the shared side: well past the line and glow (the nearest border is the side's ends).
    const shared = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const sharedDistance = borderDistance(shape, shared.x, shared.y, sides);
    expect(sharedDistance).toBeGreaterThan(shape.cellWidth * 0.15);
    // The middle of the outer (west) side, a hair inside: right on the border.
    const [wx, wy, wx2, wy2] = sideEnds(shape, 3);
    const outer = { x: a.x + ((wx + wx2) / 2) * 0.98, y: a.y + ((wy + wy2) / 2) * 0.98 };
    expect(borderDistance(shape, outer.x, outer.y, sides)).toBeLessThan(shape.cellWidth * 0.03);
    // Cells nobody owns draw nothing.
    const far = cellCentre(shape, 20, 20);
    expect(borderDistance(shape, far.x, far.y, sides)).toBe(Infinity);
  });

  it("each side's ends are two of the cell's real corners", () => {
    const grid = new HexGrid(shape.cellWidth, shape.cellHeight, kind);
    const corners = grid.cellCorners(6, 6);
    // HexGrid's centre may be offset from cellShape's (its own origin): compare relative corners.
    const gridCentre = grid.cellToPixel(6, 6);
    const relCorners = grid.cellCorners(6, 6).map((c) => [c.x - gridCentre.x, c.y - gridCentre.y]);
    expect(corners.length).toBe(6);
    for (let side = 0; side < 6; side++) {
      const [ax, ay, bx, by] = sideEnds(shape, side);
      for (const [x, y] of [
        [ax, ay],
        [bx, by],
      ]) {
        const match = relCorners.some(([cx, cy]) => Math.abs(cx! - x!) < 1e-6 && Math.abs(cy! - y!) < 1e-6);
        expect(match).toBe(true);
      }
    }
  });
});

describe("border pulse and shader", () => {
  it("pulses only on High, in steps", () => {
    expect(pulseAt(1234, 0, "medium")).toBe(0.5);
    expect(pulseAt(1234, 0, "low")).toBe(0.5);
    expect(pulseAt(0, 0, "high")).toBeCloseTo(0.5);
    // Steps every 3 ticks of the shared clock (100 ms): half a step later it has not moved.
    expect(PULSE_STEP_TICKS).toBe(3);
    expect(pulseAt(50, 0, "high")).toBe(pulseAt(0, 0, "high"));
    expect(pulseAt(800, 0, "high")).toBeCloseTo(1);
  });

  it("has a colour and a line for every relation, and the dark rim", () => {
    for (const name of ["uYou", "uAlliance", "uOther", "uHostile", "uFriend", "uPinned", "uRim", "uRimAlpha"]) {
      expect(BORDER_FRAGMENT).toContain(`uniform ${name === "uRimAlpha" ? "float" : "vec3"} ${name};`);
    }
    expect(BORDER_FRAGMENT).toContain("relation == 4) { colour = uHostile; halfK = 1.2; dashed = true; }");
    expect(BORDER_FRAGMENT).toContain("relation == 5) { colour = uFriend; halfK = 0.7; doubleGap = 0.018; }");
    // A pinned friend's third stroke down the middle.
    expect(BORDER_FRAGMENT).toContain("triple = true;");
    expect(BORDER_FRAGMENT).toContain("if (triple) fromLine = min(fromLine, fromCentre);");
  });

  it("walks the neighbours in HexGrid's order", () => {
    expect(BORDER_FRAGMENT).toContain(
      "vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0)",
    );
  });
});

describe("name tags on the painted map", () => {
  it("keep today's plates on the tile map and take mock-up B's parchment tag on the painted one", () => {
    expect(tagStyle(false, "pointy")).toEqual(TILE_TAG_STYLE);
    expect(tagStyle(false, "flat")).toEqual(TILE_TAG_STYLE);
    const pointy = tagStyle(true, "pointy");
    expect(pointy.plate).toBe(PAINTED_TAG_COLOUR);
    expect(pointy.text).toBe(PAINTED_TAG_TEXT);
    // Bigger on the tall pointy-top cell than on the flat one, which has less room.
    expect(pointy.scale).toBeGreaterThan(tagStyle(true, "flat").scale);
    expect(tagStyle(true, "flat").scale).toBeGreaterThan(1);
  });
});
