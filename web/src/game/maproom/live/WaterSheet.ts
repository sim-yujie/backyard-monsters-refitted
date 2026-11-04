import {
  Geometry,
  Mesh,
  Rectangle,
  RenderTexture,
  Shader,
  Texture,
  type Renderer,
} from "pixi.js";
import { mapRoomGrid } from "@/game/HexGrid";

/**
 * The moving water, as a handful of hex pictures redrawn a few dozen times a
 * second (MR2 part 1, owner 3 Nov 2026).
 *
 * Every water cell on the map wears one of these pictures as an ordinary
 * sprite (`WaterLayer`), so the cells themselves are built once and never
 * touched again: each animation step redraws only this one small texture, in
 * one draw call, and every sprite showing a frame of it moves with it.
 *
 * The glints are Codex's painted sea highlights (`water-glints`), sampled twice
 * at two scales drifting different ways; where the two layers meet they
 * sparkle. They are sampled at the cell's place in the world, so the sea
 * reads as one surface across cells rather than a stamp per hex. That takes
 * one frame per place modulo the pattern's period (450 x 225 points: 12
 * frames of flat-top cells, 6 of pointy-top ones; see `layoutNow`), so they
 * cover the whole world without a seam.
 *
 * Four more frames hold the shore foam (`foam`): one along the hex's top edge
 * (flat-top) or left side (pointy-top) and one along its upper-left edge, each
 * in two phases. Flipped, they make the other four edges.
 *
 * Sizes and the shader follow the world grid's shape as it is when the sheet
 * is built, so it must be built after `setHexShape` (the live map builds it
 * when the map opens).
 */

/** Empty points around each frame, so linear sampling never reads the next one. */
const GUTTER = 1;
const COLUMNS = 8;
const ROWS = 2;
/** Slots before the foam ones; the glint frames use the first 12 (flat) or 6 (pointy). */
const FOAM_FIRST = 12;

/** Which edge a foam frame lines. */
export const FoamEdge = {
  /** Flat-top: the top edge; flipped upside down it is the bottom one. */
  TOP: 0,
  /** Pointy-top: the upright left side (same frame slot as TOP); flipped it is the right one. */
  SIDE: 0,
  /** The upper-left edge; flipped it is any of the other slanted three. */
  UPPER_LEFT: 1,
} as const;
export type FoamEdge = (typeof FoamEdge)[keyof typeof FoamEdge];

/**
 * The sheet's sizes for the world grid's shape, read when the sheet is built
 * (after `setHexShape`). The glint pattern repeats every 450 x 225 points on
 * both shapes: 4 columns by 3 rows of flat-top cells (the half-row stagger of
 * odd columns divides it), or 3 columns by 2 rows of pointy-top ones (an even
 * number of rows keeps the half-column stagger of odd rows in step).
 */
interface Layout {
  pointy: boolean;
  frameWidth: number;
  frameHeight: number;
  slotWidth: number;
  slotHeight: number;
  periodColumns: number;
  periodRows: number;
}

const layoutNow = (): Layout => {
  const pointy = mapRoomGrid.shape === "pointy";
  /** Frames are the hex's bounding box and a point of bleed, so neighbouring cells meet without a hairline. */
  const frameWidth = mapRoomGrid.cellWidth + 2;
  const frameHeight = mapRoomGrid.cellHeight + 2;
  return {
    pointy,
    frameWidth,
    frameHeight,
    slotWidth: frameWidth + GUTTER * 2,
    slotHeight: frameHeight + GUTTER * 2,
    periodColumns: pointy ? 3 : 4,
    periodRows: pointy ? 2 : 3,
  };
};

const VERTEX = /* glsl */ `
in vec2 aPosition;
out vec2 vPos;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
}
`;

