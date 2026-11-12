// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Assets, Texture, type Graphics } from "pixi.js";
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

  it("at Halloween fetches the dusky tile set instead of the grass", async () => {
    const load = vi.spyOn(Assets, "load").mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ground = new YardGround("original");
    ground.layout(bounds, 1, "plot");

    await ground.loadTiles();
    ground.setSeason("halloween");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(14));

    const roots = load.mock.calls.map(([url]) => String(url).replace(/[^/]+$/, ""));
    expect(roots.slice(0, 7).every((root) => root === "/assets/yardbg/grass/")).toBe(true);
    expect(roots.slice(7).every((root) => root === "/assets/yardbg/spooky/")).toBe(true);
    ground.destroy();
    load.mockRestore();
    warn.mockRestore();
  });

  it("lays nothing when the yard was left while its tiles were loading", async () => {
    let arrive!: (texture: Texture) => void;
    const pending = new Promise<Texture>((resolve) => (arrive = resolve));
    const load = vi.spyOn(Assets, "load").mockReturnValue(pending as never);
    const ground = new YardGround();
    ground.layout(bounds, 1, "plot");

    const loading = ground.loadTiles();
    ground.destroy();
    arrive(Texture.WHITE);

    await expect(loading).resolves.toBe(false);
    load.mockRestore();
  });

  /** The URLs the ground asks for, after `act`, with every load failing at once. */
  const fetched = async (ground: YardGround, act: () => void = () => {}): Promise<string[]> => {
    const load = vi.spyOn(Assets, "load").mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ground.layout(bounds, 1, "plot");
    act();
    await ground.loadTiles();
    const urls = load.mock.calls.map(([url]) => String(url));
    load.mockRestore();
    warn.mockRestore();
    ground.destroy();
    return urls;
  };

  it("lays the player's picked ground, the painted ones at High quality's 2x", async () => {
    expect(await fetched(new YardGround("meadow"))).toEqual([1, 2, 3, 4].map((n) => `/assets/yardbg/meadow/layer${n}@2x.webp`));
    expect(await fetched(new YardGround("sand"))).toHaveLength(4);
    expect((await fetched(new YardGround("sand")))[0]).toBe("/assets/yardbg/sand/2167_isosand1_isosand1.png");
  });

  it("changes ground at once when the player picks another", async () => {
    const ground = new YardGround("meadow");
    const urls = await fetched(ground, () => ground.setGround("snow"));
    expect(urls.at(-1)).toBe("/assets/yardbg/snow/layer4@2x.webp");
  });

  it("dresses only the grass grounds for Halloween; a picked ground and the Inferno's lava stay", async () => {
    const meadow = new YardGround("meadow");
    meadow.setSeason("halloween");
    expect((await fetched(meadow))[0]).toBe("/assets/yardbg/spooky/2174_isograss1_isograss1.png");
    const snow = new YardGround("snow");
    snow.setSeason("halloween");
    expect((await fetched(snow))[0]).toBe("/assets/yardbg/snow/layer1@2x.webp");
    const inferno = new YardGround("snow");
    const lava = vi.spyOn(Assets, "load").mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    inferno.layout(bounds, 1, "plot", "lava");
    await inferno.loadTiles();
    expect(String(lava.mock.calls[0]?.[0])).toMatch(/^\/assets\/yardbg\/lava\//);
    lava.mockRestore();
    warn.mockRestore();
    inferno.destroy();
  });

  it("draws the range ring dark only on a ground that would swallow white", () => {
    const snow = new YardGround("snow");
    snow.layout(bounds, 1, "plot");
    expect(snow.rangeInk()).not.toBeNull();
    snow.layout(bounds, 1, "plot", "lava");
    expect(snow.rangeInk()).toBeNull();
    for (const id of ["meadow", "original", "desert", "autumn", "swamp", "rock", "sand", "crater"] as const) {
      const ground = new YardGround(id);
      ground.layout(bounds, 1, "plot");
      expect(ground.rangeInk()).toBeNull();
      ground.destroy();
    }
    snow.destroy();
  });
});
