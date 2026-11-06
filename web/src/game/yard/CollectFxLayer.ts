import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { Effect } from "@/game/sound/EffectsPlayer";
import { playEffect } from "@/game/sound/sound";
import { resourceRealm } from "@/ui/resourceIcon";
import { flightPose, type Flight } from "./collectFx";
import type { HarvestKey } from "./harvest";

/**
 * Draws the resource balls a bank throws at the Town Hall (issue #208); the
 * timings and the arc are `collectFx.ts`.
 *
 * The balls live in the world, above every building, as Flash's
 * `MAP._RESOURCES` sat over `_BUILDINGTOPS` (`MAP.as:189-193`), so they pan
 * and zoom with the yard. Shadows go in a container under all the balls.
 * Sprites are pooled: Collect all on a yard of forty harvesters throws some
 * five hundred balls, and they come and go every bank.
 *
 * A landing calls the thrower's `onLand` with the ball's share, so the thrower
 * knows when the last is down. {@link finish} lands every ball still in the
 * air at once, so a bank still settles when the yard goes;
 * {@link cancel} takes one throw's balls away without landing them, for a
 * bank the server refused after its balls were already thrown (#208).
 *
 * Each ball makes Flash's sounds (`ResourcePackage.as:36-43,97-103`): a pop
 * as it leaves (`bankfire`) and another as it lands (`bankland`); on the
 * Inferno yard the Inferno's own pair, `ibankfire` and `ibankland`. The effects
 * player keeps a big bank from rattling (`sound/EffectsPlayer.ts`). Balls
 * landed all at once by {@link finish}, or taken away, make none: the yard
 * is going or the bank was refused.
 */

/**
 * A ball's picture: a resource's, or `magma`, the ball the Monster Juicer
 * throws for an Inferno monster (`BUILDING9.as:66`, `_lastType` 8). `bone`,
 * `coal` and `sulfur` are frames 5-7, the Inferno's other three, which an
 * attack's loot orbs show on an Inferno yard (`ATTACK.as:723-725`).
 */
export type PackageDot = HarvestKey | "bone" | "coal" | "sulfur" | "magma";

/** The ball of each resource, and the shadow they share. */
export interface CollectFxArt {
  dot(resource: PackageDot): Texture;
  readonly shadow: Texture;
  destroy(): void;
}

interface DotStyle {
  /** Gradient stops: [ratio 0..255, r, g, b]. */
  readonly stops: readonly (readonly number[])[];
  /** The gradient's middle, px from the ball's. */
  readonly lightX: number;
  readonly lightY: number;
  /** The gradient's radius, px. */
  readonly radius: number;
}

/**
 * The `packagedot` frames of `client/scripts/_assets/assets.swf`: an 11 px
 * circle, a 1 px black outline, and a radial gradient. Frames 1-4 (shapes
 * 1803-1806) are the four resources, centred 2.85 px up and left of the
 * middle, 9.04 px in radius; frame 8 (shape 1810) is magma, centred 1.9 px
 * left and 2.55 px up, 8.58 px in radius.
 */
const RESOURCE_LIGHT = -2.85;
const RESOURCE_GRADIENT_RADIUS = 9.04;
const resourceDot = (stops: readonly (readonly number[])[]): DotStyle => ({
  stops,
  lightX: RESOURCE_LIGHT,
  lightY: RESOURCE_LIGHT,
  radius: RESOURCE_GRADIENT_RADIUS,
});
const DOT_STYLES: Readonly<Record<PackageDot, DotStyle>> = {
  r1: resourceDot([
    [0, 164, 89, 57],
    [255, 106, 38, 38],
  ]),
  r2: resourceDot([
    [2, 174, 174, 174],
    [255, 94, 94, 94],
  ]),
  r3: resourceDot([
    [0, 239, 143, 191],
    [255, 199, 5, 199],
  ]),
  r4: resourceDot([
    [2, 36, 253, 36],
    [255, 2, 101, 1],
  ]),
  // Frames 5-7 (shapes 1807-1809), sampled from their pictures.
  bone: resourceDot([
    [0, 255, 250, 235],
    [255, 140, 118, 60],
  ]),
  coal: resourceDot([
    [0, 215, 210, 200],
    [130, 22, 22, 20],
    [255, 0, 0, 0],
  ]),
  sulfur: resourceDot([
    [0, 250, 255, 47],
    [255, 178, 162, 0],
  ]),
  magma: {
    stops: [
      [0, 252, 237, 13],
      [35, 252, 158, 13],
      [84, 180, 70, 56],
      [137, 60, 6, 0],
      [192, 101, 8, 0],
      [255, 131, 7, 0],
    ],
    lightX: -1.9,
    lightY: -2.55,
    radius: 8.58,
  },
};
const DOT_RADIUS = 5;

