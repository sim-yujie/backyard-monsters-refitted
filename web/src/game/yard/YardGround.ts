import { Assets, Container, Graphics, Texture, TilingSprite } from "pixi.js";
import type { Season } from "@/game/season";
import { noiseMask } from "./groundNoise";
import { currentGround, GROUNDS, groundUrls, type GroundId, type GroundSpec } from "./groundChoice";
import { leafSpots, PROP_BOXES, PROP_SCALE, PROPS_ART, recolourGround, thanksgivingSkin } from "./thanksgivingSkin";
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

/**
 * The Halloween set: Flash's seven grass images recoloured to a dusky
 * purple-grey with dead grass (a luminance gradient map, so each keeps its
 * texture and the blend works unchanged), under the same file names. It
 * dresses the grass grounds (`groundChoice.ts`: Original and Meadow);
 * Thanksgiving takes the grass ground in use and recolours the baked block
 * itself, by the chosen look (`thanksgivingSkin.ts`), and scatters its leaves
 * on it. A player who picked another ground keeps it through an event.
 */
const SPOOKY: GroundSpec = {
  ...GROUNDS.original,
  root: "/assets/yardbg/spooky/",
  fill: 0x5a4c5e,
};

/**
 * The Inferno yard's ground: Flash's four lava images, `inferno_lava1` to
 * `inferno_lava4`, composited the same way as the grass (`MAPBG.as:30-37`;
 * `BASE.as:1493-1495` picks `"lava"` on an Inferno yard). In the order
 * `MAPBG` numbers them, g1 to g4; the numeric prefixes are the asset ids.
 * Lava is lava whatever ground the player picked, and in every season.
 */
const LAVA: GroundSpec = {
  ...GROUNDS.original,
  root: "/assets/yardbg/lava/",
  files: [
    "2169_inferno_lava1_inferno_lava1.png",
    "2171_inferno_lava2_inferno_lava2.png",
    "2170_inferno_lava3_inferno_lava3.png",
    "2165_inferno_lava4_inferno_lava4.png",
  ],
  // The lava's dark crust, shown until its tiles arrive.
  fill: 0x3a1a12,
  grass: false,
};

/**
 * What the ground is made of: the player's ground (dressed for the season) on
 * the surface, lava on an Inferno yard. Flash took no season dressing in the Inferno.
 */
export type Terrain = "grass" | "lava";

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


/** Covers a canvas with one image, on the plain grid `MAPBG` uses. */
const tile = (
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  [columns, rows]: readonly [number, number],
  width: number,
  height: number,
): void => {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      context.drawImage(image, column * width, row * height, width, height);
    }
  }
};

/** One block of ground: its art, its size in world pixels and how many canvas pixels each holds. */
interface Block {
  readonly spec: GroundSpec;
  readonly urls: readonly string[];
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

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
  private style: GroundStyle = "plot";
  private season: Season = "normal";
  private terrain: Terrain = "grass";
  private ground: GroundId;

  /** `ground` is the player's pick (`groundChoice.ts`) unless a caller names one. */
  constructor(ground: GroundId = currentGround()) {
    this.ground = ground;
    // The clip is only ever used as a mask. Pixi takes it out of the ordinary
    // draw when it is assigned as one, so it must NOT be hidden here: a mask
    // that is not visible contributes nothing to the stencil and clips its
    // target down to nothing.
    this.root.addChild(this.surround, this.plot, this.clip, this.boundary);
  }

  /** The ground's art now: lava in the Inferno, the event's dress on a grass ground, else the pick. */
  private spec(): GroundSpec {
    if (this.terrain === "lava") return LAVA;
    const picked = GROUNDS[this.ground];
    if (picked.grass && this.season === "halloween") return SPOOKY;
    return picked;
  }

  /** Thanksgiving's leaves and recolour, on a grass ground only. */
  private autumn(): boolean {
    return this.season === "thanksgiving" && this.terrain === "grass" && GROUNDS[this.ground].grass === true;
  }

  /** The flat colour under the tiles. */
  private colour(): number {
    return this.autumn() ? thanksgivingSkin().fill : this.spec().fill;
  }

  /**
   * The colour the tower range ring is drawn in on this ground, or null for
   * Flash's white: only a ground light enough to swallow white (Snow) has one.
   */
  rangeInk(): number | null {
    return this.terrain === "lava" || this.autumn() ? null : (this.spec().rangeInk ?? null);
  }

