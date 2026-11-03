import { Assets, CanvasSource, Geometry, GlProgram, Mesh, Shader, type TextureSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { onQualityChange, quality, sheetAtQuality, type Quality } from "@/game/quality";
import { FOG_COLOUR, LOADING_COLOUR } from "../cellVisuals";
import type { ZoneRecord } from "../ZoneStore";
import type { CellRange } from "../zones";
import { cellCentre, paintedCellShape, textureAspect, type CellShape } from "./cellShape";
import { SPRITE_ROWS, SPRITE_SHEET_ROWS } from "./canopy";
import { GroundData } from "./GroundData";
import { SHADER_TEXTURES } from "./groundKinds";
import { GROUND_FRAGMENT, GROUND_VERTEX } from "./groundShader";
import { RiverLayer } from "./RiverLayer";
import type { RiverCells } from "./riverPaths";

/** The ground texture atlas, 4 textures a row (`web/tools/mr2-paint/build.py`). */
const ATLAS_URL = `${import.meta.env.BASE_URL}maproom/painted/ground@4x.webp`;
const ATLAS_COLUMNS = 4;

/**
 * The sprite sheets the shader places (plan steps 2, 3 and 6): ground details (3 rows), sea rocks
 * (2 rows), edge trees and pines (2 rows), boulders, goo pools and reeds (3 rows), 4 frames a row,
 * joined into one 4 x 10 sheet on load so they take one sampler (`canopy.ts` `SPRITE_SHEET_ROWS`).
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
}

const QUALITY_LEVEL: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

/**
 * How often the water and surf step, in milliseconds, by Quality (plan section 5: half rate on
 * Medium, still on Low). Each step makes the tilted view redraw (`TiltView.invalidate`), so the
 * rate is kept low; the motion is slow enough that 12 steps a second reads as smooth.
 */
export const WATER_STEP_MS: Record<Quality, number | null> = { high: 1000 / 12, medium: 1000 / 6, low: null };

/**
 * The water's clock for this moment: whole steps of the Quality's rate since `startMs`, in seconds,
 * or 0 on Low (still water). Pure, for the tests.
 */
export const waterTime = (nowMs: number, startMs: number, level: Quality): number => {
  const step = WATER_STEP_MS[level];
  if (step === null) return 0;
  return (Math.floor((nowMs - startMs) / step) * step) / 1000;
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
 * Whether this browser can run the ground shader: a WebGL2 context that compiles and links it.
 * Without that the map stays on today's tiles by itself (plan step 2: "if the shader fails on a
 * GPU, the map falls back to tiles"). `gl` is for tests; the default makes a throwaway context.
 */
export const groundShaderCompiles = (gl?: WebGL2RenderingContext | null): boolean => {
  let context = gl;
  if (context === undefined) {
    try {
      context = document.createElement("canvas").getContext("webgl2");
    } catch {
      context = null;
    }
  }
  if (!context) return false;
  try {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = context!.createShader(type);
      if (!shader) return null;
      // Pixi adds the precision lines after the version; the sources already carry them.
      context!.shaderSource(shader, source);
      context!.compileShader(shader);
      return context!.getShaderParameter(shader, context!.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(context.VERTEX_SHADER, GROUND_VERTEX.replace("in vec2 aPosition;", "precision highp float;\nin vec2 aPosition;"));
    const fragment = compile(context.FRAGMENT_SHADER, GROUND_FRAGMENT);
    if (!vertex || !fragment) return false;
    const program = context.createProgram();
    if (!program) return false;
    context.attachShader(program, vertex);
    context.attachShader(program, fragment);
    context.linkProgram(program);
    const ok = Boolean(context.getProgramParameter(program, context.LINK_STATUS));
    context.deleteProgram(program);
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    return ok;
  } catch {
    return false;
  } finally {
    if (gl === undefined) context.getExtension("WEBGL_lose_context")?.loseContext();
  }
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

  constructor(readonly shape: CellShape = paintedCellShape()) {
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
      },
      uData: this.data.source,
      uSprites: this.spriteStandIn,
      uCliffs: this.spriteStandIn,
      uRiver: this.rivers.uniforms.source,
    };
    SHADER_TEXTURES.forEach((_, index) => {
      resources[`uGround${index}`] = this.standIns[index]!;
    });
    this.shader = new Shader({
      glProgram: GlProgram.from({ vertex: GROUND_VERTEX, fragment: GROUND_FRAGMENT, name: "mr2-painted-ground" }),
      resources,
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
    if (this.shader.resources.uRiver !== source) this.shader.resources.uRiver = source;
    this.rivers.releaseRetired();
    const uniforms = this.uniforms;
    uniforms.uRiverOn = on ? 1 : 0;
    uniforms.uRiverRect.set(rect);
    return true;
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
    if (WATER_STEP_MS[level] === null || !(this.rivers.showing || this.data.hasWater(range))) return false;
    const time = waterTime(nowMs, this.startMs, level);
    if (time === this.uniforms.uTime) return false;
    this.uniforms.uTime = time;
    return true;
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
      image = (await Assets.load(url)).source.resource;
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
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

  /** Fetches the sprite sheets and joins them into the shader's one 4 x 10 sheet. */
  private async loadSprites(level: Quality): Promise<boolean> {
    const decalsUrl = sheetAtQuality(DECALS_URL, level);
    if (decalsUrl === this.spritesUrl) return true;
    let sheets: (CanvasImageSource & { width: number; height: number })[];
    try {
      const loaded = await Promise.all(SPRITE_SHEETS.map(({ url }) => Assets.load(sheetAtQuality(url, level))));
      sheets = loaded.map((texture) => texture.source.resource);
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const frame = sheets[0]!.width / SPRITE_COLUMNS;
    const canvas = document.createElement("canvas");
    canvas.width = frame * SPRITE_COLUMNS;
    canvas.height = frame * SPRITE_ROWS;
    const context = canvas.getContext("2d")!;
    let row = 0;
    SPRITE_SHEETS.forEach(({ rows }, index) => {
      context.drawImage(sheets[index]!, 0, frame * row, canvas.width, frame * rows);
      row += rows;
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
      const texture = await Assets.load(url);
      image = texture.source.resource as CanvasImageSource;
    } catch {
      return false;
    }
    if (this.destroyed) return false;
    const size = (image as { width: number }).width / ATLAS_COLUMNS;
    const cut = SHADER_TEXTURES.map((slot) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.getContext("2d")!.drawImage(
        image,
        (slot % ATLAS_COLUMNS) * size,
        Math.floor(slot / ATLAS_COLUMNS) * size,
        size,
        size,
        0,
        0,
        size,
        size,
      );
      return new CanvasSource({
        resource: canvas,
        addressMode: "repeat",
        scaleMode: "linear",
        mipmapFilter: "linear",
        autoGenerateMipmaps: true,
        maxAnisotropy: 4,
      });
    });
    const old = this.textures;
    cut.forEach((source, index) => {
      this.shader.resources[`uGround${index}`] = source;
    });
    this.textures = cut;
    this.loadedUrl = url;
    for (const source of old) source.destroy();
    return true;
  }

  applyZone(zone: ZoneRecord): void {
    this.data.applyZone(zone);
  }

  reset(): void {
    this.data.reset();
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
    for (const source of [...this.textures, ...this.standIns, this.spriteStandIn]) source.destroy();
    this.sprites?.destroy();
    this.cliffs?.destroy();
  }
}
