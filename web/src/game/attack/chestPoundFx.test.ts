import { describe, expect, it } from "vitest";
import { atlasCellFrame } from "./abilityBits";
import { CHEST_POUND_SET, PLANNED_ABILITIES, bodyPulseOf, chestPoundAtlas, pulseScale, sizeOf } from "./chestPoundFx";

describe("Codex's Chest Pound plan", () => {
  it("is the only planned ability; the rest keep the painted look", () => {
    expect(PLANNED_ABILITIES).toEqual(["chestPound"]);
  });

  it("names only cells on its own sheet, one row of four", () => {
    const atlas = chestPoundAtlas();
    expect(atlas.cells).toEqual(["chest_burst", "lock_mark", "lock_snap", "taunt_wave"]);
    const plan = CHEST_POUND_SET.plan;
    const used = [...(plan.pieces ?? []), ...(plan.on_each ?? []), ...(plan.held ?? [])].map((piece) => piece.cell);
    expect(used.length).toBeGreaterThan(0);
    for (const cell of used) expect(atlasCellFrame(atlas, cell ?? "")).not.toBeNull();
    expect(atlasCellFrame(atlas, "taunt_wave")).toMatchObject({ x: 576, y: 0, width: 192, height: 192 });
    expect(atlasCellFrame(atlas, "heal_cross")).toBeNull();
  });

  it("loads the Modern and Classic sheets by look", () => {
    const atlas = chestPoundAtlas();
    expect(atlas.url(false)).toMatch(/\/assets\/fx\/chest-pound\.modern\.webp$/);
    expect(atlas.url(true)).toMatch(/\/assets\/fx\/chest-pound\.classic\.webp$/);
  });

  it("reads reach-relative sizes and squashes Gorgo's body back to normal", () => {
    expect(sizeOf("reach", 500)).toBe(500);
    expect(sizeOf("reach*0.5", 500)).toBe(250);
    expect(sizeOf(84, 500)).toBe(84);
    const pulse = bodyPulseOf(100, CHEST_POUND_SET.plan.body);
    expect(pulse).not.toBeNull();
    expect(pulseScale(pulse!, 105)!.x).toBeGreaterThan(1);
    expect(pulseScale(pulse!, 200)).toBeNull();
  });
});
