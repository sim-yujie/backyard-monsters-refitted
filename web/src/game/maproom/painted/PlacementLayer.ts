import { Container, Geometry, GlProgram, Mesh, RenderTexture, Shader, type Renderer, type TextureSource } from "pixi.js";
import type { CellRange } from "../zones";
import { DECAL_GRID, FEATURE_GRID, MARSH_GRID, ROCK_GRID } from "./canopy";
import { cellCentre, type CellShape } from "./cellShape";
import { GROUND_VERTEX, placementFragment, type PlacementGrid } from "./groundShader";

/**
 * Which sprite piece stands on each grid square round the view (Map Room 2 Modern look, plan step
 * 10): the ground details, sea rocks, edge trees and boulders, and the marsh's pieces.
 *
 * Whether a square holds a piece, and which, hangs on the square alone (its foot's ground, coast,
 * cliff, river, forest edge), never on the pixel. The ground shader used to work it out per pixel
 * for every square a pixel could see, which made it so big that Windows Chrome took 40 s to compile
 * it. Now a small program per grid works out each square once, into one texel of a placement atlas
 * (the four grids side by side), and the ground shader only reads it (`placedAt`). The atlas covers
 * the squares round the view with some slack, and is worked out again when the view leaves them or
 * the cells, rivers or Quality change.
 */

/** The grids, in the atlas's column order (the ground shader's uPlaceAt x, y, z, w). */
export const PLACEMENT_GRIDS: readonly PlacementGrid[] = ["decals", "rocks", "features", "marsh"];

/** Each grid's square, as a share of a cell's width. */
export const GRID_SHARE: Record<PlacementGrid, number> = {
  decals: DECAL_GRID,
  rocks: ROCK_GRID,
  features: FEATURE_GRID,
  marsh: MARSH_GRID,
};

/**
 * The cell width on screen (pixels) below which a grid's pieces have faded out (the ground shader's
 * detailFade, rockFade, treeFade and marshFade start here); under half of it the grid is not worked
 * out at all.
 */
export const FADE_START: Record<PlacementGrid, number> = { decals: 26, rocks: 7, features: 9, marsh: 12 };

/** Squares kept round the view's own (a pixel looks up to two squares away from its own). */
const MARGIN = 3;
/** Extra squares worked out each way, as a share of the view's, so a small pan needs no new pass. */
const SLACK = 0.25;
/** The atlas's largest side; a view needing more squares gets the middle ones. */
export const MAX_SIDE = 2048;

/** A block of grid squares: the first one's x and y, and how many across and down. */
export interface SquareRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const NO_SQUARES: SquareRect = { x: 0, y: 0, w: 0, h: 0 };

/** The world rectangle (points) round a cell range, a cell's margin each way. */
export const worldBounds = (shape: CellShape, range: CellRange): [number, number, number, number] => {
  const a = cellCentre(shape, range.minCol, range.minRow);
  const b = cellCentre(shape, range.maxCol, range.maxRow);
  return [
    Math.min(a.x, b.x) - shape.cellWidth,
    Math.min(a.y, b.y) - shape.cellHeight,
    Math.max(a.x, b.x) + shape.cellWidth,
    Math.max(a.y, b.y) + shape.cellHeight,
  ];
};

/** The squares (of `size` world points) a world rectangle needs, with the lookup's margin. */
export const squaresFor = (bounds: readonly [number, number, number, number], size: number): SquareRect => {
  const x = Math.floor(bounds[0] / size) - MARGIN;
  const y = Math.floor(bounds[1] / size) - MARGIN;
  return { x, y, w: Math.ceil(bounds[2] / size) + MARGIN + 1 - x, h: Math.ceil(bounds[3] / size) + MARGIN + 1 - y };
};

/** Whether `outer` holds every square of `inner`. */
export const holds = (outer: SquareRect, inner: SquareRect): boolean =>
  inner.w === 0 ||
  (outer.w > 0 &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h);

/** `needed` grown by the slack, and cut to {@link MAX_SIDE} round its middle. */
export const withSlack = (needed: SquareRect): SquareRect => {
  if (needed.w === 0) return NO_SQUARES;
  const grow = (start: number, count: number): [number, number] => {
    const extra = Math.ceil(count * SLACK);
    let first = start - extra;
    let total = count + 2 * extra;
    if (total > MAX_SIDE) {
      first += Math.floor((total - MAX_SIDE) / 2);
      total = MAX_SIDE;
    }
    return [first, total];
  };
  const [x, w] = grow(needed.x, needed.w);
  const [y, h] = grow(needed.y, needed.h);
  return { x, y, w, h };
};

interface Pass {
  readonly mesh: Mesh<Geometry, Shader>;
  readonly shader: Shader;
  readonly program: GlProgram;
  rect: SquareRect;
}

/** The placement programs, one per grid (`shaderWarmup.ts` compiles them ahead). */
export const placementProgram = (grid: PlacementGrid): GlProgram =>
  GlProgram.from({ vertex: GROUND_VERTEX, fragment: placementFragment(grid), name: `mr2-place-${grid}` });

