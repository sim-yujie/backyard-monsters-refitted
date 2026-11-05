import { Container, Sprite, type Texture } from "pixi.js";
import { hexZoom } from "../lod";

/**
 * The sky over Map Room 2 (MR2 part 1): cloud shadows drifting over the near
 * map, thick white cloud banks framing the far map as in the owner's mock-up, and now and then a few gulls flying across.
 *
 * Clouds are not simulated. Each band of them is a fixed scatter on a grid
 * that the wind slides across the world, so a cloud's place is a function of
 * the time alone: panning, zooming or coming back to the map later finds every
 * cloud where it should be, and only the dozen or so over the screen are ever
 * drawn, from a small pool of sprites.
 */

interface Band {
  /** Grid spacing in world points: one cloud at most per cell of it. */
  spacingX: number;
  spacingY: number;
  /** Share of grid cells that hold a cloud. */
  cover: number;
  /** Cloud width in world points, from and to. */
  minWidth: number;
  maxWidth: number;
  /** World points a second. */
  windX: number;
  windY: number;
  tint: number;
  alpha: number;
}

/**
 * Shadows: about a screen wide at a close zoom, sliding at a walking pace.
 * Faint, so a camp under one still reads.
 */
const SHADOWS: Band = {
  spacingX: 2100,
  spacingY: 1500,
  cover: 0.7,
  minWidth: 900,
  maxWidth: 1700,
  windX: 16,
  windY: -5,
  tint: 0x0b1830,
  alpha: 0.22,
};

/**
 * Cloud banks around the edge of the far view, as in the owner's Codex mock-up
 * (3 Nov 2026: "95% similar"): thick white clouds framing the map, the middle
 * clear. They hang on the screen, not the world, so the map slides under them
 * as it pans; the top and bottom banks roll slowly with the wind, and every
 * cloud bobs and swells a little.
 */
const FRAME = {
  /** Clouds in the top and in the bottom bank, and in each side bank. */
  along: 10,
  side: 5,
  /** How far a bank reaches into the view, as a share of the view's height (top, bottom) or width (sides). */
  reachY: 0.15,
  reachX: 0.09,
  /** Seconds for a top or bottom cloud to roll across the screen. */
  rollSeconds: 300,
  alpha: 0.96,
} as const;

/**
 * Shadows show from the zoom where the raster gives way to hexes (`hexZoom`);
 * white clouds below it, fading in. As fractions of that zoom.
 */
const SHADOW_FADE_FROM = 0.7;

/**
 * The painted ground (`../painted/`) is a bright, light meadow, so the navy shadows read
 * far darker on it than on the tile map's dark grass: there they are drawn at this share
 * of their strength. The tile map (painted switch off) keeps the full shadows; Classic has none.
 */
export const PAINTED_SHADOW_STRENGTH = 0.45;
const CLOUDS_FULL_BELOW = 0.55;

/** Gulls: how often a flock crosses, and how it looks on screen. */
const FLOCK_EVERY_MIN_S = 18;
const FLOCK_EVERY_MAX_S = 40;
const BIRD_SCREEN_WIDTH = 22;
const BIRD_SCREEN_SPEED = 75;
/** Gulls only over the near map, where a cell is big enough for them to be birds, not dots. */
const BIRDS_MIN_ZOOM = 0.3;

export interface ViewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Bird {
  sprite: Sprite;
  /** Its own phase in the wingbeat. */
  phase: number;
}

interface Flock {
  birds: Bird[];
  /** Offsets of each bird from the leader, in screen pixels. */
  offsets: { x: number; y: number }[];
  /** Start, in world points, and velocity, in world points a second. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

export class SkyLayer {
  /** Shadows: over the ground and buildings. */
  readonly shadows = new Container();
  /** Clouds and birds: over everything. */
  readonly above = new Container();

  private readonly shadowPool: Sprite[] = [];
  private readonly cloudPool: Sprite[] = [];
  private flock: Flock | null = null;
  private nextFlock = FLOCK_EVERY_MIN_S;
  private lastTime = 0;

  constructor(
    private readonly clouds: readonly Texture[],
    private readonly bird: Texture | null,
    private readonly birds: boolean,
    /** Share of the shadows' alpha: 1 on the tile map, `PAINTED_SHADOW_STRENGTH` on the painted ground. */
    private readonly shadowStrength = 1,
    /**
     * Whether the cloud banks frame the far map. Off over the painted ground: its own fog clouds
     * (`../painted/CloudLayer.ts`) fill the far view and bank along the edge of sight, and these flat
     * sprites over that cloud sea read as a second, different sky.
     */
    private readonly frameBanks = true,
  ) {
    this.shadows.interactiveChildren = false;
    this.above.interactiveChildren = false;
  }

