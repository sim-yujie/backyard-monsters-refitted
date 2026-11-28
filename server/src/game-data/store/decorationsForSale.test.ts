import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { footprintOf } from "../buildingFootprints.js";
import { REVAMP_DECORATIONS, revampDecoration } from "../revampDecorations.js";
import { DECORATIONS_FOR_SALE, decorationPrice } from "./decorationsForSale.js";
import { storeItems } from "./storeItems.js";

/**
 * The decorations sold for Shiny (owner decision 2026-11-04): Flash's
 * Decorations tab, its `block`ed entries left out, at its store price.
 */
describe("DECORATIONS_FOR_SALE", () => {
  test("73 of Flash's decorations, each once, each priced above 0 from its BUILDING store row", () => {
    const flash = DECORATIONS_FOR_SALE.filter((type) => !revampDecoration(type));
    expect(flash).toHaveLength(73);
    expect(new Set(DECORATIONS_FOR_SALE).size).toBe(DECORATIONS_FOR_SALE.length);
    for (const type of flash) {
      expect(footprintOf(type).decoration).toBe(true);
      expect(decorationPrice(type)).toBe(storeItems[`BUILDING${type}`]!.c[0]);
      expect(decorationPrice(type)).toBeGreaterThan(0);
    }
  });

  test("and this project's own at their own price, first under their sub-tab, with no store row", () => {
    expect(DECORATIONS_FOR_SALE).toHaveLength(73 + 32);
    expect(REVAMP_DECORATIONS.slice(0, 6).map((one) => [one.type, decorationPrice(one.type)])).toEqual([
      [201, 25],
      [202, 30],
      [203, 35],
      [204, 50],
      [205, 60],
      [206, 75],
    ]);
    // The Christmas 2026 prizes (233-236, `events.ts` CHRISTMAS_DECOR) are won, never sold.
    const prizes = [233, 234, 235, 236];
    for (const { type, price } of REVAMP_DECORATIONS) {
      if (prizes.includes(type)) {
        expect(DECORATIONS_FOR_SALE).not.toContain(type);
        expect(decorationPrice(type)).toBeUndefined();
        expect(footprintOf(type).decoration).toBe(true);
        continue;
      }
      expect(DECORATIONS_FOR_SALE).toContain(type);
      expect(decorationPrice(type)).toBe(price);
      expect(footprintOf(type).decoration).toBe(true);
      expect(storeItems[`BUILDING${type}`]).toBeUndefined();
    }
    // Plants start after the 14 Evil (the autumn three, then the ten new plants), Good after the 14 + 13 Plants
    // (the autumn three, then the six new props), Flags after the 16 + 9 Good, Premium after the 23 + 1 Flags.
    expect(DECORATIONS_FOR_SALE.slice(14, 17)).toEqual([201, 205, 206]);
    expect(DECORATIONS_FOR_SALE.slice(17, 27)).toEqual([228, 232, 229, 231, 230, 225, 226, 223, 224, 227]);
    expect(DECORATIONS_FOR_SALE.slice(41, 44)).toEqual([202, 203, 204]);
    expect(DECORATIONS_FOR_SALE.slice(44, 50)).toEqual([211, 212, 209, 208, 210, 213]);
    expect(DECORATIONS_FOR_SALE[66]).toBe(207);
    expect(DECORATIONS_FOR_SALE.slice(90, 99)).toEqual([214, 215, 216, 217, 218, 219, 220, 221, 222]);
  });

  test("every BUILDING store row not sold is one Flash's tab hid (block) or priced 0", () => {
    const unsold = Object.keys(storeItems)
      .filter((key) => /^BUILDING\d+$/.test(key))
      .map((key) => Number(key.slice("BUILDING".length)))
      .filter((type) => !DECORATIONS_FOR_SALE.includes(type))
      .sort((a, b) => a - b);
    expect(unsold).toEqual([58, 59, 67, 69, 70, 110, 120, 121, 122, 123, 124, 125, 126, 131, 135]);
    for (const type of unsold) expect(decorationPrice(type)).toBeUndefined();
  });

  test("Flash's prices: an Acorn 5, a flag 150, the Pirate Flag 125, the Statue of Liberty 500", () => {
    expect(decorationPrice(55)).toBe(5);
    expect(decorationPrice(28)).toBe(150);
    expect(decorationPrice(49)).toBe(125);
    expect(decorationPrice(99)).toBe(500);
    expect(decorationPrice(20)).toBeUndefined();
  });

  test("the web's display copy lists the same types at the same prices, in the same order", () => {
    const web = readFileSync(new URL("../../../../web/src/game/yard/decorShop.ts", import.meta.url), "utf8");
    const body = /DECORATIONS_FOR_SALE[^=]*=\s*\[([\s\S]*?)\];/.exec(web)?.[1] ?? "";
    const pairs = [...body.matchAll(/\[(\d+),\s*(\d+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(pairs).toEqual(DECORATIONS_FOR_SALE.map((type) => [type, decorationPrice(type)!]));
  });
});
