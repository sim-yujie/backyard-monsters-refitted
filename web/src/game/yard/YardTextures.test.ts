import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture, TextureSource } from "pixi.js";
import { setDeviceTextureLimit } from "@/game/quality";
import { RETRY_DELAYS_MS } from "./retryLoad";
import { YardTextures } from "./YardTextures";
import type { ResolvedAnim, ResolvedImage } from "./buildingArt";

/**
 * A picture that fails to load is asked for again before the yard gives up on
 * it, as Flash's `ImageCache` did: one broken answer on a first load must not
 * leave a building without its picture until the page is reloaded.
 */

const wall: ResolvedImage = { url: "/assets/buildings/walls/top.1.png", x: 0, y: 0, frame: null };

const gun: ResolvedAnim = {
  url: "/assets/buildings/lasertower/anim.png",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  frames: 4,
  columns: 2,
};

/** Every wait the retries make, run straight through. */
const waitAll = async () => {
  for (const delay of RETRY_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay);
};

describe("YardTextures: a picture that does not load", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is asked for again and used when a later try works", async () => {
    let calls = 0;
    vi.spyOn(Assets, "load").mockImplementation((() => {
      calls++;
      return calls < 3 ? Promise.reject(new Error("broken answer")) : Promise.resolve(Texture.WHITE);
    }) as typeof Assets.load);
    const arrived: string[] = [];
    const textures = new YardTextures((key) => arrived.push(key));

    expect(textures.get(wall)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    // Failed once and waiting to ask again: still on its way, not missing.
    expect(textures.isMissing(wall)).toBe(false);
    expect(arrived).toEqual([]);

    await waitAll();
    expect(calls).toBe(3);
    expect(textures.get(wall)).toBe(Texture.WHITE);
    expect(arrived).toEqual([wall.url]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("counts as missing only after five tries, and is not asked for again after that", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const arrived: string[] = [];
    const textures = new YardTextures((key) => arrived.push(key));

    textures.get(wall);
    // Asking every frame while the retries wait does not start another fetch.
    for (let frame = 0; frame < 10; frame++) textures.get(wall);
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of RETRY_DELAYS_MS.slice(0, -1)) {
      await vi.advanceTimersByTimeAsync(delay);
      expect(textures.isMissing(wall)).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS.at(-1)!);

    expect(load).toHaveBeenCalledTimes(5);
    expect(textures.isMissing(wall)).toBe(true);
    expect(arrived).toEqual([wall.url]);
    expect(warn).toHaveBeenCalledOnce();

    expect(textures.get(wall)).toBeNull();
    await waitAll();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it("knows a failed strip with columns is missing", async () => {
    vi.spyOn(Assets, "load").mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const textures = new YardTextures(() => {});

    expect(textures.strip(gun)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    await waitAll();
    expect(textures.isStripMissing(gun)).toBe(true);
  });

  it("stops asking once the yard is gone", async () => {
    const load = vi
      .spyOn(Assets, "load")
      .mockImplementation((() => Promise.reject(new Error("gone"))) as typeof Assets.load);
    const textures = new YardTextures(() => {});

    textures.get(wall);
    await vi.advanceTimersByTimeAsync(0);
    textures.destroy();
    await waitAll();
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("YardTextures: a picture bigger than the graphics card holds", () => {
  /** A 3D turret strip: 32 cells of 64 x 51 at 2x, 4096 x 102 px... */
  const turret: ResolvedAnim = {
    url: "/assets/buildings/railguntower/turret.t1@2x.webp",
    x: 0,
    y: 0,
    width: 64,
    height: 51,
    frames: 32,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setDeviceTextureLimit(null);
  });

  /** ...made 6144 px wide, as the Railgun's is, so it passes a 4096 px card. */
  const wideStrip = (): Texture =>
    new Texture({
      source: new TextureSource({ width: 3072, height: 51, resolution: 2, resource: { picture: true } as never }),
    });

  const canvasDocument = (): void => {
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }),
    });
  };

  it("copies each cell out on its own, so no tower is drawn as a black box", async () => {
    canvasDocument();
    setDeviceTextureLimit(4096);
    const strip = wideStrip();
    vi.spyOn(Assets, "load").mockImplementation((() => Promise.resolve(strip)) as typeof Assets.load);
    const textures = new YardTextures(() => {});
    expect(textures.strip(turret)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cells = textures.strip(turret)!;
    expect(cells.length).toBeGreaterThan(1);
    for (const cell of cells) {
      expect(cell.source).not.toBe(strip.source);
      expect(cell.source.resolution).toBe(2);
    }
    const destroyed = vi.spyOn(cells[0]!, "destroy");
    textures.destroy();
    // A copy owns its canvas, so it goes with it.
    expect(destroyed).toHaveBeenCalledWith(true);
  });

  it("frames the cells over the one picture on a card that holds it", async () => {
    canvasDocument();
    setDeviceTextureLimit(8192);
    const strip = wideStrip();
    vi.spyOn(Assets, "load").mockImplementation((() => Promise.resolve(strip)) as typeof Assets.load);
    const textures = new YardTextures(() => {});
    textures.strip(turret);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const cell of textures.strip(turret)!) expect(cell.source).toBe(strip.source);
  });
});
