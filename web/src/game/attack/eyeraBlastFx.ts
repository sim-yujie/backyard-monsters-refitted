import { Container, Sprite, Texture } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

/**
 * Eye-ra's blast, drawn three new ways for the owner to choose from
 * (feat/eyera-explosion), beside the yellow rings it shows today. Drawing
 * only: nothing here reaches the battle, its damage, targeting or replay.
 *
 * - `ring`: today's three yellow rings (the layer draws those itself).
 * - `punchy` (A): a white-yellow flash, a fast shockwave ring and sparks,
 *   and a short shake of the yard.
 * - `fiery` (B): a fireball, embers that arc and fall, dark smoke that
 *   lingers about a second, and a scorch on the ground that fades.
 * - `goo` (C): a purple-green goo splatter, chunks and little eyeballs that
 *   fly out and bounce, a goo stain, and a bigger damage number.
 *
 * Picked with `?blast=a|b|c|ring` on the page's address, remembered in the
 * browser for the next attack. Every particle is a pooled sprite placed from
 * its age alone, so 1x and 2x play the same path, at their own speed.
 */

export type BlastStyle = "ring" | "punchy" | "fiery" | "goo";

/** Where the chosen style is remembered between visits. */
export const BLAST_STYLE_KEY = "bymr.eyeraBlast";

const STYLE_NAMES: Readonly<Record<string, BlastStyle>> = {
  ring: "ring",
  off: "ring",
  a: "punchy",
  punchy: "punchy",
  b: "fiery",
  fiery: "fiery",
  c: "goo",
  goo: "goo",
};

/** A style from a `?blast=` value or a remembered one; null for anything else. */
export const blastStyleNamed = (raw: string | null | undefined): BlastStyle | null =>
  (raw ? STYLE_NAMES[raw.trim().toLowerCase()] : undefined) ?? null;

/** Saves the address's `?blast=` choice, if it makes one; the choice or null. */
const rememberAsked = (): BlastStyle | null => {
  try {
    const asked =
      typeof location === "undefined"
        ? null
        : blastStyleNamed(new URLSearchParams(location.search).get("blast"));
    if (asked) localStorage.setItem(BLAST_STYLE_KEY, asked);
    return asked;
  } catch {
    return null;
  }
};

// On the page's first load too: logging in drops the address's query.
rememberAsked();

/**
 * The style to draw: the address's `?blast=` first, saved for next time,
 * then the saved one, then today's rings.
 */
export const readBlastStyle = (): BlastStyle => {
  const asked = rememberAsked();
  if (asked) return asked;
  try {
    return blastStyleNamed(localStorage.getItem(BLAST_STYLE_KEY)) ?? "ring";
  } catch {
    return "ring";
  }
};

/** Sprites alive at once across every blast: the cost ceiling with many Eye-ras. */
export const MAX_BITS = 260;
/** Ground marks (scorches, stains) kept at once; the oldest goes first. */
export const MAX_MARKS = 14;

/** A blast's own screen size for a level-1 Eye-ra: 60 cartesian, root two wide. */
const BASE_RADIUS = 85;

type Look = "soft" | "dot" | "ring" | "chunk" | "eye" | "scorch" | "stain";

/** One sprite of a blast, placed from its age each frame. */
interface Bit {
  readonly sprite: Sprite;
  readonly born: number;
  readonly life: number;
  /** Ground point it starts over, world px, and its height above it. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ground-plane and upward speed, px per tick. */
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Share of ground speed lost each tick. */
  readonly drag: number;
  /** px per tick per tick, down; a bit with gravity lands and stays. */
  readonly gravity: number;
  /** Width at birth and at death, px; height is `squash` of it. */
  readonly size0: number;
  readonly size1: number;
  readonly squash: number;
  /** Ticks to fade in, and the alpha it peaks at. */
  readonly fadeIn: number;
  readonly peak: number;
  /** Share of its life it stays at its peak before fading. */
  readonly hold: number;
  /** Tint stops spread over its life. */
  readonly colours: readonly number[];
  readonly spin: number;
  /** Drawn long along its flight: a spark. */
  readonly stretch: boolean;
  /** Its size eases out (fast, then slow) rather than evenly. */
  readonly easeOut: boolean;
}

