import { steppedSeconds } from "../animationClock";
import { Geometry, GlProgram, Mesh, Shader } from "pixi.js";
import { WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { onQualityChange, quality, type Quality } from "@/game/quality";
import type { ZoneRecord } from "../ZoneStore";
import type { CellRange } from "../zones";
import { BORDER_FRAGMENT } from "./borderShader";
import { BORDER_COLOURS, BorderData, BorderRelation } from "./borders";
import { cellCentre, paintedCellShape, type CellShape } from "./cellShape";
import { GROUND_VERTEX } from "./groundShader";

/** The borders' program (one per page; `shaderWarmup.ts` compiles it ahead). */
export const borderProgram = (): GlProgram =>
  GlProgram.from({ vertex: GROUND_VERTEX, fragment: BORDER_FRAGMENT, name: "mr2-painted-borders" });

const QUALITY_LEVEL: Record<Quality, number> = { high: 2, medium: 1, low: 0 };

/** The pulse's length (one slow breath) and how often it steps, on High only (plan section 5). */
export const PULSE_PERIOD_MS = 3200;
/** Every 3 ticks of the map's animation clock (10 a second), on the water's ticks (`animationClock.ts`). */
export const PULSE_STEP_TICKS = 3;

/**
 * The pulse for this moment, 0..1, stepped every `PULSE_STEP_TICKS`; always 0.5 (steady) below
 * High. Pure, for the tests.
 */
export const pulseAt = (nowMs: number, startMs: number, level: Quality): number => {
  if (level !== "high") return 0.5;
  const stepped = steppedSeconds(nowMs, startMs, PULSE_STEP_TICKS) * 1000;
  return 0.5 + 0.5 * Math.sin((stepped / PULSE_PERIOD_MS) * Math.PI * 2);
};

const rgb = (colour: number): Float32Array =>
  new Float32Array([((colour >> 16) & 0xff) / 255, ((colour >> 8) & 0xff) / 255, (colour & 0xff) / 255]);

interface BorderUniforms {
  uQuality: number;
  uPulse: number;
}

/**
 * The glowing borders round players' land on the painted map (plan step 8): its own quad over
 * the world, over the painted ground (and rivers) and under the cells' markers. Lives and dies with
 * the painted look (`MapRenderer.setPaintedMap`), so with MR2_PAINTED_MAP off, or in Classic,
 * nothing of it exists.
 */
export class BorderLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly data: BorderData;
  private readonly shader: Shader;
  private readonly startMs = performance.now();
  private readonly stopQuality: () => void;
  private myAlliance: number | null = null;

  constructor(readonly shape: CellShape = paintedCellShape()) {
    this.data = new BorderData(shape.kind);
    this.shader = new Shader({
      glProgram: borderProgram(),
      resources: {
        borderUniforms: {
          uShape: { value: shape.kind === "flat" ? 0 : 1, type: "f32" },
          uUnit: { value: new Float32Array([shape.unitX, shape.unitY]), type: "vec2<f32>" },
          uWorldCells: { value: new Float32Array([WORLD_WIDTH, WORLD_HEIGHT]), type: "vec2<f32>" },
          uCellPoints: { value: shape.cellWidth, type: "f32" },
          uQuality: { value: QUALITY_LEVEL[quality()], type: "f32" },
          uPulse: { value: 0.5, type: "f32" },
          uYou: { value: rgb(BORDER_COLOURS[BorderRelation.YOU]), type: "vec3<f32>" },
          uAlliance: { value: rgb(BORDER_COLOURS[BorderRelation.ALLIANCE]), type: "vec3<f32>" },
          uOther: { value: rgb(BORDER_COLOURS[BorderRelation.OTHER]), type: "vec3<f32>" },
          uAttacker: { value: rgb(BORDER_COLOURS[BorderRelation.ATTACKER]), type: "vec3<f32>" },
        },
        uData: this.data.source,
      },
    });

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
    this.mesh.label = "mr2-painted-borders";

    this.stopQuality = onQualityChange((level) => {
      this.uniforms.uQuality = QUALITY_LEVEL[level];
      this.uniforms.uPulse = 0.5;
    });
  }

  private get uniforms(): BorderUniforms {
    return (this.shader.resources.borderUniforms as { uniforms: BorderUniforms }).uniforms;
  }

  applyZone(zone: ZoneRecord): void {
    this.data.applyZone(zone, this.myAlliance);
  }

  /** The viewer's alliance changed: the relation colours are worked out again from these zones. */
  setMyAlliance(id: number | null, zones: Iterable<ZoneRecord>): void {
    if (id === this.myAlliance) return;
    this.myAlliance = id;
    for (const zone of zones) this.data.applyZone(zone, id);
  }

  reset(): void {
    this.data.reset();
  }

  /** Uploads pending writes; returns whether the picture changed. */
  flush(): boolean {
    return this.data.flush();
  }

  /**
   * Steps the pulse (High only, and only with a border in sight). Returns true when the picture
   * changed, so a tilted view knows to redraw (`TiltView.invalidate`).
   */
  animate(nowMs: number, range: CellRange, level: Quality = quality()): boolean {
    if (level !== "high" || !this.data.hasBorder(range)) return false;
    const pulse = pulseAt(nowMs, this.startMs, level);
    if (pulse === this.uniforms.uPulse) return false;
    this.uniforms.uPulse = pulse;
    return true;
  }

  destroy(): void {
    this.stopQuality();
    this.mesh.destroy();
    this.shader.destroy();
    this.data.destroy();
  }
}
