import { Assets, Container, Graphics, Texture, TilingSprite } from "pixi.js";
import { noiseMask } from "./groundNoise";
import type { YardBounds } from "./YardGrid";

/**
 * The ground the yard sits on: a tiled grass texture over the whole world, with
 * the plot boundary drawn over it on the player's own yard.
 *
 * ## How the original tiles it, and what this does instead
 *
 * The Flash client's `MAPBG.MakeTile` builds one 1000 x 500 texture out of the
 * seven 200 x 100 grass images in `server/public/assets/yardbg/grass/`. Each
 * image is first laid out on its own 5 x 5 grid, and then images two to seven
 * are composited over image one through Perlin-noise alpha masks seeded from the
 * base's own seed, so no two yards get the same grass
 * (`client/scripts/MAPBG.as:58-105`). `MAP.swapBG` then repeats that composite
 * on a plain 4 x 4 grid stepping exactly 1000 x 500, which is what the live
 * bitmap renderer does (`client/scripts/MAP.as:262-274`); the legacy
 * display-list path beside it steps 998 x 498 instead, overlapping by a pixel
 * to hide seams (`:277-289`). This follows the live path, so the tiling sprite
 * repeats on the block's own size with no overlap.
 *
 * This follows that structure exactly — same 1000 x 500 block, same layer
 * order, same per-layer feature sizes — on a 2D canvas, substituting seeded
 * value noise for Flash's `perlinNoise`, which is a specific implementation
 * whose output cannot be reproduced from the ActionScript. See
 * `groundNoise.ts`. The blend is not optional dressing: the seven images are
 * not variations on grass but different ground — packed earth, tufted grass,
 * gravel — so compositing them hard-edged gives a checkerboard rather than a
 * lawn.
 *
 * The images themselves are full 200 x 100 rectangles of texture rather than
 * isometric diamonds — the original lays them on a plain grid with no stagger,
 * which only works if they tile as rectangles. The size is the one the embedded
 * bitmap classes declare (`client/scripts/isograss1.as:6`); the extracted PNGs
 * under `yardbg/` match it, except `rock/` and `sand/`, which are 200 x 101.
 *
 * Note that the Flash client never reads `server/public/assets/yardbg/` at all:
 * it uses bitmaps embedded in the SWF, and the folder is the extracted form of
 * those, staged for this client.
 *
 * The composite is one canvas, built once when the yard opens. Everything after
 * that is a `TilingSprite` repeating it over the whole world, the plot and
 * what lies around it alike, as Flash laid one grass field under every yard
 * (`MAP.as:262-274`): one cohesive ground (#197), not a lawn on a dark
 * backdrop. See {@link GroundStyle} for the edge.
 */

/** Where the game server keeps the yard backgrounds. Proxied in development. */
const TILE_ROOT = "/assets/yardbg/grass/";

/**
 * The seven grass images, in the order `MAPBG` numbers them
 * (`client/scripts/MAPBG.as:58-68`: g1 is isograss1, g2 is isograss2, and so
 * on). The numeric prefixes are the asset ids the server serves them under.
 */
const GRASS_TILES = [
  "2174_isograss1_isograss1.png",
  "2175_isograss2_isograss2.png",
  "2172_isograss3_isograss3.png",
  "2173_isograss4_isograss4.png",
  "2177_isograss5_isograss5.png",
  "2178_isograss6_isograss6.png",
  "2176_isograss7_isograss7.png",
] as const;

/** One grass image, in pixels (`client/scripts/MAPBG.as:89`). */
const TILE_WIDTH = 200;
const TILE_HEIGHT = 100;

/** The composite, in tiles and in pixels (`client/scripts/MAPBG.as:84-96`). */
const BLOCK_COLUMNS = 5;
const BLOCK_ROWS = 5;
const BLOCK_WIDTH = TILE_WIDTH * BLOCK_COLUMNS;
const BLOCK_HEIGHT = TILE_HEIGHT * BLOCK_ROWS;

/** Grass green, shown until the tiles arrive and behind them if they never do. */
const GROUND_COLOUR = 0x4a7a3a;

/**
 * The plot edge on the own yard: a soft dark line with a faint light one just
 * inside it, so the edge reads on any grass without changing the ground on
 * either side of it (#197).
 */
const EDGE_SHADE = { width: 4, color: 0x1b2418, alpha: 0.5, alignment: 1 } as const;
const EDGE_LIGHT = { width: 2, color: 0xf2f7d8, alpha: 0.3, alignment: 0 } as const;

/**
 * How far past the world's edge the grass runs, in world pixels, so a view
 * zoomed out to fit a wide window, or panned to the margin, still stands on
 * grass rather than on the page background.
 */
const GROUND_MARGIN = 2_000;

/**
 * How the ground treats the plot edge.
 *
 * Both lay grass over the whole world, as the Flash client laid a 4000 x 2000
 * grass field under every yard (`MAP.as:262-274`). `plot` also marks the
 * plot's edge, subtly, for the player's own yard, where the edge is where
 * building stops: Flash drew the edge only in BUILD mode
 * (`client/scripts/MAP.as:362-365`). `open` has no edge at all, so an enemy
 * camp sits in open country rather than on a marked plot.
 */
export type GroundStyle = "plot" | "open";

/** A small deterministic generator, so one base seed always gives one yard. */
/** Covers a canvas with one image, on the plain grid `MAPBG` uses. */
const tile = (context: CanvasRenderingContext2D, image: CanvasImageSource): void => {
  for (let row = 0; row < BLOCK_ROWS; row++) {
    for (let column = 0; column < BLOCK_COLUMNS; column++) {
      context.drawImage(image, column * TILE_WIDTH, row * TILE_HEIGHT, TILE_WIDTH, TILE_HEIGHT);
    }
  }
};

