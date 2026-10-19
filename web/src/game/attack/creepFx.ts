import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { Point } from "@/game/yard/YardGrid";
import { directionColumn } from "./monsterSprites";

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
 *
 * ## Whose shot looks like what
 *
 * Flash drew every one of those shots with one clip, `FIREBALL_CLIP`: frame 1
 * for damage, frame 2 for a heal (`FIREBALLS.as:84-89`), frame 3 for Fomor's
 * (`Fomor.as:155`), and the Teratorn's magma with an orange glow on top
 * (`FIREBALL.as:64-68`). A ranked D.A.V.E. fired two `rocket` sprites instead
 * (`creeps/DAVE.as:16-23`, `SPRITES.as:83`), each from a point jittered ten px
 * about its body. The owner asked for D.A.V.E., Fomor, Zafreeti and Vorg to
 * look their own, the two healers alike but not the same, so each has a
 * {@link ProjectileStyle}; everyone else keeps the fireball. Drawing only:
 * every shot still flies {@link PROJECTILE_TICKS} and carries what it did.
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
/**
 * Ticks a style's landing is shown: a heal's plus a little longer, so it is
 * seen, and a rocket's pop and smoke. Drawing only; the shot has landed.
 */
export const HEAL_BURST_TICKS = 14;
export const ROCKET_BURST_TICKS = 8;
export const burstTicks = (style: ProjectileStyle): number =>
  HEALER_STYLES.has(style) ? HEAL_BURST_TICKS : style === "rocket" ? ROCKET_BURST_TICKS : BURST_TICKS;
/** World px the arc rises at its middle. */
const ARC_HEIGHT = 12;

/**
 * A ranked Teratorn's fireball jumping on to the next building (#352) flies
 * as Flash's did: the same `FIREBALL` carries on at its 6 px a loop
 * (`creeps/Teratorn.as:19`, `FIREBALL.as:127-137`, ticked every loop at
 * `GLOBAL.as:1291`), so a jump of 60 px is in the air for 10 ticks.
 */
export const JUMP_PX_PER_TICK = 6;
/** The fewest ticks a jump is in the air, so a short one is still seen. */
const JUMP_MIN_TICKS = 4;

/** Ticks a struck building is drawn flashed. */
export const FLASH_TICKS = 3;
/** Ticks before the same building may flash again, so a mob does not strobe it. */
export const FLASH_COOLDOWN_TICKS = 12;

/** Ticks a hurt creep's body is tinted red. */
export const HURT_TICKS = 6;

/**
 * Damage numbers, as `ATTACK.damage` (`ATTACK.as:773-800`) and
 * `ParticleDamageItem.as:24-45, :71-80` drew them: bold red over a dark
 * outline, rising 25 px over half a second with a cubic ease-in-out, then
 * gone; healing green with a plus. At most three per target within 400 ms —
 * the second shifted right ten px a digit, the third left — and twenty alive
 * at once (`ParticleText.as:14-31`).
 */
/** Ticks a number lives: 0.5 s at 1x. */
export const LABEL_TICKS = 40;
/** World px a number rises over its life. */
export const LABEL_RISE = 25;
/** Ticks over which a number fades at the end, so it does not pop off. */
const LABEL_FADE_TICKS = 8;
/** Numbers alive at once; a new one past this is not shown. */
export const LABEL_MAX = 20;
/** Numbers one target may show within `LABEL_WINDOW_TICKS`. */
export const LABEL_PER_TARGET = 3;
/** The window those are counted in: 400 ms at 1x. */
export const LABEL_WINDOW_TICKS = 32;
/** World px the second and third number of a target shift, per digit. */
export const LABEL_DIGIT_SHIFT = 10;
/** World px above a building's footprint middle its numbers start. */
export const BUILDING_NUMBER_LIFT = 24;

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
const LABEL_COLOUR = 0xff0000;
const LABEL_HEAL_COLOUR = 0x39d353;
const LABEL_STROKE = 0x1a0a0a;

/** The champions that stomp: a long reach in the stats, no projectile in Flash. */
const STOMPING_CHAMPIONS: ReadonlySet<string> = new Set(["G1", "G2", "G4", "G5"]);