/**
 * `mcShadow` (shape 1801): a 14.6 × 8.5 px black ellipse at 30% opacity under
 * a 10 × 5 px blur. Drawn as an ellipse whose gradient does the blur: solid
 * to where the blur starts eating in, half at the ellipse's edge, gone where
 * the blur reaches.
 */
const SHADOW_RX = 7.3 + 5;
const SHADOW_RY = 4.25 + 2.5;
const SHADOW_ALPHA = 76 / 255;

/** Canvas pixels per world pixel, so a ball stays round at the closest zoom. */
const ART_RESOLUTION = 4;

const canvasTexture = (
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
): Texture => {
  if (typeof document === "undefined") return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * ART_RESOLUTION);
  canvas.height = Math.ceil(height * ART_RESOLUTION);
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  context.scale(ART_RESOLUTION, ART_RESOLUTION);
  context.translate(width / 2, height / 2);
  draw(context);
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: ART_RESOLUTION }) });
};

const drawDot = (resource: PackageDot): Texture => {
  const size = (DOT_RADIUS + 1) * 2;
  const style = DOT_STYLES[resource];
  return canvasTexture(size, size, (context) => {
    const gradient = context.createRadialGradient(
      style.lightX,
      style.lightY,
      0,
      style.lightX,
      style.lightY,
      style.radius,
    );
    for (const [ratio, r, g, b] of style.stops) {
      gradient.addColorStop(ratio! / 255, `rgb(${r},${g},${b})`);
    }
    context.beginPath();
    context.arc(0, 0, DOT_RADIUS, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
    context.lineWidth = 1;
    context.strokeStyle = "#000";
    context.stroke();
  });
};

const drawShadow = (): Texture =>
  canvasTexture(SHADOW_RX * 2 + 2, SHADOW_RY * 2 + 2, (context) => {
    context.scale(1, SHADOW_RY / SHADOW_RX);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, SHADOW_RX);
    const colour = (alpha: number): string => `rgba(0,0,0,${alpha.toFixed(3)})`;
    gradient.addColorStop(0, colour(SHADOW_ALPHA));
    gradient.addColorStop(2.3 / SHADOW_RX, colour(SHADOW_ALPHA));
    gradient.addColorStop(7.3 / SHADOW_RX, colour(SHADOW_ALPHA / 2));
    gradient.addColorStop(1, colour(0));
    context.beginPath();
    context.arc(0, 0, SHADOW_RX, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
  });

/** The art drawn on first use, the way Flash's vector symbols look. */
export const packageArt = (): CollectFxArt => {
  const dots = new Map<PackageDot, Texture>();
  let shadow: Texture | null = null;
  return {
    dot(resource) {
      let texture = dots.get(resource);
      if (!texture) {
        texture = drawDot(resource);
        dots.set(resource, texture);
      }
      return texture;
    },
    get shadow() {
      shadow ??= drawShadow();
      return shadow;
    },
    destroy() {
      for (const texture of [...dots.values(), shadow]) {
        if (texture && texture !== Texture.WHITE) texture.destroy(true);
      }
      dots.clear();
      shadow = null;
    },
  };
};

export type LandListener = (resource: HarvestKey, share: number) => void;

interface Ball {
  readonly group: number;
  readonly flight: Flight;
  readonly onLand: LandListener;
  readonly dot: Sprite;
  readonly shadow: Sprite;
  elapsed: number;
  /** Shown once its delay was up, with its pop played. */
  thrown: boolean;
}

export interface CollectFxOptions {
  readonly art?: CollectFxArt;
  /** Plays a sound effect; the game's effects player when left out. */
  readonly sound?: (effect: Effect) => void;
  /** Whether the yard is the Inferno's; the screen's resource realm when left out. */
  readonly inferno?: () => boolean;
}

export class CollectFxLayer {
  readonly root = new Container();

  private readonly shadows = new Container();
  private readonly dots = new Container();
  private readonly art: CollectFxArt;
  private readonly sound: (effect: Effect) => void;
  private readonly inferno: () => boolean;
  private readonly balls: Ball[] = [];
  private readonly freeDots: Sprite[] = [];
  private readonly freeShadows: Sprite[] = [];
  private groups = 0;

  constructor(options: CollectFxOptions = {}) {
    this.art = options.art ?? packageArt();
    this.sound = options.sound ?? playEffect;
    this.inferno = options.inferno ?? (() => resourceRealm() === "inferno");
    this.root.eventMode = "none";
    this.root.addChild(this.shadows, this.dots);
  }

  /** Balls in the air, their delay up or not. */
  get flying(): number {
    return this.balls.length;
  }

  /**
   * Throws a bank's balls; `onLand` hears each one land. Returns the throw's
   * number, for {@link cancel}.
   */
  launch(flights: readonly Flight[], onLand: LandListener): number {
    const group = ++this.groups;
    for (const flight of flights) {
      const dot = this.freeDots.pop() ?? this.makeSprite(this.dots);
      const shadow = this.freeShadows.pop() ?? this.makeSprite(this.shadows);
      dot.texture = this.art.dot(flight.dot ?? flight.resource);
      shadow.texture = this.art.shadow;
      dot.visible = false;
      shadow.visible = false;
      this.balls.push({ group, flight, onLand, dot, shadow, elapsed: 0, thrown: false });
    }
    return group;
  }

  /** Takes one throw's balls out of the air without landing them. */
  cancel(group: number): void {
    const balls = this.balls;
    for (let index = balls.length - 1; index >= 0; index--) {
      const ball = balls[index]!;
      if (ball.group !== group) continue;
      this.release(ball);
      balls[index] = balls[balls.length - 1]!;
      balls.pop();
    }
  }

  /** One frame: every ball on by `deltaSeconds`; the ones that land are put away. */
  update(deltaSeconds: number): void {
    const balls = this.balls;
    for (let index = balls.length - 1; index >= 0; index--) {
      const ball = balls[index]!;
      ball.elapsed += deltaSeconds;
      const pose = flightPose(ball.flight, ball.elapsed);
      if (pose.visible && !ball.thrown) {
        ball.thrown = true;
        this.sound(this.inferno() ? "ibankfire" : "bankfire");
      }
      if (pose.landed) {
        this.release(ball);
        balls[index] = balls[balls.length - 1]!;
        balls.pop();
        this.sound(this.inferno() ? "ibankland" : "bankland");
        ball.onLand(ball.flight.resource, ball.flight.share);
        continue;
      }
      ball.dot.visible = pose.visible;
      ball.shadow.visible = pose.visible && pose.shadowAlpha > 0.004;
      if (!pose.visible) continue;
      ball.dot.position.set(pose.x, pose.y - pose.lift);
      ball.shadow.position.set(pose.x + pose.shadowX, pose.y + pose.shadowY);
      ball.shadow.alpha = pose.shadowAlpha;
    }
  }

  /** Lands every ball still in the air at once. */
  finish(): void {
    const balls = this.balls.splice(0);
    for (const ball of balls) this.release(ball);
    for (const ball of balls) ball.onLand(ball.flight.resource, ball.flight.share);
  }

  destroy(): void {
    this.finish();
    this.root.destroy({ children: true });
    this.freeDots.length = 0;
    this.freeShadows.length = 0;
    this.art.destroy();
  }

  private makeSprite(parent: Container): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.visible = false;
    parent.addChild(sprite);
    return sprite;
  }

  private release(ball: Ball): void {
    ball.dot.visible = false;
    ball.shadow.visible = false;
    this.freeDots.push(ball.dot);
    this.freeShadows.push(ball.shadow);
  }
}
