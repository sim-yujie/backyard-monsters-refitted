import { describe, expect, it } from "vitest";
import { BUILDING_COST_ROWS, INFERNO_COST_ROWS, OUTPOST_COST_ROWS } from "./buildingCostData";
import {
  captionLines,
  SNAPSHOT_GAME_NAME,
  SNAPSHOT_MAX_SCALE,
  SNAPSHOT_PADDING,
  SNAPSHOT_SIZE,
  snapshotFileName,
  snapshotFrame,
  snapshotHiddenIds,
  spriteBox,
  unionRect,
  type SpriteLike,
} from "./yardSnapshot";

/** The shared yard picture (owner, 2026-11-11): no traps, the whole yard centred. */

describe("snapshotHiddenIds", () => {
  it("leaves out the Booby Trap and the Heavy Trap and nothing else", () => {
    const yard = [
      { id: 1, type: 14 }, // Town Hall
      { id: 2, type: 24 }, // Booby Trap
      { id: 3, type: 17 }, // wall
      { id: 4, type: 117 }, // Heavy Trap
      { id: 5, type: 89 }, // Monster Fly Trap: a decoration, not a trap
    ];
    expect(snapshotHiddenIds(yard)).toEqual([2, 4]);
  });

  it("covers every type the cost tables call a trap, on the main yard, outposts and the Inferno", () => {
    const trapTypes = new Set<number>();
    for (const rows of [BUILDING_COST_ROWS, OUTPOST_COST_ROWS, INFERNO_COST_ROWS]) {
      for (const row of rows) if (row[2] === "trap") trapTypes.add(row[0]);
    }
    expect([...trapTypes].sort((a, b) => a - b)).toEqual([24, 117]);
    const yard = [...trapTypes].map((type, index) => ({ id: index + 1, type }));
    expect(snapshotHiddenIds(yard)).toHaveLength(trapTypes.size);
  });
});

describe("unionRect", () => {
  it("holds every rectangle and skips missing ones", () => {
    expect(
      unionRect([
        { x: 10, y: 20, width: 30, height: 40 },
        null,
        { x: -5, y: 50, width: 10, height: 100 },
      ]),
    ).toEqual({ x: -5, y: 20, width: 45, height: 130 });
  });

  it("is null for nothing, and ignores broken numbers", () => {
    expect(unionRect([])).toBeNull();
    expect(unionRect([{ x: Number.NaN, y: 0, width: 1, height: 1 }])).toBeNull();
  });
});

describe("spriteBox", () => {
  const sprite = (over: Partial<SpriteLike> = {}): SpriteLike => ({
    visible: true,
    x: 100,
    y: 200,
    anchor: { x: 0.5, y: 1 },
    scale: { x: 0.5, y: 0.5 },
    texture: { orig: { width: 80, height: 120 } },
    ...over,
  });

  it("places the picture by its anchor and scale", () => {
    expect(spriteBox(sprite())).toEqual({ x: 80, y: 140, width: 40, height: 60 });
  });

  it("reads a flipped sprite the right way round", () => {
    expect(spriteBox(sprite({ scale: { x: -0.5, y: 0.5 }, anchor: { x: 0.25, y: 0 } }))).toEqual({
      x: 70,
      y: 200,
      width: 40,
      height: 60,
    });
  });

  it("is null for a hidden sprite or an empty picture", () => {
    expect(spriteBox(sprite({ visible: false }))).toBeNull();
    expect(spriteBox(sprite({ texture: { orig: { width: 0, height: 10 } } }))).toBeNull();
  });
});