/**
 * How a shot is drawn. `fireball` is everyone's but these four: D.A.V.E.'s
 * rockets, Fomor's magenta bolt, and the two healers' green shots.
 */
export type ProjectileStyle = "fireball" | "rocket" | "fomor" | "zafreeti" | "vorg";

const STYLE_BY_MONSTER: Readonly<Record<string, ProjectileStyle>> = {
  C12: "rocket", // D.A.V.E.
  G3: "fomor",
  C15: "zafreeti",
  C16: "vorg",
};

/** The style a monster's ranged swing is drawn in. */
export const projectileStyle = (monsterId: string): ProjectileStyle =>
  STYLE_BY_MONSTER[monsterId] ?? "fireball";

/**
 * The healers' styles: Zafreeti and Vorg, the only monsters that heal
 * (`targetGroup` 5, `CreepBase.as:195-196`). They share a soft green glow and
 * a plus that sparkles where the heal lands; each has its own tint and trail.
 */
export const HEALER_STYLES: ReadonlySet<ProjectileStyle> = new Set(["zafreeti", "vorg"]);

/** Fomor's bolt, in its own magenta. */
const FOMOR_GLOW = 0xd23cff;
const FOMOR_BODY = 0xff5ad2;
const FOMOR_CORE = 0xffe2f7;
const FOMOR_TAIL = 0xa03ce6;

/** The healers: Zafreeti's sea-green, from the blue orb in its shell; Vorg's lime, from its body. */
const HEAL_TINTS: Readonly<Record<"zafreeti" | "vorg", { glow: number; body: number; core: number }>> = {
  zafreeti: { glow: 0x5cf0d2, body: 0x2fd9b4, core: 0xeafff9 },
  vorg: { glow: 0xc8f25a, body: 0x9ee03a, core: 0xfbffe6 },
};
const HEAL_PLUS = 0xffffff;

/** D.A.V.E.'s rockets: the trail of smoke, the flame, and the drawn body before the sheet is in. */
const ROCKET_SMOKE = 0xc8c8c8;
const ROCKET_FLAME = 0xffb428;
const ROCKET_BODY = 0xd0d0d0;
const ROCKET_NOSE = 0xe04848;
/** Columns of the `rocket` sheet: 11.25 degrees apiece, clockwise from east (`SPRITES.as:355-359`). */
export const ROCKET_DIRECTIONS = 32;
/** World px each of the pair sits off the line to the target, either side. */
export const ROCKET_SPREAD = 7;

/* ── Pure arithmetic ────────────────────────────────────────────────────── */

/**
 * How far along a lunge a body is, in px toward its target: a half sine that
 * peaks at `LUNGE_PX` halfway through and is 0 outside `[0, LUNGE_TICKS]`.
 */
export const lungeOffset = (age: number): number => {
  if (age < 0 || age >= LUNGE_TICKS) return 0;
  return Math.sin((age / LUNGE_TICKS) * Math.PI) * LUNGE_PX;
};

/** Ticks a fireball's jump from one building to the next is in the air. */
export const jumpTicks = (from: Point, to: Point): number =>
  Math.max(JUMP_MIN_TICKS, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / JUMP_PX_PER_TICK));

/**
 * Where a projectile is `age` ticks into a `flight`-tick flight: a line with a
 * small arc, or a straight line for an `arc` of 0 (a rocket).
 */
export const flightPoint = (
  from: Point,
  to: Point,
  age: number,
  flight = PROJECTILE_TICKS,
  arc = ARC_HEIGHT,
): Point => {
  const t = Math.max(0, Math.min(1, age / flight));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * arc,
  };
};

/**
 * Where the two rockets of a D.A.V.E. volley start and end: either side of the
 * line, `ROCKET_SPREAD` off it, one a little ahead of the other so a volley is
 * not a mirror image. Flash jittered each start at random by up to ten px
 * (`creeps/DAVE.as:18-22`); these are fixed, so a replay draws the same pair.
 */
