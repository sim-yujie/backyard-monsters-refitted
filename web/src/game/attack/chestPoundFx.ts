import type { ChampionAbilityId } from "@/game/combat/rules";
import type { Point } from "@/game/yard/YardGrid";
import { artUrl } from "../../artUrl";
import type { AbilityAtlas, AbilityBits, AbilityBitSpec } from "./abilityBits";
import { abilityNoise, type CreepPlace } from "./abilityFx";
import chestPoundPlan from "./chestPoundPlan.json";

/**
 * Gorgo's Chest Pound as Codex planned and painted it (the mm-anim bake-off;
 * owner, 28 Nov 2026: "codex gorgo chest pound. The rest can retain as-is").
 * The plan, `chestPoundPlan.json`, is Codex's `motion.json` entry for the
 * ability: pieces thrown when he pounds, one snap on each tower caught, a
 * mark held over each while the hold lasts, a shake and a squash on his body.
 * Its four painted cells sit on `server/public/assets/fx/chest-pound.<look>.webp`
 * (Modern and Classic). Every other ability keeps `abilityFx.ts`'s look.
 * Drawing only: nothing reaches the battle.
 */

/** The abilities drawn from a plan here; the rest keep the painted look. */
export const PLANNED_ABILITIES: readonly ChampionAbilityId[] = ["chestPound"];

/* ── The plan's form (the shared brief, bake/brief.md) ───────────────────── */

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
  readonly count?: number;
  /**
   * The brief let this be read two ways, and both entrants took one: an
   * object, or the radius alone with the other three beside it on the piece.
   */
  readonly ring?: Size | { readonly radius?: Size; readonly radial_speed?: number; readonly stagger_ms?: number; readonly jitter?: number };
  readonly radial_speed?: number;
  readonly stagger_ms?: number;
  readonly jitter?: number;
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
  /** Held pieces only: one loop, and whether size goes there and back each loop. */
  readonly loop_ms?: number;
  readonly pulse?: boolean;
}

export interface PlanBody {
  readonly start_ms?: number;
  readonly keys?: readonly { readonly ms: number; readonly scale_x?: number; readonly scale_y?: number }[];
  readonly flash?: { readonly colour?: string; readonly peak?: number; readonly duration_ms?: number };
}

export interface AbilityPlan {
  readonly pieces?: readonly PlanPiece[];
  readonly on_each?: readonly PlanPiece[];
  readonly held?: readonly PlanPiece[];
  readonly shake?: { readonly start_ms?: number; readonly strength_px?: number; readonly duration_ms?: number };
  readonly body?: PlanBody;
  readonly body_target?: PlanBody;
}

export interface FxSet {
  readonly name: string;
  readonly cells: readonly string[];
  readonly columns: number;
  /** Each cell's visible bounds as a share of its 192 px cell [width, height]; a plan's size is the visible width. */
  readonly bounds?: Readonly<Record<string, readonly [number, number]>>;
  /** The plan for Chest Pound. */
  readonly plan: AbilityPlan;
}

/** Codex's Chest Pound: its cells, their visible bounds and its plan. */
export const CHEST_POUND_SET: FxSet = chestPoundPlan as unknown as FxSet;

/** The sheet the plan's cells sit on, one row of four. */
export const chestPoundAtlas = (): AbilityAtlas => ({
  url: (classic) => artUrl(`/assets/fx/chest-pound.${classic ? "classic" : "modern"}.webp`),
  cells: CHEST_POUND_SET.cells,
  columns: CHEST_POUND_SET.columns,
});

/* ── Units ────────────────────────────────────────────────────────────────── */

/** Battle ticks a second. */
const TPS = 80;
const ticks = (ms: number | undefined): number => Math.round(((ms ?? 0) * TPS) / 1000);
const perTick = (pxPerSecond: number | undefined): number => (pxPerSecond ?? 0) / TPS;
const perTick2 = (pxPerSecond2: number | undefined): number => (pxPerSecond2 ?? 0) / (TPS * TPS);
/** A share of speed lost each second, as the bits' share lost each tick. */
const dragPerTick = (perSecond: number | undefined): number => {
  const share = Math.min(0.999, Math.max(0, perSecond ?? 0));
  return share <= 0 ? 0 : 1 - Math.pow(1 - share, 1 / TPS);
};