  step(timeSeconds: number, view: ViewRect, zoom: number): void {
    const dt = Math.max(0, timeSeconds - this.lastTime);
    this.lastTime = timeSeconds;
    if (this.clouds.length > 0) {
      const hex = hexZoom();
      const shadowAlpha =
        this.shadowStrength * smooth((zoom - hex * SHADOW_FADE_FROM) / (hex - hex * SHADOW_FADE_FROM));
      this.place(SHADOWS, this.shadowPool, this.shadows, timeSeconds, view, shadowAlpha);
      if (this.frameBanks) {
        const cloudAlpha = smooth((hex - zoom) / (hex - hex * CLOUDS_FULL_BELOW));
        this.frame(timeSeconds, view, cloudAlpha);
      }
    }
    if (this.birds && this.bird) this.fly(dt, view, zoom);
  }

  destroy(): void {
    this.shadows.destroy({ children: true });
    this.above.destroy({ children: true });
  }

  /** Puts the cloud banks around the view's edge on the cloud pool's sprites, and hides the rest. */
  private frame(time: number, view: ViewRect, alpha: number): void {
    let used = 0;
    if (alpha > 0.01) {
      const w = view.right - view.left;
      const h = view.bottom - view.top;
      const put = (seed: number, x: number, y: number, width: number): void => {
        const sprite = this.cloudPool[used] ?? this.newSprite(this.cloudPool, this.above);
        used += 1;
        const texture = this.clouds[seed % this.clouds.length]!;
        if (sprite.texture !== texture) sprite.texture = texture;
        const breathe = 1 + 0.05 * Math.sin(time * (0.15 + 0.1 * unit(seed, 6)) + unit(seed, 7) * 6.3);
        const scale = (width / texture.width) * breathe;
        sprite.scale.set(scale * (unit(seed, 5) < 0.5 ? -1 : 1), scale);
        const bob = Math.sin(time * (0.1 + 0.08 * unit(seed, 8)) + unit(seed, 9) * 6.3);
        sprite.position.set(x + bob * w * 0.012, y + bob * h * 0.012);
        sprite.tint = 0xffffff;
        sprite.alpha = FRAME.alpha * alpha;
        sprite.visible = true;
      };
      const heightOf = (seed: number, width: number): number => {
        const texture = this.clouds[seed % this.clouds.length]!;
        return (width / texture.width) * texture.height;
      };
      // Top and bottom: rolling with the wind, wrapping round off the right edge.
      for (let bank = 0; bank < 2; bank++) {
        for (let k = 0; k < FRAME.along; k++) {
          const seed = hash2(101 + bank, k);
          const u = fract(k / FRAME.along + unit(seed, 1) * 0.06 + time / FRAME.rollSeconds);
          const width = w * (0.24 + 0.14 * unit(seed, 2));
          const half = heightOf(seed, width) / 2;
          const reach = h * FRAME.reachY * (0.7 + 0.6 * unit(seed, 3));
          const y = bank === 0 ? view.top + reach - half : view.bottom - reach + half;
          put(seed, view.left + (u * 1.6 - 0.3) * w, y, width);
        }
      }
      // Left and right: standing banks.
      for (let bank = 0; bank < 2; bank++) {
        for (let k = 0; k < FRAME.side; k++) {
          const seed = hash2(201 + bank, k);
          const width = w * (0.2 + 0.1 * unit(seed, 2));
          const reach = w * FRAME.reachX * (0.7 + 0.6 * unit(seed, 3));
          const x = bank === 0 ? view.left + reach - width / 2 : view.right - reach + width / 2;
          put(seed, x, view.top + ((k + 0.5 + (unit(seed, 1) - 0.5) * 0.5) / FRAME.side) * h, width);
        }
      }
    }
    for (let index = used; index < this.cloudPool.length; index++) this.cloudPool[index]!.visible = false;
  }