export const rocketPair = (from: Point, to: Point): Array<{ from: Point; to: Point }> => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const across = { x: -dy / length, y: dx / length };
  const along = { x: dx / length, y: dy / length };
  return [1, -1].map((side) => ({
    from: {
      x: from.x + across.x * ROCKET_SPREAD * side + along.x * (side > 0 ? 3 : -3),
      y: from.y + across.y * ROCKET_SPREAD * side + along.y * (side > 0 ? 3 : -3),
    },
    // They close on the target and burst a few px apart, so both pops are seen.
    to: { x: to.x + across.x * 3 * side, y: to.y + across.y * 3 * side },
  }));
};

/** Cubic ease-in-out, as Flash's `Cubic.easeInOut` tween. */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * A number's rise and alpha at `age`: 25 px up with a cubic ease-in-out over
 * its life (`ParticleDamageItem.as:71-80`), fully opaque until the last few
 * ticks, when it fades rather than popping off.
 */
export const labelPose = (age: number): { rise: number; alpha: number } => {
  const t = Math.max(0, Math.min(1, age / LABEL_TICKS));
  const left = LABEL_TICKS - age;
  return {
    rise: easeInOutCubic(t) * LABEL_RISE,
    alpha: left >= LABEL_FADE_TICKS ? 1 : Math.max(0, left / LABEL_FADE_TICKS),
  };
};

/** Where a target's `index`-th number within the window sits sideways: 0, right, left. */
export const labelShift = (index: number, digits: number): number => {
  if (index === 1) return LABEL_DIGIT_SHIFT * digits;
  if (index === 2) return -LABEL_DIGIT_SHIFT * digits;
  return 0;
};

/** Whether a swing is drawn as a projectile: from range, and not a stomper. */
export const drawsProjectile = (monsterId: string, ranged: boolean): boolean =>
  ranged && !STOMPING_CHAMPIONS.has(monsterId);

/**
 * Where a big flyer's shot leaves its body: the mouth, low on the cell and
 * toward the target. The old start (ground point lifted by a fixed height)
 * ignored the cell, so a tall flyer such as Fomor fired from the top of its
 * head. `cell` is the drawn cell's top-left and size in world px; the mouth
 * sits `MOUTH_REACH` of the cell's width out along the way to the target
 * and `MOUTH_DROP` of its height down from the top, nudged by the aim.
 */
export const MOUTH_REACH = 0.3;
export const MOUTH_DROP = 0.62;
export const MOUTH_AIM = 0.12;

export const mouthPoint = (
  cell: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  target: Point,
): Point => {
  const cx = cell.x + cell.width / 2;
  const cy = cell.y + cell.height * MOUTH_DROP;
  const dx = target.x - cx;
  const dy = target.y - cy;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: cx, y: cy };
  return {
    x: cx + (dx / length) * cell.width * MOUTH_REACH,
    y: cy + (dy / length) * cell.height * MOUTH_AIM,
  };
};

/* ── The effects ────────────────────────────────────────────────────────── */

/** What the effects ask the layer for each frame. */
export interface CreepFxHost {
  /** A creep's ground point and the world y of the top of its body, or null once gone. */
  creepAnchor(id: number): { readonly ground: Point; readonly top: number } | null;
  /** Switches a building's hit flash on or off. */
  flashBuilding(id: number, on: boolean): void;
  /** The camera's zoom, so a number keeps its size on screen. */
  zoom(): number;
  /**
   * A projectile carrying `amount` of a building's health has landed (#77):
   * the host shows the building's loss from now, not from the swing.
   */
  landed?(buildingId: number, amount: number): void;
  /**
   * The `rocket` sheet's cell for a heading column, or null until the sheet
   * is in; a rocket is drawn by hand until then, and without a host for it.
   */
  rocketCell?(column: number): Texture | null;
}

/** What a number says: health lost in red, health gained in green with a plus. */
export type NumberKind = "damage" | "heal";

interface Projectile {
  readonly tick: number;
  readonly from: Point;
  readonly to: Point;
  /** The building to flash when it lands, or -1. */
  readonly buildingId: number;
  readonly big: boolean;
  /** Health the swing took off, shown over the building when it lands. */
  readonly amount: number;
  /** Ticks it is in the air. */
  readonly flight: number;
  readonly style: ProjectileStyle;
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
  /** The target it counts against: `creep:5`, `building:12`. */
  key: string;
  /** The creep it follows, or -1 for a number fixed where it was made. */
  follow: number;
  bornTick: number;
  amount: number;
  /** Sideways shift for the second and third number of a target. */
  shiftX: number;
  /** Where it was last anchored, for after the creep is gone. */
  x: number;
  y: number;
}

