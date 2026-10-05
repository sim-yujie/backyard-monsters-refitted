import type { Graphics } from "pixi.js";
import {
  isTower,
  LASER_DROP,
  LASER_HEIGHT,
  laserEnd,
  laserSweep,
  TESLA_CHARGE_END,
  TESLA_LOOP_END,
  TESLA_TICKS_PER_FRAME,
  TESLA_WIND_END,
  towerStats,
  type BeamLine,
  type CreepSnapshot,
  type LaserSweep,
} from "@/game/combat/rules";
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import type { Point } from "@/game/yard/YardGrid";
import type { Yard } from "@/game/yard/yardModel";
import { flyerAltitude } from "./monsterSprites";

/**
 * What a defence tower does on screen while it fights (issue #67): which way
 * its gun points, and what leaves the muzzle.
 *
 * The engine says only *that* a tower shot a creep (`BattleVisualEvent`
 * `shot`); everything here is the picture the Flash client drew for it, and
 * none of it feeds back into the battle.
 *
 * ## Facing
 *
 * A tower's animation strip is not a loop but a set of headings, one cell per
 * so many degrees. While a tower has a target, `BTOWER.Rotate` sets the cell
 * from the cartesian bearing to the first target, measured from the tower's
 * origin plus (35, 35) (`client/scripts/BTOWER.as:441-480`). The degrees per
 * cell differ per class — 11.25 for the Sniper Tower (`BUILDING21.as:22-32`),
 * 12 for the Aerial Defense Tower (`BUILDING115.as:98-110`) and the Railgun,
 * which also adds 30 (`BUILDING118.as:55-72`). The Laser Tower follows its
 * beam's screen angle at 6.66 a cell (`BUILDING23.as:64-77`, `LASER.as`
 * `Track`), and the Tesla Tower plays a charge, a firing loop and a wind-down
 * (`BUILDING25.as:84-200`), starting on the engine's `charge` event and
 * looping while its zaps come (issue #266), with a glow on the coil as it
 * charges. The Cannon Tower has no animated layer.
 *
 * ## Projectiles
 *
 * Every shot leaves from `(x, y + _top)` of the building's origin, `_top`
 * being the per-class muzzle height ({@link TOWER_MUZZLE}). The Sniper, Cannon
 * and Aerial towers spawn a `PROJECTILE` that flies at half its stat `speed`
 * per tick and re-aims at its target every five ticks (`PROJECTILE.as:33-46`);
 * the Laser sweeps a beam across its target for a hundred ticks (`LASER.as`),
 * along the engine's own sweep, so its end is where the pulses land (issue #267);
 * the Tesla forks a bolt (`EFFECTS.Lightning`); the Railgun lays a glowing
 * trail of gun-balls along its line of fire (`BUILDING118.as:145-185`), all
 * 1,600 px of the beam the engine hurt along (issue #261).
 *
 * A `PROJECTILE` dealt its damage when it arrived, not when it was fired
 * (`PROJECTILE.as:31-50`), so each bullet reports its landing tick to the
 * host (`landed`), which holds the wound back until then (#77). The beam, the
 * bolt and the rail hurt at once in Flash and report nothing.
 *
 * Every clock here is the battle tick, so 2x speed doubles it all.
 */

/* ── Pure facing arithmetic ─────────────────────────────────────────────── */

/**
 * World px each class's muzzle sits above its origin: `_top` in the Flash
 * class. `BUILDING20.as:17`, `BUILDING21.as:15`, `BUILDING23.as:40`,
 * `BUILDING25.as:31`, `BUILDING115.as:31`, `BUILDING118.as:39`.
 */
export const TOWER_MUZZLE: Readonly<Record<number, number>> = {
  20: -4,
  21: -30,
  23: -30,
  25: -30,
  115: -5,
  118: 15,
};
const DEFAULT_MUZZLE = -30;

/** Where a tower's shots leave from, in world px. */
export const muzzleOf = (type: number, worldX: number, worldY: number): Point => ({
  x: worldX,
  y: worldY + (TOWER_MUZZLE[type] ?? DEFAULT_MUZZLE),
});

/** Half the 70-unit footprint `Rotate` adds to the origin (`BTOWER.as:456`). */
const TOWER_CENTRE = 35;
const DEGREES = 180 / Math.PI;