export const colourOf = (hex: string | undefined, fallback = 0xffffff): number => {
  if (!hex) return fallback;
  const value = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(value) ? value : fallback;
};

const colours = (tint: readonly string[] | string | undefined): number[] =>
  tint === undefined ? [0xffffff] : (Array.isArray(tint) ? tint : [tint as string]).map((one) => colourOf(one));

/** A size: px, or "reach" (the circle's diameter) times a share ("reach*0.5"). */
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

/** Where a piece may start: the anchors the brief names, those this cast has. */
export interface Anchors {
  readonly [name: string]: { readonly at: Point; readonly follow: (() => Point | null) | null } | undefined;
}

export const casterAnchors = (caster: CreepPlace, follow: () => CreepPlace | null): Anchors => {
  const chest = (place: CreepPlace): Point => ({ x: place.mid.x, y: place.mid.y - (place.mid.y - place.top) * 0.2 });
  const head = (place: CreepPlace): Point => ({ x: place.mid.x, y: place.top + (place.y - place.top) * 0.12 });
  const feet = (place: CreepPlace): Point => ({ x: place.x, y: place.y });
  const along = (pick: (place: CreepPlace) => Point) => () => {
    const now = follow();
    return now ? pick(now) : null;
  };
  return {
    caster_feet: { at: feet(caster), follow: along(feet) },
    caster_chest: { at: chest(caster), follow: along(chest) },
    caster_head: { at: head(caster), follow: along(head) },
  };
};

/* ── The player ───────────────────────────────────────────────────────────── */

export interface BodyPulse {
  readonly born: number;
  readonly keys: readonly { readonly tick: number; readonly x: number; readonly y: number }[];
  readonly flash: { readonly colour: number; readonly peak: number; readonly life: number } | null;
}

export const bodyPulseOf = (tick: number, body: PlanBody | undefined): BodyPulse | null => {
  if (!body) return null;
  const born = tick + ticks(body.start_ms);
  const keys = (body.keys ?? [])
    .map((key) => ({ tick: ticks(key.ms), x: key.scale_x ?? 1, y: key.scale_y ?? 1 }))
    .sort((a, b) => a.tick - b.tick);
  const flash = body.flash
    ? { colour: colourOf(body.flash.colour), peak: body.flash.peak ?? 0.6, life: Math.max(1, ticks(body.flash.duration_ms ?? 200)) }
    : null;
  if (keys.length === 0 && !flash) return null;
  return { born, keys, flash };
};

/** The body's scale from a pulse at `tick`, straight lines between its keys; null once it is over. */
export const pulseScale = (pulse: BodyPulse, tick: number): { x: number; y: number } | null => {
  const age = tick - pulse.born;
  const last = pulse.keys.at(-1);
  const flashOver = !pulse.flash || age > pulse.flash.life;
  if (age < 0) return { x: 1, y: 1 };
  if ((!last || age > last.tick) && flashOver) return null;
  if (!last || age >= last.tick) return { x: last?.x ?? 1, y: last?.y ?? 1 };
  let before = { tick: 0, x: 1, y: 1 };
  for (const key of pulse.keys) {
    if (key.tick >= age) {
      const span = Math.max(1, key.tick - before.tick);
      const share = Math.min(1, Math.max(0, (age - before.tick) / span));
      return { x: before.x + (key.x - before.x) * share, y: before.y + (key.y - before.y) * share };
    }
    before = key;
  }
  return { x: 1, y: 1 };
};

/** The flash's strength from a pulse at `tick`: up at once, fading over its life. */
export const pulseFlash = (pulse: BodyPulse, tick: number): number => {
  const flash = pulse.flash;
  if (!flash) return 0;
  const age = tick - pulse.born;
  if (age < 0 || age > flash.life) return 0;
  return flash.peak * (1 - age / flash.life);
};

/** One tower held by Chest Pound, as the player draws its `held` pieces. */
export interface HeldAt {
  readonly key: number;
  readonly since: number;
  /** Ticks since the hold ended, or -1 while it lasts. */
  readonly ended: number;
  readonly anchors: Anchors;
}

