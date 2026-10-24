import { describe, expect, test } from "bun:test";
import { blockLevel, blockPrice, quoteWallBlocks } from "./wallBlocks.js";

describe("wall upgrade prices (STORE.as:404-519)", () => {
  test("3 / 6 / 10 / 15 Shiny per Block for each level climbed", () => {
    expect(blockPrice(1, 2)).toBe(3);
    expect(blockPrice(1, 3)).toBe(9);
    expect(blockPrice(1, 4)).toBe(19);
    expect(blockPrice(1, 5)).toBe(34);
    expect(blockPrice(3, 5)).toBe(25);
    expect(blockPrice(4, 4)).toBe(0);
    expect(blockPrice(5, 2)).toBe(0);
  });

  test("a Block being built is level 1; a legacy Stone row is at least 2", () => {
    expect(blockLevel({ id: 1, x: 0, y: 0, t: 17, l: 1, cB: 30 })).toBe(1);
    expect(blockLevel({ id: 1, x: 0, y: 0, t: 17 })).toBe(1);
    expect(blockLevel({ id: 1, x: 0, y: 0, t: 18, l: 1 })).toBe(2);
    expect(blockLevel({ id: 1, x: 0, y: 0, t: 18, l: 4 })).toBe(4);
  });

  test("the quote counts only Blocks below the tier, and ignores other buildings", () => {
    const quote = quoteWallBlocks(
      {
        "1": { id: 1, x: 0, y: 0, t: 17, l: 1 },
        "2": { id: 2, x: 0, y: 0, t: 17, l: 3 },
        "3": { id: 3, x: 0, y: 0, t: 17, l: 5 },
        "4": { id: 4, x: 0, y: 0, t: 20, l: 1 },
      },
      4,
    );
    expect(quote).toEqual({ tier: 4, blocks: 2, shiny: 19 + 10 });
  });
});