/** Degrees folded into `[0, 360)`. */
export const wrapDegrees = (degrees: number): number => {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

/**
 * The bearing from a tower to a point, both in yard units, in degrees from
 * the +x axis turning towards +y — what `atan2` gives in Flash's cartesian
 * space (`BTOWER.as:457-462`).
 */
export const bearingDegrees = (tower: Point, target: Point): number =>
  wrapDegrees(
    Math.atan2(target.y - (tower.y + TOWER_CENTRE), target.x - (tower.x + TOWER_CENTRE)) *
      DEGREES,
  );

interface FacingRule {
  readonly degreesPerCell: number;
  readonly offsetDegrees: number;
}

/** The classes whose cell is a bearing, with their divisor and offset. */
const FACING: Readonly<Record<number, FacingRule>> = {
  21: { degreesPerCell: 11.25, offsetDegrees: 0 },
  115: { degreesPerCell: 12, offsetDegrees: 0 },
  118: { degreesPerCell: 12, offsetDegrees: 30 },
};

/** Whether a type turns its gun toward its target. */
export const facesTarget = (type: number): boolean => FACING[type] !== undefined;

/**
 * The strip cell for a bearing, or null for a type that does not turn.
 *
 * The Sniper's 11.25° divisor names 32 cells but its strip holds 30; the
 * Flash client blitted an empty rectangle for the last two and the gun
 * vanished for a bearing near due east. Clamping to the last cell is the
 * nearest facing there is.
 */
export const facingCell = (type: number, bearing: number, frames: number): number | null => {
  const rule = FACING[type];
  if (!rule || frames <= 0) return null;
  const cell = Math.trunc(wrapDegrees(bearing + rule.offsetDegrees) / rule.degreesPerCell);
  return Math.min(cell, frames - 1);
};

/** The laser strip's degrees per cell (`BUILDING23.as:64-77`). */
export const LASER_DEGREES_PER_CELL = 6.66;
/** `LASER.Tick` hands `Track` the beam angle less 25 (`LASER.as`). */
export const LASER_TRACK_OFFSET = -25;

/** The Laser Tower's cell for its beam's screen angle in degrees. */
export const laserCell = (beamDegrees: number, frames: number): number => {
  if (frames <= 0) return 0;
  const cell = Math.trunc(wrapDegrees(beamDegrees + LASER_TRACK_OFFSET) / LASER_DEGREES_PER_CELL);
  return Math.min(cell, frames - 1);
};

/* ── The Tesla timeline ─────────────────────────────────────────────────── */

/**
 * `BUILDING25.as:107-200`: cells 0-31 charge, 32-40 loop, 41-54 wind down,
 * the engine's own timeline (issue #266).
 */
export { TESLA_CHARGE_END, TESLA_LOOP_END, TESLA_WIND_END };

export type TeslaPhase = "idle" | "charge" | "loop" | "wind";

export interface TeslaState {
  readonly phase: TeslaPhase;
  readonly cell: number;
  /** Frames into the wind-down, which advances a cell every second frame. */
  readonly windTicks: number;
}

export const TESLA_IDLE: TeslaState = { phase: "idle", cell: 0, windTicks: 0 };

/**
 * One frame of the Tesla Tower's strip, a frame being
 * {@link TESLA_TICKS_PER_FRAME} ticks as in the engine. `firing` is, when
 * idle, whether a charge began, and after that whether it is still zapping;
 * the Flash class charged on its first `Fire`, looped while zaps remained and
 * wound down once they did not.
 */
export const teslaTick = (state: TeslaState, firing: boolean): TeslaState => {
  switch (state.phase) {
    case "idle":
      return firing ? { phase: "charge", cell: 1, windTicks: 0 } : state;
    case "charge": {
      const cell = state.cell + 1;
      return cell >= TESLA_CHARGE_END
        ? { phase: "loop", cell: TESLA_CHARGE_END, windTicks: 0 }
        : { phase: "charge", cell, windTicks: 0 };
    }
    case "loop": {
      if (!firing) return { phase: "wind", cell: state.cell, windTicks: 0 };
      const cell = state.cell + 1;
      return { phase: "loop", cell: cell >= TESLA_LOOP_END ? TESLA_CHARGE_END : cell, windTicks: 0 };
    }
    case "wind": {
      const windTicks = state.windTicks + 1;
      if (windTicks % 2 !== 0) return { ...state, windTicks };
      const cell = state.cell + 1;
      return cell >= TESLA_WIND_END ? TESLA_IDLE : { phase: "wind", cell, windTicks };
    }
  }
};

/* ── Towers of a yard ───────────────────────────────────────────────────── */

export interface TowerInfo {
  readonly id: number;
  readonly type: number;
  readonly level: number;
  /** Yard units, the space the bearing is measured in. */
  readonly x: number;
  readonly y: number;
  /** World px of the origin, where the muzzle offset is added. */
  readonly worldX: number;
  readonly worldY: number;
  /** Cells in the first animation strip; 0 for a tower with no gun layer. */
  readonly frames: number;
}

/** Every tower in a yard, with what its facing and shots need. */
export const towersOf = (yard: Yard): TowerInfo[] =>
  yard.buildings
    .filter((building) => isTower(building.type))
    .map((building) => ({
      id: building.id,
      type: building.type,
      level: building.level,
      x: building.x,
      y: building.y,
      worldX: building.worldX,
      worldY: building.worldY,
      frames: resolveArt(building.type, building.level, ArtState.DEFAULT)?.anims[0]?.frames ?? 0,
    }));

/* ── The effects ────────────────────────────────────────────────────────── */

/** Ticks a turret keeps tracking after its last shot before holding still. */
export const FACING_HOLD_TICKS = 30;
/**
 * Ticks the Tesla keeps its loop going after its last zap: a zap comes every
 * 4 frames (8 ticks), so a gap past this means the charge is spent.
 */
const TESLA_HOLD_TICKS = 12;
/** Ticks from a charge's start to its first possible zap: the 32 frames of charge. */
const TESLA_CHARGE_TICKS = TESLA_CHARGE_END * TESLA_TICKS_PER_FRAME;
/** World px the coil sits above the origin, where the bolts leave (`BUILDING25.as:140-150`). */
const COIL_HEIGHT = 50;
/** `PROJECTILE.Move`: half the stat speed per tick, re-aimed every fifth. */
const BULLET_SPEED_FACTOR = 0.5;
const BULLET_AIM_TICKS = 5;
/** Ticks an impact mark lingers. */
const IMPACT_TICKS = 8;
/** Ticks a muzzle flash shows. */
const FLASH_TICKS = 2;
/** `LASER.Tick`: power ramps over ten ticks, holds to 80, gone at 100. */
const BEAM_TICKS = 100;
const BEAM_FADE_AT = 80;
/** `EFFECTS.Lightning` fades by 1.75 a tick and is gone after three. */
const BOLT_TICKS = 3;
/**
 * `BUILDING118.TickFast` counts the railgun's trail in stage frames, a frame
 * every second tick: solid for ten, then a fifth fainter each frame, gone at
 * the fifteenth (`BUILDING118.as:74-112`).
 */
const RAIL_SOLID_FRAMES = 10;
const RAIL_GONE_FRAME = 15;
/** The length of each gun-ball segment. */
const RAIL_SEGMENT = 32;
/** World px a walking creep's body middle sits above its ground point: where shots land and leave. */
export const BODY_HEIGHT = 10;

const BOLT_COLOUR = 0x30c8fa; // `EFFECTS.Lightning` default 3197178
const BEAM_GLOW = 0xfca133; // `LASER.Tick` 16555315
const BEAM_CORE = 0xf4eddd; // 16051677
const RAIL_GLOW = 0x0088bb; // `BUILDING118.Fire` GlowFilter 35003
// `RAILGUNPROJECTILE_CLIP` (shape 1563): a 10 px ball, blue at the rim, near white inside.
const GUN_BALL_RIM = 0x1892fc;
const GUN_BALL_CORE = 0xd4ebff;
// `PROJECTILE_CLIP` (shape 1836): a 9 px dark ball lit from the top left.
const CANNON_BALL = 0x1e1e1e;
const CANNON_BALL_LIT = 0x464646;
const SNIPER_ROUND = 0xffd75e;
const SNIPER_CORE = 0xfffbe8;
const FLAK_ROUND = 0xdfe8ff;

/**
 * How solid the railgun's trail is `age` ticks after the shot, as
 * `BUILDING118.TickFast` steps it a frame at a time: 1 for ten frames, then
 * 0.8, 0.6, 0.4, 0.2, and null once it is gone. It counts the render clock
 * only, never the battle.
 */
export const railFade = (age: number): number | null => {
  const frame = Math.floor(Math.max(0, age) / TESLA_TICKS_PER_FRAME);
  if (frame >= RAIL_GONE_FRAME) return null;
  return frame <= RAIL_SOLID_FRAMES ? 1 : 1 - (frame - RAIL_SOLID_FRAMES) * 0.2;
};

interface Bullet {
  /** What `onShot` returned for it, and what `landed` reports. */
  readonly key: number;
  readonly type: number;
  readonly creepId: number;
  /** The shot tick: the bullet leaves the muzzle then and flies from the next. */
  readonly bornTick: number;
  x: number;
  y: number;
  /** World px per tick. */
  readonly speed: number;
  readonly splash: number;
  /** The last point aimed at, kept once the creep is gone. */
  aim: Point;
  stepX: number;
  stepY: number;
  ticks: number;
  landedTick: number | null;
}

interface Beam {
  readonly towerId: number;
  readonly bornTick: number;
  /** The engine's sweep (issue #267), in world px: its end is where the pulses land. */
  readonly sweep: LaserSweep;
}

interface Bolt {
  readonly from: Point;
  readonly to: Point;
  readonly tick: number;
}

interface Rail {
  readonly from: Point;
  readonly dirX: number;
  readonly dirY: number;
  readonly length: number;
  readonly tick: number;
}

interface Flash {
  readonly at: Point;
  readonly tick: number;
}

interface TowerState {
  readonly info: TowerInfo;
  lastShotTick: number;
  targetCreep: number;
  cell: number | null;
  tesla: TeslaState;
  /** The tick the Tesla's latest charge began; a charge not yet shown starts the strip. */
  chargeTick: number;
  chargePending: boolean;
}

/** What the effects ask of the yard renderer. */
export interface TowerFxHost {
  setAnimFrame(id: number, layer: number, frame: number): void;
  /**
   * A bullet reached its target on `tick` (#77): the moment Flash's
   * `PROJECTILE.Move` dealt its damage, so the moment the wound is shown.
   */
  landed?(key: number, tick: number): void;
}

export interface ShotLike {
  readonly tick: number;
  readonly towerId: number;
  readonly creepId: number;
  readonly ix: number;
  readonly iy: number;
  /** The Railgun's beam (issue #261), yard units at both ends. */
  readonly beam?: BeamLine;
  /** The Laser's sweep (issue #267): its origin and its target's point, yard units. */
  readonly sweep?: BeamLine;
}

/** Repeatable jitter from a tick and an index, in `[0, 1)`. */
const jitter = (tick: number, index: number): number => {
  const mixed = Math.imul((tick + 1) * 0x9e3779b1, index * 2 + 0x85ebca6b) >>> 0;
  return (mixed % 10_007) / 10_007;
};

export class TowerFx {
  private readonly towers = new Map<number, TowerState>();
  private readonly bullets: Bullet[] = [];
  private readonly beams: Beam[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly rails: Rail[] = [];
  private readonly flashes: Flash[] = [];
  private lastTick = 0;
  private nextKey = 1;

  /**
   * `graphics` is redrawn every frame; `origin` turns isometric yard px into
   * world px, the yard's `bounds.originX/Y`.
   */
  constructor(
    private readonly graphics: Graphics,
    towers: readonly TowerInfo[],
    private readonly host: TowerFxHost,
    private readonly origin: Point,
  ) {
    for (const info of towers) {
      this.towers.set(info.id, {
        info,
        lastShotTick: Number.NEGATIVE_INFINITY,
        targetCreep: -1,
        cell: null,
        tesla: TESLA_IDLE,
        chargeTick: Number.NEGATIVE_INFINITY,
        chargePending: false,
      });
    }
  }

  /** A Tesla Tower began to charge on `tick` (issue #266): its strip starts. */
  onCharge(towerId: number, tick: number): void {
    const tower = this.towers.get(towerId);
    if (!tower) return;
    tower.chargeTick = tick;
    tower.chargePending = true;
  }

  /** A tower's splash radius in cartesian units: 0 for none, or a tower this does not know. */
  splashOf(id: number): number {
    const info = this.towers.get(id)?.info;
    return info ? (towerStats(info.type, info.level)?.splash ?? 0) : 0;
  }

  /** The cell a tower's gun was last set to, or null while it has never turned. */
  cellOf(id: number): number | null {
    return this.towers.get(id)?.cell ?? null;
  }

  /**
   * Records a shot and starts its projectile. `target` is the creep hit.
   *
   * Returns the bullet's key when the shot is a travelling bullet, which the
   * host hears again through `landed` when it arrives; null for a shot that
   * reaches its target at once — the laser, the tesla, the railgun — or from
   * a tower this does not know.
   */
  onShot(event: ShotLike, target: CreepSnapshot | undefined): number | null {
    const tower = this.towers.get(event.towerId);
    if (!tower) return null;
    tower.lastShotTick = event.tick;
    tower.targetCreep = event.creepId;

    const from = muzzleOf(tower.info.type, tower.info.worldX, tower.info.worldY);
    const aim = this.aimAt(target, event.ix, event.iy);
    const type = tower.info.type;

    if (type === 23) {
      // The beam the engine pulses along (issue #267), from below the tower to
      // the target's point; a shot without one aims at the creep's feet.
      const sweep = event.sweep;
      const start = sweep
        ? this.groundAt(sweep.fromIx, sweep.fromIy)
        : { x: tower.info.worldX, y: tower.info.worldY + LASER_DROP };
      const end = sweep ? this.groundAt(sweep.toIx, sweep.toIy) : { x: aim.x, y: aim.y + BODY_HEIGHT };
      this.beams.push({
        towerId: tower.info.id,
        bornTick: event.tick,
        sweep: laserSweep(Math.trunc(start.x), Math.trunc(start.y), Math.trunc(end.x), Math.trunc(end.y)),
      });
      return null;
    }
    if (type === 25) {
      // `BUILDING25.as:150`: the bolt leaves from 50 px above the origin.
      this.bolts.push({
        from: { x: tower.info.worldX, y: tower.info.worldY - COIL_HEIGHT },
        to: aim,
        tick: event.tick,
      });
      return null;
    }
    if (type === 118) {
      // The beam the engine hurt along (issue #261), on the ground as it was
      // measured; a shot without one runs just past its target.
      const beam = event.beam;
      const start = beam ? this.groundAt(beam.fromIx, beam.fromIy) : from;
      const end = beam ? this.groundAt(beam.toIx, beam.toIy) : aim;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.hypot(dx, dy) || 1;
      this.rails.push({
        from: start,
        dirX: dx / distance,
        dirY: dy / distance,
        length: beam ? distance : distance + RAIL_SEGMENT * 2,
        tick: event.tick,
      });
      this.flashes.push({ at: from, tick: event.tick });
      return null;
    }

    const stats = towerStats(type, tower.info.level);
    const speed = (stats?.speed ?? 10) * BULLET_SPEED_FACTOR;
    const key = this.nextKey;
    this.nextKey += 1;
    this.bullets.push({
      key,
      type,
      creepId: event.creepId,
      bornTick: event.tick,
      x: from.x,
      y: from.y,
      speed: Math.max(speed, 1),
      splash: stats?.splash ?? 0,
      aim,
      stepX: 0,
      stepY: 0,
      ticks: 0,
      landedTick: null,
    });
    this.flashes.push({ at: from, tick: event.tick });
    return key;
  }

  /** Bullets still in the air. */
  get flyingCount(): number {
    return this.bullets.filter((bullet) => bullet.landedTick === null).length;
  }

  /**
   * Turns every gun and redraws every projectile for `tick`. `creepAt` is
   * the creep by id right now, or undefined once it is gone.
   */
  update(tick: number, creepAt: (id: number) => CreepSnapshot | undefined): void {
    const elapsed = Math.max(0, Math.min(tick - this.lastTick, 400));
    this.lastTick = tick;

    for (const tower of this.towers.values()) this.turn(tower, tick, elapsed, creepAt);

    const graphics = this.graphics;
    graphics.clear();
    this.drawFlashes(tick);
    this.drawBullets(tick, elapsed, creepAt);
    this.drawBeams(tick);
    this.drawCoils(tick);
    this.drawBolts(tick);
    this.drawRails(tick);
  }

  /**
   * Every gun at rest and nothing in the air: the battle is over (#308). A
   * Tesla goes back to its idle cell; the other guns keep the way they face.
   */
  standDown(): void {
    this.bullets.length = 0;
    this.beams.length = 0;
    this.bolts.length = 0;
    this.rails.length = 0;
    this.flashes.length = 0;
    for (const tower of this.towers.values()) {
      tower.targetCreep = -1;
      tower.chargePending = false;
      tower.chargeTick = Number.NEGATIVE_INFINITY;
      tower.tesla = TESLA_IDLE;
      if (tower.info.type === 25 && tower.info.frames > 0) this.setCell(tower, TESLA_IDLE.cell);
    }
    this.graphics.clear();
  }

  destroy(): void {
    this.towers.clear();
    this.bullets.length = 0;
    this.beams.length = 0;
    this.bolts.length = 0;
    this.rails.length = 0;
    this.flashes.length = 0;
  }

  /* ── Facing ─────────────────────────────────────────────────────────── */

  private turn(
    tower: TowerState,
    tick: number,
    elapsed: number,
    creepAt: (id: number) => CreepSnapshot | undefined,
  ): void {
    const { info } = tower;
    if (info.type === 25) {
      this.stepCoil(tower, tick, elapsed);
      if (info.frames > 0) this.setCell(tower, tower.tesla.cell);
      return;
    }
    if (info.frames <= 0) return;
    const recent = tick - tower.lastShotTick <= FACING_HOLD_TICKS;

    if (info.type === 23) {
      let beam: Beam | undefined;
      for (const candidate of this.beams) if (candidate.towerId === info.id) beam = candidate;
      const end = beam ? laserEnd(beam.sweep, Math.max(0, tick - beam.bornTick)) : null;
      if (!beam || !end) return;
      const degrees = Math.atan2(end.y - beam.sweep.ay, end.x - beam.sweep.ax) * DEGREES;
      this.setCell(tower, laserCell(degrees, info.frames));
      return;
    }

    if (!facesTarget(info.type) || !recent) return;
    const creep = creepAt(tower.targetCreep);
    if (!creep) return;
    const cell = facingCell(
      info.type,
      bearingDegrees({ x: info.x, y: info.y }, { x: creep.ix, y: creep.iy }),
      info.frames,
    );
    if (cell !== null) this.setCell(tower, cell);
  }

  /**
   * The Tesla's strip over the ticks since the last update, a step on every
   * tick the engine runs a frame on (every second one): it charges on the
   * engine's charge, loops while zaps keep coming, then winds down.
   */
  private stepCoil(tower: TowerState, tick: number, elapsed: number): void {
    let state = tower.tesla;
    for (let at = tick - elapsed + 1; at <= tick; at += 1) {
      if (at % TESLA_TICKS_PER_FRAME !== 0) continue;
      if (state.phase === "idle") {
        if (!tower.chargePending || at < tower.chargeTick) continue;
        tower.chargePending = false;
        state = teslaTick(state, true);
        continue;
      }
      const zapping =
        at - tower.lastShotTick <= TESLA_HOLD_TICKS ||
        at - tower.chargeTick <= TESLA_CHARGE_TICKS + TESLA_HOLD_TICKS;
      state = teslaTick(state, zapping);
    }
    tower.tesla = state;
  }

  private setCell(tower: TowerState, cell: number): void {
    if (tower.cell === cell) return;
    tower.cell = cell;
    this.host.setAnimFrame(tower.info.id, 0, cell);
  }

  /* ── Projectiles ────────────────────────────────────────────────────── */

  /** The world point of a yard position on the ground. */
  private groundAt(ix: number, iy: number): Point {
    return { x: ix - iy + this.origin.x, y: (ix + iy) / 2 + this.origin.y };
  }

  /** The world point a shot is aimed at: the creep's body, or its altitude. */
  private aimAt(creep: CreepSnapshot | undefined, ix: number, iy: number): Point {
    const x = (creep?.ix ?? ix) - (creep?.iy ?? iy) + this.origin.x;
    const y = ((creep?.ix ?? ix) + (creep?.iy ?? iy)) / 2 + this.origin.y;
    const lift = creep?.flying ? flyerAltitude(creep.monsterId) : BODY_HEIGHT;
    return { x, y: y - lift };
  }

  private drawFlashes(tick: number): void {
    let keep = 0;
    for (const flash of this.flashes) {
      const age = tick - flash.tick;
      if (age > FLASH_TICKS) continue;
      this.flashes[keep] = flash;
      keep += 1;
      this.graphics.circle(flash.at.x, flash.at.y, 5 - age).fill({ color: 0xffffff, alpha: 0.9 });
    }
    this.flashes.length = keep;
  }

  private drawBullets(
    tick: number,
    elapsed: number,
    creepAt: (id: number) => CreepSnapshot | undefined,
  ): void {
    let keep = 0;
    for (const bullet of this.bullets) {
      if (bullet.landedTick === null) {
        this.flyBullet(bullet, tick, elapsed, creepAt);
      }
      if (bullet.landedTick !== null) {
        const age = tick - bullet.landedTick;
        if (age > IMPACT_TICKS) continue;
        this.drawImpact(bullet, age);
      } else {
        this.drawRound(bullet);
      }
      this.bullets[keep] = bullet;
      keep += 1;
    }
    this.bullets.length = keep;
  }

  private flyBullet(
    bullet: Bullet,
    tick: number,
    elapsed: number,
    creepAt: (id: number) => CreepSnapshot | undefined,
  ): void {
    for (let step = 0; step < elapsed; step += 1) {
      // The tick this step moves the bullet into. A shot read in the middle
      // of a long frame (2x, a slow device) flies only from its own tick, so
      // it lands on the tick it would have at 1x.
      const stepTick = tick - elapsed + step + 1;
      if (stepTick <= bullet.bornTick) continue;
      if (bullet.ticks % BULLET_AIM_TICKS === 0) {
        const creep = creepAt(bullet.creepId);
        if (creep) bullet.aim = this.aimAt(creep, creep.ix, creep.iy);
        const dx = bullet.aim.x - bullet.x;
        const dy = bullet.aim.y - bullet.y;
        const heading = Math.atan2(dy, dx);
        bullet.stepX = Math.cos(heading) * bullet.speed;
        bullet.stepY = Math.sin(heading) * bullet.speed;
      }
      bullet.ticks += 1;
      bullet.x += bullet.stepX;
      bullet.y += bullet.stepY;
      const left = Math.hypot(bullet.aim.x - bullet.x, bullet.aim.y - bullet.y);
      // `PROJECTILE.Move` lands once within a full speed of the target. The
      // landing is stamped with the tick it happened on, not the frame's,
      // so a long frame does not restart the impact.
      if (left <= bullet.speed * 2) {
        bullet.x = bullet.aim.x;
        bullet.y = bullet.aim.y;
        bullet.landedTick = stepTick;
        this.host.landed?.(bullet.key, stepTick);
        return;
      }
    }
  }

  private drawRound(bullet: Bullet): void {
    const graphics = this.graphics;
    if (bullet.type === 20) {
      // Flash's cannon ball, a slow heavy round.
      graphics.circle(bullet.x, bullet.y, 4.5).fill({ color: CANNON_BALL });
      graphics.circle(bullet.x - 1, bullet.y - 1, 2.8).fill({ color: CANNON_BALL_LIT });
      graphics.circle(bullet.x - 1.6, bullet.y - 1.6, 1).fill({ color: 0x6e6e6e });
      return;
    }
    if (bullet.type === 21) {
      // Flash fires the Sniper's shot with the cannon's ball too, only two or
      // three times as fast (#312); here it is a bright tracer, so the two
      // towers' shots read apart at a glance.
      const reach = Math.min(4, 36 / Math.max(bullet.speed, 1));
      graphics
        .moveTo(bullet.x - bullet.stepX * reach, bullet.y - bullet.stepY * reach)
        .lineTo(bullet.x, bullet.y)
        .stroke({ width: 4, color: SNIPER_ROUND, alpha: 0.35 });
      graphics
        .moveTo(bullet.x - bullet.stepX * reach * 0.6, bullet.y - bullet.stepY * reach * 0.6)
        .lineTo(bullet.x, bullet.y)
        .stroke({ width: 1.5, color: SNIPER_CORE, alpha: 0.9 });
      graphics.circle(bullet.x, bullet.y, 1.8).fill({ color: SNIPER_CORE });
      return;
    }
    const colour = bullet.type === 115 ? FLAK_ROUND : SNIPER_ROUND;
    // A short tail behind the round, so a fast shot still reads as travelling.
    graphics
      .moveTo(bullet.x - bullet.stepX * 1.5, bullet.y - bullet.stepY * 1.5)
      .lineTo(bullet.x, bullet.y)
      .stroke({ width: 1.5, color: colour, alpha: 0.5 });
    graphics.circle(bullet.x, bullet.y, bullet.type === 115 ? 2.5 : 2).fill({ color: colour });
  }

  private drawImpact(bullet: Bullet, age: number): void {
    const graphics = this.graphics;
    const life = 1 - age / IMPACT_TICKS;
    if (bullet.splash > 0) {
      // The blast, drawn as the ground ellipse it covers: half the splash
      // radius across, capped so the flak tower's 180 does not fill the screen.
      const reach = Math.min(bullet.splash / 2, 40);
      const radius = 4 + (reach - 4) * (1 - life);
      graphics
        .ellipse(bullet.x, bullet.y + BODY_HEIGHT, radius, radius / 2)
        .stroke({ width: 2, color: 0xffd28a, alpha: 0.8 * life });
      if (bullet.type === 20) {
        // The cannon ball bursts: a dark puff behind a hot core.
        graphics.circle(bullet.x, bullet.y, 4 + 6 * (1 - life)).fill({ color: 0x3a342e, alpha: 0.45 * life });
        graphics.circle(bullet.x, bullet.y, 5 * life + 2).fill({ color: 0xffb347, alpha: 0.85 * life });
        return;
      }
      graphics.circle(bullet.x, bullet.y, 6 * life + 2).fill({ color: 0xffffff, alpha: 0.7 * life });
      return;
    }
    if (bullet.type === 21) {
      // The sniper's round strikes as a small sharp spark.
      const ray = 3 + 5 * (1 - life);
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        graphics
          .moveTo(bullet.x + dx * 1.5, bullet.y + dy * 1.5)
          .lineTo(bullet.x + dx * ray, bullet.y + dy * ray)
          .stroke({ width: 1.5, color: SNIPER_CORE, alpha: life });
      }
      graphics.circle(bullet.x, bullet.y, 2 * life + 1).fill({ color: SNIPER_ROUND, alpha: life });
      return;
    }
    graphics.circle(bullet.x, bullet.y, 4 * life + 1).fill({ color: 0xffffff, alpha: 0.8 * life });
  }

  private drawBeams(tick: number): void {
    let keep = 0;
    for (const beam of this.beams) {
      const age = tick - beam.bornTick;
      if (age > BEAM_TICKS) continue;
      this.beams[keep] = beam;
      keep += 1;
      const power = Math.min(1, age < BEAM_FADE_AT ? age / 10 : (BEAM_TICKS - age) / 10);
      if (power <= 0) continue;
      // `LASER.Tick`: the end sweeps on the ground where the engine pulses; the
      // beam is drawn from 8 px along it and `height` up (`LASER.as:79-84`).
      const end = laserEnd(beam.sweep, Math.max(0, age));
      if (!end) continue;
      const { ax, ay } = beam.sweep;
      const along = Math.hypot(end.x - ax, end.y - ay) || 1;
      const start = {
        x: ax + ((end.x - ax) / along) * 8,
        y: ay + ((end.y - ay) / along) * 8 - LASER_HEIGHT,
      };
      const graphics = this.graphics;
      graphics
        .moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 9, color: BEAM_GLOW, alpha: 0.28 * power });
      graphics
        .moveTo(start.x, start.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 2.5, color: BEAM_CORE, alpha: power });
      graphics.circle(start.x, start.y, 4).fill({ color: BEAM_CORE, alpha: power });
      graphics.ellipse(end.x, end.y, 8, 4).fill({ color: BEAM_GLOW, alpha: 0.6 * power });
    }
    this.beams.length = keep;
  }

  /**
   * A glow on each Tesla's coil while it charges, growing to full as the
   * charge does, and flickering at full while it zaps. The strip shows the
   * same thing in the Flash art; the glow keeps it readable when zoomed out.
   */
  private drawCoils(tick: number): void {
    for (const tower of this.towers.values()) {
      const { phase, cell } = tower.tesla;
      if (phase !== "charge" && phase !== "loop") continue;
      const power = phase === "charge" ? cell / TESLA_CHARGE_END : 0.8 + jitter(tick, 7) * 0.2;
      const x = tower.info.worldX;
      const y = tower.info.worldY - COIL_HEIGHT;
      this.graphics.circle(x, y, 4 + 10 * power).fill({ color: BOLT_COLOUR, alpha: 0.12 + 0.3 * power });
      this.graphics.circle(x, y, 2 + 3 * power).fill({ color: 0xe8f8ff, alpha: 0.3 + 0.6 * power });
    }
  }

  private drawBolts(tick: number): void {
    let keep = 0;
    for (const bolt of this.bolts) {
      const age = tick - bolt.tick;
      if (age > BOLT_TICKS) continue;
      this.bolts[keep] = bolt;
      keep += 1;
      const alpha = 1 / Math.pow(1.75, age);
      const dx = bolt.to.x - bolt.from.x;
      const dy = bolt.to.y - bolt.from.y;
      const distance = Math.hypot(dx, dy);
      // `EFFECTS.Lightning`: a corner every 30 px, each thrown up to 7 px off the line.
      const corners = Math.max(1, Math.trunc(distance / 30));
      const graphics = this.graphics;
      graphics.moveTo(bolt.from.x, bolt.from.y);
      for (let index = 1; index < corners; index += 1) {
        const along = index / corners;
        graphics.lineTo(
          bolt.from.x + dx * along - 7 + jitter(bolt.tick, index) * 15,
          bolt.from.y + dy * along - 7 + jitter(bolt.tick, index + 97) * 15,
        );
      }
      graphics.lineTo(bolt.to.x - 5 + jitter(bolt.tick, 3) * 10, bolt.to.y - jitter(bolt.tick, 5) * 10);
      graphics.stroke({ width: 5, color: BOLT_COLOUR, alpha: 0.3 * alpha });
      // The same path again as the bright core.
      graphics.moveTo(bolt.from.x, bolt.from.y);
      for (let index = 1; index < corners; index += 1) {
        const along = index / corners;
        graphics.lineTo(
          bolt.from.x + dx * along - 7 + jitter(bolt.tick, index) * 15,
          bolt.from.y + dy * along - 7 + jitter(bolt.tick, index + 97) * 15,
        );
      }
      graphics.lineTo(bolt.to.x - 5 + jitter(bolt.tick, 3) * 10, bolt.to.y - jitter(bolt.tick, 5) * 10);
      graphics.stroke({ width: 1.5, color: 0xe8f8ff, alpha });
    }
    this.bolts.length = keep;
  }

  private drawRails(tick: number): void {
    let keep = 0;
    for (const rail of this.rails) {
      const life = railFade(tick - rail.tick);
      if (life === null) continue;
      this.rails[keep] = rail;
      keep += 1;
      if (life <= 0) continue;
      const graphics = this.graphics;
      const end = {
        x: rail.from.x + rail.dirX * rail.length,
        y: rail.from.y + rail.dirY * rail.length,
      };
      // A 1 px white line under a strength-4 blue glow (`BUILDING118.as:176-179`).
      graphics
        .moveTo(rail.from.x, rail.from.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 10, color: RAIL_GLOW, alpha: 0.3 * life });
      graphics
        .moveTo(rail.from.x, rail.from.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 5, color: RAIL_GLOW, alpha: 0.75 * life });
      graphics
        .moveTo(rail.from.x, rail.from.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 1.5, color: 0xffffff, alpha: life });
      // The gun-balls on top: one every segment along the line, as `Fire` laid them.
      for (let along = RAIL_SEGMENT; along <= rail.length; along += RAIL_SEGMENT) {
        const x = rail.from.x + rail.dirX * along;
        const y = rail.from.y + rail.dirY * along;
        graphics.circle(x, y, 5).fill({ color: GUN_BALL_RIM, alpha: 0.6 * life });
        graphics.circle(x, y, 3.5).fill({ color: GUN_BALL_CORE, alpha: life });
        graphics.circle(x, y, 1.5).fill({ color: 0xffffff, alpha: life });
      }
    }
    this.rails.length = keep;
  }
}