export class YardGround {
  readonly root = new Container();

  private readonly surround = new Graphics();
  private readonly plot = new Graphics();
  private readonly clip = new Graphics();
  private readonly boundary = new Graphics();
  private tiles: TilingSprite | null = null;
  private composite: Texture | null = null;

  private bounds: YardBounds | null = null;
  private seed = 1;

  constructor() {
    // The clip is only ever used as a mask. Pixi takes it out of the ordinary
    // draw when it is assigned as one, so it must NOT be hidden here: a mask
    // that is not visible contributes nothing to the stencil and clips its
    // target down to nothing.
    this.root.addChild(this.surround, this.plot, this.clip, this.boundary);
  }

  /** Draws the plot outline and the flat fill. Safe to call before the art. */
  layout(bounds: YardBounds, seed: number, style: GroundStyle = "plot"): void {
    this.bounds = bounds;
    this.seed = seed;

    const corners = bounds.corners;
    const first = corners[0];
    if (!first) return;

    // The grass covers everything the camera can reach, plot or not, and a
    // margin beyond it.
    const [left, top] = [-GROUND_MARGIN, -GROUND_MARGIN];
    const [right, bottom] = [bounds.width + GROUND_MARGIN, bounds.height + GROUND_MARGIN];
    const world = [left, top, right, top, right, bottom, left, bottom];

    // A wash under the grass, so the ground is green before the tiles arrive.
    this.surround
      .clear()
      .rect(left, top, right - left, bottom - top)
      .fill({ color: GROUND_COLOUR });

    this.plot.clear().poly(world).fill({ color: GROUND_COLOUR });
    this.clip.clear().poly(world).fill({ color: 0xffffff });
    this.boundary.clear();
    if (style === "plot") {
      const edge = corners.flatMap((point) => [point.x, point.y]);
      this.boundary.poly(edge).stroke(EDGE_SHADE);
      this.boundary.poly(edge).stroke(EDGE_LIGHT);
    }

    if (this.tiles) this.sizeTiles(bounds);
  }

  /**
   * Fetches the grass and lays it over the flat fill.
   *
   * Resolves false if the art did not arrive, in which case the flat colour
   * stays — a yard on plain green is a yard you can still read.
   */
  async loadTiles(): Promise<boolean> {
    const bounds = this.bounds;
    if (!bounds || this.tiles) return this.tiles !== null;

    let textures: Texture[];
    try {
      textures = await Promise.all(
        GRASS_TILES.map((file) => Assets.load<Texture>(TILE_ROOT + file)),
      );
    } catch (caught) {
      console.warn("Yard grass did not load; the plot stays a flat colour.", caught);
      return false;
    }

    const composite = this.bakeComposite(textures);
    if (!composite) return false;
    this.composite = composite;

    const tiles = new TilingSprite({ texture: this.composite, width: 1, height: 1 });
    tiles.mask = this.clip;
    this.tiles = tiles;
    this.sizeTiles(bounds);

    // Above the flat fill, below the boundary stroke.
    this.root.addChildAt(tiles, this.root.getChildIndex(this.clip));
    return true;
  }

  destroy(): void {
    this.tiles?.destroy();
    this.tiles = null;
    this.composite?.destroy(true);
    this.composite = null;
    this.root.destroy({ children: true });
  }

  private sizeTiles(bounds: YardBounds): void {
    if (!this.tiles) return;
    // Out to the margin, with the tile grid still anchored at the world's
    // origin, where Flash's grass field started.
    this.tiles.position.set(-GROUND_MARGIN, -GROUND_MARGIN);
    this.tiles.tilePosition.set(GROUND_MARGIN % BLOCK_WIDTH, GROUND_MARGIN % BLOCK_HEIGHT);
    this.tiles.width = bounds.width + 2 * GROUND_MARGIN;
    this.tiles.height = bounds.height + 2 * GROUND_MARGIN;
  }

  /**
   * One 1000 x 500 block of grass, composited once.
   *
   * Layer one is laid down solid; each later layer is tiled onto its own canvas,
   * punched through by a noise mask, and drawn over the result. Returns null if
   * the browser will not give a 2D context or the decoded images cannot be read,
   * in which case the plot keeps its flat colour.
   */
  private bakeComposite(textures: Texture[]): Texture | null {
    const canvas = document.createElement("canvas");
    canvas.width = BLOCK_WIDTH;
    canvas.height = BLOCK_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const images = textures
      .map((texture) => texture.source.resource as CanvasImageSource | null | undefined)
      .filter((resource): resource is CanvasImageSource => Boolean(resource));
    const base = images[0];
    if (!base) return null;

    try {
      tile(context, base);

      // client/scripts/MAPBG.as:100-105: layer n is masked with
      // perlinNoise(50 * n, 25 * n, 2, seed + 1 + n).
      for (let layer = 1; layer < images.length; layer++) {
        const image = images[layer];
        if (!image) continue;

        const over = document.createElement("canvas");
        over.width = BLOCK_WIDTH;
        over.height = BLOCK_HEIGHT;
        const overContext = over.getContext("2d");
        if (!overContext) continue;

        tile(overContext, image);
        overContext.globalCompositeOperation = "destination-in";
        overContext.drawImage(
          noiseMask(
            BLOCK_WIDTH,
            BLOCK_HEIGHT,
            50 * (layer + 1),
            25 * (layer + 1),
            this.seed + 1 + layer,
          ),
          0,
          0,
        );

        context.drawImage(over, 0, 0);
      }
    } catch (caught) {
      console.warn("Yard grass could not be composited; the plot stays flat.", caught);
      return null;
    }

    return Texture.from(canvas);
  }
}
