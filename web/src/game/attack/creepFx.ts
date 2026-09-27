import { Container, Graphics, Text } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";

/**
 * The moments a creep makes during a battle that are not the creep itself
 * (issues #63 and #68): a ranged monster's projectile, the flash on the
 * building it lands on, the smoke when a building crosses into damaged or
 * destroyed, and the damage numbers over a monster that is hit.
 *
 * `AttackBattleLayer` owns the creep sprites and calls in here from its event
 * handler; this owns nothing that is in the depth-sorted yard. Everything is
 * drawn in the scene's overlay above the buildings and runs on the battle
 * tick, so 2x speed doubles all of it. The layer keeps the two things a creep
 * body does itself — the melee lunge and the red hurt tint — because they move
 * and tint the body sprite; the arithmetic for both lives here so it can be
 * tested without a renderer.
 *
 * ## What Flash did
 *
 * Fomor spawns a `FIREBALL` from its body, eight tenths of the way to the
 * target, every swing (`champions/Fomor.as:145-157`); Teratorn, Vorg, Zafreeti,
 * Rezghul and Sabnox override `rangedAttack` the same way with the magma
 * projectile (`creeps/Teratorn.as:17-22`). Gorgo, Drull, Korath and Krallen
 * have a reach of 35 to 90 yard units but stomp rather than shoot, so a
 * projectile is drawn for a ranged swing only when the monster is not one of
 * them. A building puffs smoke when it turns damaged and again, larger and
 * with a stream, when it is destroyed (`BFOUNDATION.as:1070-1092`,
 * `Smoke.as:83-101`). Flash's `MonsterBase.damaged` is an empty stub
 * (`MonsterBase.as:405`), so the damage numbers here are new: the owner asked
 * for them (#68).
 */

/* ── Tick constants ─────────────────────────────────────────────────────── */

/** Ticks a melee lunge takes, out and back: 100 ms at 1x. */
export const LUNGE_TICKS = 8;
/** World px a lunging body moves toward its target at the peak. */
export const LUNGE_PX = 4;

/** Ticks a projectile is in the air: 200 ms at 1x. */
export const PROJECTILE_TICKS = 16;
/** Ticks the burst where it landed is shown. */
export const BURST_TICKS = 6;
/** World px the arc rises at its middle. */
const ARC_HEIGHT = 12;

/** Ticks a struck building is drawn flashed. */
export const FLASH_TICKS = 3;
/** Ticks before the same building may flash again, so a mob does not strobe it. */
export const FLASH_COOLDOWN_TICKS = 12;

/** Ticks a hurt creep's body is tinted red. */
export const HURT_TICKS = 6;

/** Ticks a damage number lives: 0.6 s at 1x. */
export const LABEL_TICKS = 48;
/** World px a damage number rises over its life. */
export const LABEL_RISE = 22;
/** Damage numbers on screen at once; the oldest is recycled past this. */
export const LABEL_POOL = 64;
/** A wound within this many ticks of a creep's last number is added to it. */
export const LABEL_MERGE_TICKS = 10;

/** Ticks a smoke puff lives. */
export const SMOKE_TICKS = 40;
/** Puffs in a poof: a building turning damaged, and one being destroyed. */
const POOF_PUFFS = { damaged: 4, destroyed: 8 } as const;
/** World px a destroyed building's puffs are still being added for. */
const STREAM_TICKS = 60;
const STREAM_EVERY = 10;

/** Colours. */
const FIREBALL_CORE = 0xfff0a0;
const FIREBALL_BODY = 0xff8c1a;
const FIREBALL_TAIL = 0xd94a12;
const SMOKE_COLOUR = 0x5a5a5a;
const LABEL_COLOUR = 0xff5a5a;
const LABEL_FRIENDLY_COLOUR = 0xffe680;
const LABEL_STROKE = 0x1a0a0a;

/** The champions that stomp: a long reach in the stats, no projectile in Flash. */
const STOMPING_CHAMPIONS: ReadonlySet<string> = new Set(["G1", "G2", "G4", "G5"]);

/* ── Pure arithmetic ────────────────────────────────────────────────────── */

/**
 * How far along a lunge a body is, in px toward its target: a half sine that
 * peaks at `LUNGE_PX` halfway through and is 0 outside `[0, LUNGE_TICKS]`.
 */
export const lungeOffset = (age: number): number => {
  if (age < 0 || age >= LUNGE_TICKS) return 0;
  return Math.sin((age / LUNGE_TICKS) * Math.PI) * LUNGE_PX;
};

