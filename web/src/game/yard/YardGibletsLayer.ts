import { Container, Graphics } from "pixi.js";
import { gibletPose, type Giblet } from "./juicerShow";

/**
 * Draws the Monster Juicer's spurt: the giblets of `GIBLET.as` hopping out of
 * the spout, and the splat each leaves where it lands (`EFFECTS.SplatParticle`).
 * The flights are `juicerShow.ts`'s; this only paints them, in one Graphics
 * redrawn each frame, above the buildings as Flash's `MAP._RESOURCES`.
 *
 * Flash's splat grows for about ten frames and is then stamped into the
 * ground for good (`EFFECTS.as:159-169`, `SnapShot`); here it grows the same
 * and then fades over a few seconds, so a yard does not stay red.
 */

/** Juice red: Flash's giblet dot and splat, as its juice burst. */
const GIBLET_RED = 0xb3121c;
const GIBLET_DARK = 0x5c070c;
const SPLAT_RED = 0x9e0f18;

/** A splat's first size (`SplatParticle(20, ..)`: 20/32) and its growth a 40 fps frame (`EFFECTS.as:161`). */
const SPLAT_SCALE = 20 / 32;
const SPLAT_GROW = 0.02 * 40;
/** It grows for this long (`life > 10` frames), then fades over `SPLAT_FADE`. */
const SPLAT_GROW_SECONDS = 11 / 40;
const SPLAT_FADE_SECONDS = 3;
/** A splat's radius at scale 1, px. */
const SPLAT_RADIUS = 9;
/** A giblet's dot radius at scale 1, px. */
const DOT_RADIUS = 4;

interface Spurt {
  readonly giblets: readonly Giblet[];
  t: number;
  landed: number;
}

interface Splat {
  readonly x: number;
  readonly y: number;
  /** Lobes round the middle: angle, distance, radius share. */
  readonly lobes: readonly (readonly [number, number, number])[];
  t: number;
}

export class YardGibletsLayer {
  readonly root = new Container();
  private readonly paint = new Graphics();
  private readonly spurts: Spurt[] = [];
  private readonly splats: Splat[] = [];

  constructor(
    private readonly random: () => number = Math.random,
    /** Hears each landing (`GIBLET.Arrived`: the `splat5` sound). */
    private readonly onLand: (() => void) | null = null,
  ) {
    this.root.eventMode = "none";
    this.root.addChild(this.paint);
  }

  /** Giblets still in the air, for `GIBLETS.Create`'s limit. */
  get inAir(): number {
    let count = 0;
    for (const spurt of this.spurts) count += spurt.giblets.length - spurt.landed;
    return count;
  }

  /** Splats still showing, for tests. */
  get splatCount(): number {
    return this.splats.length;
  }

  throw(giblets: readonly Giblet[]): void {
    if (giblets.length > 0) this.spurts.push({ giblets, t: 0, landed: 0 });
  }

  update(deltaSeconds: number): void {
    const g = this.paint;
    g.clear();
    if (this.spurts.length === 0 && this.splats.length === 0) return;
    const dt = Math.max(0, deltaSeconds);

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i]!;
      splat.t += dt;
      if (splat.t >= SPLAT_GROW_SECONDS + SPLAT_FADE_SECONDS) {
        this.splats.splice(i, 1);
        continue;
      }
      const grow = Math.min(splat.t, SPLAT_GROW_SECONDS);
      const scale = SPLAT_SCALE + SPLAT_GROW * grow;
      const fade = splat.t <= SPLAT_GROW_SECONDS ? 1 : 1 - (splat.t - SPLAT_GROW_SECONDS) / SPLAT_FADE_SECONDS;
      const r = SPLAT_RADIUS * scale;
      g.ellipse(splat.x, splat.y, r, r * 0.5).fill({ color: SPLAT_RED, alpha: 0.85 * fade });
      for (const [angle, distance, share] of splat.lobes) {
        g.ellipse(
          splat.x + Math.cos(angle) * r * distance,
          splat.y + Math.sin(angle) * r * distance * 0.5,
          r * share,
          r * share * 0.5,
        ).fill({ color: SPLAT_RED, alpha: 0.85 * fade });
      }
    }

    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const spurt = this.spurts[i]!;
      const before = spurt.t;
      spurt.t += dt;
      let flying = 0;
      for (const giblet of spurt.giblets) {
        const end = giblet.delay + giblet.duration;
        if (before < end && spurt.t >= end) {
          spurt.landed++;
          this.splat(giblet.toX, giblet.toY);
          continue;
        }
        const pose = gibletPose(giblet, spurt.t);
        if (!pose) {
          if (spurt.t < end) flying++;
          continue;
        }
        flying++;
        const r = DOT_RADIUS * giblet.scale;
        g.ellipse(pose.x, pose.y, r, r * 0.5).fill({ color: 0x000000, alpha: 0.25 });
        g.circle(pose.x, pose.y - pose.lift, r).fill(GIBLET_RED).stroke({ color: GIBLET_DARK, width: 1 });
      }
      if (flying === 0) this.spurts.splice(i, 1);
    }
  }

  /** Lands everything at once and clears it, for a yard going away. */
  clear(): void {
    this.spurts.length = 0;
    this.splats.length = 0;
    this.paint.clear();
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
  }

  private splat(x: number, y: number): void {
    // `ParticleSplat` has five shapes (`EFFECTS.as:84`): a blob and a few lobes stands in for them.
    const lobes: [number, number, number][] = [];
    const count = 2 + Math.floor(this.random() * 4);
    for (let i = 0; i < count; i++) {
      lobes.push([this.random() * Math.PI * 2, 0.6 + this.random() * 0.6, 0.3 + this.random() * 0.35]);
    }
    this.splats.push({ x, y, lobes, t: 0 });
    this.onLand?.();
  }
}