export class CreepFx {
  /** Everything here, in the overlay: projectiles, then smoke, then numbers. */
  readonly root = new Container();
  private readonly fire = new Graphics();
  /** D.A.V.E.'s rockets, from the `rocket` sheet, over their smoke in `fire`. */
  private readonly rockets = new Container();
  private readonly smoke = new Container();
  private readonly labels = new Container();

  private readonly projectiles: Projectile[] = [];
  private readonly rocketSprites: Sprite[] = [];
  private readonly puffs: Puff[] = [];
  private readonly puffPool: Graphics[] = [];
  private readonly streams: Stream[] = [];
  private readonly flashUntil = new Map<number, number>();
  private readonly flashStarted = new Map<number, number>();
  private readonly active: Label[] = [];
  private readonly labelPool: Label[] = [];
  /** Live numbers per target, oldest first, for the per-target cap and shifts. */
  private readonly labelsByKey = new Map<string, Label[]>();
  private tick = 0;
  private poofs = 0;

  constructor(
    private readonly host: CreepFxHost,
    private readonly reducedMotion = false,
  ) {
    for (const layer of [this.root, this.fire, this.rockets, this.smoke, this.labels]) {
      layer.eventMode = "none";
    }
    this.root.addChild(this.fire, this.rockets, this.smoke, this.labels);
  }

  /* ── Adding ─────────────────────────────────────────────────────────── */