  /** Draws the plot outline and the flat fill. Safe to call before the art. */
  layout(bounds: YardBounds, seed: number, style: GroundStyle = "plot", terrain: Terrain = "grass"): void {
    if (terrain !== this.terrain) {
      // Another yard's ground: the tiles in hand are the wrong ones.
      this.terrain = terrain;
      this.dropTiles();
    }
    this.bounds = bounds;
    this.seed = seed;
    this.style = style;
    const colour = this.colour();

    const corners = bounds.corners;
    const first = corners[0];
    if (!first) return;

    // The ground covers everything the camera can reach, plot or not, and a
    // margin beyond it.
    const [left, top] = [-GROUND_MARGIN, -GROUND_MARGIN];
    const [right, bottom] = [bounds.width + GROUND_MARGIN, bounds.height + GROUND_MARGIN];
    const world = [left, top, right, top, right, bottom, left, bottom];

    // A wash under the tiles, so the ground has its colour before they arrive.
    this.surround
      .clear()
      .rect(left, top, right - left, bottom - top)
      .fill({ color: colour });

    this.plot.clear().poly(world).fill({ color: colour });
    this.clip.clear().poly(world).fill({ color: 0xffffff });
    this.boundary.clear();
    if (style === "plot") {
      const edge = corners.flatMap((point) => [point.x, point.y]);
      this.boundary.poly(edge).stroke(EDGE_SHADE);
      this.boundary.poly(edge).stroke(EDGE_LIGHT);
    }

    if (this.tiles) this.sizeTiles(bounds);
  }

  /** The block the ground is baked into, by its art and the Quality setting. */
  private block(): Block {
    const spec = this.spec();
    const { urls, scale } = groundUrls(spec);
    return {
      spec,
      urls,
      scale,
      width: spec.tile[0] * spec.repeat[0],
      height: spec.tile[1] * spec.repeat[1],
    };
  }

  /**
   * Fetches the ground's images and lays them over the flat fill.
   *
   * Resolves false if the art did not arrive, in which case the flat colour
   * stays — a yard on a plain colour is a yard you can still read.
   */
  async loadTiles(): Promise<boolean> {
    const bounds = this.bounds;
    if (!bounds || this.tiles) return this.tiles !== null;
    const [season, terrain, ground] = [this.season, this.terrain, this.ground];
    const block = this.block();

    // Thanksgiving's fallen leaves come from the props picture; a ground
    // without them is still a ground, so a miss only drops the leaves.
    const autumn = this.autumn();
    const leaves = autumn ? Assets.load<Texture>(PROPS_ART).catch(() => null) : Promise.resolve(null);

    let textures: Texture[];
    let leafArt: Texture | null;
    try {
      [textures, leafArt] = await Promise.all([Promise.all(block.urls.map((url) => Assets.load<Texture>(url))), leaves]);
    } catch (caught) {
      console.warn("Yard ground did not load; the plot stays a flat colour.", caught);
      return false;
    }

    // The season, the terrain or the ground changed while these were in
    // flight: the newer load lays its own.
    if (season !== this.season || terrain !== this.terrain || ground !== this.ground || this.tiles) {
      return this.tiles !== null;
    }
    // The yard was left (e.g. for the map) while these were in flight: there
    // is nothing to lay them on ("The supplied Container must be a child of
    // the caller", 5 players, 3-6 Nov 2026).
    if (this.root.destroyed || this.clip.destroyed || this.clip.parent !== this.root) return false;

    const composite = this.bakeComposite(block, textures, autumn ? { leaves: leafArt } : null);
    if (!composite) return false;
    this.composite = composite;

    const tiles = new TilingSprite({ texture: this.composite, width: 1, height: 1 });
    // A painted ground is baked at 2x (or 1.5x): drawn back at world size.
    tiles.tileScale.set(1 / block.scale);
    tiles.mask = this.clip;
    this.tiles = tiles;
    this.sizeTiles(bounds);

    // Above the flat fill, below the boundary stroke.
    this.root.addChildAt(tiles, this.root.getChildIndex(this.clip));
    return true;
  }

  /**
   * Re-dresses the ground for `season` (`game/season.ts`): the fill colour at
   * once, the tiles as soon as the season's set arrives. A no-op when the
   * season is the one already shown.
   */
  setSeason(season: Season): void {
    if (season === this.season) return;
    this.season = season;
    // Lava is lava in every season.
    if (this.terrain === "lava") return;
    this.redress();
  }

  /** Lays the player's newly picked ground (`groundChoice.ts`) at once. */
  setGround(ground: GroundId): void {
    if (ground === this.ground) return;
    this.ground = ground;
    if (this.terrain === "lava") return;
    this.redress();
  }

  destroy(): void {
    this.dropTiles();
    this.root.destroy({ children: true });
  }

  private redress(): void {
    this.dropTiles();
    if (!this.bounds) return;
    this.layout(this.bounds, this.seed, this.style, this.terrain);
    void this.loadTiles();
  }