/** Where a projectile is `age` ticks into its flight: a line with a small arc. */
export const flightPoint = (from: Point, to: Point, age: number): Point => {
  const t = Math.max(0, Math.min(1, age / PROJECTILE_TICKS));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * ARC_HEIGHT,
  };
};

/** A damage number's rise and alpha at `age`: up steadily, fading in the second half. */
export const labelPose = (age: number): { rise: number; alpha: number } => {
  const t = Math.max(0, Math.min(1, age / LABEL_TICKS));
  return { rise: t * LABEL_RISE, alpha: t < 0.5 ? 1 : 1 - (t - 0.5) * 2 };
};

/** Whether a swing is drawn as a projectile: from range, and not a stomper. */
export const drawsProjectile = (monsterId: string, ranged: boolean): boolean =>
  ranged && !STOMPING_CHAMPIONS.has(monsterId);

/* ── The effects ────────────────────────────────────────────────────────── */

/** What the effects ask the layer for each frame. */
export interface CreepFxHost {
  /** A creep's ground point and the world y of the top of its body, or null once gone. */
  creepAnchor(id: number): { readonly ground: Point; readonly top: number } | null;
  /** Switches a building's hit flash on or off. */
  flashBuilding(id: number, on: boolean): void;
}

interface Projectile {
  readonly tick: number;
  readonly from: Point;
  readonly to: Point;
  /** The building to flash when it lands, or -1. */
  readonly buildingId: number;
  readonly big: boolean;
  landed: boolean;
}

interface Puff {
  readonly tick: number;
  readonly graphic: Graphics;
  readonly x: number;
  readonly y: number;
  readonly drift: number;
  readonly radius: number;
}

interface Stream {
  readonly at: Point;
  readonly until: number;
  next: number;
}

interface Label {
  readonly text: Text;
  creepId: number;
  bornTick: number;
  amount: number;
  /** Where it was last drawn, for after the creep is gone. */
  x: number;
  y: number;
}

export class CreepFx {
  /** Everything here, in the overlay: projectiles, then smoke, then numbers. */
  readonly root = new Container();
  private readonly fire = new Graphics();
  private readonly smoke = new Container();
  private readonly labels = new Container();

  private readonly projectiles: Projectile[] = [];
  private readonly puffs: Puff[] = [];
  private readonly puffPool: Graphics[] = [];
  private readonly streams: Stream[] = [];
  private readonly flashUntil = new Map<number, number>();
  private readonly flashStarted = new Map<number, number>();
  private readonly active: Label[] = [];
  private readonly labelPool: Label[] = [];
  private readonly labelByCreep = new Map<number, Label>();
  private tick = 0;
  private poofs = 0;

  constructor(
    private readonly host: CreepFxHost,
    private readonly reducedMotion = false,
  ) {
    for (const layer of [this.root, this.fire, this.smoke, this.labels]) layer.eventMode = "none";
    this.root.addChild(this.fire, this.smoke, this.labels);
  }

  /* ── Adding ─────────────────────────────────────────────────────────── */

  /** A projectile from a monster's body to a target, flashing `buildingId` on arrival. */
  projectile(tick: number, from: Point, to: Point, buildingId: number, big: boolean): void {
    this.projectiles.push({ tick, from, to, buildingId, big, landed: false });
  }

  /** Flashes a building for `FLASH_TICKS`, unless it flashed a moment ago. */
  flash(buildingId: number, tick: number): void {
    if (buildingId < 0) return;
    const started = this.flashStarted.get(buildingId);
    if (started !== undefined && tick - started < FLASH_COOLDOWN_TICKS) return;
    this.flashStarted.set(buildingId, tick);
    if (!this.flashUntil.has(buildingId)) this.host.flashBuilding(buildingId, true);
    this.flashUntil.set(buildingId, tick + FLASH_TICKS);
  }