const fragmentFor = (layout: Layout): string => {
  const halfW = mapRoomGrid.cellWidth / 2;
  const halfH = mapRoomGrid.cellHeight / 2;
  // Pointy-top: each slanted edge drops halfH / 2 over halfW, so its slope is SLANT and NORM
  // turns the line's value into points of distance.
  const slant = halfH / (2 * halfW);
  const norm = Math.sqrt(1 + slant * slant);
  const f = (value: number): string => value.toFixed(4);

  const mask = layout.pointy
    ? `float d = min(HALF_W + 0.75 - a.x, (HALF_H - a.y - ${f(slant)} * a.x) / ${f(norm)} + 0.75);`
    : `float d = min(HALF_H + 0.75 - a.y, (HALF_W + 0.75 - a.x - a.y) * 0.7071);`;
  const place = layout.pointy
    ? `vec2(COL_STEP * (column + 0.5 * mod(row, 2.0)), ROW_STEP * row)`
    : `vec2(COL_STEP * column, ROW_STEP * (row + 0.5 * mod(column, 2.0)))`;
  // Distance in from the edge a foam frame lines. Flat: the top edge, or the upper left.
  // Pointy: the upright left side, or the upper left.
  const edgeDistance = layout.pointy
    ? `edge < 0.5 ? local.x + HALF_W : (local.y + HALF_H + ${f(slant)} * local.x) / ${f(norm)}`
    : `edge < 0.5 ? local.y + HALF_H : (local.x + local.y + HALF_W) * 0.7071`;

  return /* glsl */ `
in vec2 vPos;
out vec4 finalColor;

uniform sampler2D uWater;
uniform sampler2D uFoam;
uniform float uTime;
uniform float uWaterOn;
uniform float uFoamOn;

const vec2 FRAME = vec2(${layout.frameWidth.toFixed(1)}, ${layout.frameHeight.toFixed(1)});
const vec2 SLOT = vec2(${layout.slotWidth.toFixed(1)}, ${layout.slotHeight.toFixed(1)});
const float GUTTER = ${GUTTER.toFixed(1)};
const float HALF_W = ${halfW.toFixed(1)};
const float HALF_H = ${halfH.toFixed(1)};
const float COL_STEP = ${mapRoomGrid.colStep.toFixed(2)};
const float ROW_STEP = ${mapRoomGrid.rowStep.toFixed(2)};
const vec2 PERIOD = vec2(COL_STEP * ${layout.periodColumns.toFixed(1)}, ROW_STEP * ${layout.periodRows.toFixed(1)});

/** 1 inside the hex (grown by a little bleed), 0 outside, a pixel of ramp between. */
float hexMask(vec2 p) {
  vec2 a = abs(p);
  ${mask}
  return clamp(d + 0.5, 0.0, 1.0);
}

void main() {
  vec2 slot = floor(vPos / SLOT);
  vec2 local = vPos - slot * SLOT - vec2(GUTTER) - FRAME * 0.5;
  float index = slot.y * ${COLUMNS.toFixed(1)} + slot.x;
  float inside = hexMask(local);
  if (inside <= 0.0) {
    finalColor = vec4(0.0);
    return;
  }

  if (index < ${FOAM_FIRST.toFixed(1)}) {
    // The cell's place modulo the period, then the point within the cell.
    float column = floor(index / ${layout.periodRows.toFixed(1)});
    float row = index - column * ${layout.periodRows.toFixed(1)};
    vec2 world = ${place} + local;
    vec2 uvA = world / PERIOD + uTime * vec2(0.010, 0.006);
    vec2 uvB = world / (PERIOD * 0.5) + vec2(0.37, 0.61) + uTime * vec2(-0.015, 0.010);
    float a = texture(uWater, uvA).a;
    float b = texture(uWater, uvB).a;
    // Where both layers have a crest, a bright sparkle; elsewhere a faint drifting sheen.
    float glint = clamp(a * b * 2.4 + a * 0.22 + b * 0.12, 0.0, 1.0);
    float alpha = glint * 0.7 * inside * uWaterOn;
    finalColor = vec4(vec3(0.88, 0.97, 1.0) * alpha, alpha);
    return;
  }

  float foamIndex = index - ${FOAM_FIRST.toFixed(1)};
  float edge = mod(foamIndex, 2.0);
  float phase = floor(foamIndex / 2.0) * 3.14159;
  float dist = ${edgeDistance};
  // The wash: the foam band breathes in and out as if waves were running up the shore.
  float wash = sin(uTime * 0.7854 + phase); // every 8 s
  float width = 12.0 + 5.0 * wash;
  float band = 1.0 - smoothstep(width * 0.35, width, dist);
  vec2 uv = local / vec2(120.0, 60.0) + vec2(uTime * 0.012 + phase * 0.21, -uTime * 0.006 + phase * 0.13);
  float lace = texture(uFoam, uv).a;
  float foam = clamp(band * (lace * 1.6 + 0.18), 0.0, 1.0);
  // A thin bright line where water meets land, there whatever the wash.
  float line = (1.0 - smoothstep(0.5, 3.0, dist)) * (0.55 + 0.15 * wash);
  float surf = max(foam * 0.9, line);
  // Under the surf, light turquoise shallows fading out into the deep blue (the owner's mock-up).
  float shallow = (1.0 - smoothstep(2.0, 34.0, dist)) * 0.62;
  float alpha = (surf + shallow * (1.0 - surf)) * inside * uFoamOn;
  vec3 colour = (vec3(1.0) * surf + vec3(0.30, 0.88, 0.78) * shallow * (1.0 - surf)) * inside * uFoamOn;
  finalColor = vec4(colour, alpha);
}
`;
};

