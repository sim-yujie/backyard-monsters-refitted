import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DECOR_KINDS, DECORATIONS_FOR_SALE, DecorKind, decorKindOf, decorOrder, SEASONAL_DECOR_KIND } from "./decorShop";
import { isDecoration } from "./planner/placement";

/** Every decoration in Flash's props: its `subgroup` and whether it is `block`ed. */
const flashDecorations = (): Map<number, { subgroup: number; block: boolean }> => {
  const props = readFileSync(new URL("../../../../client/scripts/YARD_PROPS.as", import.meta.url), "utf8");
  const found = new Map<number, { subgroup: number; block: boolean }>();
  const parts = props.split(/"id": (\d+),/);
  for (let index = 1; index < parts.length; index += 2) {
    const body = parts[index + 1] ?? "";
    if (!/"type": "decoration"/.test(body)) continue;
    const subgroup = /"subgroup": (\d+)/.exec(body);
    found.set(Number(parts[index]), { subgroup: subgroup ? Number(subgroup[1]) : -1, block: /"block": true/.test(body) });
  }
  return found;
};

describe("Flash's Decorations sub-tabs", () => {
  it("are Flash's five, in its order, one word each", () => {
    expect(DECOR_KINDS.map((kind) => kind.label)).toEqual(["Evil", "Plants", "Good", "Flags", "Premium"]);
    for (const kind of DECOR_KINDS) expect(kind.label).toMatch(/^\w+$/);
  });

  it("put every decoration under its Flash subgroup, once", () => {
    const flash = flashDecorations();
    const all = DECOR_KINDS.flatMap((kind) => kind.types);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(84 + 36);
    expect(flash.size).toBe(84);
    // This project's six autumn ones (owner, 10 Nov 2026): Plants and Good.
    expect(DECOR_KINDS[1]?.types.slice(0, 3)).toEqual([201, 205, 206]);
    expect(DECOR_KINDS[2]?.types.slice(0, 3)).toEqual([202, 203, 204]);
    for (const [type, { subgroup }] of flash) {
      expect(isDecoration(type), `${type} is a decoration`).toBe(true);
      expect(decorKindOf(type), `${type}`).toBe(DECOR_KINDS[subgroup]?.id);
    }
    for (let type = 0; type < 300; type++) {
      expect(decorKindOf(type) !== null, `${type}`).toBe(isDecoration(type));
    }
  });

  it("sell 14 Evil, 14 + 13 Plants, 16 + 9 Good, 23 + 1 Flags and 6 + 9 Premium, the shop's order sub-tab by sub-tab", () => {
    const sold = new Set(DECORATIONS_FOR_SALE.map(([type]) => type));
    const counts = DECOR_KINDS.map((kind) => kind.types.filter((type) => sold.has(type)).length);
    expect(counts).toEqual([14, 27, 25, 24, 15]);
    expect(DECOR_KINDS.flatMap((kind) => kind.types.filter((type) => sold.has(type)))).toEqual(
      DECORATIONS_FOR_SALE.map(([type]) => type),
    );
  });

  it("keep Flash's blocked ones (not sold) in their own sub-tab for when one is stored", () => {
    const flash = flashDecorations();
    const sold = new Set(DECORATIONS_FOR_SALE.map(([type]) => type));
    const blocked = [...flash].filter(([, entry]) => entry.block).map(([type]) => type);
    expect(blocked.sort((a, b) => a - b)).toEqual([58, 59, 67, 69, 70, 110, 111, 120, 121, 131, 135]);
    for (const type of blocked) expect(sold.has(type)).toBe(false);
    expect(decorKindOf(67)).toBe(DecorKind.PLANTS);
    expect(decorKindOf(70)).toBe(DecorKind.GOOD);
    expect(decorKindOf(121)).toBe(DecorKind.PREMIUM);
  });

  it("order the tab sub-tab by sub-tab", () => {
    expect(decorOrder(107)).toBe(0);
    expect(decorOrder(73)).toBeLessThan(decorOrder(55));
    expect(decorOrder(32)).toBeLessThan(decorOrder(120));
    expect(decorOrder(5)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("this project's autumn decorations (owner, 10 Nov 2026)", () => {
  it("sell for 25 to 75 coins, cheapest first in their sub-tab", () => {
    const prices = new Map(DECORATIONS_FOR_SALE);
    expect([201, 202, 203, 204, 205, 206].map((type) => prices.get(type))).toEqual([25, 30, 35, 50, 60, 75]);
    expect(decorKindOf(201)).toBe(DecorKind.PLANTS);
    expect(decorKindOf(206)).toBe(DecorKind.PLANTS);
    expect(decorKindOf(204)).toBe(DecorKind.GOOD);
    expect(decorOrder(201)).toBeLessThan(decorOrder(55));
    expect(decorOrder(202)).toBeLessThan(decorOrder(57));
  });

  it("are followed by the new ones (24 Nov 2026), first in their sub-tab after the autumn ones", () => {
    const prices = new Map(DECORATIONS_FOR_SALE);
    expect(DECOR_KINDS[1]?.types.slice(3, 13)).toEqual([228, 232, 229, 231, 230, 225, 226, 223, 224, 227]);
    expect(DECOR_KINDS[2]?.types.slice(3, 9)).toEqual([211, 212, 209, 208, 210, 213]);
    expect(DECOR_KINDS[3]?.types[0]).toBe(207);
    expect(DECOR_KINDS[4]?.types.slice(0, 9)).toEqual([214, 215, 216, 217, 218, 219, 220, 221, 222]);
    // Placeholder prices until the owner's price card: only that each has one.
    for (let type = 207; type <= 232; type++) expect(prices.get(type), `${type}`).toBeGreaterThan(0);
  });

  it("lead the sub-tab an announcement's Shop opens on", () => {
    const tab = DECOR_KINDS.find((kind) => kind.id === SEASONAL_DECOR_KIND)!;
    expect(tab.types.slice(0, 3)).toEqual([201, 205, 206]);
  });
});
