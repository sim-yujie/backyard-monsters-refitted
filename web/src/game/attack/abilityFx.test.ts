import { describe, expect, it } from "vitest";
import { ABILITY_LOOKS, TrailFx, BEAM_TICKS, MIST_TICKS, stoneCracks } from "./abilityFx";

describe("ability looks (lead's vet, 27 Nov 2026)", () => {
  it("gives Stone Skin and Chest Pound a shock ring, Bubble and Acid Spit a beam", () => {
    expect(ABILITY_LOOKS.stoneSkin.castRing).toBeGreaterThan(0);
    expect(ABILITY_LOOKS.chestPound.castRing).toBeGreaterThan(0);
    expect(ABILITY_LOOKS.bubble.beam).toBe(true);
    expect(ABILITY_LOOKS.acidSpit.beam).toBe(true);
  });

  it("cracks a creep the same way every frame, inside its body's box", () => {
    expect(stoneCracks(7)).toEqual(stoneCracks(7));
    for (const crack of stoneCracks(12345)) {
      for (const [u, v] of crack) {
        expect(u).toBeGreaterThan(0);
        expect(u).toBeLessThan(1);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("lets a beam and a mist fade out after their time", () => {
    const fx = new TrailFx();
    fx.beam(100, { x: 0, y: 0 }, { x: 50, y: 20 }, 0x7fd8ff);
    fx.mist(100, { x: 0, y: 0 }, 200, 0x6ef0a0);
    fx.update(100 + BEAM_TICKS);
    expect(fx.root.context.instructions.length).toBeGreaterThan(0);
    fx.update(100 + MIST_TICKS + 1);
    expect(fx.root.context.instructions.length).toBe(0);
    fx.destroy();
  });
});