const HELD_FADE_OUT = ticks(200);

export class PlanPlayer {
  constructor(
    private readonly set: FxSet,
    private readonly bits: AbilityBits,
    private readonly classic: boolean,
  ) {}

  get ready(): boolean {
    this.bits.preload();
    return this.bits.ready;
  }

  /**
   * A plan's size is the piece's visible width, and an explicit `squash` its
   * visible height over that; without one the piece keeps its painted shape.
   * The sprite's own width and squash that give that, from the cell's bounds.
   */
  private fitted(cell: string, squash: number | undefined): { scale: number; squash: number } {
    const bounds = this.set.bounds?.[cell];
    const fw = Math.max(0.05, bounds?.[0] ?? 1);
    const fh = Math.max(0.05, bounds?.[1] ?? 1);
    return { scale: 1 / fw, squash: squash === undefined ? 1 : (squash * fw) / fh };
  }

  plan(ability: ChampionAbilityId): AbilityPlan | null {
    return PLANNED_ABILITIES.includes(ability) ? this.set.plan : null;
  }

  /** Throws a list of pieces from the anchors given, for an ability gone off at `tick`. */
  play(tick: number, pieces: readonly PlanPiece[] | undefined, anchors: Anchors, reach: number, seed: number): void {
    if (!pieces) return;
    pieces.forEach((piece, index) => this.throwPiece(tick, piece, anchors, reach, seed * 7 + index * 131));
  }

  /** The held pieces over each caught tower, for this frame. */
  held(tick: number, pieces: readonly PlanPiece[] | undefined, holds: readonly HeldAt[], reach: number): void {
    if (!pieces) return;
    for (const hold of holds) {
      const age = tick - hold.since;
      const out = hold.ended < 0 ? 1 : Math.max(0, 1 - hold.ended / HELD_FADE_OUT);
      if (out <= 0) continue;
      for (const piece of pieces) {
        const anchor = hold.anchors[piece.anchor ?? "tower"];
        if (!anchor) continue;
        const where = anchor.follow?.() ?? anchor.at;
        const start = ticks(piece.start_ms);
        if (age < start) continue;
        const local = age - start;
        const loop = Math.max(1, ticks(piece.loop_ms ?? piece.life_ms ?? 800));
        const phase = (local % loop) / loop;
        const shape = piece.pulse ? 1 - Math.abs(phase * 2 - 1) : phase;
        const [size0, size1] = sizes(piece.size, reach);
        const fit = this.fitted(piece.flipbook?.[0] ?? piece.cell ?? "", piece.squash);
        const size = (size0 + (size1 - size0) * shape) * fit.scale;
        const fadeIn = ticks(piece.fade_in_ms);
        const into = fadeIn > 0 ? Math.min(1, local / fadeIn) : 1;
        const tint = colours(this.classic && piece.tint_classic ? piece.tint_classic : piece.tint);
        const cell = this.frameAt(piece, local, loop);
        const offset = piece.offset ?? [0, 0];
        this.bits.spot({
          cell,
          at: { x: where.x + offset[0], y: where.y + offset[1] - (piece.z ?? 0) },
          size,
          squash: fit.squash,
          alpha: (piece.peak ?? 1) * into * out,
          tint: mixTint(tint, phase),
          rotation: (((piece.rotation_deg ?? 0) + ((piece.spin_deg_s ?? 0) * local) / TPS) * Math.PI) / 180,
          add: piece.blend === "add" && !this.classic,
          ground: piece.layer === "ground",
        });
      }
    }
  }

  private frameAt(piece: PlanPiece, age: number, life: number): string {
    const frames = piece.flipbook;
    if (!frames || frames.length === 0) return piece.cell ?? "";
    const step = piece.flipbook_fps ? TPS / piece.flipbook_fps : life / frames.length;
    const index = Math.floor(age / Math.max(1, step));
    return frames[piece.flipbook_loop || piece.flipbook_fps ? index % frames.length : Math.min(frames.length - 1, index)]!;
  }

