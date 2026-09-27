import type { Graphics } from "pixi.js";
import { isTower, towerStats, type CreepSnapshot } from "@/game/combat/rules";
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
 * (`BUILDING25.as:84-200`). The Cannon Tower has no animated layer.
 *
 * ## Projectiles
 *
 * Every shot leaves from `(x, y + _top)` of the building's origin, `_top`
 * being the per-class muzzle height ({@link TOWER_MUZZLE}). The Sniper, Cannon
 * and Aerial towers spawn a `PROJECTILE` that flies at half its stat `speed`
 * per tick and re-aims at its target every five ticks (`PROJECTILE.as:33-46`);
 * the Laser sweeps a beam across its target for a hundred ticks (`LASER.as`);
 * the Tesla forks a bolt (`EFFECTS.Lightning`); the Railgun lays a glowing
 * trail of gun-balls along its line of fire (`BUILDING118.as:145-185`).
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

/** `BUILDING25.as:107-200`: cells 0-31 charge, 32-40 loop, 41-54 wind down. */
export const TESLA_CHARGE_END = 32;
export const TESLA_LOOP_END = 41;
export const TESLA_WIND_END = 55;

export type TeslaPhase = "idle" | "charge" | "loop" | "wind";

export interface TeslaState {
  readonly phase: TeslaPhase;
  readonly cell: number;
  /** Ticks into the wind-down, which advances a cell every second tick. */
  readonly windTicks: number;
}

export const TESLA_IDLE: TeslaState = { phase: "idle", cell: 0, windTicks: 0 };

/**
 * One tick of the Tesla Tower's strip. `firing` is whether it still has
 * something to shoot; the Flash class charged on its first `Fire`, looped
 * while shots remained and wound down once they did not.
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
/** Ticks the Tesla keeps its loop going after its last shot. */
const TESLA_HOLD_TICKS = 30;
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
/** Ticks the railgun's trail lasts, and the length of each gun-ball segment. */
const RAIL_TICKS = 16;
const RAIL_SEGMENT = 32;
/** World px a shot lands above a walking creep's ground point. */
const BODY_HEIGHT = 10;

const BOLT_COLOUR = 0x30c8fa; // `EFFECTS.Lightning` default 3197178
const BEAM_GLOW = 0xfca133; // `LASER.Tick` 16555315
const BEAM_CORE = 0xf4eddd; // 16051677
const RAIL_GLOW = 0x0088bb; // `BUILDING118.Fire` GlowFilter 35003
const CANNON_BALL = 0x2b2b2b;
const SNIPER_ROUND = 0xfff1a8;
const FLAK_ROUND = 0xdfe8ff;

interface Bullet {
  readonly type: number;
  readonly creepId: number;
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
  readonly from: Point;
  readonly bornTick: number;
  readonly distance: number;
  /** Screen degrees; sweeps from `LASER.Fire`'s start across the target. */
  angle: number;
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
}

/** What the effects ask of the yard renderer. */
export interface TowerFxHost {
  setAnimFrame(id: number, layer: number, frame: number): void;
}

