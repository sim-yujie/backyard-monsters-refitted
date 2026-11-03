import { Assets, BufferImageSource, CanvasSource, Geometry, GlProgram, Mesh, Shader, type TextureSource } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { onQualityChange, quality, sheetAtQuality, type Quality } from "@/game/quality";
import type { CellRange } from "../zones";
import { cellCentre, paintedCellShape, textureAspect, type CellShape } from "./cellShape";
import { CLOUD_FRAGMENT, CLOUD_VERTEX } from "./cloudShader";
import { cloudTime, fogDistances, fogInRange } from "./clouds";
import type { GroundData } from "./GroundData";

/** Codex's seamless cloud tops (`web/tools/mr2-cloud-kit`), 512 / 256 / 128 px by Quality. */
const DECK_URL = `${import.meta.env.BASE_URL}maproom/painted/cloud-deck@4x.webp`;

/** The cloud picture's average colour, drawn until it lands. */
const DECK_COLOUR = [0.9, 0.89, 0.92] as const;

/**
 * The colour the painted ground gives fog cells while the clouds cover them: the cloud's own shade,
 * so wherever the cloud's soft edge thins over a fog cell it shows cloud, not the dark fog of the
 * tile map (`PaintedGround.setFogColour`).
 */
export const FOG_UNDER_CLOUD = 0xd9d8e6;

const QUALITY_LEVEL: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

interface CloudUniforms {
  uQuality: number;
  uTime: number;
  uDeckReady: number;
}

/**
 * The painted fog (plan step 9): one quad over the world, over the painted ground and its borders,
 * that paints every fog cell as cloud (`cloudShader.ts`). It keeps one byte a cell, each cell's
 * distance into the fog (`fogDistances`), worked out from the ground's data when zones arrive; it
 * loads the cloud picture at the player's Quality and reloads it when that changes.
 */
export class CloudLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly shader: Shader;
  private readonly standIn: CanvasSource;
  private deck: TextureSource | null = null;
  private deckUrl: string | null = null;
  private readonly startMs = performance.now();
  private readonly stopQuality: () => void;
  private destroyed = false;
  /** Each cell's distance into the fog, and its texture. */
  private readonly distances: Uint8Array;
  private readonly distanceSource: BufferImageSource;
  private stale = true;

  constructor(
    private readonly data: GroundData,
    private readonly shape: CellShape = paintedCellShape(),
  ) {
    this.standIn = solidSource("rgba(0,0,0,0)");
    this.distances = new Uint8Array(data.width * data.height);
    this.distanceSource = new BufferImageSource({
      resource: this.distances,
      width: data.width,
      height: data.height,
      format: "r8unorm",
      scaleMode: "nearest",
      autoGenerateMipmaps: false,
      alphaMode: "no-premultiply-alpha",
    });
    this.shader = new Shader({
      glProgram: GlProgram.from({ vertex: CLOUD_VERTEX, fragment: CLOUD_FRAGMENT, name: "mr2-painted-clouds" }),
      resources: {
        cloudUniforms: {
          uShape: { value: shape.kind === "flat" ? 0 : 1, type: "f32" },
          uUnit: { value: new Float32Array([shape.unitX, shape.unitY]), type: "vec2<f32>" },
          uWorldCells: { value: new Float32Array([WORLD_WIDTH, WORLD_HEIGHT]), type: "vec2<f32>" },
          uCellPoints: { value: shape.cellWidth, type: "f32" },
          uAspect: { value: textureAspect(shape), type: "f32" },
          uQuality: { value: QUALITY_LEVEL[quality()], type: "f32" },
          uTime: { value: 0, type: "f32" },
          uDeckReady: { value: 0, type: "f32" },
          uDeckColour: { value: new Float32Array(DECK_COLOUR), type: "vec3<f32>" },
        },
        uFogDistance: this.distanceSource,
        uDeck: this.standIn,
      },
    });

    // The same quad as the ground: the world and a cell's margin round it.
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
    this.mesh.label = "mr2-painted-clouds";

    this.stopQuality = onQualityChange((level) => {
      this.uniforms.uQuality = QUALITY_LEVEL[level];
      void this.load(level);
    });
  }

  private get uniforms(): CloudUniforms {
    return (this.shader.resources.cloudUniforms as { uniforms: CloudUniforms }).uniforms;
  }

  /** The ground's data changed (a zone arrived, or the sight changed): the fog is measured again at the next `flush`. */
  invalidate(): void {
    this.stale = true;
  }

  /**
   * Measures each cell's distance into the fog again when the ground's data changed, and uploads it.
   * Returns whether it did, so a tilted view knows to redraw.
   */
  flush(): boolean {
    if (!this.stale) return false;
    this.stale = false;
    fogDistances(this.shape, this.data, this.distances);
    this.distanceSource.update();
    return true;
  }

  /**
   * Drifts the clouds a step when one is due and fog is in sight (`range`, the visible cells).
   * Returns true when the picture changed, so a tilted view knows to redraw.
   */
  animate(nowMs: number, range: CellRange, level: Quality = quality()): boolean {
    const time = cloudTime(nowMs, this.startMs, level);
    if (time === this.uniforms.uTime || !fogInRange(this.data, range)) return false;
    this.uniforms.uTime = time;
    return true;
  }

  /** Fetches the cloud picture at this Quality; until it lands the cloud is its flat average colour. */
  async load(level: Quality = quality()): Promise<boolean> {
    const url = sheetAtQuality(DECK_URL, level);
    if (url === this.deckUrl) return true;
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
    const old = this.deck;
    this.shader.resources.uDeck = source;
    this.deck = source;
    this.deckUrl = url;
    this.uniforms.uDeckReady = 1;
    old?.destroy();
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopQuality();
    this.mesh.destroy();
    this.shader.destroy();
    this.standIn.destroy();
    this.distanceSource.destroy();
    this.deck?.destroy();
  }
}

const solidSource = (css: string): CanvasSource => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return new CanvasSource({ resource: canvas, addressMode: "repeat" });
};