describe("snapshotFrame", () => {
  const plot: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 4000, height: 2000 };

  it("centres the buildings and keeps the picture's shape", () => {
    const content = { x: 1000, y: 500, width: 2000, height: 1000 };
    const { frame, scale } = snapshotFrame(content, plot);
    expect(frame.x + frame.width / 2).toBeCloseTo(2000);
    expect(frame.y + frame.height / 2).toBeCloseTo(1000);
    expect(frame.width / frame.height).toBeCloseTo(SNAPSHOT_SIZE.width / SNAPSHOT_SIZE.height);
    expect(frame.width * scale).toBeCloseTo(SNAPSHOT_SIZE.width);
    expect(frame.height * scale).toBeCloseTo(SNAPSHOT_SIZE.height);
  });

  it("keeps every building in, with grass on every side", () => {
    const content = { x: 300, y: 200, width: 3000, height: 1800 };
    const { frame } = snapshotFrame(content, plot);
    const padX = content.width * SNAPSHOT_PADDING;
    const padY = content.height * SNAPSHOT_PADDING;
    expect(frame.x).toBeLessThanOrEqual(content.x - padX + 1e-6);
    expect(frame.y).toBeLessThanOrEqual(content.y - padY + 1e-6);
    expect(frame.x + frame.width).toBeGreaterThanOrEqual(content.x + content.width + padX - 1e-6);
    expect(frame.y + frame.height).toBeGreaterThanOrEqual(content.y + content.height + padY - 1e-6);
    // The tighter side touches its padding: as large as it can be.
    expect(frame.height).toBeCloseTo(content.height * (1 + SNAPSHOT_PADDING * 2));
  });

  it("does not blow a tiny yard up past the most the art can take", () => {
    const content = { x: 1900, y: 950, width: 200, height: 100 };
    const { frame, scale } = snapshotFrame(content, plot);
    expect(scale).toBe(SNAPSHOT_MAX_SCALE);
    expect(frame.width).toBeCloseTo(SNAPSHOT_SIZE.width / SNAPSHOT_MAX_SCALE);
    expect(frame.x + frame.width / 2).toBeCloseTo(2000);
  });

  it("frames the whole plot when there is nothing to frame", () => {
    for (const content of [null, { x: 5, y: 5, width: 0, height: 0 }]) {
      const { frame } = snapshotFrame(content, plot);
      expect(frame.x + frame.width / 2).toBeCloseTo(2000);
      expect(frame.y + frame.height / 2).toBeCloseTo(1000);
      expect(frame.width).toBeGreaterThanOrEqual(plot.width);
    }
  });

  it("takes another picture size", () => {
    const { frame, scale } = snapshotFrame({ x: 0, y: 0, width: 1000, height: 1000 }, plot, { width: 800, height: 800 });
    expect(frame.width * scale).toBeCloseTo(800);
    expect(frame.height * scale).toBeCloseTo(800);
  });
});

describe("captionLines", () => {
  it("names the player and their level over the game's name", () => {
    expect(captionLines({ name: "Kevin", level: 32 })).toEqual(["Kevin · Level 32", SNAPSHOT_GAME_NAME]);
  });

  it("drops what it does not know", () => {
    expect(captionLines({ name: "Kevin" })).toEqual(["Kevin", SNAPSHOT_GAME_NAME]);
    expect(captionLines({ level: 5 })).toEqual(["Level 5", SNAPSHOT_GAME_NAME]);
    expect(captionLines({ name: "  ", level: 0 })).toEqual([SNAPSHOT_GAME_NAME]);
    expect(captionLines({})).toEqual([SNAPSHOT_GAME_NAME]);
  });
});

describe("snapshotFileName", () => {
  const day = new Date(2026, 10, 11, 23, 59);

  it("names the file after the player and the day", () => {
    expect(snapshotFileName("Kevin", day)).toBe("bymr-yard-kevin-2026-11-11.png");
  });

  it("keeps only letters, digits and dashes", () => {
    expect(snapshotFileName("  Dr. Évil / <3 ", day)).toBe("bymr-yard-dr-evil-3-2026-11-11.png");
    expect(snapshotFileName("???", day)).toBe("bymr-yard-2026-11-11.png");
    expect(snapshotFileName(null, day)).toBe("bymr-yard-2026-11-11.png");
  });
});