export class WaterSheet {
  private readonly target: RenderTexture;
  private readonly mesh: Mesh<Geometry, Shader>;
  private readonly shader: Shader;
  private readonly waterFrames: Texture[] = [];
  private readonly foamFrames: Texture[] = [];
  private readonly layout = layoutNow();

  constructor(water: Texture | null, foam: Texture | null, resolution: number) {
    const { slotWidth, slotHeight, frameWidth, frameHeight } = this.layout;
    const width = slotWidth * COLUMNS;
    const height = slotHeight * ROWS;
    this.target = RenderTexture.create({ width, height, resolution, antialias: false });

    this.shader = Shader.from({
      gl: { vertex: VERTEX, fragment: fragmentFor(this.layout), name: "mr2-water-sheet" },
      resources: {
        uWater: (water ?? Texture.EMPTY).source,
        uFoam: (foam ?? Texture.EMPTY).source,
        waterUniforms: {
          uTime: { value: 0, type: "f32" },
          uWaterOn: { value: water ? 1 : 0, type: "f32" },
          uFoamOn: { value: foam ? 1 : 0, type: "f32" },
        },
      },
    });
    const geometry = new Geometry({
      attributes: { aPosition: new Float32Array([0, 0, width, 0, width, height, 0, height]) },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });

    for (let index = 0; index < COLUMNS * ROWS; index++) {
      const frame = new Rectangle(
        (index % COLUMNS) * slotWidth + GUTTER,
        Math.floor(index / COLUMNS) * slotHeight + GUTTER,
        frameWidth,
        frameHeight,
      );
      const texture = new Texture({ source: this.target.source, frame });
      if (index < FOAM_FIRST) this.waterFrames.push(texture);
      else this.foamFrames.push(texture);
    }
  }

  /** The glint frame for a water cell: the one whose place in the pattern matches the cell's. */
  waterFrame(col: number, row: number): Texture {
    const { periodColumns, periodRows } = this.layout;
    return this.waterFrames[mod(col, periodColumns) * periodRows + mod(row, periodRows)]!;
  }

  /** A foam frame along one edge, in one of two phases so neighbouring shores do not wash in step. */
  foamFrame(edge: FoamEdge, phase: number): Texture {
    return this.foamFrames[(phase & 1) * 2 + edge]!;
  }

  /** Redraws every frame for this moment. One small offscreen draw. */
  render(renderer: Renderer, timeSeconds: number): void {
    // Wrapped so the float the shader gets keeps its precision over a long session. Every drift
    // above is a whole number of tiles per TIME_WRAP, and the wash a whole number of 8 s
    // breaths, so the wrap does not jump.
    this.shader.resources.waterUniforms.uniforms.uTime = timeSeconds % TIME_WRAP;
    renderer.render({ container: this.mesh, target: this.target, clear: true, clearColor: [0, 0, 0, 0] });
  }

  destroy(): void {
    for (const frame of [...this.waterFrames, ...this.foamFrames]) frame.destroy(false);
    this.mesh.destroy();
    this.shader.destroy();
    this.target.destroy(true);
  }
}

const TIME_WRAP = 1000;

const mod = (value: number, by: number): number => ((value % by) + by) % by;
