import { describe, expect, it } from "vitest";
import type { ResolvedAnim } from "./buildingArt";
import { loopAnimLayers, type AnimLayer } from "./YardAnimations";
import { animPolicy, YARD_TICK_HZ } from "./yardAnim";

/**
 * A strip with an idle loop of its own (the Inferno's Incubator Control
 * Centre: 32 idle cells, then 64 working ones), run at the type's rate.
 */
const layer = (): AnimLayer => {
  const anim: ResolvedAnim = { url: "", x: 0, y: 0, width: 1, height: 1, frames: 96, columns: 15, rest: 32 };
  return {
    anim,
    sprite: { totalFrames: 96, currentFrame: 0 } as AnimLayer["sprite"],
    policy: animPolicy(16)!,
    progress: 0,
    resolved: true,
  };
};

/** Seconds for `cells` of the working loop at the type's rate. */
const cells = (count: number): number => (count * animPolicy(16)!.ticksPerFrame!) / YARD_TICK_HZ;

describe("a strip with an idle loop (loopAnimLayers)", () => {
  it("plays its idle cells while idle, each for two working cells, round in the same time", () => {
    const one = layer();
    loopAnimLayers([one], cells(10.5), false);
    expect(one.sprite.currentFrame).toBe(5);
    loopAnimLayers([one], cells(53), false);
    expect(one.sprite.currentFrame).toBe(31);
    loopAnimLayers([one], cells(1), false);
    expect(one.sprite.currentFrame).toBe(0);
  });

  it("plays its working cells while working, and carries on from the same point when it starts or stops", () => {
    const one = layer();
    loopAnimLayers([one], cells(20.5), false);
    expect(one.sprite.currentFrame).toBe(10);
    loopAnimLayers([one], 0.001, true);
    expect(one.sprite.currentFrame).toBe(32 + 20);
    loopAnimLayers([one], cells(43), true);
    expect(one.sprite.currentFrame).toBe(95);
    loopAnimLayers([one], cells(2), false);
    expect(one.sprite.currentFrame).toBe(0);
  });

  it("holds a strip whose policy holds it (mid-build), and leaves a strip with no idle loop alone", () => {
    const busy = { ...layer(), policy: { ...animPolicy(16)!, ticksPerFrame: null } };
    loopAnimLayers([busy], 5, false);
    expect(busy.sprite.currentFrame).toBe(0);
    const plain = { ...layer(), anim: { url: "", x: 0, y: 0, width: 1, height: 1, frames: 96 } };
    loopAnimLayers([plain], 5, true);
    expect(plain.sprite.currentFrame).toBe(0);
  });
});
