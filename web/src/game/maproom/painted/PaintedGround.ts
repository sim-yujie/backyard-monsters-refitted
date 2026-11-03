import { Assets, CanvasSource, Geometry, GlProgram, Mesh, Shader, type TextureSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { onQualityChange, quality, sheetAtQuality, type Quality } from "@/game/quality";
import { FOG_COLOUR, LOADING_COLOUR } from "../cellVisuals";
import type { ZoneRecord } from "../ZoneStore";
import { cellCentre, paintedCellShape, textureAspect, type CellShape } from "./cellShape";
import { GroundData } from "./GroundData";
import { SHADER_TEXTURES } from "./groundKinds";
import { GROUND_FRAGMENT, GROUND_VERTEX } from "./groundShader";

/** The ground texture atlas, 4 textures a row (`web/tools/mr2-paint/build.py`). */
const ATLAS_URL = `${import.meta.env.BASE_URL}maproom/painted/ground@4x.webp`;
const ATLAS_COLUMNS = 4;

/** World points one texture repeat covers across: two cells. */
const TEXTURE_CELLS = 2;

/** Mock-up B's hex lines: light cream at about 30%. */
const LINE_COLOUR = [1.0, 0.97, 0.86, 0.3] as const;

/** Flat stand-ins until the atlas lands, by sampler: the textures' average colours. */
const STAND_INS = [
  "#9cc63a", "#6fae2a", "#e7b860", "#7f725e", "#4c4a2c",
  "#4f6a26", "#e9eef4", "#a2c040", "#3cc4d4", "#1f62b8",
];

const QUALITY_LEVEL: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

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
  private readonly stopQuality: () => void;
  private destroyed = false;

  constructor(readonly shape: CellShape = paintedCellShape()) {
    this.data = new GroundData();
    this.standIns = STAND_INS.map(solidSource);
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
      },
      uData: this.data.source,
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
      (this.shader.resources.groundUniforms as { uniforms: { uQuality: number } }).uniforms.uQuality =
        QUALITY_LEVEL[level];
      void this.load(level);
    });
  }

  /** Fetches the ground atlas at this Quality and cuts it into repeating textures. */
  async load(level: Quality = quality()): Promise<boolean> {
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
    for (const source of [...this.textures, ...this.standIns]) source.destroy();
  }
}
