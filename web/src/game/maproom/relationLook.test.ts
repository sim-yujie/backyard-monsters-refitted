import { describe, expect, it } from "vitest";
import { BORDER_RIM_COLOUR, RELATION_LOOK, type PlayerRelation } from "./relationLook";

/** WCAG relative luminance of `0xRRGGBB`. */
const luminance = (colour: number): number => {
  const channel = (shift: number): number => {
    const c = ((colour >> shift) & 0xff) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
};
const contrast = (a: number, b: number): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
/** The line's glowing middle: 40 per cent towards white, as the painted shader draws it. */
const lifted = (colour: number): number => {
  const lift = (shift: number): number => {
    const c = (colour >> shift) & 0xff;
    return Math.round(c + (255 - c) * 0.4);
  };
  return (lift(16) << 16) | (lift(8) << 8) | lift(0);
};
const hue = (colour: number): number => {
  const r = ((colour >> 16) & 0xff) / 255;
  const g = ((colour >> 8) & 0xff) / 255;
  const b = (colour & 0xff) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

/** The map's grass bands (`cellVisuals.ts` TERRAIN_BANDS). */
const GRASS = [0x647f16, 0x4d7b0d, 0x415d0e];

/** The border palette (owner, 8 Nov 2026: green friends, dark-blue alliance, red enemies). */
describe("relation border palette", () => {
  it("draws friends green, alliance dark blue, hostile red and neutral a quiet grey", () => {
    expect(RELATION_LOOK.friend.colour).toBe(0x4dff86);
    expect(RELATION_LOOK.pinned.colour).toBe(0xa4ffbe);
    expect(RELATION_LOOK.alliance.colour).toBe(0x2f5bff);
    expect(RELATION_LOOK.hostile.colour).toBe(0xff4a3d);
    expect(RELATION_LOOK.other.colour).toBe(0xc2c9d2);
    expect(RELATION_LOOK.you.colour).toBe(0x3cf2ff);
    // A pinned friend is the lighter green.
    expect(luminance(RELATION_LOOK.pinned.colour)).toBeGreaterThan(luminance(RELATION_LOOK.friend.colour));
  });

  it("keeps the line styles, so colour-blind players can still tell them apart", () => {
    const styles: Record<PlayerRelation, string> = {
      you: "thick",
      alliance: "solid",
      pinned: "triple",
      friend: "double",
      hostile: "dashed",
      other: "thin",
    };
    for (const [relation, style] of Object.entries(styles)) {
      expect(RELATION_LOOK[relation as PlayerRelation].style).toBe(style);
    }
  });

  it("reads against the dark rim: every line's middle at least 6.5 times the rim's luminance", () => {
    for (const look of Object.values(RELATION_LOOK)) {
      expect(contrast(lifted(look.colour), BORDER_RIM_COLOUR)).toBeGreaterThan(6.5);
    }
  });

  it("keeps the friend greens apart from the grass: a cooler hue and clearly brighter", () => {
    for (const relation of ["friend", "pinned"] as const) {
      const colour = RELATION_LOOK[relation].colour;
      for (const grass of GRASS) {
        expect(Math.abs(hue(colour) - hue(grass))).toBeGreaterThan(45);
        expect(contrast(colour, grass)).toBeGreaterThan(2.5);
      }
    }
  });
});