interface Mark {
  readonly sprite: Sprite;
  readonly born: number;
  readonly life: number;
  readonly peak: number;
}

interface Shake {
  readonly born: number;
  readonly life: number;
  readonly amp: number;
}

export interface EyeraBlastHost {
  /** Where the flying bits go: over the buildings. */
  readonly air: Container;
  /** Where scorches and stains go: on the ground, under the buildings. */
  ground(): Container;
  /** Offsets the yard on screen by this many screen px; 0, 0 to settle it. */
  shake?(dx: number, dy: number): void;
}

/** Spec for a bit; everything but where it starts has a default. */
type BitSpec = Partial<Omit<Bit, "sprite" | "born" | "x" | "y">> & {
  readonly look: Look;
  readonly at: Point;
  readonly delay?: number;
  readonly add?: boolean;
};

/** A fixed hash of a tick and an index, in [0, 1): replays draw the same blast. */
export const blastNoise = (tick: number, index: number): number => {
  let h = (tick * 374761393 + index * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/** A tint between stops `colours` at `t` in [0, 1]. */
export const tintAt = (colours: readonly number[], t: number): number => {
  if (colours.length === 0) return 0xffffff;
  if (colours.length === 1) return colours[0] ?? 0xffffff;
  const scaled = Math.max(0, Math.min(1, t)) * (colours.length - 1);
  const index = Math.min(colours.length - 2, Math.floor(scaled));
  const share = scaled - index;
  const a = colours[index] ?? 0xffffff;
  const b = colours[index + 1] ?? a;
  const mix = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - share) + ((b >> shift) & 0xff) * share) << shift;
  return mix(16) | mix(8) | mix(0);
};

/**
 * Where a bit is `age` ticks in: ground drift slowed by drag, and a height
 * under gravity that stops at the ground. Returns the ground point, the
 * height and whether it has landed.
 */
export const bitPath = (
  bit: Pick<Bit, "x" | "y" | "z" | "vx" | "vy" | "vz" | "drag" | "gravity">,
  age: number,
): { x: number; y: number; z: number; landed: boolean } => {
  let flight = age;
  let landed = false;
  if (bit.gravity > 0) {
    const down = (bit.vz + Math.sqrt(bit.vz * bit.vz + 2 * bit.gravity * bit.z)) / bit.gravity;
    if (age >= down) {
      flight = down;
      landed = true;
    }
  }
  const travel =
    bit.drag > 0 ? (1 - Math.pow(1 - bit.drag, flight)) / bit.drag : flight;
  const z = landed ? 0 : Math.max(0, bit.z + bit.vz * flight - 0.5 * bit.gravity * flight * flight);
  return { x: bit.x + bit.vx * travel, y: bit.y + bit.vy * travel, z, landed };
};

/* ── Textures, drawn once on a canvas ───────────────────────────────────── */

let looks: Map<Look, Texture> | null = null;

const canvasTexture = (size: number, paint: (context: CanvasRenderingContext2D) => void): Texture => {
  if (typeof document === "undefined") return Texture.WHITE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return Texture.WHITE;
  paint(context);
  return Texture.from(canvas);
};

const radial = (
  context: CanvasRenderingContext2D,
  size: number,
  stops: readonly (readonly [number, string])[],
): void => {
  const half = size / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
};