  /**
   * Smoke at a building's middle: a small poof for turning damaged, a large
   * one and a stream of further puffs for being destroyed.
   */
  poof(tick: number, at: Point, destroyed: boolean): void {
    this.poofs += 1;
    const count = destroyed ? POOF_PUFFS.destroyed : POOF_PUFFS.damaged;
    const spread = destroyed ? 18 : 10;
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + 0.5) / count) * Math.PI * 2 + tick * 0.31;
      this.addPuff(
        tick,
        at.x + Math.cos(angle) * spread,
        at.y + Math.sin(angle) * spread * 0.5,
        destroyed ? 9 : 6,
      );
    }
    if (destroyed && !this.reducedMotion) {
      this.streams.push({ at, until: tick + STREAM_TICKS, next: tick + STREAM_EVERY });
    }
  }

  /** A wound on a creep: a number over it, merged into a very recent one. */
  hurt(tick: number, creepId: number, amount: number, at: Point, friendly: boolean): void {
    const shown = Math.max(1, Math.round(amount));
    const recent = this.labelByCreep.get(creepId);
    if (recent && tick - recent.bornTick < LABEL_MERGE_TICKS) {
      recent.amount += shown;
      recent.text.text = String(recent.amount);
      return;
    }
    const label = this.acquireLabel();
    label.creepId = creepId;
    label.bornTick = tick;
    label.amount = shown;
    label.x = at.x;
    label.y = at.y;
    label.text.text = String(shown);
    label.text.style.fill = friendly ? LABEL_FRIENDLY_COLOUR : LABEL_COLOUR;
    label.text.visible = true;
    label.text.alpha = 1;
    label.text.position.set(Math.round(at.x), Math.round(at.y));
    this.active.push(label);
    this.labelByCreep.set(creepId, label);
  }

  /* ── Frame ──────────────────────────────────────────────────────────── */

  update(tick: number): void {
    this.tick = tick;
    this.drawProjectiles(tick);
    this.expireFlashes(tick);
    this.drawSmoke(tick);
    this.drawLabels(tick);
  }

  destroy(): void {
    this.root.parent?.removeChild(this.root);
    for (const id of this.flashUntil.keys()) this.host.flashBuilding(id, false);
    this.flashUntil.clear();
    this.flashStarted.clear();
    this.projectiles.length = 0;
    this.puffs.length = 0;
    this.puffPool.length = 0;
    this.streams.length = 0;
    this.active.length = 0;
    this.labelPool.length = 0;
    this.labelByCreep.clear();
    this.root.destroy({ children: true });
  }

  /* ── Counts, for tests and the dev hook ─────────────────────────────── */

  get projectileCount(): number {
    return this.projectiles.length;
  }

  get labelCount(): number {
    return this.active.length;
  }

  get pooledLabelCount(): number {
    return this.labelPool.length;
  }

  get puffCount(): number {
    return this.puffs.length;
  }

  /** Poofs made over the battle so far. */
  get poofsMade(): number {
    return this.poofs;
  }

  /** Buildings drawn flashed right now. */
  get flashing(): readonly number[] {
    return [...this.flashUntil.keys()];
  }

  /** The number a creep is showing, or null. */
  labelFor(creepId: number): { amount: number; x: number; y: number } | null {
    const label = this.labelByCreep.get(creepId);
    if (!label || tickAge(this.tick, label.bornTick) > LABEL_TICKS) return null;
    return { amount: label.amount, x: label.text.x, y: label.text.y };
  }

  /* ── Projectiles ────────────────────────────────────────────────────── */

  private drawProjectiles(tick: number): void {
    const fire = this.fire;
    fire.clear();
    let keep = 0;
    for (const shot of this.projectiles) {
      const age = tick - shot.tick;
      if (age > PROJECTILE_TICKS + BURST_TICKS) continue;
      this.projectiles[keep] = shot;
      keep += 1;
      if (age >= PROJECTILE_TICKS && !shot.landed) {
        shot.landed = true;
        this.flash(shot.buildingId, tick);
      }
      const radius = shot.big ? 6 : 4.5;
      if (age < PROJECTILE_TICKS) {
        const at = flightPoint(shot.from, shot.to, age);
        if (!this.reducedMotion) {
          // Three tail beads along the path just flown, fading back.
          for (let back = 1; back <= 3; back += 1) {
            const trail = flightPoint(shot.from, shot.to, age - back * 1.5);
            fire
              .circle(trail.x, trail.y, radius * (1 - back * 0.22))
              .fill({ color: FIREBALL_TAIL, alpha: 0.5 - back * 0.13 });
          }
        }
        fire.circle(at.x, at.y, radius).fill({ color: FIREBALL_BODY, alpha: 0.95 });
        fire.circle(at.x, at.y, radius * 0.5).fill({ color: FIREBALL_CORE, alpha: 1 });
      } else {
        const burst = (age - PROJECTILE_TICKS) / BURST_TICKS;
        fire
          .circle(shot.to.x, shot.to.y, radius + burst * radius * 2)
          .fill({ color: FIREBALL_BODY, alpha: 0.8 * (1 - burst) });
      }
    }
    this.projectiles.length = keep;
  }

  private expireFlashes(tick: number): void {
    for (const [id, until] of this.flashUntil) {
      if (tick < until) continue;
      this.flashUntil.delete(id);
      this.host.flashBuilding(id, false);
    }
  }

  /* ── Smoke ──────────────────────────────────────────────────────────── */

  private addPuff(tick: number, x: number, y: number, radius: number): void {
    const graphic = this.puffPool.pop() ?? this.makePuff();
    graphic.clear();
    graphic.circle(0, 0, radius).fill({ color: SMOKE_COLOUR, alpha: 1 });
    graphic.visible = true;
    graphic.alpha = 0.7;
    graphic.scale.set(1);
    graphic.position.set(x, y);
    // Deterministic: the battle is replayable, the smoke may as well be.
    const drift = ((Math.trunc(x + y + tick) % 7) - 3) * 0.15;
    this.puffs.push({ tick, graphic, x, y, drift, radius });
  }

  private makePuff(): Graphics {
    const graphic = new Graphics();
    graphic.eventMode = "none";
    this.smoke.addChild(graphic);
    return graphic;
  }

  private drawSmoke(tick: number): void {
    let keepStreams = 0;
    for (const stream of this.streams) {
      if (tick >= stream.until) continue;
      this.streams[keepStreams] = stream;
      keepStreams += 1;
      while (stream.next <= tick) {
        this.addPuff(stream.next, stream.at.x, stream.at.y, 5);
        stream.next += STREAM_EVERY;
      }
    }
    this.streams.length = keepStreams;

    let keep = 0;
    for (const puff of this.puffs) {
      const age = tick - puff.tick;
      if (age > SMOKE_TICKS) {
        puff.graphic.visible = false;
        this.puffPool.push(puff.graphic);
        continue;
      }
      this.puffs[keep] = puff;
      keep += 1;
      const life = age / SMOKE_TICKS;
      puff.graphic.alpha = 0.7 * (1 - life);
      if (this.reducedMotion) continue;
      puff.graphic.scale.set(1 + life * 0.8);
      puff.graphic.position.set(puff.x + puff.drift * age, puff.y - life * puff.radius * 3);
    }
    this.puffs.length = keep;
  }

  /* ── Damage numbers ─────────────────────────────────────────────────── */

  private acquireLabel(): Label {
    const pooled = this.labelPool.pop();
    if (pooled) return pooled;
    if (this.active.length >= LABEL_POOL) {
      // Past the cap the oldest number goes early rather than a new one being made.
      let oldest = 0;
      for (let index = 1; index < this.active.length; index += 1) {
        if ((this.active[index] as Label).bornTick < (this.active[oldest] as Label).bornTick) {
          oldest = index;
        }
      }
      const [label] = this.active.splice(oldest, 1) as [Label];
      this.forget(label);
      return label;
    }
    const text = new Text({
      text: "",
      style: {
        fontFamily: "Nunito, sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: LABEL_COLOUR,
        stroke: { color: LABEL_STROKE, width: 3 },
      },
    });
    text.anchor.set(0.5, 1);
    text.eventMode = "none";
    this.labels.addChild(text);
    return { text, creepId: -1, bornTick: 0, amount: 0, x: 0, y: 0 };
  }

  private forget(label: Label): void {
    if (this.labelByCreep.get(label.creepId) === label) this.labelByCreep.delete(label.creepId);
  }

  private drawLabels(tick: number): void {
    let keep = 0;
    for (const label of this.active) {
      const age = tick - label.bornTick;
      if (age > LABEL_TICKS) {
        label.text.visible = false;
        this.forget(label);
        this.labelPool.push(label);
        continue;
      }
      this.active[keep] = label;
      keep += 1;
      const anchor = this.host.creepAnchor(label.creepId);
      if (anchor) {
        label.x = anchor.ground.x;
        label.y = anchor.top - 6;
      }
      const pose = labelPose(age);
      const rise = this.reducedMotion ? 0 : pose.rise;
      label.text.position.set(Math.round(label.x), Math.round(label.y - rise));
      label.text.alpha = pose.alpha;
    }
    this.active.length = keep;
  }
}

const tickAge = (tick: number, born: number): number => tick - born;
