import { Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { planFlights, type Flight } from "./collectFx";
import { CollectFxLayer, type CollectFxArt } from "./CollectFxLayer";

/** The balls' sprites (#208): placed each frame, landed with their shares, pooled. */

const art = (): CollectFxArt => ({
  dot: () => Texture.EMPTY,
  shadow: Texture.EMPTY,
  destroy: vi.fn(),
});

const flights = (amount: number): Flight[] =>
  planFlights([{ type: 2, x: 0, y: 0, resource: "r2", amount }], { x: 600, y: 0 }, () => 0);

const dotsOf = (layer: CollectFxLayer) => layer.root.children[1]!.children;
const shadowsOf = (layer: CollectFxLayer) => layer.root.children[0]!.children;

describe("CollectFxLayer", () => {
  it("shows each ball once its delay is up and moves it along its arc", () => {
    const layer = new CollectFxLayer({ art: art() });
    layer.launch(flights(300), () => {});
    expect(layer.flying).toBe(3);
    layer.update(0.05);
    const visible = dotsOf(layer).filter((dot) => dot.visible);
    expect(visible).toHaveLength(1);
    // Lifted off the line: drawn above where the ball is on the ground.
    expect(visible[0]!.y).toBeLessThan(-24);
  });

  it("hands each ball's share over as it lands, adding up to the bank", () => {
    const layer = new CollectFxLayer({ art: art() });
    const onLand = vi.fn();
    layer.launch(flights(30_001), onLand);
    for (let frame = 0; frame < 60 * 8 && layer.flying > 0; frame++) layer.update(1 / 60);
    expect(layer.flying).toBe(0);
    expect(onLand).toHaveBeenCalledTimes(12);
    const total = onLand.mock.calls.reduce((sum, [, share]) => sum + (share as number), 0);
    expect(total).toBe(30_001);
    expect(onLand.mock.calls.every(([resource]) => resource === "r2")).toBe(true);
    expect(dotsOf(layer).every((dot) => !dot.visible)).toBe(true);
  });

  it("reuses its sprites for the next bank", () => {
    const layer = new CollectFxLayer({ art: art() });
    layer.launch(flights(30_001), () => {});
    layer.update(10);
    layer.launch(flights(30_001), () => {});
    expect(dotsOf(layer)).toHaveLength(12);
    expect(shadowsOf(layer)).toHaveLength(12);
  });

  it("takes one throw's balls away without landing them, leaving the others", () => {
    const layer = new CollectFxLayer({ art: art() });
    const kept = vi.fn();
    const dropped = vi.fn();
    layer.launch(flights(50), kept);
    const group = layer.launch(flights(500), dropped);
    layer.update(0.1);
    layer.cancel(group);
    expect(layer.flying).toBe(1);
    expect(dotsOf(layer).filter((dot) => dot.visible)).toHaveLength(1);
    layer.update(10);
    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it("lands every ball at once on finish, and on destroy", () => {
    const layer = new CollectFxLayer({ art: art() });
    const onLand = vi.fn();
    layer.launch(flights(500), onLand);
    layer.finish();
    expect(onLand).toHaveBeenCalledTimes(4);
    expect(layer.flying).toBe(0);

    const other = new CollectFxLayer({ art: art() });
    const late = vi.fn();
    other.launch(flights(50), late);
    other.destroy();
    expect(late).toHaveBeenCalledWith("r2", 50);
  });
});
