import { describe, expect, it } from "vitest";
import { leafSpots, propSpots, recolourGround, SKINS, skinIdFrom } from "./thanksgivingSkin";

/** A plot diamond, clockwise from the top, as `YardBounds.corners`. */
const CORNERS = [
  { x: 1000, y: 200 },
  { x: 1800, y: 600 },
  { x: 1000, y: 1000 },
  { x: 200, y: 600 },
];

/** Whether a point is inside the diamond. */
const inside = (x: number, y: number): boolean => Math.abs(x - 1000) / 800 + Math.abs(y - 600) / 400 <= 1;

describe("Thanksgiving yard dress-up looks", () => {
  it("?tgskin= picks look A, B or C; anything else is the default A", () => {
    expect(skinIdFrom("?tgskin=b")).toBe("b");
    expect(skinIdFrom("?x=1&tgskin=C")).toBe("c");
    expect(skinIdFrom("?tgskin=a")).toBe("a");
    // The owner chose C (8 Nov): it is the look with no switch.
    expect(skinIdFrom("?tgskin=z")).toBe("c");
    expect(skinIdFrom("")).toBe("c");
  });

  it("every look recolours the grass warmer and keeps alpha", () => {
    for (const skin of Object.values(SKINS)) {
      // A mid grass green.
      const pixels = new Uint8ClampedArray([74, 122, 58, 200]);
      recolourGround(pixels, skin);
      const [r, g, b, a] = pixels;
      expect(a).toBe(200);
      // Redder than it was: autumn, not spring.
      expect(r! - g!).toBeGreaterThan(74 - 122);
      expect(b).toBeLessThanOrEqual(80);
    }
  });

  it("props stand outside the plot, along all four sides, the pattern in turn", () => {
    for (const skin of [SKINS.a, SKINS.b]) {
      const spots = propSpots(skin, CORNERS, 42);
      expect(spots.length).toBeGreaterThan(8);
      for (const spot of spots) expect(inside(spot.x, spot.y)).toBe(false);
      expect(spots.slice(0, skin.props.pattern.length).map((spot) => spot.prop)).toEqual(skin.props.pattern);
      // Same seed, same yard.
      expect(propSpots(skin, CORNERS, 42)).toEqual(spots);
    }
  });

  it("look C, the owner's: nothing round the yard, 30% fewer leaves than the first 80", () => {
    expect(SKINS.c.props.pattern).toEqual([]);
    expect(propSpots(SKINS.c, CORNERS, 42)).toEqual([]);
    expect(SKINS.c.leaves.count).toBe(Math.round(80 * 0.7));
  });

  it("leaves: the look's count, inside the ground block, the same for one seed", () => {
    const spots = leafSpots(SKINS.b, 1000, 500, 9);
    expect(spots).toHaveLength(SKINS.b.leaves.count);
    for (const leaf of spots) {
      expect(leaf.x).toBeGreaterThanOrEqual(0);
      expect(leaf.x).toBeLessThan(1000);
      expect(leaf.y).toBeLessThan(500);
    }
    expect(leafSpots(SKINS.b, 1000, 500, 9)).toEqual(spots);
    expect(leafSpots(SKINS.b, 1000, 500, 10)).not.toEqual(spots);
  });
});
