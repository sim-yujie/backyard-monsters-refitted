import { Assets, type Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";
import { artUrl } from "../../../artUrl";
import astraSet from "./astra.json";
import neonSet from "./neon.json";

/**
 * The krampus-fx bake-off (owner, 28 Nov 2026, desk frost-abil2: "If we wanna
 * do a frost aura, how would it look? No simple circle nonsense ... propose
 * animations using astra, or neon for me to vet"). Krampus's Frost aura, Ice
 * Shards and Blizzard Stomp as each designer model planned them
 * (`art-samples/frost-tribe/fxbake/<model>/round-N/motion.json`, from the one
 * shared brief `fxbake/brief.md`), drawn from that model's own sheet. A dev
 * switch, `?frostFx=current|astra|neon` (named apart from mm-anim's `?fxSet=`);
 * `current`, the default, is today's look, untouched. Every set is played by
 * this one reader, so neither is built with more care than the other.
 * Drawing only: nothing here reaches the battle.
 */

export type FrostFxId = "current" | "astra" | "neon";

export const frostFxFromUrl = (): FrostFxId => {
  if (typeof location === "undefined") return "current";
  const wanted = new URLSearchParams(location.search).get("frostFx");
  return wanted === "astra" || wanted === "neon" ? wanted : "current";
};

/* ── The plan's form (the shared brief) ───────────────────────────────────── */

type Size = number | string;

export interface PlanPiece {
  readonly cell?: string;
  readonly flipbook?: readonly string[];
  readonly flipbook_loop?: boolean;
  readonly flipbook_fps?: number;
  readonly start_ms?: number;
  readonly life_ms?: number;
  readonly anchor?: string;
  readonly offset?: readonly [number, number];
  readonly follow?: boolean;
  readonly vel?: readonly [number, number];
  readonly vz?: number;
  readonly z?: number;
  readonly gravity?: number;
  readonly drag?: number;
  readonly fly_to?: string;
  readonly arc_px?: number;
  readonly face_flight?: boolean;
  readonly count?: number;
  readonly ring?: Size | { readonly radius?: Size; readonly radial_speed?: number; readonly stagger_ms?: number; readonly jitter?: number };
  readonly radial_speed?: number;
  readonly stagger_ms?: number;
  readonly jitter?: number;
  readonly spread_deg?: number;
  readonly size?: readonly [Size, Size] | Size;
  readonly ease?: string;
  readonly squash?: number;
  readonly rotation_deg?: number;
  readonly spin_deg_s?: number;
  readonly fade_in_ms?: number;
  readonly peak?: number;
  readonly hold?: number;
  readonly tint?: readonly string[] | string;
  readonly tint_classic?: readonly string[] | string;
  readonly blend?: string;
  readonly layer?: string;
  readonly loop_ms?: number;
  readonly pulse?: boolean;
  readonly phase_stagger?: number;
  readonly orbit_deg_s?: number;
}

export interface PlanBody {
  readonly start_ms?: number;
  readonly keys?: readonly { readonly ms: number; readonly scale_x?: number; readonly scale_y?: number }[];
  readonly flash?: { readonly colour?: string; readonly peak?: number; readonly duration_ms?: number };
}

interface Shake {
  readonly start_ms?: number;
  readonly strength_px?: number;
  readonly duration_ms?: number;
}

export interface FrostPlan {
  readonly frostAura?: { readonly held?: PlanPiece[]; readonly on_each?: PlanPiece[]; readonly held_each?: PlanPiece[] };
  readonly iceShards?: {
    readonly launch?: PlanPiece[];
    readonly pieces?: PlanPiece[];
    readonly impact?: PlanPiece[];
    readonly held?: PlanPiece[];
    readonly body_target?: PlanBody;
    readonly body?: PlanBody;
    readonly shake?: Shake;
  };
  readonly blizzardStomp?: {
    readonly pieces?: PlanPiece[];
    readonly on_each?: PlanPiece[];
    readonly held?: PlanPiece[];
    readonly shake?: Shake;
    readonly body?: PlanBody;
  };
}

export interface FrostSet {
  readonly name: string;
  readonly cells: readonly string[];
  readonly columns: number;
  /** Each cell's visible bounds as a share of its 192 px cell [width, height]. */
  readonly bounds: Readonly<Record<string, readonly [number, number]>>;
  /** Cells drawn from the light sheet (white on clear, the game tints them). */
  readonly plan: FrostPlan;
}

const SETS: Record<Exclude<FrostFxId, "current">, FrostSet> = {
  astra: astraSet as unknown as FrostSet,
  neon: neonSet as unknown as FrostSet,
};

export const frostSet = (id: FrostFxId): FrostSet | null => (id === "current" ? null : SETS[id]);

const CELL = 192;

/* ── Units ────────────────────────────────────────────────────────────────── */

const TPS = 80;
const ticks = (ms: number | undefined): number => Math.round(((ms ?? 0) * TPS) / 1000);

const colourOf = (hex: string | undefined, fallback = 0xffffff): number => {
  if (!hex) return fallback;
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(value) ? value : fallback;
};

const colours = (tint: readonly string[] | string | undefined): number[] =>
  tint === undefined ? [0xffffff] : (Array.isArray(tint) ? tint : [tint as string]).map((one) => colourOf(one));

/** A size: px, or "reach" (the circle's diameter) / "radius" times a share ("reach*0.5"). */
export const sizeOf = (size: Size | undefined, reach: number, fallback = 16): number => {
  if (typeof size === "number") return size;
  if (typeof size !== "string") return fallback;
  const match = /^\s*(reach|radius)\s*(?:\*\s*([\d.]+))?\s*$/.exec(size);
  if (!match) {
    const plain = Number.parseFloat(size);
    return Number.isFinite(plain) ? plain : fallback;
  }
  const base = match[1] === "radius" ? reach / 2 : reach;
  return base * (match[2] ? Number.parseFloat(match[2]) : 1);
};

const sizes = (size: PlanPiece["size"], reach: number): [number, number] => {
  if (Array.isArray(size)) return [sizeOf(size[0], reach), sizeOf(size[1] ?? size[0], reach)];
  const one = sizeOf(size as Size | undefined, reach);
  return [one, one];
};

const lerpColour = (a: number, b: number, t: number): number => {
  const ch = (shift: number): number => {
    const from = (a >> shift) & 255;
    const to = (b >> shift) & 255;
    return Math.round(from + (to - from) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

const tintAt = (list: readonly number[], t: number): number => {
  if (list.length <= 1) return list[0] ?? 0xffffff;
  const at = Math.max(0, Math.min(0.9999, t)) * (list.length - 1);
  const i = Math.floor(at);
  return lerpColour(list[i]!, list[i + 1]!, at - i);
};

/** A fixed noise in 0-1 for a seed and an index (never random at run time). */
const noise = (seed: number, n: number, k = 0): number => {
  const s = Math.sin(seed * 12.9898 + n * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/* ── What the battle layer hands the player ───────────────────────────────── */

export interface Anchor {
  /** Where it is now; null once it is gone. */
  readonly now: () => Point | null;
}
export type Anchors = Readonly<Record<string, Anchor | undefined>>;

export interface KrampusNow {
  readonly id: number;
  readonly level: number;
  readonly feet: Point;
  readonly top: number;
  /** Screen heading, radians, y down; 0 faces right. */
  readonly heading: number;
}

export interface FrostBakeHost {
  readonly air: () => Container;
  readonly ground: () => Container;
  /** Every Krampus standing now. */
  readonly krampus: () => readonly KrampusNow[];
  /** A creep's feet and the top of its drawn body, null once gone. */
  readonly creep: (id: number) => { feet: Point; top: number; lift: number } | null;
  /** A tower's foot (footprint middle) and top, null once gone. */
  readonly tower: (id: number) => { base: Point; top: Point } | null;
  /** The towers Krampus's aura holds now. */
  readonly blinded: () => readonly number[];
  /** Every standing tower's scan point, yard units. */
  readonly towerPoints: () => readonly { id: number; x: number; y: number }[];
  /** A screen shake from a tick, px, ticks (Modern, and only if the player's shake switch is on). */
  readonly jolt: (tick: number, strength: number, life: number) => void;
  /** Aura radius in yard units at a level. */
  readonly auraRadius: (level: number) => number;
  readonly classic: boolean;
  readonly low: boolean;
}

/* ── Live pieces ──────────────────────────────────────────────────────────── */

interface Live {
  sprite: Sprite;
  frames: readonly string[];
  frameTicks: number;
  born: number;
  life: number;
  start: Point;
  follow: Anchor | null;
  to: Anchor | null;
  arc: number;
  /** Sideways bow of the flight (a fanned copy), px at its middle, + left of the line. */
  bow: number;
  face: boolean;
  vx: number;
  vy: number;
  vz: number;
  z: number;
  gravity: number;
  drag: number;
  size0: number;
  size1: number;
  easeOut: boolean;
  squash: number;
  rotation: number;
  spin: number;
  fadeIn: number;
  peak: number;
  hold: number;
  tints: number[];
  /** The point it started from when it follows (offsets are added to the anchor). */
  local: Point;
}

interface Held {
  key: string;
  pieces: readonly PlanPiece[];
  anchors: Anchors;
  since: number;
  /** The tick it ended on, or -1 while it lasts. */
  ended: number;
  /** Ends by itself at this tick (a chill's or a slow's end); Infinity for never. */
  until: number;
  reach: number;
}

interface Pulse {
  creepId: number;
  born: number;
  keys: { tick: number; x: number; y: number }[];
  flash: { colour: number; peak: number; life: number } | null;
}

const HELD_FADE_OUT = ticks(200);

export class FrostBakeFx {
  private readonly live: Live[] = [];
  private readonly pool: Sprite[] = [];
  private readonly held = new Map<string, Held>();
  private readonly spots: Sprite[] = [];
  private spotsUsed = 0;
  private readonly pulses: Pulse[] = [];
  private sheet: Texture | null = null;
  private loading = false;
  private readonly textures = new Map<string, Texture>();
  private readonly blindedNow = new Set<number>();
  private readonly stompsSeen = new Map<number, number>();
  private seed = 1;

  constructor(
    private readonly set: FrostSet,
    private readonly host: FrostBakeHost,
  ) {}

  private get plan(): FrostPlan {
    return this.set.plan;
  }

  private load(): void {
    if (this.sheet || this.loading) return;
    this.loading = true;
    const url = artUrl(`/assets/fx/frostbake/${this.set.name}.${this.host.classic ? "classic" : "modern"}.webp`);
    void Assets.load<Texture>(url).then((texture) => {
      this.sheet = texture;
    });
  }

  private texture(cell: string): Texture | null {
    this.load();
    if (!this.sheet) return null;
    let texture = this.textures.get(cell);
    if (!texture) {
      const index = this.set.cells.indexOf(cell);
      if (index < 0) return null;
      const frame = new Rectangle((index % this.set.columns) * CELL, Math.floor(index / this.set.columns) * CELL, CELL, CELL);
      texture = new Texture({ source: this.sheet.source, frame });
      this.textures.set(cell, texture);
    }
    return texture;
  }

  /** Width scale and squash that make `size` the piece's visible width (and `squash` its visible height over it). */
  private fitted(cell: string, squash: number | undefined): { scale: number; squash: number } {
    const bounds = this.set.bounds[cell];
    const fw = Math.max(0.05, bounds?.[0] ?? 1);
    const fh = Math.max(0.05, bounds?.[1] ?? 1);
    return { scale: 1 / fw, squash: squash === undefined ? 1 : (squash * fw) / fh };
  }

  private many(count: number): number {
    return this.host.low ? Math.max(1, Math.round(count * 0.4)) : count;
  }

  /* ── Events from the battle layer ─────────────────────────────────────── */

  /** Krampus threw an ice shard at a flyer (`target` its creep id, -1 for none). */
  shard(tick: number, krampusId: number, from: Point, targetId: number, targetAt: Point): void {
    const plan = this.plan.iceShards;
    if (!plan) return;
    const k = this.host.krampus().find((one) => one.id === krampusId);
    const anchors = this.casterAnchors(krampusId, k ?? null, from);
    const flyer = (lift: (c: { feet: Point; top: number; lift: number }) => Point, fallback: Point): Anchor => {
      let last = fallback;
      return {
        now: () => {
          const c = targetId >= 0 ? this.host.creep(targetId) : null;
          if (c) last = lift(c);
          return last;
        },
      };
    };
    const all: Record<string, Anchor> = {
      ...anchors,
      target: flyer((c) => ({ x: c.feet.x, y: c.feet.y - c.lift }), targetAt),
      target_ground: flyer((c) => c.feet, targetAt),
    };
    const seed = this.seed++;
    this.play(tick, plan.launch, all, 0, seed);
    this.play(tick, plan.pieces, all, 0, seed + 1);
    const land = tick + 16;
    this.play(land, plan.impact, all, 0, seed + 2);
    if (plan.body_target && targetId >= 0) this.pulse(targetId, land, plan.body_target);
    if (plan.body) this.pulse(krampusId, tick, plan.body);
    if (plan.shake) this.shake(tick, plan.shake);
    if (plan.held && targetId >= 0) {
      const key = `shard:${targetId}`;
      const old = this.held.get(key);
      const until = land + 2 * TPS;
      if (old && old.ended < 0) old.until = until;
      else this.held.set(key, { key, pieces: plan.held, anchors: all, since: land, ended: -1, until, reach: 0 });
    }
  }

  /** Krampus began his stomp (rearing up): the stomp's pieces before the slam start now. */
  stompStart(tick: number, krampusId: number, slamTick: number): void {
    if (this.stompsSeen.get(krampusId) === slamTick) return;
    this.stompsSeen.set(krampusId, slamTick);
    const plan = this.plan.blizzardStomp;
    if (!plan?.pieces) return;
    const k = this.host.krampus().find((one) => one.id === krampusId);
    if (!k) return;
    this.stompReach.set(krampusId, slamTick);
    this.play(slamTick, plan.pieces, this.casterAnchors(krampusId, k, null), this.stompDiameter(k.level), this.seed++, tick);
  }

  private readonly stompReach = new Map<number, number>();

  private stompDiameter(level: number): number {
    // Korath's quake reach, 2.5 of his ranges (65 at levels 5-6), as the game draws its ring.
    const range = [35, 45, 55, 60, 65, 65][Math.max(0, Math.min(5, level - 1))]!;
    return range * 2.5 * 2;
  }

  /** Blizzard Stomp landed: the towers inside, each slowed for 3 s. */
  slam(tick: number, krampusId: number, ix: number, iy: number, radius: number): void {
    const plan = this.plan.blizzardStomp;
    if (!plan) return;
    const k = this.host.krampus().find((one) => one.id === krampusId);
    const started = this.stompReach.get(krampusId);
    // The rear-up is seen a tick or two late (a frame), so its slam guess may be off by as much.
    if (k && (started === undefined || Math.abs(started - tick) > 8)) {
      // His rear-up was not seen (a frame skipped): the stomp from the slam.
      this.stompsSeen.set(krampusId, tick);
      this.play(tick, plan.pieces, this.casterAnchors(krampusId, k, null), radius * 2, this.seed++, tick);
    }
    this.stompReach.delete(krampusId);
    if (plan.shake) this.shake(tick, plan.shake);
    if (plan.body) this.pulse(krampusId, tick, plan.body);
    const inside = this.host
      .towerPoints()
      .filter((one) => (one.x - ix) * (one.x - ix) + (one.y - iy) * (one.y - iy) <= radius * radius);
    for (const one of inside) {
      const anchors = this.towerAnchors(one.id);
      this.play(tick, plan.on_each, anchors, radius * 2, this.seed++);
      if (!plan.held) continue;
      const key = `stomp:${one.id}`;
      const old = this.held.get(key);
      const until = tick + 3 * TPS;
      if (old && old.ended < 0) old.until = until;
      else this.held.set(key, { key, pieces: plan.held, anchors, since: tick, ended: -1, until, reach: radius * 2 });
    }
  }

  /* ── Anchors ──────────────────────────────────────────────────────────── */

  private casterAnchors(id: number, at: KrampusNow | null, fallback: Point | null): Record<string, Anchor> {
    const place = (pick: (k: KrampusNow) => Point): Anchor => {
      let last: Point | null = at ? pick(at) : fallback;
      return {
        now: () => {
          const k = this.host.krampus().find((one) => one.id === id);
          if (k) last = pick(k);
          return last;
        },
      };
    };
    return {
      caster_feet: place((k) => k.feet),
      // His head leads his body: forward along his heading (a goat is about 1.4 times as long as tall).
      caster_chest: place((k) => {
        const tall = k.feet.y - k.top;
        return { x: k.feet.x + Math.cos(k.heading) * tall * 0.2, y: k.feet.y - tall * 0.5 + Math.sin(k.heading) * tall * 0.1 };
      }),
      caster_head: place((k) => {
        const tall = k.feet.y - k.top;
        return { x: k.feet.x + Math.cos(k.heading) * tall * 0.45, y: k.top + tall * 0.25 + Math.sin(k.heading) * tall * 0.15 };
      }),
    };
  }

  private towerAnchors(id: number): Record<string, Anchor> {
    const pick = (f: (t: { base: Point; top: Point }) => Point): Anchor => {
      let last: Point | null = null;
      return {
        now: () => {
          const t = this.host.tower(id);
          if (t) last = f(t);
          return last;
        },
      };
    };
    return {
      tower_base: pick((t) => t.base),
      tower: pick((t) => ({ x: t.base.x, y: (t.base.y + t.top.y) / 2 })),
      tower_top: pick((t) => t.top),
    };
  }

  /* ── One-shot pieces ──────────────────────────────────────────────────── */

  /**
   * Throws pieces for an ability gone off at `tick` (its time 0); a piece
   * starting before `notBefore` (a stomp seen late) starts then instead.
   */
  private play(tick: number, pieces: readonly PlanPiece[] | undefined, anchors: Anchors, reach: number, seed: number, notBefore = -Infinity): void {
    if (!pieces) return;
    pieces.forEach((piece, index) => this.throwPiece(tick, piece, anchors, reach, seed * 7 + index * 131, notBefore));
  }

  private throwPiece(tick: number, piece: PlanPiece, anchors: Anchors, reach: number, seed: number, notBefore: number): void {
    const anchor = anchors[piece.anchor ?? "caster_feet"];
    if (!anchor) return;
    const at = anchor.now();
    if (!at) return;
    const ring =
      piece.ring === undefined
        ? undefined
        : typeof piece.ring === "object"
          ? piece.ring
          : { radius: piece.ring, radial_speed: piece.radial_speed, stagger_ms: piece.stagger_ms, jitter: piece.jitter };
    const fan = piece.spread_deg !== undefined && (piece.count ?? 1) > 1;
    const count = Math.max(1, ring || fan ? this.many(piece.count ?? 1) : piece.count ?? 1);
    const [size0, size1] = sizes(piece.size, reach);
    const frames = piece.flipbook && piece.flipbook.length > 0 ? piece.flipbook : [piece.cell ?? ""];
    const fit = this.fitted(frames[0]!, piece.squash);
    const life = Math.max(1, ticks(piece.life_ms ?? 300));
    const offset = piece.offset ?? [0, 0];
    const to = piece.fly_to ? (anchors[piece.fly_to] ?? null) : null;
    const tint = colours(this.host.classic && piece.tint_classic ? piece.tint_classic : piece.tint);
    const frameTicks = piece.flipbook && (piece.flipbook_loop || piece.flipbook_fps) ? Math.max(1, Math.round(TPS / (piece.flipbook_fps ?? 30))) : 0;
    const radius = ring ? sizeOf(ring.radius, reach, 0) : 0;
    const stagger = ticks(ring?.stagger_ms ?? piece.stagger_ms);
    const toAt = to?.now() ?? null;
    const dist = toAt ? Math.hypot(toAt.x - at.x - offset[0], toAt.y - at.y - offset[1]) : 0;
    for (let n = 0; n < count; n += 1) {
      const jitter = ring?.jitter ?? 0;
      const angle = ((n + (noise(seed, n) - 0.5) * jitter) / count) * Math.PI * 2;
      const out = ring ? { x: Math.cos(angle), y: Math.sin(angle) * 0.5 } : { x: 0, y: 0 };
      const reachJitter = ring ? 1 + (noise(seed, n, 1) - 0.5) * jitter * 0.4 : 1;
      const radial = ((ring?.radial_speed ?? 0) / TPS) * reachJitter;
      const local = { x: offset[0] + out.x * radius * reachJitter, y: offset[1] + out.y * radius * reachJitter };
      // A fanned copy leaves the line at its angle and bows back onto the target.
      const fanAngle = fan ? ((n / (count - 1) - 0.5) * (piece.spread_deg ?? 0) * Math.PI) / 180 : 0;
      const bow = fan ? (Math.tan(fanAngle) * dist) / 2 : 0;
      let born = tick + ticks(piece.start_ms) + n * stagger;
      if (born < notBefore) born = notBefore;
      const follows = piece.follow === true;
      const sprite = this.pool.pop() ?? this.makeSprite();
      (piece.layer === "ground" ? this.host.ground() : this.host.air()).addChild(sprite);
      sprite.blendMode = piece.blend === "add" && !this.host.classic ? "add" : "normal";
      sprite.visible = false;
      this.live.push({
        sprite,
        frames,
        frameTicks,
        born,
        life,
        start: follows ? { x: 0, y: 0 } : { x: at.x + local.x, y: at.y + local.y },
        local,
        follow: follows ? anchor : null,
        to,
        arc: piece.arc_px ?? 0,
        bow,
        face: piece.face_flight === true,
        vx: (piece.vel?.[0] ?? 0) / TPS + out.x * radial,
        vy: (piece.vel?.[1] ?? 0) / TPS + out.y * radial,
        vz: (piece.vz ?? 0) / TPS,
        z: piece.z ?? 0,
        gravity: (piece.gravity ?? 0) / (TPS * TPS),
        drag: piece.drag ? 1 - Math.pow(1 - Math.min(0.999, Math.max(0, piece.drag)), 1 / TPS) : 0,
        size0: size0 * fit.scale,
        size1: size1 * fit.scale,
        easeOut: piece.ease === "out",
        squash: fit.squash,
        rotation: ((piece.rotation_deg ?? 0) * Math.PI) / 180,
        spin: ((piece.spin_deg_s ?? 0) * Math.PI) / 180 / TPS,
        fadeIn: ticks(piece.fade_in_ms),
        peak: piece.peak ?? 1,
        hold: Math.min(0.999, Math.max(0, piece.hold ?? 0.5)),
        tints: tint,
      });
    }
  }

  private makeSprite(): Sprite {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    return sprite;
  }

  private release(sprite: Sprite): void {
    sprite.visible = false;
    sprite.parent?.removeChild(sprite);
    this.pool.push(sprite);
  }

  /** Distance moved after `n` ticks at `v` a tick losing `drag` of it each tick. */
  private static travel(v: number, drag: number, n: number): number {
    return drag > 0 ? (v * (1 - Math.pow(1 - drag, n))) / drag : v * n;
  }

  private drawLive(bit: Live, age: number): boolean {
    const { sprite } = bit;
    if (age < 0) {
      sprite.visible = false;
      return true;
    }
    if (age > bit.life) return false;
    const t = age / bit.life;
    const frame =
      bit.frameTicks > 0
        ? bit.frames[Math.floor(age / bit.frameTicks) % bit.frames.length]!
        : bit.frames[Math.min(bit.frames.length - 1, Math.floor(t * bit.frames.length))]!;
    const texture = this.texture(frame);
    if (!texture) {
      sprite.visible = false;
      return true;
    }
    sprite.texture = texture;
    let x: number;
    let y: number;
    let rotation = bit.rotation + bit.spin * age;
    const base = bit.follow ? bit.follow.now() : { x: 0, y: 0 };
    if (!base) return false;
    const to = bit.to?.now() ?? null;
    if (to) {
      const from = { x: base.x + (bit.follow ? bit.local.x : bit.start.x), y: base.y + (bit.follow ? bit.local.y : bit.start.y) };
      const point = (s: number) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const side = Math.sin(s * Math.PI) * bit.bow;
        return {
          x: from.x + dx * s + (dy / len) * side,
          y: from.y + dy * s - (dx / len) * side - Math.sin(s * Math.PI) * bit.arc,
        };
      };
      const here = point(t);
      x = here.x;
      y = here.y;
      if (bit.face) {
        const ahead = point(Math.min(1, t + 0.02));
        const behind = point(Math.max(0, t - 0.02));
        rotation = bit.rotation + Math.atan2(ahead.y - behind.y, ahead.x - behind.x);
      }
    } else {
      const fall = bit.gravity > 0 ? (age * age * bit.gravity) / 2 : 0;
      const z = Math.max(0, bit.z + bit.vz * age - fall);
      x = (bit.follow ? base.x + bit.local.x : bit.start.x) + FrostBakeFx.travel(bit.vx, bit.drag, age);
      y = (bit.follow ? base.y + bit.local.y : bit.start.y) + FrostBakeFx.travel(bit.vy, bit.drag, age) - z;
    }
    const grow = bit.easeOut ? 1 - (1 - t) * (1 - t) * (1 - t) : t;
    const size = bit.size0 + (bit.size1 - bit.size0) * grow;
    let alpha = bit.peak;
    if (bit.fadeIn > 0 && age < bit.fadeIn) alpha *= age / bit.fadeIn;
    if (t > bit.hold) alpha *= Math.max(0, 1 - (t - bit.hold) / (1 - bit.hold));
    sprite.visible = alpha > 0.01;
    sprite.alpha = alpha;
    sprite.tint = tintAt(bit.tints, t);
    sprite.rotation = rotation;
    sprite.position.set(x, y);
    sprite.width = size;
    sprite.height = size * bit.squash;
    return true;
  }

  /* ── Held pieces ──────────────────────────────────────────────────────── */

  private spot(): Sprite {
    let sprite = this.spots[this.spotsUsed];
    if (!sprite) {
      sprite = this.makeSprite();
      this.spots.push(sprite);
    }
    this.spotsUsed += 1;
    return sprite;
  }

  private drawHeld(tick: number, hold: Held): void {
    const age = tick - hold.since;
    const out = hold.ended < 0 ? 1 : Math.max(0, 1 - (tick - hold.ended) / HELD_FADE_OUT);
    if (out <= 0) return;
    for (const piece of hold.pieces) {
      const anchor = hold.anchors[piece.anchor ?? "tower"];
      const where = anchor?.now();
      if (!where) continue;
      const loop = Math.max(1, ticks(piece.loop_ms ?? piece.life_ms ?? 800));
      const fadeIn = ticks(piece.fade_in_ms);
      const into = fadeIn > 0 ? Math.min(1, age / fadeIn) : 1;
      const [size0, size1] = sizes(piece.size, hold.reach);
      const frames = piece.flipbook && piece.flipbook.length > 0 ? piece.flipbook : [piece.cell ?? ""];
      const fit = this.fitted(frames[0]!, piece.squash);
      const tint = colours(this.host.classic && piece.tint_classic ? piece.tint_classic : piece.tint);
      const ring = piece.ring === undefined ? undefined : typeof piece.ring === "object" ? piece.ring : { radius: piece.ring };
      const radius = ring ? sizeOf(ring.radius, hold.reach, 0) : 0;
      const count = Math.max(1, ring ? this.many(piece.count ?? 1) : piece.count ?? 1);
      const orbit = (((piece.orbit_deg_s ?? 0) * Math.PI) / 180) * (age / TPS);
      const offset = piece.offset ?? [0, 0];
      for (let n = 0; n < count; n += 1) {
        const local = age + Math.round((piece.phase_stagger ?? 0) * n * loop);
        const phase = (((local % loop) + loop) % loop) / loop;
        const shape = piece.pulse ? 1 - Math.abs(phase * 2 - 1) : phase;
        const angle = (n / count) * Math.PI * 2 + orbit;
        const ox = ring ? Math.cos(angle) * radius : 0;
        const oy = ring ? Math.sin(angle) * radius * 0.5 : 0;
        // Opacity over one loop follows the one-shot fields when a `hold` is given:
        // in over `fade_in_ms`, full to `hold`, out by the loop's end.
        let envelope = 1;
        if (piece.hold !== undefined && piece.hold < 1) {
          const inShare = fadeIn / loop;
          if (inShare > 0 && phase < inShare) envelope = phase / inShare;
          else if (phase > piece.hold) envelope = Math.max(0, 1 - (phase - piece.hold) / (1 - piece.hold));
        }
        const alpha = (piece.peak ?? 1) * into * out * envelope;
        if (alpha <= 0.01) continue;
        const frame =
          piece.flipbook && piece.flipbook.length > 0
            ? frames[
                piece.flipbook_fps
                  ? Math.floor(((local / TPS) * piece.flipbook_fps) % frames.length)
                  : Math.min(frames.length - 1, Math.floor(phase * frames.length))
              ]!
            : frames[0]!;
        const texture = this.texture(frame);
        if (!texture) continue;
        const sprite = this.spot();
        (piece.layer === "ground" ? this.host.ground() : this.host.air()).addChild(sprite);
        sprite.texture = texture;
        sprite.blendMode = piece.blend === "add" && !this.host.classic ? "add" : "normal";
        sprite.visible = true;
        sprite.alpha = alpha;
        sprite.tint = tintAt(tint, phase);
        const size = (size0 + (size1 - size0) * shape) * fit.scale;
        sprite.width = size;
        sprite.height = size * fit.squash;
        sprite.rotation = (((piece.rotation_deg ?? 0) + ((piece.spin_deg_s ?? 0) * local) / TPS) * Math.PI) / 180;
        sprite.position.set(where.x + offset[0] + ox, where.y + offset[1] + oy - (piece.z ?? 0));
      }
    }
  }

  /* ── Body pulses ──────────────────────────────────────────────────────── */

  private pulse(creepId: number, tick: number, body: PlanBody): void {
    const keys = (body.keys ?? []).map((key) => ({ tick: ticks(key.ms), x: key.scale_x ?? 1, y: key.scale_y ?? 1 })).sort((a, b) => a.tick - b.tick);
    const flash = body.flash
      ? { colour: colourOf(body.flash.colour), peak: body.flash.peak ?? 0.6, life: Math.max(1, ticks(body.flash.duration_ms ?? 200)) }
      : null;
    if (keys.length === 0 && !flash) return;
    this.pulses.push({ creepId, born: tick + ticks(body.start_ms), keys, flash });
  }

  /** A creep's body scale and flash from the pulses on it now (1, 1, 0 for none). */
  bodyAt(creepId: number, tick: number): { x: number; y: number; flash: number; colour: number } {
    let x = 1;
    let y = 1;
    let flash = 0;
    let colour = 0xffffff;
    for (const pulse of this.pulses) {
      if (pulse.creepId !== creepId) continue;
      const age = tick - pulse.born;
      if (age < 0) continue;
      const scale = keyed(pulse.keys, age);
      x *= scale.x;
      y *= scale.y;
      if (pulse.flash && age <= pulse.flash.life) {
        const strength = pulse.flash.peak * (1 - age / pulse.flash.life);
        if (strength > flash) {
          flash = strength;
          colour = pulse.flash.colour;
        }
      }
    }
    return { x, y, flash, colour };
  }

  private shake(tick: number, shake: Shake): void {
    if (this.host.classic) return;
    this.host.jolt(tick + ticks(shake.start_ms), Math.min(6, shake.strength_px ?? 3), Math.max(1, ticks(shake.duration_ms ?? 200)));
  }

  /* ── Every frame ──────────────────────────────────────────────────────── */

  update(tick: number): void {
    this.load();
    // The aura: held round each Krampus standing; on each tower it starts to blind, and held there while it does.
    const aura = this.plan.frostAura;
    const standing = this.host.krampus();
    if (aura) {
      const alive = new Set<string>();
      for (const k of standing) {
        const key = `aura:${k.id}`;
        alive.add(key);
        const reach = this.host.auraRadius(k.level) * Math.SQRT2 * 2;
        const old = this.held.get(key);
        if (!old && aura.held) {
          this.held.set(key, { key, pieces: aura.held, anchors: this.casterAnchors(k.id, k, null), since: tick, ended: -1, until: Infinity, reach });
        }
      }
      for (const hold of this.held.values()) {
        if (hold.key.startsWith("aura:") && !alive.has(hold.key) && hold.ended < 0) hold.ended = tick;
      }
      const blind = new Set(this.host.blinded());
      const reach = standing.length > 0 ? this.host.auraRadius(standing[0]!.level) * Math.SQRT2 * 2 : 0;
      for (const id of blind) {
        if (this.blindedNow.has(id)) continue;
        this.blindedNow.add(id);
        const anchors = this.towerAnchors(id);
        this.play(tick, aura.on_each, anchors, reach, this.seed++);
        if (aura.held_each) {
          this.held.set(`blind:${id}`, { key: `blind:${id}`, pieces: aura.held_each, anchors, since: tick, ended: -1, until: Infinity, reach });
        }
      }
      for (const id of [...this.blindedNow]) {
        if (blind.has(id)) continue;
        this.blindedNow.delete(id);
        const hold = this.held.get(`blind:${id}`);
        if (hold && hold.ended < 0) hold.ended = tick;
      }
    }
    // One-shot pieces.
    for (let at = this.live.length - 1; at >= 0; at -= 1) {
      const bit = this.live[at]!;
      if (!this.drawLive(bit, tick - bit.born)) {
        this.release(bit.sprite);
        this.live.splice(at, 1);
      }
    }
    // Held pieces, redrawn each frame.
    this.spotsUsed = 0;
    for (const [key, hold] of this.held) {
      if (hold.ended < 0 && tick >= hold.until) hold.ended = tick;
      if (hold.ended >= 0 && tick - hold.ended > HELD_FADE_OUT) {
        this.held.delete(key);
        continue;
      }
      this.drawHeld(tick, hold);
    }
    for (let n = this.spotsUsed; n < this.spots.length; n += 1) {
      const sprite = this.spots[n]!;
      sprite.visible = false;
      sprite.parent?.removeChild(sprite);
    }
    for (let at = this.pulses.length - 1; at >= 0; at -= 1) {
      const pulse = this.pulses[at]!;
      const last = Math.max(pulse.keys.at(-1)?.tick ?? 0, pulse.flash?.life ?? 0);
      if (tick - pulse.born > last + 1) this.pulses.splice(at, 1);
    }
  }

  destroy(): void {
    for (const bit of this.live) bit.sprite.destroy();
    for (const sprite of [...this.pool, ...this.spots]) sprite.destroy();
    this.live.length = 0;
    this.pool.length = 0;
    this.spots.length = 0;
    this.held.clear();
    for (const texture of this.textures.values()) texture.destroy();
    this.textures.clear();
  }
}

/** A body's scale `age` ticks into its keys, straight lines between them (1, 1 before and after). */
const keyed = (keys: readonly { tick: number; x: number; y: number }[], age: number): { x: number; y: number } => {
  const last = keys.at(-1);
  if (!last || age >= last.tick) return { x: last && age === last.tick ? last.x : 1, y: last && age === last.tick ? last.y : 1 };
  let before = { tick: 0, x: 1, y: 1 };
  for (const key of keys) {
    if (key.tick >= age) {
      const span = Math.max(1, key.tick - before.tick);
      const share = Math.min(1, Math.max(0, (age - before.tick) / span));
      return { x: before.x + (key.x - before.x) * share, y: before.y + (key.y - before.y) * share };
    }
    before = key;
  }
  return { x: 1, y: 1 };
};
