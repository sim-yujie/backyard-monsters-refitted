import { Sprite, Texture, type Container } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

/**
 * Explosions drawn in code over the yard (feat/eyera-explosion). Drawing
 * only: nothing here reaches the battle, its damage, targeting or replay.
 *
 * - `fiery`: a fireball, embers that arc and fall, dark smoke that lingers
 *   about a second, and a scorch on the ground that fades. Eye-ra's blast.
 * - `punchy`: a white-yellow flash, a fast shockwave ring and sparks, and a
 *   short shake of the yard (`full`); just the flash and the shockwave
 *   (`light`); or the flash alone (`flash`), for a move that goes off every
 *   swing (feat/punchy-trial).
 *
 * Every particle is a pooled sprite placed from its age alone, so 1x and 2x
 * play the same path, at their own speed.
 */

/** Sprites alive at once across every blast: the cost ceiling with many Eye-ras. */
export const MAX_BITS = 260;
/** Ground marks (scorches, stains) kept at once; the oldest goes first. */
export const MAX_MARKS = 14;
/** The most the yard is ever shaken, screen px, however many blasts go off. */
export const MAX_SHAKE = 8;

/**
 * A punchy blast in full (flash, shockwave, sparks, shake), light (flash and
 * shockwave), or the flash alone.
 */
export type PunchyStrength = "full" | "light" | "flash";

/** A blast's own screen size for a level-1 Eye-ra: 60 cartesian, root two wide. */
const BASE_RADIUS = 85;

type Look = "soft" | "dot" | "ring" | "scorch";

/** One sprite of a blast, placed from its age each frame. */
interface Bit {
  readonly sprite: Sprite;
  readonly look: Look;
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

export interface BlastHost {
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
  }
  looks.set(look, texture);
  return texture;
};

/* ── The effect ─────────────────────────────────────────────────────────── */

/**
 * The Modern trap explosion's numbers (beta 6, a SAMPLE for the owner), all in
 * one place so the owner's call on it is a quick change. Ticks are the
 * battle's, 80 a second. The Classic look keeps the scorch and thin ring the
 * battle screen draws itself.
 */
export const TRAP_FX = {
  /** The fireball's reach on the ground against the blast's: 1 = its edge is the blast's edge. */
  reach: 1,
  /** The white flash, the fire on the ground and the smoke puff, ticks. */
  flashTicks: 8,
  fireTicks: 36,
  smokeTicks: 80,
  /** Clods of dirt thrown out, smoke puffs and sparks: [Booby Trap, Heavy Trap]. */
  dirt: [12, 22],
  puffs: [6, 10],
  sparks: [8, 14],
  /** The Heavy Trap's small shake (screen px, ticks); the Booby Trap does not shake. */
  heavyShake: { amp: 5, ticks: 24 },
} as const;

/**
 * The ground the fireball covers for a blast reaching `radius` screen px
 * across (the blast's circle as the yard shows it: twice as wide as tall).
 */
export const trapFireball = (radius: number): { width: number; height: number } => ({
  width: 2 * radius * TRAP_FX.reach,
  height: radius * TRAP_FX.reach,
});

/** The soft look fades out toward its edge: its picture is this much wider than what still shows. */
const SOFT_EDGE = 1.15;
/** The ring look's line sits at this share of its picture's width. */
const RING_LINE = 0.89;

export class BlastFx {
  private readonly bits: Bit[] = [];
  private readonly pool: Sprite[] = [];
  private readonly marks: Mark[] = [];
  /** One shake at a time: blasts together never add up (feat/punchy-trial). */
  private shake: Shake | null = null;
  private shaking = false;
  private made = 0;

  /**
   * `maxShake` raises the shake's ceiling (bigger attack effects), and
   * `fewer` halves the extra bits ("Reduce effects").
   */
  constructor(
    private readonly host: BlastHost,
    private readonly reducedMotion = false,
    private readonly maxShake = MAX_SHAKE,
    private readonly fewer = false,
  ) {}

  /** Bits alive, for tests and the dev hook. */
  get bitCount(): number {
    return this.bits.length;
  }

  /** How many bits of each look are alive, for tests. */
  looksAlive(): Partial<Record<Look, number>> {
    const counts: Partial<Record<Look, number>> = {};
    for (const bit of this.bits) counts[bit.look] = (counts[bit.look] ?? 0) + 1;
    return counts;
  }

  get markCount(): number {
    return this.marks.length;
  }

  /** Blasts drawn so far. */
  get blastsMade(): number {
    return this.made;
  }

  /** How hard the running shake started, screen px; 0 when none runs. */
  get shakeAmp(): number {
    return this.shake?.amp ?? 0;
  }

