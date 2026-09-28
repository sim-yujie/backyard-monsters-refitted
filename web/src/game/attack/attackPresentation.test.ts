import { describe, expect, it } from "vitest";
import { AttackPresentation } from "./attackPresentation";
import type { AttackSessionState } from "./AttackSession";

const stateAt = (damagePercent: number): AttackSessionState =>
  ({ damagePercent }) as AttackSessionState;

describe("AttackPresentation (#148)", () => {
  it("plays while any hold says so, and stops holding once released", () => {
    const presentation = new AttackPresentation();
    expect(presentation.playing()).toBe(false);
    let falling = true;
    const release = presentation.hold(() => falling);
    presentation.hold(() => false);
    expect(presentation.playing()).toBe(true);
    falling = false;
    expect(presentation.playing()).toBe(false);
    falling = true;
    release();
    expect(presentation.playing()).toBe(false);
  });

  it("shows the screen's damage, never above the engine's, and the engine's with no view", () => {
    const presentation = new AttackPresentation();
    expect(presentation.damageShown(stateAt(42))).toBe(42);
    const release = presentation.showDamageWith(() => 30);
    expect(presentation.damageShown(stateAt(42))).toBe(30);
    expect(presentation.damageShown(stateAt(20))).toBe(20);
    release();
    expect(presentation.damageShown(stateAt(42))).toBe(42);
  });
});
