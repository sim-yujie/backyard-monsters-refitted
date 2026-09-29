// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { readYard } from "./yardModel";
import { YardGround } from "./YardGround";

/**
 * One cohesive ground (#197): grass is laid over the whole world and a margin
 * past it, the player's plot and what lies around it alike; only the own
 * yard's plot edge is drawn over it, and a foreign yard has none.
 */

const bounds = readYard({ error: 0, buildingdata: {}, storedata: {} } as unknown as BaseLoadResponse).bounds;

/** The ground's layers, in the order the constructor adds them. */
const layers = (ground: YardGround) => {
  const [surround, plot, clip, boundary] = ground.root.children as Graphics[];
  return { surround: surround!, plot: plot!, clip: clip!, boundary: boundary! };
};

describe("YardGround", () => {
  it("lays the ground past the whole world, not just the plot, on the own yard", () => {
    const ground = new YardGround();
    ground.layout(bounds, 1, "plot");
    const { clip, surround } = layers(ground);
    for (const layer of [clip, surround]) {
      const box = layer.getLocalBounds();
      expect(box.x).toBeLessThan(0);
      expect(box.y).toBeLessThan(0);
      expect(box.x + box.width).toBeGreaterThan(bounds.width);
      expect(box.y + box.height).toBeGreaterThan(bounds.height);
    }
    // The plot edge is drawn, along the plot diamond.
    const edge = layers(ground).boundary.getLocalBounds();
    expect(edge.width).toBeGreaterThan(0);
    expect(edge.width).toBeLessThan(bounds.width + 10);
    ground.destroy();
  });

  it("draws no edge on a foreign yard's open ground", () => {
    const ground = new YardGround();
    ground.layout(bounds, 1, "open");
    expect(layers(ground).boundary.getLocalBounds().width).toBe(0);
    ground.destroy();
  });
});