  /**
   * A blast's size against a level-1 Eye-ra's, and how many of `count` extra
   * bits to throw: fewer when the yard is busy, none for less motion.
   */
  private begin(radius: number): { scale: number; many: (count: number) => number } {
    this.made += 1;
    const scale = Math.max(0.6, Math.min(1.8, radius / BASE_RADIUS));
    // Many at once: the extras thin out before the core flash and ring do.
    const busy = (this.bits.length > MAX_BITS / 2 ? 0.5 : 1) * (this.fewer ? 0.5 : 1);
    const many = (count: number): number =>
      this.reducedMotion ? 0 : Math.max(1, Math.round(count * busy));
    return { scale, many };
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
    this.shake = null;
    if (this.shaking) this.host.shake?.(0, 0);
    this.shaking = false;
  }

  /* ── Punchy ─────────────────────────────────────────────────────────── */

  /**
   * A punchy blast at the ground point `at`, `radius` screen px wide: a flash,
   * a shockwave, and in `full` the fire glow, sparks and a short shake;
   * `flash` is the flash and nothing else.
   */
  punchy(tick: number, at: Point, radius: number, strength: PunchyStrength = "full"): void {
    const { scale, many } = this.begin(radius);
    const lift = { x: at.x, y: at.y - 12 };
    this.add(tick, { look: "soft", at: lift, add: true, life: 9, size0: radius * 0.5, size1: radius * 1.5, easeOut: true, colours: [0xffffff, 0xfff3a0, 0xffc040] });
    if (strength === "flash") return;
    if (strength === "full") {
      this.add(tick, { look: "soft", at: lift, add: true, life: 16, size0: radius * 0.6, size1: radius * 0.9, colours: [0xfff6c0, 0xffa020, 0xff6000], peak: 0.9 });
    }
    this.add(tick, { look: "ring", at, add: true, life: 18, size0: radius * 0.2, size1: radius * 2.2, squash: 0.5, easeOut: true, hold: 0.15, colours: [0xffffff, 0xfff0a0, 0xffb040] });
    this.add(tick, { look: "ring", at, add: true, delay: 3, life: 16, size0: radius * 0.15, size1: radius * 1.6, squash: 0.5, easeOut: true, peak: 0.55, colours: [0xffffff, 0xffe080] });
    if (strength === "light") return;
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
    if (!this.reducedMotion) this.startShake({ born: tick, life: 14, amp: Math.min(MAX_SHAKE, 5 * Math.min(1.4, scale)) });
  }

  /* ── Demolish ───────────────────────────────────────────────────────── */

  /**
   * A building falling (bigger attack effects): a flash and a fireball,
   * dust rolling along the ground, sparks, chunks of the building thrown up
   * that land and stay a moment, a scorch, and a shake as hard as the
   * building is big. No shockwave ring: the owner dropped it, as it read like
   * the Bandito's attack. A `small` one (a wall) gets the flash, a few chunks
   * and no shake.
   */
  demolish(tick: number, at: Point, radius: number, small = false): void {
    const { scale, many } = this.begin(radius);
    const lift = { x: at.x, y: at.y - 14 };
    this.add(tick, { look: "soft", at: lift, add: true, life: 12, size0: radius * 0.7, size1: radius * 2, easeOut: true, colours: [0xffffff, 0xfff3a0, 0xffb040] });
    if (!small) {
      this.mark(tick, "scorch", at, radius * 1.6, 0.6, 220);
      this.add(tick, { look: "soft", at: lift, add: true, life: 22, size0: radius * 0.8, size1: radius * 1.2, colours: [0xfff6c0, 0xffa020, 0xff6000, 0x802000], peak: 0.95 });
      // Dust rolling out along the ground.
      const dust = many(10);
      for (let index = 0; index < dust; index += 1) {
        const angle = (index / dust) * Math.PI * 2 + blastNoise(tick, index + 500);
        this.add(tick, {
          look: "soft", at, delay: 2,
          life: 46 + Math.round(blastNoise(tick, index + 520) * 20),
          vx: Math.cos(angle) * 3.2 * scale, vy: Math.sin(angle) * 1.6 * scale, drag: 0.08,
          z: 4, vz: 0.15, size0: radius * 0.3, size1: radius * 0.75, fadeIn: 4, peak: 0.6, hold: 0.2,
          colours: [0x9a8a70, 0x7a6e60, 0x5a5550],
        });
      }
      const sparks = many(14);
      for (let index = 0; index < sparks; index += 1) {
        const angle = ((index + blastNoise(tick, index + 540)) / sparks) * Math.PI * 2;
        const speed = (8 + blastNoise(tick, index + 560) * 7) * scale;
        this.add(tick, {
          look: "dot", at: lift, add: true,
          life: 14 + Math.round(blastNoise(tick, index + 580) * 8),
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
          drag: 0.14, size0: 5, size1: 1.5, stretch: true,
          colours: [0xffffff, 0xffe070, 0xff8020],
        });
      }
    }
    // Chunks of the building, thrown up, landing and lying a moment.
    const chunks = small ? Math.min(4, many(4)) : many(16);
    for (let index = 0; index < chunks; index += 1) {
      const angle = ((index + blastNoise(tick, index + 600)) / chunks) * Math.PI * 2;
      const speed = (1.5 + blastNoise(tick, index + 620) * 3) * scale;
      const tone = blastNoise(tick, index + 640);
      this.add(tick, {
        look: "dot", at: { x: at.x, y: at.y },
        life: 50 + Math.round(blastNoise(tick, index + 660) * 20),
        z: 16, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: 4 + blastNoise(tick, index + 680) * 4, gravity: 0.32, drag: 0.03,
        size0: 6 + tone * 5, size1: 5, hold: 0.7, spin: 0.3,
        colours: [tone > 0.5 ? 0x6b5a48 : 0x8a7a66, 0x4a4038],
      });
    }
    // "Reduce effects" keeps the fall's shake out, as it keeps the hit-stop.
    if (!this.reducedMotion && !this.fewer && !small) {
      this.startShake({ born: tick, life: 22, amp: Math.min(this.maxShake, 7 * Math.min(2, scale)) });
    }
  }

