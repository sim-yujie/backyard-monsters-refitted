import { steppedSeconds } from "../animationClock";
import {
  Assets,
  BufferImageSource,
  CanvasSource,
  Geometry,
  GlProgram,
  Mesh,
  Shader,
  type Renderer,
  type TextureSource,
} from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { onQualityChange, quality, sheetAtQuality, type Quality } from "@/game/quality";
import { FOG_COLOUR, LOADING_COLOUR } from "../cellVisuals";
import type { ZoneRecord } from "../ZoneStore";
import type { CellRange } from "../zones";
import { cellCentre, paintedCellShape, textureAspect, type CellShape } from "./cellShape";
import { SPRITE_ROWS, SPRITE_SHEET_ROWS } from "./canopy";
import { GroundData } from "./GroundData";
import { GroundTexture, SHADER_TEXTURES } from "./groundKinds";
import { GROUND_SAMPLERS, GROUND_VERTEX, groundFragment } from "./groundShader";
import { PLACEMENT_GRIDS, PlacementLayer, placementProgram } from "./PlacementLayer";
import { RiverLayer } from "./RiverLayer";
import type { RiverCells } from "./riverPaths";
import type { ProgramWarmer } from "./shaderWarmup";
import { MR2_FULL_LOOK, markOnce, timeArt, timeCut } from "../openMarks";

/** The ground texture atlas, 4 textures a row (`web/tools/mr2-paint/build.py`). */
const ATLAS_URL = `${import.meta.env.BASE_URL}maproom/painted/ground@4x.webp`;
const ATLAS_COLUMNS = 4;
/**
 * Each atlas square is its texture framed in a gutter of itself, wrapped, 1/32 of the texture's size
 * on every side (`web/tools/mr2-paint/build.py`), cut off here: without it WebP's smoothing and the
 * smaller Qualities' resize bled the neighbouring squares into each texture's edge, a straight line
 * wherever it repeats (MR2 step 11, clearest in the shallows on Low).
 */
export const GROUND_GUTTER = 1 / 32;

/**
 * The sprite sheets the shader places (plan steps 2, 3 and 6): ground details (3 rows), sea rocks
 * (2 rows), edge trees and pines (2 rows), boulders and the marsh pieces (4 rows), 4 frames a row,
 * joined into one 4 x 11 sheet on load so they take one sampler (`canopy.ts` `SPRITE_SHEET_ROWS`).
 */
const DECALS_URL = `${import.meta.env.BASE_URL}maproom/painted/decals@4x.webp`;
const SPRITE_SHEETS: readonly { url: string; rows: number }[] = [
  { url: DECALS_URL, rows: SPRITE_SHEET_ROWS.decals },
  { url: `${import.meta.env.BASE_URL}maproom/painted/sea-rocks@4x.webp`, rows: SPRITE_SHEET_ROWS.seaRocks },
  { url: `${import.meta.env.BASE_URL}maproom/painted/forest-bits-pieces@4x.webp`, rows: SPRITE_SHEET_ROWS.forest },
  { url: `${import.meta.env.BASE_URL}maproom/painted/marsh-rocks@4x.webp`, rows: SPRITE_SHEET_ROWS.marshRocks },
];
const SPRITE_COLUMNS = 4;
/** The cliff faces and their pieces (plan step 5, `hills.ts` says where each strip sits). */
const CLIFFS_URL = `${import.meta.env.BASE_URL}maproom/painted/cliffs@4x.webp`;

/** World points one texture repeat covers across: two cells. */
const TEXTURE_CELLS = 2;

/** Mock-up B's hex lines: light cream at about 30%. */
const LINE_COLOUR = [1.0, 0.97, 0.86, 0.3] as const;

/** Flat stand-ins until the atlas lands, by sampler: the textures' average colours. */
const STAND_INS = [
  "#9cc63a", "#6fae2a", "#e7b860", "#7f725e", "#4c4a2c",
  "#5e8a2c", "#e9eef4", "#a2c040", "#3cc4d4", "#1f62b8", "#d9a85a", "#3f8fd8",
];

/** The ground shader's uniforms this class changes after it is made. */
interface GroundUniforms {
  uQuality: number;
  uTime: number;
  uSpritesReady: number;
  uCliffsReady: number;
  uRiverOn: number;
  uRiverRect: Float32Array;
  uFog: Float32Array;
  uDecalRect: Float32Array;
  uRockRect: Float32Array;
  uFeatureRect: Float32Array;
  uMarshRect: Float32Array;
  uPlaceAt: Float32Array;
}