export interface ShotLike {
  readonly tick: number;
  readonly towerId: number;
  readonly creepId: number;
  readonly ix: number;
  readonly iy: number;
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
      });
    }
  }

  /** The cell a tower's gun was last set to, or null while it has never turned. */
  cellOf(id: number): number | null {
    return this.towers.get(id)?.cell ?? null;
  }

  /** Records a shot and starts its projectile. `target` is the creep hit. */
  onShot(event: ShotLike, target: CreepSnapshot | undefined): void {
    const tower = this.towers.get(event.towerId);
    if (!tower) return;
    tower.lastShotTick = event.tick;
    tower.targetCreep = event.creepId;

    const from = muzzleOf(tower.info.type, tower.info.worldX, tower.info.worldY);
    const aim = this.aimAt(target, event.ix, event.iy);
    const type = tower.info.type;

    if (type === 23) {
      const distance = Math.hypot(aim.x - from.x, aim.y - from.y);
      const toward = Math.atan2(aim.y - from.y, aim.x - from.x) * DEGREES;
      // `LASER.Fire`: the beam starts short of the target and sweeps across it.
      const angle = toward - 150 / Math.sqrt(Math.max(distance, 1));
      const kept = this.beams.filter((beam) => beam.towerId !== tower.info.id);
      this.beams.length = 0;
      this.beams.push(...kept, { towerId: tower.info.id, from, bornTick: event.tick, distance, angle });
      return;
    }
    if (type === 25) {
      // `BUILDING25.as:150`: the bolt leaves from 50 px above the origin.
      this.bolts.push({
        from: { x: tower.info.worldX, y: tower.info.worldY - 50 },
        to: aim,
        tick: event.tick,
      });
      return;
    }
    if (type === 118) {
      const dx = aim.x - from.x;
      const dy = aim.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      this.rails.push({
        from,
        dirX: dx / distance,
        dirY: dy / distance,
        length: distance + RAIL_SEGMENT * 2,
        tick: event.tick,
      });
      this.flashes.push({ at: from, tick: event.tick });
      return;
    }

    const stats = towerStats(type, tower.info.level);
    const speed = (stats?.speed ?? 10) * BULLET_SPEED_FACTOR;
    this.bullets.push({
      type,
      creepId: event.creepId,
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
    this.drawBeams(tick, elapsed);
    this.drawBolts(tick);
    this.drawRails(tick);
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
    if (info.frames <= 0) return;
    const recent = tick - tower.lastShotTick <= FACING_HOLD_TICKS;

    if (info.type === 25) {
      const firing = tick - tower.lastShotTick <= TESLA_HOLD_TICKS;
      let state = tower.tesla;
      for (let step = 0; step < elapsed; step += 1) state = teslaTick(state, firing);
      tower.tesla = state;
      this.setCell(tower, state.cell);
      return;
    }

    if (info.type === 23) {
      const beam = this.beams.find((candidate) => candidate.towerId === info.id);
      if (beam) this.setCell(tower, laserCell(beam.angle, info.frames));
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

  private setCell(tower: TowerState, cell: number): void {
    if (tower.cell === cell) return;
    tower.cell = cell;
    this.host.setAnimFrame(tower.info.id, 0, cell);
  }

  /* ── Projectiles ────────────────────────────────────────────────────── */

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
        bullet.landedTick = tick - elapsed + step + 1;
        return;
      }
    }
  }

  private drawRound(bullet: Bullet): void {
    const graphics = this.graphics;
    if (bullet.type === 20) {
      graphics.circle(bullet.x, bullet.y, 4).fill({ color: CANNON_BALL, alpha: 0.95 });
      graphics.circle(bullet.x - 1.2, bullet.y - 1.2, 1.4).fill({ color: 0x8c8c8c, alpha: 0.8 });
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
      graphics.circle(bullet.x, bullet.y, 6 * life + 2).fill({ color: 0xffffff, alpha: 0.7 * life });
      return;
    }
    graphics.circle(bullet.x, bullet.y, 4 * life + 1).fill({ color: 0xffffff, alpha: 0.8 * life });
  }

  private drawBeams(tick: number, elapsed: number): void {
    let keep = 0;
    for (const beam of this.beams) {
      const age = tick - beam.bornTick;
      if (age > BEAM_TICKS) continue;
      this.beams[keep] = beam;
      keep += 1;
      // `LASER.Tick`: the angle creeps by 2/sqrt(distance) a tick.
      beam.angle += (2 / Math.sqrt(Math.max(beam.distance, 1))) * elapsed;
      const power = Math.min(1, age < BEAM_FADE_AT ? age / 10 : (BEAM_TICKS - age) / 10);
      if (power <= 0) continue;
      const radians = beam.angle / DEGREES;
      const reach = beam.distance + Math.sin(age / 80) * (beam.distance / 20);
      const start = { x: beam.from.x + Math.cos(radians) * 8, y: beam.from.y + Math.sin(radians) * 8 };
      const end = { x: beam.from.x + Math.cos(radians) * reach, y: beam.from.y + Math.sin(radians) * reach };
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
      const age = tick - rail.tick;
      if (age > RAIL_TICKS) continue;
      this.rails[keep] = rail;
      keep += 1;
      const life = age < RAIL_TICKS / 2 ? 1 : (RAIL_TICKS - age) / (RAIL_TICKS / 2);
      const graphics = this.graphics;
      const end = {
        x: rail.from.x + rail.dirX * rail.length,
        y: rail.from.y + rail.dirY * rail.length,
      };
      graphics
        .moveTo(rail.from.x, rail.from.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 7, color: RAIL_GLOW, alpha: 0.35 * life });
      // The gun-balls: one every segment along the line, as `Fire` laid them.
      for (let along = RAIL_SEGMENT; along <= rail.length; along += RAIL_SEGMENT) {
        graphics
          .circle(rail.from.x + rail.dirX * along, rail.from.y + rail.dirY * along, 2.5)
          .fill({ color: 0xffffff, alpha: life });
      }
      graphics
        .moveTo(rail.from.x, rail.from.y)
        .lineTo(end.x, end.y)
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.9 * life });
    }
    this.rails.length = keep;
  }
}