  /**
   * A projectile from a monster's body to a target. On arrival it flashes
   * `buildingId` and shows `amount` over it, so the number lands with the shot.
   * `tick` may be ahead of now: a fireball's jump leaves when the one before
   * it lands, and nothing is drawn until then. A `rocket` is a pair, as
   * D.A.V.E. fired two (`creeps/DAVE.as:18-19`); the first carries the
   * number, so the building still shows one loss when they land together.
   */
  projectile(
    tick: number,
    from: Point,
    to: Point,
    buildingId: number,
    big: boolean,
    amount = 0,
    flight = PROJECTILE_TICKS,
    style: ProjectileStyle = "fireball",
  ): void {
    if (style !== "rocket") {
      this.projectiles.push({ tick, from, to, buildingId, big, amount, flight, style, landed: false });
      return;
    }
    rocketPair(from, to).forEach((pair, index) => {
      this.projectiles.push({
        tick,
        from: pair.from,
        to: pair.to,
        buildingId,
        big,
        amount: index === 0 ? amount : 0,
        flight,
        style,
        landed: false,
      });
    });
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

  /**
   * A number over a target: health a creep or building lost, or health a
   * creep gained. `key` names the target for the per-target cap; `follow` is
   * the creep the number rides on, or -1 to stay where it was made. A fourth
   * number for one target inside the window, or a twenty-first anywhere, is
   * not shown, as Flash dropped them.
   */
  number(tick: number, key: string, follow: number, amount: number, at: Point, kind: NumberKind): void {
    const shown = Math.max(1, Math.round(Math.abs(amount)));
    const siblings = (this.labelsByKey.get(key) ?? []).filter(
      (label) => tick - label.bornTick < LABEL_WINDOW_TICKS,
    );
    if (siblings.length >= LABEL_PER_TARGET) return;
    const label = this.acquireLabel();
    if (!label) return;
    label.key = key;
    label.follow = follow;
    label.bornTick = tick;
    label.amount = kind === "heal" ? shown : -shown;
    label.shiftX = labelShift(siblings.length, String(shown).length);
    label.x = at.x;
    label.y = at.y;
    label.text.text = kind === "heal" ? `+${shown}` : String(shown);
    label.text.style.fill = kind === "heal" ? LABEL_HEAL_COLOUR : LABEL_COLOUR;
    label.text.visible = true;
    label.text.alpha = 1;
    label.text.position.set(Math.round(at.x + label.shiftX), Math.round(at.y));
    this.active.push(label);
    this.labelsByKey.set(key, [...siblings, label]);
  }

  /* ── Frame ──────────────────────────────────────────────────────────── */

  update(tick: number): void {
    this.tick = tick;
    this.drawProjectiles(tick);
    this.expireFlashes(tick);
    this.drawSmoke(tick);
    this.drawLabels(tick);
  }

  /** Lets every projectile still in the air go without landing: the battle is over (#308). */
  dropProjectiles(): void {
    this.projectiles.length = 0;
    this.fire.clear();
    for (const sprite of this.rocketSprites) sprite.visible = false;
  }

  destroy(): void {
    this.root.parent?.removeChild(this.root);
    for (const id of this.flashUntil.keys()) this.host.flashBuilding(id, false);
    this.flashUntil.clear();
    this.flashStarted.clear();
    this.projectiles.length = 0;
    this.rocketSprites.length = 0;
    this.puffs.length = 0;
    this.puffPool.length = 0;
    this.streams.length = 0;
    this.active.length = 0;
    this.labelPool.length = 0;
    this.labelsByKey.clear();
    this.root.destroy({ children: true });
  }

  /* ── Counts, for tests and the dev hook ─────────────────────────────── */

  get projectileCount(): number {
    return this.projectiles.length;
  }

  /** The shots in the air, waiting to be thrown, or bursting, for tests. */
  get shots(): ReadonlyArray<
    Readonly<Pick<Projectile, "tick" | "from" | "to" | "buildingId" | "amount" | "flight" | "style">>
  > {
    return this.projectiles;
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

  /**
   * The numbers a target is showing, oldest first: negative for damage,
   * positive for healing, with where each is drawn.
   */
  labelsFor(key: string): Array<{ amount: number; x: number; y: number }> {
    return (this.labelsByKey.get(key) ?? [])
      .filter((label) => tickAge(this.tick, label.bornTick) <= LABEL_TICKS)
      .map((label) => ({ amount: label.amount, x: label.text.x, y: label.text.y }));
  }

  /* ── Projectiles ────────────────────────────────────────────────────── */

  private drawProjectiles(tick: number): void {
    const fire = this.fire;
    fire.clear();
    let rockets = 0;
    let keep = 0;
    for (const shot of this.projectiles) {
      const age = tick - shot.tick;
      // A frame that skips past the burst still lands the shot, so the damage it holds is let go.
      if (age >= shot.flight && !shot.landed) {
        shot.landed = true;
        this.flash(shot.buildingId, tick);
        if (shot.buildingId >= 0 && shot.amount > 0) {
          this.host.landed?.(shot.buildingId, shot.amount);
          const over = { x: shot.to.x, y: shot.to.y - BUILDING_NUMBER_LIFT };
          this.number(tick, `building:${shot.buildingId}`, -1, shot.amount, over, "damage");
        }
      }
      if (age > shot.flight + burstTicks(shot.style)) continue;
      this.projectiles[keep] = shot;
      keep += 1;
      // Not yet thrown: a jump waiting for the fireball before it to land.
      if (age < 0) continue;
      switch (shot.style) {
        case "rocket":
          if (this.drawRocket(shot, age, rockets)) rockets += 1;
          break;
        case "fomor":
          this.drawFomorBolt(shot, age);
          break;
        case "zafreeti":
        case "vorg":
          this.drawHeal(shot, age, shot.style);
          break;
        default:
          this.drawFireball(shot, age);
      }
    }
    this.projectiles.length = keep;
    for (let index = rockets; index < this.rocketSprites.length; index += 1) {
      this.rocketSprites[index]!.visible = false;
    }
  }

  /** Everyone else's: an orange ball with a hot core and three tail beads, a flare where it lands. */
  private drawFireball(shot: Projectile, age: number): void {
    const fire = this.fire;
    const radius = shot.big ? 6 : 4.5;
    if (age < shot.flight) {
      const at = flightPoint(shot.from, shot.to, age, shot.flight);
      if (!this.reducedMotion) {
        // Three tail beads along the path just flown, fading back.
        for (let back = 1; back <= 3; back += 1) {
          const trail = flightPoint(shot.from, shot.to, age - back * 1.5, shot.flight);
          fire
            .circle(trail.x, trail.y, radius * (1 - back * 0.22))
            .fill({ color: FIREBALL_TAIL, alpha: 0.5 - back * 0.13 });
        }
      }
      fire.circle(at.x, at.y, radius).fill({ color: FIREBALL_BODY, alpha: 0.95 });
      fire.circle(at.x, at.y, radius * 0.5).fill({ color: FIREBALL_CORE, alpha: 1 });
    } else {
      const burst = (age - shot.flight) / BURST_TICKS;
      fire
        .circle(shot.to.x, shot.to.y, radius + burst * radius * 2)
        .fill({ color: FIREBALL_BODY, alpha: 0.8 * (1 - burst) });
    }
  }

  /**
   * One of D.A.V.E.'s rockets: Flash's `rocket` cell turned to its heading,
   * flying straight (`FIREBALL.as:120-133` steers it, no arc), a flicker of
   * flame behind it and a trail of grey smoke that swells as it thins; it
   * pops in an orange flash and a puff of smoke. Returns whether it used the
   * `slot`-th rocket sprite.
   */
  private drawRocket(shot: Projectile, age: number, slot: number): boolean {
    const fire = this.fire;
    if (age >= shot.flight) {
      const burst = (age - shot.flight) / burstTicks("rocket");
      fire
        .circle(shot.to.x, shot.to.y, 3 + burst * 9)
        .fill({ color: ROCKET_SMOKE, alpha: 0.55 * (1 - burst) });
      fire
        .circle(shot.to.x, shot.to.y, 2 + burst * 5)
        .fill({ color: ROCKET_FLAME, alpha: 0.9 * (1 - burst) });
      return false;
    }
    const at = flightPoint(shot.from, shot.to, age, shot.flight, 0);
    const heading = Math.atan2(shot.to.y - shot.from.y, shot.to.x - shot.from.x);
    const back = { x: -Math.cos(heading), y: -Math.sin(heading) };
    if (!this.reducedMotion) {
      // Smoke left behind: older puffs further back, bigger and fainter.
      for (let puff = 1; puff <= 4; puff += 1) {
        const trail = flightPoint(shot.from, shot.to, age - puff * 1.6, shot.flight, 0);
        fire
          .circle(trail.x + back.x * 5, trail.y + back.y * 5, 1.6 + puff * 0.9)
          .fill({ color: ROCKET_SMOKE, alpha: 0.5 - puff * 0.1 });
      }
    }
    // The flame at the tail, flickering tick to tick.
    const flicker = this.reducedMotion ? 2 : age % 2 === 0 ? 2.4 : 1.6;
    fire
      .circle(at.x + back.x * 6, at.y + back.y * 6, flicker)
      .fill({ color: ROCKET_FLAME, alpha: 0.95 });

    // The nearest column, not Flash's truncated one, so a rocket points where it flies.
    const column = directionColumn(heading + Math.PI / ROCKET_DIRECTIONS, ROCKET_DIRECTIONS);
    const cell = this.host.rocketCell?.(column) ?? null;
    if (!cell) {
      // Drawn by hand while the sheet is not in: a grey body and a red nose.
      fire
        .moveTo(at.x + back.x * 5, at.y + back.y * 5)
        .lineTo(at.x - back.x * 3, at.y - back.y * 3)
        .stroke({ color: ROCKET_BODY, width: 2.5 });
      fire.circle(at.x - back.x * 3, at.y - back.y * 3, 1.8).fill({ color: ROCKET_NOSE });
      return false;
    }
    const sprite = this.rocketSprite(slot);
    sprite.texture = cell;
    sprite.visible = true;
    sprite.position.set(Math.round(at.x), Math.round(at.y));
    return true;
  }

  private rocketSprite(slot: number): Sprite {
    const pooled = this.rocketSprites[slot];
    if (pooled) return pooled;
    const sprite = new Sprite();
    sprite.anchor.set(0.5);
    sprite.eventMode = "none";
    this.rockets.addChild(sprite);
    this.rocketSprites.push(sprite);
    return sprite;
  }

  /**
   * Fomor's bolt (Flash gave it a frame of its own, `Fomor.as:155`): a magenta
   * orb in a violet haze with a pale core, trailing sparks that weave either
   * side of its path, and a ring that opens where it lands.
   */
  private drawFomorBolt(shot: Projectile, age: number): void {
    const fire = this.fire;
    const radius = shot.big ? 5.5 : 4.5;
    if (age >= shot.flight) {
      const burst = (age - shot.flight) / burstTicks("fomor");
      fire
        .circle(shot.to.x, shot.to.y, radius * (1 + burst * 2.4))
        .stroke({ color: FOMOR_BODY, width: 2.5 * (1 - burst) + 0.5, alpha: 0.9 * (1 - burst) });
      fire
        .circle(shot.to.x, shot.to.y, radius * (1 - burst))
        .fill({ color: FOMOR_CORE, alpha: 1 - burst });
      return;
    }
    const at = flightPoint(shot.from, shot.to, age, shot.flight);
    if (!this.reducedMotion) {
      const dx = shot.to.x - shot.from.x;
      const dy = shot.to.y - shot.from.y;
      const length = Math.hypot(dx, dy) || 1;
      const across = { x: -dy / length, y: dx / length };
      for (let back = 1; back <= 4; back += 1) {
        const trail = flightPoint(shot.from, shot.to, age - back * 1.2, shot.flight);
        // Sparks weave side to side behind the bolt.
        const weave = Math.sin((age - back * 1.2) * 1.4) * 3.5;
        fire
          .circle(trail.x + across.x * weave, trail.y + across.y * weave, radius * (0.62 - back * 0.1))
          .fill({ color: FOMOR_TAIL, alpha: 0.75 - back * 0.15 });
      }
    }
    fire.circle(at.x, at.y, radius * 1.8).fill({ color: FOMOR_GLOW, alpha: 0.3 });
    fire.circle(at.x, at.y, radius).fill({ color: FOMOR_BODY, alpha: 0.95 });
    fire.circle(at.x, at.y, radius * 0.45).fill({ color: FOMOR_CORE, alpha: 1 });
  }

  /**
   * A healer's shot. The family look: a soft glow round a bright core, and a
   * white plus over a ring of the healer's tint where it lands, rising a
   * little as it fades. Zafreeti's is a big sea-green orb with two motes
   * circling it and a mist behind; Vorg's a small lime spark that leaves
   * twinkles along its path.
   */
  private drawHeal(shot: Projectile, age: number, style: "zafreeti" | "vorg"): void {
    const fire = this.fire;
    const tint = HEAL_TINTS[style];
    const zafreeti = style === "zafreeti";
    const radius = zafreeti ? 5.5 : 3.5;
    if (age >= shot.flight) {
      const burst = (age - shot.flight) / burstTicks(style);
      const fade = 1 - burst;
      fire
        .circle(shot.to.x, shot.to.y, radius * (1.2 + burst * 2))
        .stroke({ color: tint.body, width: 2, alpha: 0.85 * fade });
      fire
        .circle(shot.to.x, shot.to.y, radius * 2.2 * fade)
        .fill({ color: tint.glow, alpha: 0.35 * fade });
      const rise = this.reducedMotion ? 0 : burst * 8;
      const arm = (zafreeti ? 5.5 : 4) * (burst < 0.3 ? 0.6 + burst * 1.4 : 1);
      this.drawPlus(shot.to.x, shot.to.y - radius - rise, arm, tint.body, fade);
      return;
    }
    const at = flightPoint(shot.from, shot.to, age, shot.flight);
    if (!this.reducedMotion) {
      if (zafreeti) {
        // A mist of fading beads behind, wider than the fireball's.
        for (let back = 1; back <= 3; back += 1) {
          const trail = flightPoint(shot.from, shot.to, age - back * 1.8, shot.flight);
          fire
            .circle(trail.x, trail.y, radius * (1.1 - back * 0.2))
            .fill({ color: tint.glow, alpha: 0.32 - back * 0.08 });
        }
      } else {
        // Twinkles left behind on alternate sides of the path.
        for (let back = 1; back <= 4; back += 1) {
          const trail = flightPoint(shot.from, shot.to, age - back * 1.4, shot.flight);
          const side = (back % 2 === 0 ? 1 : -1) * 2.5;
          this.drawTwinkle(trail.x + side, trail.y - side * 0.5, 2.6 - back * 0.4, tint.glow, 0.9 - back * 0.18);
        }
      }
    }
    fire.circle(at.x, at.y, radius * 2).fill({ color: tint.glow, alpha: 0.28 });
    fire.circle(at.x, at.y, radius).fill({ color: tint.body, alpha: 0.95 });
    fire.circle(at.x, at.y, radius * 0.5).fill({ color: tint.core, alpha: 1 });
    if (zafreeti && !this.reducedMotion) {
      // Two motes circling the orb, like a genie's smoke.
      for (const offset of [0, Math.PI]) {
        const angle = age * 0.9 + offset;
        fire
          .circle(at.x + Math.cos(angle) * radius * 1.7, at.y + Math.sin(angle) * radius * 0.9, 1.6)
          .fill({ color: tint.core, alpha: 0.95 });
      }
    }
  }

  /** The plus a heal leaves where it lands: white over the healer's tint. */
  private drawPlus(x: number, y: number, arm: number, colour: number, alpha: number): void {
    const fire = this.fire;
    const thick = Math.max(1.5, arm * 0.45);
    fire.rect(x - arm - 1, y - thick / 2 - 1, (arm + 1) * 2, thick + 2).fill({ color: colour, alpha });
    fire.rect(x - thick / 2 - 1, y - arm - 1, thick + 2, (arm + 1) * 2).fill({ color: colour, alpha });
    fire.rect(x - arm, y - thick / 2, arm * 2, thick).fill({ color: HEAL_PLUS, alpha });
    fire.rect(x - thick / 2, y - arm, thick, arm * 2).fill({ color: HEAL_PLUS, alpha });
  }

  /** A four-point star: Vorg's twinkles. */
  private drawTwinkle(x: number, y: number, size: number, colour: number, alpha: number): void {
    if (size <= 0 || alpha <= 0) return;
    const pinch = size * 0.3;
    this.fire
      .poly([
        x, y - size,
        x + pinch, y - pinch,
        x + size, y,
        x + pinch, y + pinch,
        x, y + size,
        x - pinch, y + pinch,
        x - size, y,
        x - pinch, y - pinch,
      ])
      .fill({ color: colour, alpha });
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

  private acquireLabel(): Label | null {
    if (this.active.length >= LABEL_MAX) return null;
    const pooled = this.labelPool.pop();
    if (pooled) return pooled;
    const text = new Text({
      text: "",
      style: {
        // Titan One (#223) has one weight, already bold; no fontWeight here,
        // or the browser fakes a bolder cut by thickening strokes on a face
        // that cannot get any heavier.
        fontFamily: "Titan One, sans-serif",
        fontSize: 13,
        fill: LABEL_COLOUR,
        stroke: { color: LABEL_STROKE, width: 3 },
      },
    });
    text.anchor.set(0.5, 1);
    text.eventMode = "none";
    this.labels.addChild(text);
    return { text, key: "", follow: -1, bornTick: 0, amount: 0, shiftX: 0, x: 0, y: 0 };
  }

  private forget(label: Label): void {
    const list = this.labelsByKey.get(label.key);
    if (!list) return;
    const rest = list.filter((other) => other !== label);
    if (rest.length === 0) this.labelsByKey.delete(label.key);
    else this.labelsByKey.set(label.key, rest);
  }

  private drawLabels(tick: number): void {
    const zoom = this.host.zoom();
    const scale = zoom > 0 ? 1 / zoom : 1;
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
      const anchor = label.follow >= 0 ? this.host.creepAnchor(label.follow) : null;
      if (anchor) {
        label.x = anchor.ground.x;
        label.y = anchor.top - 6;
      }
      const pose = labelPose(age);
      const rise = this.reducedMotion ? 0 : pose.rise;
      label.text.scale.set(scale);
      label.text.position.set(
        Math.round(label.x + label.shiftX * scale),
        Math.round(label.y - rise),
      );
      label.text.alpha = pose.alpha;
    }
    this.active.length = keep;
  }
}

const tickAge = (tick: number, born: number): number => tick - born;