const RECT_UNIFORM = { decals: "uDecalRect", rocks: "uRockRect", features: "uFeatureRect", marsh: "uMarshRect" } as const;

const QUALITY_LEVEL: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

/**
 * The ground's program for one Quality (`shaderWarmup.ts` compiles it ahead). Each Quality has its
 * own, with the level fixed in the source: Low's compiles in a few seconds, so the painted look shows
 * quickly the first time, and the player's own level takes over when it has compiled (plan step 10).
 */
export const groundProgram = (level: Quality): GlProgram => {
  // Kept, since the ground asks for its program every frame (the source is ~60 kB of text).
  let program = GROUND_PROGRAMS.get(level);
  if (!program) {
    program = GlProgram.from({ vertex: GROUND_VERTEX, fragment: groundFragment(level), name: `mr2-painted-ground-${level}` });
    GROUND_PROGRAMS.set(level, program);
  }
  return program;
};
const GROUND_PROGRAMS = new Map<Quality, GlProgram>();

/** The foam texture's brightness (luma) for each pixel of its RGBA bytes. */
const lumaOf = (r: number, g: number, b: number): number => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

/**
 * The wet sand's colour with the foam's brightness in its alpha (the shader's surf reads it there,
 * which saves a texture slot: WebGL2 promises only 16). Pure, for the tests.
 */
export const withFoamAlpha = (wetSand: Uint8ClampedArray, foam: Uint8ClampedArray): Uint8Array => {
  const out = new Uint8Array(wetSand.length);
  for (let i = 0; i < wetSand.length; i += 4) {
    out[i] = wetSand[i]!;
    out[i + 1] = wetSand[i + 1]!;
    out[i + 2] = wetSand[i + 2]!;
    out[i + 3] = lumaOf(foam[i]!, foam[i + 1]!, foam[i + 2]!);
  }
  return out;
};

/**
 * How often the water and surf step, in ticks of the map's animation clock (`animationClock.ts`), by
 * Quality (plan section 5: half rate on Medium, still on Low): 10 a second on High, 5 on Medium. Each
 * step makes the tilted view redraw (`TiltView.invalidate`), so the rate is kept low and on the same
 * ticks as the border pulse and the fog; the motion is slow enough that 10 steps a second reads as
 * smooth.
 */
export const WATER_STEP_TICKS: Record<Quality, number | null> = { high: 3, medium: 6, low: null };

/**
 * The water's clock for this moment: whole steps of the Quality's rate since `startMs`, in seconds,
 * or 0 on Low (still water). Pure, for the tests.
 */
export const waterTime = (nowMs: number, startMs: number, level: Quality): number => {
  const every = WATER_STEP_TICKS[level];
  return every === null ? 0 : steppedSeconds(nowMs, startMs, every);
};

const rgb = (colour: number): [number, number, number] => [
  ((colour >> 16) & 0xff) / 255,
  ((colour >> 8) & 0xff) / 255,
  (colour & 0xff) / 255,
];

const solidSource = (css: string): CanvasSource => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return new CanvasSource({ resource: canvas, addressMode: "repeat" });
};

/**
 * Map Room 2's painted ground (Modern look, plan step 2): one quad over the world drawn by the
 * ground shader, in place of today's tiles, raster and hex outline sprites. The renderer feeds it
 * zones as they arrive; it loads its textures at the player's Quality and reloads them when that
 * changes.
 */
export class PaintedGround {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly data: GroundData;
  private readonly shader: Shader;
  private readonly standIns: CanvasSource[];
  private textures: TextureSource[] = [];
  private loadedUrl: string | null = null;
  private sprites: TextureSource | null = null;
  private spritesUrl: string | null = null;
  private readonly spriteStandIn: CanvasSource;
  private cliffs: TextureSource | null = null;
  private cliffsUrl: string | null = null;
  private readonly startMs = performance.now();
  /** The rivers' distance picture (look plan step 7), painted by the shader with the sea's water. */
  private readonly rivers = new RiverLayer();
  private readonly stopQuality: () => void;
  private destroyed = false;
  /** Whether this open's "full look" timing mark is set (`openMarks.ts`). */
  private fullLookMarked = false;
  /** Which sprite piece each grid square holds (`PlacementLayer.ts`), worked out round the view. */
  private readonly placements: PlacementLayer;