  private dropTiles(): void {
    this.tiles?.destroy();
    this.tiles = null;
    this.composite?.destroy(true);
    this.composite = null;
  }

  private sizeTiles(bounds: YardBounds): void {
    if (!this.tiles) return;
    const { width, height } = this.block();
    // Out to the margin, with the tile grid still anchored at the world's
    // origin, where Flash's grass field started.
    this.tiles.position.set(-GROUND_MARGIN, -GROUND_MARGIN);
    this.tiles.tilePosition.set(GROUND_MARGIN % width, GROUND_MARGIN % height);
    this.tiles.width = bounds.width + 2 * GROUND_MARGIN;
    this.tiles.height = bounds.height + 2 * GROUND_MARGIN;
  }

  /**
   * One block of ground, composited once: Flash's 1000 x 500 of 200 x 100
   * images, or a painted ground's 800 x 400 of 400 x 200, at the painted
   * scale.
   *
   * Layer one is laid down solid; each later layer is tiled onto its own canvas,
   * punched through by a noise mask, and drawn over the result. Returns null if
   * the browser will not give a 2D context or the decoded images cannot be read,
   * in which case the plot keeps its flat colour.
   */
  private bakeComposite(
    block: Block,
    textures: Texture[],
    autumn: { leaves: Texture | null } | null = null,
  ): Texture | null {
    const { spec, scale } = block;
    const [width, height] = [Math.round(block.width * scale), Math.round(block.height * scale)];
    const [tileWidth, tileHeight] = [spec.tile[0] * scale, spec.tile[1] * scale];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;

    const images = textures
      .map((texture) => texture.source.resource as CanvasImageSource | null | undefined)
      .filter((resource): resource is CanvasImageSource => Boolean(resource));
    const base = images[0];
    if (!base) return null;

    try {
      tile(context, base, spec.repeat, tileWidth, tileHeight);

      // client/scripts/MAPBG.as:100-105: layer n is masked with
      // perlinNoise(50 * n, 25 * n, 2, seed + 1 + n).
      for (let layer = 1; layer < images.length; layer++) {
        const image = images[layer];
        if (!image) continue;

        const over = document.createElement("canvas");
        over.width = width;
        over.height = height;
        const overContext = over.getContext("2d");
        if (!overContext) continue;

        tile(overContext, image, spec.repeat, tileWidth, tileHeight);
        overContext.globalCompositeOperation = "destination-in";
        overContext.drawImage(
          noiseMask(
            width,
            height,
            50 * (layer + 1) * scale,
            25 * (layer + 1) * scale,
            this.seed + 1 + layer,
            spec.ramps?.[layer - 1] ?? null,
          ),
          0,
          0,
        );

        context.drawImage(over, 0, 0);
      }
      if (autumn) this.dressForAutumn(context, block, autumn.leaves);
    } catch (caught) {
      console.warn("Yard ground could not be composited; the plot stays flat.", caught);
      return null;
    }

    return Texture.from(canvas);
  }

  /**
   * Thanksgiving: recolours the baked block by the chosen look's gradient map
   * and lays its fallen leaves on it (`thanksgivingSkin.ts`), once, when the
   * ground is baked. A leaf near an edge is drawn again across it, so the
   * repeat of the block shows no cut leaves.
   */
  private dressForAutumn(context: CanvasRenderingContext2D, block: Block, leafArt: Texture | null): void {
    const skin = thanksgivingSkin();
    const { width, height, scale } = block;
    try {
      const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
      recolourGround(pixels.data, skin);
      context.putImageData(pixels, 0, 0);
    } catch (caught) {
      // A canvas the browser will not read back: the grass stays green.
      console.warn("Thanksgiving ground could not be recoloured; the grass stays green.", caught);
    }

    const image = leafArt?.source.resource as CanvasImageSource | null | undefined;
    if (!image) return;
    for (const leaf of leafSpots(skin, width, height, this.seed)) {
      const box = PROP_BOXES[leaf.kind];
      const [w, h] = [box.w * PROP_SCALE, box.h * PROP_SCALE];
      for (const dx of [-width, 0, width]) {
        for (const dy of [-height, 0, height]) {
          const [x, y] = [leaf.x + dx, leaf.y + dy];
          if (x < -w || y < -w || x > width + w || y > height + w) continue;
          context.save();
          // World pixels onto a block baked at 2x (or 1.5x).
          context.scale(scale, scale);
          context.translate(x, y);
          context.rotate(leaf.angle);
          // Squashed to the ground's tilt: a leaf lying flat in the yard.
          context.scale(1, 0.6);
          context.drawImage(image, box.x, box.y, box.w, box.h, -w / 2, -h / 2, w, h);
          context.restore();
        }
      }
    }
  }
}