  private throwPiece(tick: number, piece: PlanPiece, anchors: Anchors, reach: number, seed: number): void {
    const anchor = anchors[piece.anchor ?? "caster_feet"];
    if (!anchor) return;
    const count = Math.max(1, piece.ring ? this.bits.many(piece.count ?? 1) : piece.count ?? 1);
    const [size0, size1] = sizes(piece.size, reach);
    const fit = this.fitted(piece.flipbook?.[0] ?? piece.cell ?? "", piece.squash);
    const life = Math.max(1, ticks(piece.life_ms ?? 300));
    const offset = piece.offset ?? [0, 0];
    const flyTo = piece.fly_to ? anchors[piece.fly_to] : undefined;
    const tint = colours(this.classic && piece.tint_classic ? piece.tint_classic : piece.tint);
    const frames = piece.flipbook && piece.flipbook.length > 0 ? piece.flipbook : undefined;
    const frameTicks = frames && (piece.flipbook_loop || piece.flipbook_fps) ? Math.max(1, Math.round(TPS / (piece.flipbook_fps ?? 30))) : 0;
    const ring =
      piece.ring === undefined
        ? undefined
        : typeof piece.ring === "object"
          ? piece.ring
          : { radius: piece.ring, radial_speed: piece.radial_speed, stagger_ms: piece.stagger_ms, jitter: piece.jitter };
    const radius = ring ? sizeOf(ring.radius, reach, 0) : 0;
    for (let n = 0; n < count; n += 1) {
      const jitter = ring?.jitter ?? 0;
      const angle = ((n + (abilityNoise(seed, n) - 0.5) * jitter) / count) * Math.PI * 2;
      const out = ring ? { x: Math.cos(angle), y: Math.sin(angle) * 0.5 } : { x: 0, y: 0 };
      const reachJitter = ring ? 1 + (abilityNoise(seed, n, 1) - 0.5) * jitter * 0.4 : 1;
      const radial = perTick(ring?.radial_speed) * reachJitter;
      const local = { x: offset[0] + out.x * radius * reachJitter, y: offset[1] + out.y * radius * reachJitter };
      const follows = piece.follow === true && anchor.follow !== null;
      const spec: AbilityBitSpec = {
        cell: frames ? frames[0]! : piece.cell ?? "",
        ...(frames ? { frames, frameTicks } : {}),
        at: follows ? local : { x: anchor.at.x + local.x, y: anchor.at.y + local.y },
        ...(follows && anchor.follow ? { follow: anchor.follow } : {}),
        ...(flyTo ? { to: flyTo.follow ?? (() => flyTo.at), arc: piece.arc_px ?? 0 } : {}),
        delay: ticks(piece.start_ms) + n * ticks(ring?.stagger_ms),
        life,
        z: piece.z ?? 0,
        vx: perTick(piece.vel?.[0]) + out.x * radial,
        vy: perTick(piece.vel?.[1]) + out.y * radial,
        vz: perTick(piece.vz),
        gravity: perTick2(piece.gravity),
        drag: dragPerTick(piece.drag),
        size0: size0 * fit.scale,
        size1: size1 * fit.scale,
        squash: fit.squash,
        fadeIn: ticks(piece.fade_in_ms),
        peak: piece.peak ?? 1,
        hold: piece.hold ?? 0,
        colours: tint,
        rotation: ((piece.rotation_deg ?? 0) * Math.PI) / 180,
        spin: ((piece.spin_deg_s ?? 0) * Math.PI) / 180 / TPS,
        easeOut: piece.ease === "out",
        add: piece.blend === "add" && !this.classic,
        ground: piece.layer === "ground",
      };
      this.bits.emit(tick, spec);
    }
  }
}

const mixTint = (tint: readonly number[], t: number): number => {
  if (tint.length <= 1) return tint[0] ?? 0xffffff;
  const scaled = Math.max(0, Math.min(1, t)) * (tint.length - 1);
  const index = Math.min(tint.length - 2, Math.floor(scaled));
  const share = scaled - index;
  const a = tint[index]!;
  const b = tint[index + 1]!;
  const mix = (shift: number): number => Math.round(((a >> shift) & 0xff) * (1 - share) + ((b >> shift) & 0xff) * share) << shift;
  return mix(16) | mix(8) | mix(0);
};