  /**
   * A shake on its own, for a tower's big hit (beta.5 tower attack effects):
   * capped at {@link MAX_SHAKE}, and never on top of a harder one.
   */
  jolt(tick: number, amp: number, life: number): void {
    if (!this.reducedMotion) this.startShake({ born: tick, life, amp: Math.min(MAX_SHAKE, amp) });
  }

  /** A small spark where a blow lands (bigger attack effects): a flash and a few bits. */
  impact(tick: number, at: Point, radius: number): void {
    const { many } = this.begin(radius);
    this.add(tick, { look: "soft", at, add: true, life: 7, size0: radius * 0.4, size1: radius * 1.3, easeOut: true, colours: [0xffffff, 0xfff3a0, 0xffc040] });
    const sparks = many(5);
    for (let index = 0; index < sparks; index += 1) {
      const angle = ((index + blastNoise(tick, index + 700)) / sparks) * Math.PI * 2;
      const speed = 4 + blastNoise(tick, index + 720) * 4;
      this.add(tick, {
        look: "dot", at, add: true,
        life: 8 + Math.round(blastNoise(tick, index + 740) * 5),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5 - 1,
        drag: 0.18, size0: 3.5, size1: 1, stretch: true,
        colours: [0xffffff, 0xffe070, 0xff8020],
      });
    }
  }

  /* ── Fiery ──────────────────────────────────────────────────────────── */

