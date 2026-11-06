import { Container, Sprite } from "pixi.js";
import {
  GIBLET_ANCHOR,
  juiceSpurtArt,
  SPLAT_ANCHOR,
  SPLAT_FRAMES,
  type JuiceSpurtArt,
} from "./juiceSpurtArt";
import { gibletPose, type Giblet } from "./juicerShow";

/**
 * Draws the Monster Juicer's spurt: the giblets of `GIBLET.as` hopping out of
 * the spout, and the splat each leaves where it lands (`EFFECTS.SplatParticle`).
 * The flights are `juicerShow.ts`'s; this only paints them, each frame: the
 * giblets in `root`, above the buildings as Flash's `MAP._RESOURCES`, and the
 * splats in `ground`, under them as Flash's `MAP._EFFECTS` (`MAP.as:173-193`),
 * so a splat never sits on the Juicer itself. The pictures are Flash's own
 * `GIBLET_CLIP` and `ParticleSplat` (`juiceSpurtArt.ts`), in both looks.
 *
 * Flash's splat grows for about ten frames and is then stamped into the
 * ground for good (`EFFECTS.as:159-169`, `SnapShot`), and saved with the
 * yard. Here it grows the same and then fades over a few seconds, so a yard
 * does not stay red.
 */

/** A splat's first size (`SplatParticle(20, ..)`: 20/32) and its growth a 40 fps frame (`EFFECTS.as:161`). */
const SPLAT_SCALE = 20 / 32;
const SPLAT_GROW = 0.02 * 40;
/** It grows for this long (`life > 10` frames), then fades over `SPLAT_FADE`. */
const SPLAT_GROW_SECONDS = 11 / 40;
const SPLAT_FADE_SECONDS = 3;

interface Spurt {
  readonly giblets: readonly Giblet[];
  /** Each giblet's sprite while it shows, by index. */
  readonly sprites: (Sprite | null)[];
  t: number;
  landed: number;
}

interface Splat {
  readonly sprite: Sprite;
  t: number;
}

export class YardGibletsLayer {
  /** The giblets in the air: goes above the buildings. */
  readonly root = new Container();
  /** The splats on the ground: goes under the buildings. */
  readonly ground = new Container();
  private readonly art: JuiceSpurtArt;
  private readonly spurts: Spurt[] = [];
  private readonly splats: Splat[] = [];
  private readonly freeGiblets: Sprite[] = [];
  private readonly freeSplats: Sprite[] = [];

  constructor(
    private readonly random: () => number = Math.random,
    /** Hears each landing (`GIBLET.Arrived`: the `splat5` sound). */
    private readonly onLand: (() => void) | null = null,
    art?: JuiceSpurtArt,
  ) {
    this.art = art ?? juiceSpurtArt();
    this.root.eventMode = "none";
    this.ground.eventMode = "none";
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
    if (giblets.length > 0) {
      this.spurts.push({ giblets, sprites: giblets.map(() => null), t: 0, landed: 0 });
    }
  }

  update(deltaSeconds: number): void {
    if (this.spurts.length === 0 && this.splats.length === 0) return;
    const dt = Math.max(0, deltaSeconds);

    for (let i = this.splats.length - 1; i >= 0; i--) {
      const splat = this.splats[i]!;
      splat.t += dt;
      if (splat.t >= SPLAT_GROW_SECONDS + SPLAT_FADE_SECONDS) {
        this.putAway(splat.sprite, this.freeSplats);
        this.splats.splice(i, 1);
        continue;
      }
      const grow = Math.min(splat.t, SPLAT_GROW_SECONDS);
      splat.sprite.scale.set(SPLAT_SCALE + SPLAT_GROW * grow);
      splat.sprite.alpha =
        splat.t <= SPLAT_GROW_SECONDS
          ? 1
          : 1 - (splat.t - SPLAT_GROW_SECONDS) / SPLAT_FADE_SECONDS;
    }

    for (let i = this.spurts.length - 1; i >= 0; i--) {
      const spurt = this.spurts[i]!;
      const before = spurt.t;
      spurt.t += dt;
      let flying = 0;
      spurt.giblets.forEach((giblet, index) => {
        const end = giblet.delay + giblet.duration;
        if (before < end && spurt.t >= end) {
          spurt.landed++;
          this.dropGiblet(spurt, index);
          this.splat(giblet.toX, giblet.toY);
          return;
        }
        const pose = gibletPose(giblet, spurt.t);
        if (!pose) {
          if (spurt.t < end) flying++;
          this.dropGiblet(spurt, index);
          return;
        }
        flying++;
        let sprite = spurt.sprites[index];
        if (!sprite) {
          sprite = this.take(this.freeGiblets, this.root, this.art.giblet, GIBLET_ANCHOR);
          sprite.scale.set(giblet.scale);
          spurt.sprites[index] = sprite;
        }
        sprite.position.set(pose.x, pose.y - pose.lift);
      });
      if (flying === 0) {
        for (let index = 0; index < spurt.sprites.length; index++)
          this.dropGiblet(spurt, index);
        this.spurts.splice(i, 1);
      }
    }
  }

  /** Clears everything at once, for a yard going away. */
  clear(): void {
    for (const spurt of this.spurts) {
      for (let index = 0; index < spurt.sprites.length; index++) this.dropGiblet(spurt, index);
    }
    for (const splat of this.splats) this.putAway(splat.sprite, this.freeSplats);
    this.spurts.length = 0;
    this.splats.length = 0;
  }

  destroy(): void {
    this.clear();
    this.root.destroy({ children: true });
    this.ground.destroy({ children: true });
    this.freeGiblets.length = 0;
    this.freeSplats.length = 0;
    this.art.destroy();
  }

  private splat(x: number, y: number): void {
    // One of `ParticleSplat`'s five frames at random (`EFFECTS.as:84`).
    const frame = 1 + Math.floor(this.random() * SPLAT_FRAMES);
    const sprite = this.take(this.freeSplats, this.ground, this.art.splat(frame), SPLAT_ANCHOR);
    sprite.position.set(x, y);
    sprite.scale.set(SPLAT_SCALE);
    sprite.alpha = 1;
    this.splats.push({ sprite, t: 0 });
    this.onLand?.();
  }

  private take(
    free: Sprite[],
    parent: Container,
    texture: Sprite["texture"],
    anchor: { readonly x: number; readonly y: number },
  ): Sprite {
    const sprite = free.pop() ?? new Sprite();
    sprite.texture = texture;
    sprite.anchor.set(anchor.x, anchor.y);
    sprite.visible = true;
    if (sprite.parent !== parent) parent.addChild(sprite);
    return sprite;
  }

  private dropGiblet(spurt: Spurt, index: number): void {
    const sprite = spurt.sprites[index];
    if (!sprite) return;
    spurt.sprites[index] = null;
    this.putAway(sprite, this.freeGiblets);
  }

  private putAway(sprite: Sprite, free: Sprite[]): void {
    sprite.visible = false;
    free.push(sprite);
  }
}