  /** Puts the band's clouds that overlap the view on the pool's sprites, and hides the rest. */
  private place(
    band: Band,
    pool: Sprite[],
    parent: Container,
    time: number,
    view: ViewRect,
    alpha: number,
  ): void {
    let used = 0;
    if (alpha > 0.01) {
      // The grid slides with the wind; find its cells under the view, a cloud's width of margin around.
      const shiftX = band.windX * time;
      const shiftY = band.windY * time;
      const margin = band.maxWidth;
      const i0 = Math.floor((view.left - margin - shiftX) / band.spacingX);
      const i1 = Math.floor((view.right + margin - shiftX) / band.spacingX);
      const j0 = Math.floor((view.top - margin - shiftY) / band.spacingY);
      const j1 = Math.floor((view.bottom + margin - shiftY) / band.spacingY);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const seed = hash2(i, j);
          if (unit(seed, 1) > band.cover) continue;
          const sprite = pool[used] ?? this.newSprite(pool, parent);
          used += 1;
          const texture = this.clouds[seed % this.clouds.length]!;
          if (sprite.texture !== texture) sprite.texture = texture;
          const width = band.minWidth + (band.maxWidth - band.minWidth) * unit(seed, 2);
          sprite.scale.set((width / texture.width) * (unit(seed, 5) < 0.5 ? -1 : 1), width / texture.width);
          sprite.position.set(
            (i + unit(seed, 3)) * band.spacingX + shiftX,
            (j + unit(seed, 4)) * band.spacingY + shiftY,
          );
          sprite.tint = band.tint;
          sprite.alpha = band.alpha * alpha;
          sprite.visible = true;
        }
      }
    }
    for (let index = used; index < pool.length; index++) pool[index]!.visible = false;
  }

  private newSprite(pool: Sprite[], parent: Container): Sprite {
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    pool.push(sprite);
    parent.addChild(sprite);
    return sprite;
  }

  /** Sends a flock across now and then, and flaps the one that is flying. */
  private fly(dt: number, view: ViewRect, zoom: number): void {
    const flock = this.flock;
    if (!flock) {
      this.nextFlock -= dt;
      if (this.nextFlock <= 0 && zoom >= BIRDS_MIN_ZOOM) this.flock = this.launch(view, zoom);
      return;
    }
    flock.age += dt;
    if (flock.age >= flock.life || zoom < BIRDS_MIN_ZOOM) {
      for (const bird of flock.birds) bird.sprite.destroy();
      this.flock = null;
      this.nextFlock = FLOCK_EVERY_MIN_S + Math.random() * (FLOCK_EVERY_MAX_S - FLOCK_EVERY_MIN_S);
      return;
    }
    const leaderX = flock.x + flock.vx * flock.age;
    const leaderY = flock.y + flock.vy * flock.age;
    const heading = Math.atan2(flock.vy, flock.vx);
    // Gulls are drawn a constant size on screen, whatever the zoom.
    const size = BIRD_SCREEN_WIDTH / zoom / this.bird!.width;
    for (let index = 0; index < flock.birds.length; index++) {
      const { sprite, phase } = flock.birds[index]!;
      const offset = flock.offsets[index]!;
      sprite.position.set(leaderX + offset.x / zoom, leaderY + offset.y / zoom);
      // A few beats, then a glide: the wings foreshorten as they sweep.
      const cycle = (flock.age * 0.9 + phase) % 2;
      const beat = cycle < 1 ? Math.abs(Math.cos(cycle * Math.PI * 3)) : 1;
      sprite.scale.set(size * (0.55 + 0.45 * beat), size);
      // The picture's gull flies up the screen; turn it to its heading.
      sprite.rotation = heading + Math.PI / 2;
    }
  }

  private launch(view: ViewRect, zoom: number): Flock {
    const width = view.right - view.left;
    const height = view.bottom - view.top;
    // Across the view, roughly with the wind, from a random point on its left or bottom edge.
    const fromLeft = Math.random() < 0.6;
    const x = fromLeft ? view.left - 60 / zoom : view.left + width * (0.1 + Math.random() * 0.5);
    const y = fromLeft ? view.top + height * (0.2 + Math.random() * 0.6) : view.bottom + 60 / zoom;
    const angle = fromLeft ? -0.35 + Math.random() * 0.4 : -Math.PI / 2 + 0.3 + Math.random() * 0.5;
    const speed = BIRD_SCREEN_SPEED / zoom;
    const count = 4 + Math.floor(Math.random() * 3);
    const birds: Bird[] = [];
    const offsets: { x: number; y: number }[] = [];
    // A loose V behind the leader.
    const back = { x: -Math.cos(angle), y: -Math.sin(angle) };
    const side = { x: -back.y, y: back.x };
    for (let index = 0; index < count; index++) {
      const rank = Math.ceil(index / 2);
      const wing = index % 2 === 0 ? 1 : -1;
      const jitter = () => (Math.random() - 0.5) * 8;
      offsets.push({
        x: back.x * rank * 26 + side.x * wing * rank * 20 + jitter(),
        y: back.y * rank * 26 + side.y * wing * rank * 20 + jitter(),
      });
      const sprite = new Sprite(this.bird!);
      sprite.anchor.set(0.5);
      this.above.addChild(sprite);
      birds.push({ sprite, phase: Math.random() * 2 });
    }
    const distance = Math.hypot(width, height) + 400 / zoom;
    return {
      birds,
      offsets,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      life: distance / speed,
    };
  }
}

const fract = (value: number): number => value - Math.floor(value);

const smooth = (value: number): number => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

const hash2 = (i: number, j: number): number => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

/** A repeatable number in [0, 1) from a seed and a salt. */
const unit = (seed: number, salt: number): number => (hash2(seed, salt) % 10007) / 10007;