  /**
   * A trap going off (Modern): a bright flash, a fireball on the ground as big
   * as the blast (so the player sees who was in range) with a brighter edge, a
   * fire core rising, dirt and sparks thrown out, and a smoke puff fading over
   * about a second. `radius` is the blast's reach across the ground, screen px.
   * The Heavy Trap's is bigger and gives a small shake, which the "Screen
   * shake" switch (no host shake), less motion and "Reduce effects" keep out.
   * `few` halves the bits ("Effects: low").
   */
  trap(tick: number, at: Point, radius: number, heavy = false, few = false): void {
    const { scale, many } = this.begin(radius);
    const some = (count: number): number => many(few ? Math.ceil(count / 2) : count);
    const side = heavy ? 1 : 0;
    const { width, height } = trapFireball(radius);
    const flat = height / width;
    const lift = { x: at.x, y: at.y - (heavy ? 14 : 10) };
    // The smoke puff first, so the fire is drawn over it: grey, rising and fading over about a second.
    const puffs = some(TRAP_FX.puffs[side]);
    for (let index = 0; index < puffs; index += 1) {
      const angle = (index / puffs) * Math.PI * 2 + blastNoise(tick, index + 900);
      const spread = width * 0.5 * (0.1 + blastNoise(tick, index + 920) * 0.35);
      this.add(tick, {
        look: "soft", at: { x: at.x + Math.cos(angle) * spread, y: at.y + Math.sin(angle) * spread * 0.5 }, delay: 4,
        life: Math.round(TRAP_FX.smokeTicks * (0.8 + blastNoise(tick, index + 940) * 0.4)),
        z: 6, vz: 0.28, vx: Math.cos(angle) * 0.35, vy: Math.sin(angle) * 0.18, drag: 0.02,
        size0: width * 0.2, size1: width * 0.45, fadeIn: 8, hold: 0.15, peak: 0.6,
        colours: [0x6e645a, 0x4e4844, 0x3a3634],
      });
    }
    // The flash.
    this.add(tick, { look: "soft", at: lift, add: true, life: TRAP_FX.flashTicks, size0: width * 0.3, size1: width * 0.75, easeOut: true, colours: [0xffffff, 0xfff6c8, 0xffd060] });
    // The fireball on the ground, out to the blast's edge, and that edge a little brighter.
    this.add(tick, { look: "soft", at, add: true, life: TRAP_FX.fireTicks, size0: width * 0.35, size1: width * SOFT_EDGE, squash: flat, easeOut: true, hold: 0.3, peak: 0.95, colours: [0xfff4c0, 0xffb030, 0xff6a10, 0x9a2400] });
    this.add(tick, { look: "ring", at, add: true, life: Math.round(TRAP_FX.fireTicks * 0.8), size0: (width * 0.4) / RING_LINE, size1: width / RING_LINE, squash: flat, easeOut: true, hold: 0.35, peak: 0.55, colours: [0xffe090, 0xff9030, 0xc04010] });
    // The fire's core, rising off the ground as it burns out.
    this.add(tick, { look: "soft", at: lift, add: true, life: Math.round(TRAP_FX.fireTicks * 0.85), size0: width * 0.22, size1: width * 0.5, vz: 0.35, hold: 0.2, peak: 0.95, colours: [0xffffff, 0xffd060, 0xff7010, 0x601000] });
    // Dirt thrown up and out, landing in the blast and lying a moment.
    const dirt = some(TRAP_FX.dirt[side]);
    for (let index = 0; index < dirt; index += 1) {
      const angle = ((index + blastNoise(tick, index + 960)) / dirt) * Math.PI * 2;
      const speed = (1.8 + blastNoise(tick, index + 980) * 3.2) * scale;
      const tone = blastNoise(tick, index + 1000);
      this.add(tick, {
        look: "dot", at: { x: at.x, y: at.y },
        life: 46 + Math.round(blastNoise(tick, index + 1020) * 22),
        z: 4, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        vz: (heavy ? 5 : 3.8) + blastNoise(tick, index + 1040) * 4, gravity: 0.32, drag: 0.03,
        size0: (3 + tone * 4) * (heavy ? 1.3 : 1), size1: 3, hold: 0.7, spin: 0.3,
        colours: [tone > 0.5 ? 0x6b5038 : 0x58483a, 0x3e3328],
      });
    }
    const sparks = some(TRAP_FX.sparks[side]);
    for (let index = 0; index < sparks; index += 1) {
      const angle = ((index + blastNoise(tick, index + 1060)) / sparks) * Math.PI * 2;
      const speed = (6 + blastNoise(tick, index + 1080) * 6) * scale;
      this.add(tick, {
        look: "dot", at: lift, add: true,
        life: 12 + Math.round(blastNoise(tick, index + 1100) * 8),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5,
        drag: 0.15, size0: 4, size1: 1.5, stretch: true,
        colours: [0xffffff, 0xffe070, 0xff8020],
      });
    }
    if (heavy && !this.reducedMotion && !this.fewer) {
      const { amp, ticks } = TRAP_FX.heavyShake;
      this.startShake({ born: tick, life: ticks, amp: Math.min(this.maxShake, amp) });
    }
  }

  /** A fiery blast at the ground point `at`, `radius` screen px wide: Eye-ra's. */
  fiery(tick: number, at: Point, radius: number): void {
    const { scale, many } = this.begin(radius);
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
      look: spec.look,
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
    // A bit that has landed lies flat on the ground, as an ember settles.
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

  /** How hard `shake` still shakes at `tick`, easing off over its life; 0 outside it. */
  private static shakeLeft(shake: Shake, tick: number): number {
    const age = tick - shake.born;
    if (age > shake.life || age < 0) return 0;
    const left = 1 - age / shake.life;
    return shake.amp * left * left;
  }

  /**
   * Starts `shake` unless the one running still shakes harder: one shake at
   * a time, so blasts going off together never add up.
   */
  private startShake(shake: Shake): void {
    if (this.shake && BlastFx.shakeLeft(this.shake, shake.born) >= shake.amp) return;
    this.shake = shake;
  }

  private drawShake(tick: number): void {
    if (!this.host.shake) return;
    const shake = this.shake;
    if (!shake || tick - shake.born >= shake.life) {
      this.shake = null;
      if (this.shaking) this.host.shake(0, 0);
      this.shaking = false;
      return;
    }
    const age = tick - shake.born;
    const amp = BlastFx.shakeLeft(shake, tick);
    const dx = Math.sin(age * 1.9 + shake.born) * amp;
    const dy = Math.cos(age * 2.7 + shake.born) * amp * 0.7;
    const cap = this.maxShake;
    this.host.shake(Math.max(-cap, Math.min(cap, dx)), Math.max(-cap, Math.min(cap, dy)));
    this.shaking = true;
  }
}
