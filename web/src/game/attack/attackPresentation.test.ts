import { describe, expect, it } from "vitest";
import { AttackPresentation } from "./attackPresentation";
import type { AttackSessionState } from "./AttackSession";

const stateAt = (damagePercent: number): AttackSessionState =>
  ({ damagePercent }) as AttackSessionState;

describe("AttackPresentation (#148)", () => {
  it("puts the battle to rest through every settler until it is released (#308)", () => {
    const presentation = new AttackPresentation();
    presentation.settle();
    const calls: string[] = [];
    const release = presentation.settleWith(() => calls.push("layer"));
    presentation.settle();
    expect(calls).toEqual(["layer"]);
    release();
    presentation.settle();
    expect(calls).toEqual(["layer"]);
  });

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

  it("is finishing while a last blow's slow motion plays, apart from the holds", () => {
    const presentation = new AttackPresentation();
    expect(presentation.finishing()).toBe(false);
    let slow = true;
    const release = presentation.holdFinish(() => slow);
    expect(presentation.finishing()).toBe(true);
    expect(presentation.playing()).toBe(false);
    slow = false;
    expect(presentation.finishing()).toBe(false);
    slow = true;
    release();
    expect(presentation.finishing()).toBe(false);
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

  it("never shows less than 0 before the first hit", () => {
    const presentation = new AttackPresentation();
    // An untouched yard's sum can land a rounding error under 0.
    expect(Math.floor(presentation.damageShown(stateAt(-1e-13)))).toBe(0);
    presentation.showDamageWith(() => -1e-12);
    expect(Math.floor(presentation.damageShown(stateAt(0)))).toBe(0);
  });
});