  /**
   * warmer compiles programs in the background (`shaderWarmup.ts`); with it, the ground starts on
   * the Low program (compiled before the look was built) and switches to the player's Quality when
   * that one is ready. Without it every program is taken as ready.
   */
  constructor(
    readonly shape: CellShape = paintedCellShape(),
    private readonly warmer: ProgramWarmer | null = null,
  ) {
    this.data = new GroundData();
    this.standIns = STAND_INS.map(solidSource);
    this.spriteStandIn = solidSource("rgba(0,0,0,0)");
    const span = shape.cellWidth * TEXTURE_CELLS;
    const resources: Record<string, unknown> = {
      groundUniforms: {
        uShape: { value: shape.kind === "flat" ? 0 : 1, type: "f32" },
        uUnit: { value: new Float32Array([shape.unitX, shape.unitY]), type: "vec2<f32>" },
        uTexScale: { value: new Float32Array([span, span * textureAspect(shape)]), type: "vec2<f32>" },
        uWorldCells: { value: new Float32Array([WORLD_WIDTH, WORLD_HEIGHT]), type: "vec2<f32>" },
        uQuality: { value: QUALITY_LEVEL[quality()], type: "f32" },
        uLine: { value: new Float32Array(LINE_COLOUR), type: "vec4<f32>" },
        uFog: { value: new Float32Array(rgb(FOG_COLOUR)), type: "vec3<f32>" },
        uUnloaded: { value: new Float32Array(rgb(LOADING_COLOUR)), type: "vec3<f32>" },
        uSpritesReady: { value: 0, type: "f32" },
        uCellPoints: { value: shape.cellWidth, type: "f32" },
        uTime: { value: 0, type: "f32" },
        uCliffsReady: { value: 0, type: "f32" },
        uRiverRect: { value: new Float32Array([0, 0, 1, 1]), type: "vec4<f32>" },
        uRiverOn: { value: 0, type: "f32" },
        uDecalRect: { value: new Float32Array(4), type: "vec4<f32>" },
        uRockRect: { value: new Float32Array(4), type: "vec4<f32>" },
        uFeatureRect: { value: new Float32Array(4), type: "vec4<f32>" },
        uMarshRect: { value: new Float32Array(4), type: "vec4<f32>" },
        uPlaceAt: { value: new Float32Array(4), type: "vec4<f32>" },
      },
      uData: this.data.source,
      uSprites: this.spriteStandIn,
      uCliffs: this.spriteStandIn,
      uRiver: this.rivers.uniforms.source,
      uPlace: this.spriteStandIn,
    };
    for (const index of GROUND_SAMPLERS) resources[`uGround${index}`] = this.standIns[index]!;
    const wanted = groundProgram(quality());
    this.shader = new Shader({
      glProgram: !warmer || warmer.ready(wanted) ? wanted : groundProgram("low"),
      resources,
    });
    this.placements = new PlacementLayer(shape, this.shader.resources.groundUniforms, {
      uData: this.data.source,
      uRiver: this.rivers.uniforms.source,
    });

    // The quad covers the world and a cell's margin round it.
    const far = cellCentre(shape, WORLD_WIDTH, WORLD_HEIGHT);
    const x0 = -shape.cellWidth;
    const y0 = -shape.cellHeight;
    const x1 = far.x + shape.cellWidth;
    const y1 = far.y + shape.cellHeight;
    const geometry = new Geometry({
      attributes: { aPosition: [x0, y0, x1, y0, x1, y1, x0, y1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.mesh.label = "mr2-painted-ground";

    this.stopQuality = onQualityChange((level) => {
      this.uniforms.uQuality = QUALITY_LEVEL[level];
      this.placements.invalidate();
      void this.load(level);
    });
  }

  private get uniforms(): GroundUniforms {
    return (this.shader.resources.groundUniforms as { uniforms: GroundUniforms }).uniforms;
  }

  /**
   * Shows the rivers round `range` (rebuilding their picture when the view leaves the built cells),
   * or hides them. Returns whether the picture changed, so a tilted view knows to redraw.
   */
  updateRivers(range: CellRange, shown: boolean, cells: RiverCells): boolean {
    const changed = this.rivers.update(range, shown, cells);
    if (!changed) return false;
    const { source, rect, on } = this.rivers.uniforms;
    if (this.shader.resources.uRiver !== source) {
      this.shader.resources.uRiver = source;
      this.placements.setRiverTexture(source);
    }
    this.placements.invalidate();
    this.rivers.releaseRetired();
    const uniforms = this.uniforms;
    uniforms.uRiverOn = on ? 1 : 0;
    uniforms.uRiverRect.set(rect);
    return true;
  }

  /** The cells' data texture, which the painted fog (`CloudLayer`) reads too. */
  get groundData(): GroundData {
    return this.data;
  }

  /** The colour fog cells are painted (under the painted fog's clouds, the cloud's own shade). */
  setFogColour(colour: number): void {
    this.uniforms.uFog.set(rgb(colour));
  }

  /** A zone arrived: the rivers are rebuilt on the next `updateRivers`. */
  invalidateRivers(): void {
    this.rivers.invalidate();
  }

  /**
   * Steps the water and surf (the only motion in the painted ground; mr2-live's water sprites sit
   * in the hidden tile layer, so nothing is drawn twice). Called every frame with the visible cells;
   * returns true when the picture changed, so a tilted view knows to redraw (`TiltView.invalidate`).
   * Water out of sight, or Quality Low, keeps the clock still.
   */
  animate(nowMs: number, range: CellRange, level: Quality = quality()): boolean {
    if (WATER_STEP_TICKS[level] === null || !(this.rivers.showing || this.data.hasWater(range))) return false;
    const time = waterTime(nowMs, this.startMs, level);
    if (time === this.uniforms.uTime) return false;
    this.uniforms.uTime = time;
    return true;
  }

  /** Every picture `load` fetches at this Quality (for the MR2 warm-up, `paintedLook.ts`). */
  static artUrls(level: Quality): string[] {
    return [ATLAS_URL, ...SPRITE_SHEETS.map(({ url }) => url), CLIFFS_URL].map((url) => sheetAtQuality(url, level));
  }

  /** The placement programs (for the warm-up, `paintedLook.ts`). */
  static placementPrograms(): GlProgram[] {
    return PLACEMENT_GRIDS.map(placementProgram);
  }

  /**
   * Readies this frame's ground (plan step 10): switches to the player's Quality's program once it
   * has compiled (the Low one shows meanwhile), and works out the sprite pieces round the view when
   * it has moved on or something changed. cellPixels is a cell's width on screen. Returns whether
   * the picture changed, so a tilted view knows to redraw.
   */
  prepare(renderer: Renderer, range: CellRange, cellPixels: number, level: Quality = quality()): boolean {
    let changed = false;
    const wanted = groundProgram(level);
    if (this.shader.glProgram !== wanted) {
      if (!this.warmer || this.warmer.ready(wanted)) {
        this.shader.glProgram = wanted;
        changed = true;
      } else {
        void this.warmer.warm(wanted);
      }
    }
    if (!this.fullLookMarked && this.shader.glProgram === wanted) {
      this.fullLookMarked = true;
      markOnce(MR2_FULL_LOOK);
    }
    const ready =(grid: (typeof PLACEMENT_GRIDS)[number]): boolean => {
      const program = placementProgram(grid);
      if (!this.warmer || this.warmer.ready(program)) return true;
      void this.warmer.warm(program).then((linked) => {
        if (linked) this.placements.invalidate();
      });
      return false;
    };
    if (this.placements.update(renderer, range, cellPixels, ready)) {
      const uniforms = this.uniforms;
      for (const grid of PLACEMENT_GRIDS) {
        const rect = this.placements.rect(grid);
        uniforms[RECT_UNIFORM[grid]].set([rect.x, rect.y, rect.w, rect.h]);
      }
      uniforms.uPlaceAt.set(this.placements.columns());
      const texture = this.placements.texture;
      if (texture && this.shader.resources.uPlace !== texture) this.shader.resources.uPlace = texture;
      changed = true;
    }
    return changed;
  }

  /** Fetches the ground atlas and the sprite sheet at this Quality. */
  async load(level: Quality = quality()): Promise<boolean> {
    const [ground] = await Promise.all([this.loadGround(level), this.loadSprites(level), this.loadCliffs(level)]);
    return ground;
  }

  /** Fetches the cliff sheet (faces repeat sideways); until it lands, hills show no cliffs. */
  private async loadCliffs(level: Quality): Promise<boolean> {
    const url = sheetAtQuality(CLIFFS_URL, level);
    if (url === this.cliffsUrl) return true;
    let image: CanvasImageSource & { width: number; height: number };
    try {
      image = (await timeArt(url, () => Assets.load(url))).source.resource;
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const canvas = timeCut("cliffs", () => {
      const copy = document.createElement("canvas");
      copy.width = image.width;
      copy.height = image.height;
      copy.getContext("2d")!.drawImage(image, 0, 0);
      return copy;
    });
    const source = new CanvasSource({
      resource: canvas,
      addressMode: "repeat",
      scaleMode: "linear",
      mipmapFilter: "linear",
      autoGenerateMipmaps: true,
    });
    const old = this.cliffs;
    this.shader.resources.uCliffs = source;
    this.cliffs = source;
    this.cliffsUrl = url;
    this.uniforms.uCliffsReady = 1;
    old?.destroy();
    return true;
  }

  /** Fetches the sprite sheets and joins them into the shader's one 4 x 11 sheet. */
  private async loadSprites(level: Quality): Promise<boolean> {
    const decalsUrl = sheetAtQuality(DECALS_URL, level);
    if (decalsUrl === this.spritesUrl) return true;
    let sheets: (CanvasImageSource & { width: number; height: number })[];
    try {
      const loaded = await Promise.all(
        SPRITE_SHEETS.map(({ url }) => {
          const at = sheetAtQuality(url, level);
          return timeArt(at, () => Assets.load(at));
        }),
      );
      sheets = loaded.map((texture) => texture.source.resource);
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const frame = sheets[0]!.width / SPRITE_COLUMNS;
    const canvas = timeCut("sprites", () => {
      const joined = document.createElement("canvas");
      joined.width = frame * SPRITE_COLUMNS;
      joined.height = frame * SPRITE_ROWS;
      const context = joined.getContext("2d")!;
      let row = 0;
      SPRITE_SHEETS.forEach(({ rows }, index) => {
        context.drawImage(sheets[index]!, 0, frame * row, joined.width, frame * rows);
        row += rows;
      });
      return joined;
    });
    const source = new CanvasSource({
      resource: canvas,
      scaleMode: "linear",
      mipmapFilter: "linear",
      autoGenerateMipmaps: true,
    });
    const old = this.sprites;
    this.shader.resources.uSprites = source;
    this.sprites = source;
    this.spritesUrl = decalsUrl;
    this.uniforms.uSpritesReady = 1;
    old?.destroy();
    return true;
  }

  /** Fetches the ground atlas at this Quality and cuts it into repeating textures. */
  private async loadGround(level: Quality): Promise<boolean> {
    const url = sheetAtQuality(ATLAS_URL, level);
    if (url === this.loadedUrl) return true;
    let image: CanvasImageSource;
    try {
      const texture = await timeArt(url, () => Assets.load(url));
      image = texture.source.resource as CanvasImageSource;
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const square = (image as { width: number }).width / ATLAS_COLUMNS;
    const size = Math.round(square / (1 + 2 * GROUND_GUTTER));
    const gutter = (square - size) / 2;
    // Cutting the atlas runs on the main thread (timed for the open, `openMarks.ts`).
    const cut: TextureSource[] = timeCut("ground", () => {
      const canvases = SHADER_TEXTURES.map((slot) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d")!.drawImage(
          image,
          (slot % ATLAS_COLUMNS) * square + gutter,
          Math.floor(slot / ATLAS_COLUMNS) * square + gutter,
          size,
          size,
          0,
          0,
          size,
          size,
        );
        return canvas;
      });
      const style = {
        addressMode: "repeat",
        scaleMode: "linear",
        mipmapFilter: "linear",
        autoGenerateMipmaps: true,
        maxAnisotropy: 4,
      } as const;
      const wetAt = SHADER_TEXTURES.indexOf(GroundTexture.WET_SAND);
      const foamAt = SHADER_TEXTURES.indexOf(GroundTexture.FOAM);
      const pixels = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
        canvas.getContext("2d")!.getImageData(0, 0, size, size).data;
      return canvases.map((canvas, index) => {
        if (index !== wetAt) return new CanvasSource({ resource: canvas, ...style });
        return new BufferImageSource({
          resource: withFoamAlpha(pixels(canvas), pixels(canvases[foamAt]!)),
          width: size,
          height: size,
          alphaMode: "no-premultiply-alpha",
          ...style,
        });
      });
    });
    const old = this.textures;
    for (const index of GROUND_SAMPLERS) this.shader.resources[`uGround${index}`] = cut[index]!;
    this.textures = cut;
    this.loadedUrl = url;
    for (const source of old) source.destroy();
    return true;
  }

  applyZone(zone: ZoneRecord): void {
    this.data.applyZone(zone);
    this.placements.invalidate();
  }

  reset(): void {
    this.data.reset();
    this.placements.invalidate();
  }

  flush(): void {
    this.data.flush();
  }

  destroy(): void {
    this.destroyed = true;
    this.stopQuality();
    this.mesh.destroy();
    this.shader.destroy();
    this.data.destroy();
    this.rivers.destroy();
    this.placements.destroy();
    for (const source of [...this.textures, ...this.standIns, this.spriteStandIn]) source.destroy();
    this.sprites?.destroy();
    this.cliffs?.destroy();
  }
}