export class PlacementLayer {
  private readonly passes = new Map<PlacementGrid, Pass>();
  private readonly root = new Container();
  private target: RenderTexture | null = null;
  private dirty = true;

  /**
   * groundUniforms is the ground shader's own uniform group (the programs read the same cells,
   * rivers and Quality); textures gives its current data and river pictures.
   */
  constructor(
    private readonly shape: CellShape,
    groundUniforms: unknown,
    textures: { uData: TextureSource; uRiver: TextureSource },
  ) {
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    for (const grid of PLACEMENT_GRIDS) {
      const program = placementProgram(grid);
      const shader = new Shader({
        glProgram: program,
        resources: {
          groundUniforms,
          placeUniforms: { uPlaceRect: { value: new Float32Array(4), type: "vec4<f32>" } },
          uData: textures.uData,
          uRiver: textures.uRiver,
        },
      });
      const mesh = new Mesh({ geometry, shader });
      mesh.visible = false;
      this.root.addChild(mesh);
      this.passes.set(grid, { mesh, shader, program, rect: NO_SQUARES });
    }
  }

  /** The programs, for the warm-up. */
  get programs(): GlProgram[] {
    return [...this.passes.values()].map((pass) => pass.program);
  }

  /** The cells, rivers or Quality changed: work the squares out again on the next update. */
  invalidate(): void {
    this.dirty = true;
  }

  /** The river picture was rebuilt as a new texture. */
  setRiverTexture(source: TextureSource): void {
    for (const pass of this.passes.values()) pass.shader.resources.uRiver = source;
    this.dirty = true;
  }

  /** The atlas, once it has been worked out. */
  get texture(): TextureSource | null {
    return this.target?.source ?? null;
  }

  /** A grid's squares in the atlas (none before its first pass, or when faded out). */
  rect(grid: PlacementGrid): SquareRect {
    return this.passes.get(grid)?.rect ?? NO_SQUARES;
  }

  /** The atlas column each grid starts at. */
  columns(): [number, number, number, number] {
    let x = 0;
    const out: number[] = [];
    for (const grid of PLACEMENT_GRIDS) {
      out.push(x);
      x += this.rect(grid).w;
    }
    return out as [number, number, number, number];
  }

  /**
   * Works the squares round `range` out again when the view has left them (or something changed).
   * cellPixels is a cell's width on screen; ready says which grids' programs have compiled (a grid
   * whose program is not ready yet shows no pieces). Returns whether the atlas changed.
   */
  update(
    renderer: Renderer,
    range: CellRange,
    cellPixels: number,
    ready: (grid: PlacementGrid) => boolean,
  ): boolean {
    const bounds = worldBounds(this.shape, range);
    const needed = new Map<PlacementGrid, SquareRect>();
    let stale = this.dirty;
    for (const grid of PLACEMENT_GRIDS) {
      const shown = ready(grid) && cellPixels >= FADE_START[grid] * 0.5;
      const want = shown ? squaresFor(bounds, GRID_SHARE[grid] * this.shape.cellWidth) : NO_SQUARES;
      needed.set(grid, want);
      const have = this.passes.get(grid)!.rect;
      if (!holds(have, want) || (want.w === 0) !== (have.w === 0)) stale = true;
    }
    if (!stale) return false;
    this.dirty = false;

    // Every grid gets the atlas's full height, so the rows line up however the target is flipped.
    const rects = PLACEMENT_GRIDS.map((grid) => withSlack(needed.get(grid)!));
    const height = Math.max(1, ...rects.map((rect) => rect.h));
    const width = Math.max(1, rects.reduce((sum, rect) => sum + rect.w, 0));
    if (!this.target || this.target.width < width || this.target.height < height) {
      this.target?.destroy(true);
      // Rounded up, so a slightly bigger view reuses it.
      this.target = RenderTexture.create({
        width: Math.min(MAX_SIDE * 4, Math.ceil(width / 256) * 256),
        height: Math.min(MAX_SIDE, Math.ceil(height / 128) * 128),
        resolution: 1,
        antialias: false,
      });
    }
    let column = 0;
    PLACEMENT_GRIDS.forEach((grid, index) => {
      const pass = this.passes.get(grid)!;
      const rect = rects[index]!;
      pass.rect = rect.w === 0 ? NO_SQUARES : { ...rect, h: height };
      pass.mesh.visible = rect.w > 0;
      pass.mesh.position.set(column, 0);
      pass.mesh.scale.set(rect.w, this.target!.height);
      const uniforms = (pass.shader.resources.placeUniforms as { uniforms: { uPlaceRect: Float32Array } }).uniforms;
      uniforms.uPlaceRect.set([rect.x, rect.y, column, 0]);
      column += rect.w;
    });
    renderer.render({ container: this.root, target: this.target, clear: true, clearColor: [0, 0, 0, 0] });
    return true;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    for (const pass of this.passes.values()) pass.shader.destroy();
    this.target?.destroy(true);
    this.target = null;
  }
}