const lookTexture = (look: Look): Texture => {
  if (!looks) looks = new Map();
  const cached = looks.get(look);
  if (cached) return cached;
  let texture: Texture;
  switch (look) {
    case "soft":
      texture = canvasTexture(64, (c) =>
        radial(c, 64, [
          [0, "rgba(255,255,255,1)"],
          [0.35, "rgba(255,255,255,0.75)"],
          [1, "rgba(255,255,255,0)"],
        ]),
      );
      break;
    case "dot":
      texture = canvasTexture(32, (c) => {
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(16, 16, 14, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case "ring":
      texture = canvasTexture(128, (c) => {
        c.strokeStyle = "rgba(255,255,255,0.35)";
        c.lineWidth = 12;
        c.beginPath();
        c.arc(64, 64, 56, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "#fff";
        c.lineWidth = 5;
        c.beginPath();
        c.arc(64, 64, 57, 0, Math.PI * 2);
        c.stroke();
      });
      break;
    case "chunk":
      texture = canvasTexture(16, (c) => {
        c.fillStyle = "#fff";
        c.beginPath();
        c.moveTo(2, 5);
        c.lineTo(10, 1);
        c.lineTo(15, 9);
        c.lineTo(7, 15);
        c.closePath();
        c.fill();
      });
      break;
    case "eye":
      texture = canvasTexture(32, (c) => {
        c.fillStyle = "#f4f1ea";
        c.beginPath();
        c.arc(16, 16, 14, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#5a2a6e";
        c.lineWidth = 2;
        c.stroke();
        c.fillStyle = "#b03fd8";
        c.beginPath();
        c.arc(19, 15, 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#120818";
        c.beginPath();
        c.arc(20, 15, 3.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(17, 12, 2, 0, Math.PI * 2);
        c.fill();
      });
      break;
    case "scorch":
      texture = canvasTexture(128, (c) => {
        radial(c, 128, [
          [0, "rgba(20,12,8,0.95)"],
          [0.45, "rgba(30,18,10,0.7)"],
          [1, "rgba(30,18,10,0)"],
        ]);
        c.strokeStyle = "rgba(15,8,4,0.55)";
        c.lineWidth = 3;
        for (let index = 0; index < 14; index += 1) {
          const angle = (index / 14) * Math.PI * 2 + blastNoise(7, index) * 0.4;
          const reach = 34 + blastNoise(11, index) * 26;
          c.beginPath();
          c.moveTo(64 + Math.cos(angle) * 14, 64 + Math.sin(angle) * 14);
          c.lineTo(64 + Math.cos(angle) * reach, 64 + Math.sin(angle) * reach);
          c.stroke();
        }
      });
      break;
    case "stain":
      texture = canvasTexture(128, (c) => {
        const blob = (x: number, y: number, r: number, colour: string): void => {
          c.fillStyle = colour;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        };
        blob(64, 64, 30, "rgba(110,40,150,0.85)");
        for (let index = 0; index < 12; index += 1) {
          const angle = (index / 12) * Math.PI * 2 + blastNoise(3, index);
          const reach = 30 + blastNoise(5, index) * 26;
          blob(
            64 + Math.cos(angle) * reach,
            64 + Math.sin(angle) * reach,
            4 + blastNoise(9, index) * 9,
            index % 3 === 0 ? "rgba(130,210,60,0.85)" : "rgba(140,55,180,0.85)",
          );
        }
        blob(56, 58, 12, "rgba(150,220,70,0.7)");
        blob(74, 70, 8, "rgba(180,90,210,0.8)");
      });
      break;
  }
  looks.set(look, texture);
  return texture;
};

/* ── The effect ─────────────────────────────────────────────────────────── */

export class EyeraBlastFx {
  private readonly bits: Bit[] = [];
  private readonly pool: Sprite[] = [];
  private readonly marks: Mark[] = [];
  private readonly shakes: Shake[] = [];
  private shaking = false;
  private made = 0;

  constructor(
    private readonly host: EyeraBlastHost,
    readonly style: BlastStyle,
    private readonly reducedMotion = false,
  ) {}

  /** Bits alive, for tests and the dev hook. */
  get bitCount(): number {
    return this.bits.length;
  }

  get markCount(): number {
    return this.marks.length;
  }

  /** Blasts drawn so far. */
  get blastsMade(): number {
    return this.made;
  }

  /**
   * An Eye-ra went off at the ground point `at`, its blast `radius` screen px
   * wide. Nothing for the `ring` style, which the layer draws itself.
   */
  blast(tick: number, at: Point, radius: number): void {
    if (this.style === "ring") return;
    this.made += 1;
    const scale = Math.max(0.6, Math.min(1.8, radius / BASE_RADIUS));
    // Many at once: the extras thin out before the core flash and ring do.
    const busy = this.bits.length > MAX_BITS / 2 ? 0.5 : 1;
    const many = (count: number): number =>
      this.reducedMotion ? 0 : Math.max(1, Math.round(count * busy));
    if (this.style === "punchy") this.punchy(tick, at, radius, scale, many);
    else if (this.style === "fiery") this.fiery(tick, at, radius, scale, many);
    else this.goo(tick, at, radius, scale, many);
  }

  update(tick: number): void {
    let keep = 0;
    for (const bit of this.bits) {
      const age = tick - bit.born;
      if (age > bit.life) {
        this.release(bit.sprite);
        continue;
      }
      this.bits[keep] = bit;
      keep += 1;
      this.drawBit(bit, age);
    }
    this.bits.length = keep;

    let marksKept = 0;
    for (const mark of this.marks) {
      const age = tick - mark.born;
      if (age > mark.life) {
        mark.sprite.destroy();
        continue;
      }
      this.marks[marksKept] = mark;
      marksKept += 1;
      const left = 1 - age / mark.life;
      // Fully there for the first half, then fading out.
      mark.sprite.alpha = mark.peak * Math.min(1, left * 2);
    }
    this.marks.length = marksKept;

    this.drawShake(tick);
  }

  destroy(): void {
    for (const bit of this.bits) bit.sprite.destroy();
    this.bits.length = 0;
    for (const sprite of this.pool) sprite.destroy();
    this.pool.length = 0;
    for (const mark of this.marks) mark.sprite.destroy();
    this.marks.length = 0;
    this.shakes.length = 0;
    if (this.shaking) this.host.shake?.(0, 0);
    this.shaking = false;
  }

  /* ── A: punchy ──────────────────────────────────────────────────────── */

  private punchy(tick: number, at: Point, radius: number, scale: number, many: (n: number) => number): void {
    const lift = { x: at.x, y: at.y - 12 };
    this.add(tick, { look: "soft", at: lift, add: true, life: 9, size0: radius * 0.5, size1: radius * 1.5, easeOut: true, colours: [0xffffff, 0xfff3a0, 0xffc040] });
    this.add(tick, { look: "soft", at: lift, add: true, life: 16, size0: radius * 0.6, size1: radius * 0.9, colours: [0xfff6c0, 0xffa020, 0xff6000], peak: 0.9 });
    this.add(tick, { look: "ring", at, add: true, life: 18, size0: radius * 0.2, size1: radius * 2.2, squash: 0.5, easeOut: true, hold: 0.15, colours: [0xffffff, 0xfff0a0, 0xffb040] });
    this.add(tick, { look: "ring", at, add: true, delay: 3, life: 16, size0: radius * 0.15, size1: radius * 1.6, squash: 0.5, easeOut: true, peak: 0.55, colours: [0xffffff, 0xffe080] });
    const sparks = many(16);
    for (let index = 0; index < sparks; index += 1) {
      const angle = ((index + blastNoise(tick, index)) / sparks) * Math.PI * 2;
      const speed = (7 + blastNoise(tick, index + 40) * 6) * scale;
      this.add(tick, {
        look: "dot", at: lift, add: true,
        life: 12 + Math.round(blastNoise(tick, index + 80) * 8),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        drag: 0.16, size0: 4, size1: 1.5, stretch: true,
        colours: [0xffffff, 0xffe070, 0xff8020],
      });
    }
    if (!this.reducedMotion) this.shakes.push({ born: tick, life: 14, amp: 5 * Math.min(1.4, scale) });
  }

  /* ── B: fiery ───────────────────────────────────────────────────────── */

  private fiery(tick: number, at: Point, radius: number, scale: number, many: (n: number) => number): void {
    this.mark(tick, "scorch", at, radius * 1.5, 0.75, 260);
    this.add(tick, { look: "soft", at: { x: at.x, y: at.y - 10 }, add: true, life: 7, size0: radius * 0.6, size1: radius * 1.1, colours: [0xffffff, 0xffd070] });
    this.add(tick, { look: "ring", at, add: true, life: 12, size0: radius * 0.3, size1: radius * 1.7, squash: 0.5, easeOut: true, peak: 0.6, colours: [0xffd080, 0xff6010] });
    // Smoke first, so the fire is drawn over it.
    const puffs = many(9);
    for (let index = 0; index < puffs; index += 1) {
      const angle = (index / puffs) * Math.PI * 2 + blastNoise(tick, index + 200);
      const spread = radius * (0.12 + blastNoise(tick, index + 220) * 0.28);
      const grey = blastNoise(tick, index + 240) > 0.5 ? 0x3b3330 : 0x2a2422;
      this.add(tick, {
        look: "soft",
        at: { x: at.x + Math.cos(angle) * spread, y: at.y + Math.sin(angle) * spread * 0.5 },
        delay: 3 + (index % 4), life: 70 + Math.round(blastNoise(tick, index + 260) * 20),
        z: 6, vz: 0.35 + blastNoise(tick, index + 280) * 0.3,
        vx: Math.cos(angle) * 0.6 * scale, vy: Math.sin(angle) * 0.3 * scale, drag: 0.04,
        size0: radius * 0.28, size1: radius * 0.7, fadeIn: 8, peak: 0.72, hold: 0.25,
        colours: [grey, 0x6a6460, 0x8a8682],
      });
    }
    const fire = this.reducedMotion ? 3 : Math.max(3, Math.round(8 * (this.bits.length > MAX_BITS / 2 ? 0.5 : 1)));
    for (let index = 0; index < fire; index += 1) {
      const angle = (index / fire) * Math.PI * 2 + blastNoise(tick, index + 300) * 0.8;
      const spread = radius * (0.05 + blastNoise(tick, index + 320) * 0.22);
      this.add(tick, {
        look: "soft", add: true,
        at: { x: at.x + Math.cos(angle) * spread, y: at.y + Math.sin(angle) * spread * 0.5 },
        delay: index % 3, life: 20 + Math.round(blastNoise(tick, index + 340) * 10),
        z: 8 + blastNoise(tick, index + 360) * 10, vz: 0.6 + blastNoise(tick, index + 380) * 0.6,
        size0: radius * 0.35, size1: radius * 0.75, easeOut: true, hold: 0.2, peak: 0.8,
        colours: [0xffe090, 0xff8a20, 0xe0400c, 0x701000],
      });
    }
    const embers = many(18);
    for (let index = 0; index < embers; index += 1) {
      const angle = ((index + blastNoise(tick, index + 400)) / embers) * Math.PI * 2;
      const speed = (1.6 + blastNoise(tick, index + 420) * 2.4) * scale;
      this.add(tick, {
        look: "dot", add: true, at: { x: at.x, y: at.y },
        life: 34 + Math.round(blastNoise(tick, index + 440) * 18),
        z: 10, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: 3 + blastNoise(tick, index + 460) * 3.5, gravity: 0.2, drag: 0.02,
        size0: 3.5, size1: 1.5, hold: 0.5,
        colours: [0xffffc0, 0xffa020, 0xd02000],
      });
    }
  }

  /* ── C: Eye-ra goo ──────────────────────────────────────────────────── */

  private goo(tick: number, at: Point, radius: number, scale: number, many: (n: number) => number): void {
    this.mark(tick, "stain", at, radius * 1.25, 0.75, 200);
    const lift = { x: at.x, y: at.y - 10 };
    this.add(tick, { look: "soft", at: lift, add: true, life: 8, size0: radius * 0.5, size1: radius * 1.3, easeOut: true, colours: [0xffffff, 0xe0a0ff, 0xa040e0] });
    this.add(tick, { look: "ring", at, add: true, life: 14, size0: radius * 0.25, size1: radius * 1.9, squash: 0.5, easeOut: true, peak: 0.85, colours: [0xd8ff90, 0x8be03a, 0x5a9a20] });
    const blobs = many(20);
    const gooColours = [
      [0xc070f0, 0x9b3dd6, 0x6a2290],
      [0xe080e0, 0xd65bd0, 0x902a90],
      [0xc0ff70, 0x8be03a, 0x4f8a1c],
    ] as const;
    for (let index = 0; index < blobs; index += 1) {
      const angle = ((index + blastNoise(tick, index + 500)) / blobs) * Math.PI * 2;
      const speed = (1.8 + blastNoise(tick, index + 520) * 3) * scale;
      const size = 4 + blastNoise(tick, index + 540) * 5;
      this.add(tick, {
        look: "dot", at: lift,
        life: 40 + Math.round(blastNoise(tick, index + 560) * 20),
        z: 4, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: 2.5 + blastNoise(tick, index + 580) * 3, gravity: 0.3, drag: 0.03,
        size0: size, size1: size * 0.8, hold: 0.6,
        colours: gooColours[index % gooColours.length] ?? gooColours[0],
      });
    }
    const chunks = many(8);
    for (let index = 0; index < chunks; index += 1) {
      const angle = ((index + 0.5 + blastNoise(tick, index + 600) * 0.5) / chunks) * Math.PI * 2;
      const speed = (1.6 + blastNoise(tick, index + 620) * 2.2) * scale;
      this.add(tick, {
        look: "chunk", at: lift,
        life: 44 + Math.round(blastNoise(tick, index + 640) * 16),
        z: 6, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: 4 + blastNoise(tick, index + 660) * 3, gravity: 0.32, drag: 0.02,
        size0: 6 + blastNoise(tick, index + 680) * 4, size1: 5, hold: 0.6,
        spin: (blastNoise(tick, index + 700) - 0.5) * 0.6,
        colours: index % 2 === 0 ? [0x7a3a98] : [0x3f6e22],
      });
    }
    const eyes = this.reducedMotion ? 0 : 3;
    for (let index = 0; index < eyes; index += 1) {
      const angle = (index / eyes) * Math.PI * 2 + blastNoise(tick, index + 720) * 1.5;
      const speed = (1.2 + blastNoise(tick, index + 740)) * scale;
      this.add(tick, {
        look: "eye", at: lift,
        life: 56,
        z: 8, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: 5 + blastNoise(tick, index + 760) * 1.5, gravity: 0.3,
        size0: 10, size1: 9, hold: 0.7,
        spin: (index % 2 === 0 ? 1 : -1) * 0.25,
        colours: [0xffffff],
      });
    }
  }

  /* ── Bits ───────────────────────────────────────────────────────────── */

  private add(tick: number, spec: BitSpec): void {
    if (this.bits.length >= MAX_BITS) return;
    const sprite = this.pool.pop() ?? this.makeSprite();
    sprite.texture = lookTexture(spec.look);
    sprite.blendMode = spec.add ? "add" : "normal";
    sprite.rotation = 0;
    sprite.visible = false;
    this.host.air.addChild(sprite);
    const bit: Bit = {
      sprite,
      born: tick + (spec.delay ?? 0),
      life: spec.life ?? 20,
      x: spec.at.x,
      y: spec.at.y,
      z: spec.z ?? 0,
      vx: spec.vx ?? 0,
      vy: spec.vy ?? 0,
      vz: spec.vz ?? 0,
      drag: spec.drag ?? 0,
      gravity: spec.gravity ?? 0,
      size0: spec.size0 ?? 8,
      size1: spec.size1 ?? spec.size0 ?? 8,
      squash: spec.squash ?? 1,
      fadeIn: spec.fadeIn ?? 0,
      peak: spec.peak ?? 1,
      hold: spec.hold ?? 0,
      colours: spec.colours ?? [0xffffff],
      spin: spec.spin ?? 0,
      stretch: spec.stretch ?? false,
      easeOut: spec.easeOut ?? false,
    };
    this.bits.push(bit);
  }

  private drawBit(bit: Bit, age: number): void {
    const { sprite } = bit;
    if (age < 0) {
      sprite.visible = false;
      return;
    }
    const t = age / bit.life;
    const path = bitPath(bit, age);
    const grow = bit.easeOut ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
    const size = bit.size0 + (bit.size1 - bit.size0) * grow;
    let alpha = bit.peak;
    if (bit.fadeIn > 0 && age < bit.fadeIn) alpha *= age / bit.fadeIn;
    if (t > bit.hold) alpha *= Math.max(0, 1 - (t - bit.hold) / (1 - bit.hold));
    sprite.visible = true;
    sprite.alpha = alpha;
    sprite.tint = tintAt(bit.colours, t);
    sprite.position.set(path.x, path.y - path.z);
    // A bit that has landed lies flat on the ground: goo spreads, a chunk tips over.
    const squash = path.landed && bit.gravity > 0 && bit.squash === 1 ? 0.55 : bit.squash;
    if (bit.stretch) {
      const speed = Math.max(0.0001, Math.pow(1 - bit.drag, age));
      const vx = bit.vx * speed;
      const vy = bit.vy * speed - bit.vz;
      sprite.rotation = Math.atan2(vy, vx);
      sprite.width = size * (1.5 + Math.min(4, Math.hypot(vx, vy) * 0.7));
      sprite.height = size;
    } else {
      sprite.rotation = path.landed ? sprite.rotation : bit.spin * age;
      sprite.width = size;
      sprite.height = size * squash;
    }
  }

  private makeSprite(): Sprite {
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    return sprite;
  }

  private release(sprite: Sprite): void {
    sprite.visible = false;
    sprite.parent?.removeChild(sprite);
    this.pool.push(sprite);
  }

  /* ── Ground marks and the shake ─────────────────────────────────────── */

  private mark(tick: number, look: Look, at: Point, width: number, peak: number, life: number): void {
    while (this.marks.length >= MAX_MARKS) this.marks.shift()?.sprite.destroy();
    const sprite = new Sprite(lookTexture(look));
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    sprite.width = width;
    sprite.height = width / 2;
    sprite.position.set(at.x, at.y);
    sprite.alpha = peak;
    this.host.ground().addChild(sprite);
    this.marks.push({ sprite, born: tick, life, peak });
  }

  private drawShake(tick: number): void {
    if (!this.host.shake) return;
    let dx = 0;
    let dy = 0;
    let keep = 0;
    for (const shake of this.shakes) {
      const age = tick - shake.born;
      if (age > shake.life || age < 0) continue;
      this.shakes[keep] = shake;
      keep += 1;
      const left = 1 - age / shake.life;
      const amp = shake.amp * left * left;
      dx += Math.sin(age * 1.9 + shake.born) * amp;
      dy += Math.cos(age * 2.7 + shake.born) * amp * 0.7;
    }
    this.shakes.length = keep;
    if (keep === 0) {
      if (this.shaking) this.host.shake(0, 0);
      this.shaking = false;
      return;
    }
    // Several at once shake no harder than the cap.
    const cap = 8;
    this.host.shake(Math.max(-cap, Math.min(cap, dx)), Math.max(-cap, Math.min(cap, dy)));
    this.shaking = true;
  }
}
