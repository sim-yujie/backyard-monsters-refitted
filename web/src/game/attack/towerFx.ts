import type { Container, Graphics, Texture } from "pixi.js";
import {
  canHit,
  defenseFlags,
  isSpurtzCannon,
  isTower,
  LASER_DROP,
  LASER_HEIGHT,
  laserEnd,
  laserSweep,
  TESLA_CHARGE_END,
  TESLA_LOOP_END,
  TESLA_TICKS_PER_FRAME,
  TESLA_WIND_END,
  spurtzBlastRadius,
  towerStats,
  towerTargets,
  type BeamLine,
  type CreepSnapshot,
  type LaserSweep,
  type LobLine,
} from "@/game/combat/rules";
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import type { Point } from "@/game/yard/YardGrid";
import type { Yard } from "@/game/yard/yardModel";
import { blastNoise, tintAt } from "./blastFx";
import { championFlightTop, flyerAltitude, spriteFor } from "./monsterSprites";
import { boltLook, ShotFx, type StripLook } from "./shotFx";
import { ShellSprites } from "./spurtzShell";

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
 *
 * ## The new look (beta.5)
 *
 * Besides the Flash look above (`classic`, which `?juice=0` and the tests
 * keep), the shots can be drawn `full` or `low`, every piece of it painted
 * (the {@link ShotFx} sheet) and only laid, stretched, tinted and faded here:
 * glows, sparks, smoke and impact bursts; the Tesla's painted bolts stretched
 * from coil to creep over a wide faint glow and a brighter band, swapped for
 * another bolt every few frames (each still hurts the one creep); the Laser's
 * and the Railgun's rays stacked soft, bright and white-hot; guns that turn
 * onto the nearest creep in range before they fire rather than snap, and
 * kick back as they do; and a jolt of the yard on the big hits. `low` throws
 * fewer bits and fewer layers, for phones. So far the Cannon, Laser, Tesla and
 * Railgun have it; the other towers keep their Flash shots in every look.
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

/**
 * How far above its ground point a shot at a creep lands: a walker's body
 * middle, or the middle of the cell a flyer is drawn in, as `layoutCreep`
 * places it at the bottom of its bob. Towers and ranged creeps aim alike, so
 * a shot at any flyer meets it in the air, not the ground under it: a Vorg,
 * whose cell hangs above its anchor, and a flying Fomor, whose cell top is
 * fixed, as well as a Teratorn. A flyer with no sheet gets its altitude.
 */
export function aimLift(
  creep: Pick<CreepSnapshot, "flying" | "monsterId" | "level" | "champion"> | null | undefined,
): number {
  if (!creep?.flying) return BODY_HEIGHT;
  const sheet = spriteFor(creep.monsterId, creep.level);
  if (!sheet) return flyerAltitude(creep.monsterId);
  const top = creep.champion ? -championFlightTop(0) : flyerAltitude(creep.monsterId) + sheet.anchorY;
  return top - sheet.frameHeight / 2;
}

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
const SPURTZ_SHELL = 0xf3f0dc;

/** The towers drawn the new way so far (beta.5 sample): Cannon, Laser, Tesla, Railgun. */
const NEW_LOOK_TYPES: ReadonlySet<number> = new Set([20, 23, 25, 118]);
/** The new look's guns that turn onto a creep as soon as it is in range: the Laser and the Railgun. */
const AIMING_TYPES: ReadonlySet<number> = new Set([23, 118]);
/** The new look's laser: an orange glow, an amber band, a white-hot core. */
const LASER_BAND = 0xffb84a;
const LASER_HOT = 0xfff4dc;
/** The new look's tints: the Tesla's arc, the rail's blue, the cannon's fire. */
const ARC_MID = 0x9fe8ff;
const RAIL_MID = 0x2aa8ff;
const RAIL_PALE = 0x8fd8ff;
const FIRE_TINTS = [0xffffff, 0xffe080, 0xff8a20, 0xa03000] as const;
const SMOKE_TINTS = [0x8a8580, 0x6a6560, 0x55504c] as const;

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

/* ── The new look's arithmetic (beta.5) ─────────────────────────────────── */

/**
 * How the shots are drawn: `classic` is the Flash client's lines; `full` and
 * `low` are the painted look, `low` with fewer bits for phones.
 */
export type TowerLook = "classic" | "full" | "low";

/**
 * Ticks a new-look zap lasts as it fades (80 ticks a second, so about 0.15 s),
 * swapping its painted bolt for another every {@link ZAP_FLICKER_TICKS}.
 */
export const ZAP_TICKS = 12;
export const ZAP_FLICKER_TICKS = 3;
/** Ticks the white flash where a zap lands lasts. */
const ZAP_FLASH_TICKS = 5;
/**
 * Degrees a gun turns a tick while it lines up on a creep that came into
 * range: a half turn in three quarters of a second, slow enough to see.
 */
export const TURN_DEGREES_PER_TICK = 3;
/** Degrees a tick once it fires: onto its beam or its target quickly, never in one frame. */
export const CATCH_UP_DEGREES_PER_TICK = 12;
/**
 * World px past its range a gun starts watching a creep (about one and a half
 * tiles), so it is already lined up when the engine first fires. Looks only:
 * when and at whom towers fire is the engine's.
 */
export const AIM_WATCH_MARGIN = 60;
/** Ticks the Laser's barrel glows up before its beam comes on in full. */
export const LASER_CHARGE_TICKS = 10;
/** Ticks between the scorch marks and sparks a laser leaves where it burns. */
const LASER_MARK_TICKS = 5;
/** Ticks a gun's kick lasts, and how far it goes back, world px. */
export const RECOIL_TICKS = 18;
export const RECOIL_PX = 4;
/** Ticks before its next shot the Railgun starts to glow, winding up. */
export const RAIL_CHARGE_TICKS = 70;

/**
 * A heading in degrees turned toward `wanted` by at most `most`, the short
 * way round.
 */
export const stepDegrees = (current: number, wanted: number, most: number): number => {
  let gap = wrapDegrees(wanted - current);
  if (gap > 180) gap -= 360;
  if (Math.abs(gap) <= most) return wrapDegrees(wanted);
  return wrapDegrees(current + Math.sign(gap) * most);
};

/**
 * The heading a gun shows in `cell`, the middle of the cell's degrees: a
 * bearing for the Railgun, the beam's screen angle for the Laser. Where a gun
 * that has not turned yet starts from.
 */
export const cellHeading = (type: number, cell: number): number => {
  if (type === 23) return wrapDegrees((cell + 0.5) * LASER_DEGREES_PER_CELL - LASER_TRACK_OFFSET);
  const rule = FACING[type];
  return rule ? wrapDegrees((cell + 0.5) * rule.degreesPerCell - rule.offsetDegrees) : 0;
};

/** How far back a gun is `age` ticks after its shot, 0 to 1: snapped back at once, eased home. */
export const recoilKick = (age: number): number => {
  if (age < 0 || age >= RECOIL_TICKS) return 0;
  if (age < 2) return age === 0 ? 0.6 : 1;
  const t = (age - 2) / (RECOIL_TICKS - 2);
  return (1 - t) * (1 - t);
};

/**
 * How wound up a Railgun is, 0 to 1, `since` ticks after its last shot with
 * `rate` ticks between shots: it glows up over the last
 * {@link RAIL_CHARGE_TICKS} before the next, and lets go if that shot is
 * overdue (its target gone).
 */
export const railCharge = (since: number, rate: number): number => {
  const start = rate - RAIL_CHARGE_TICKS;
  if (since < start || since > rate + 30) return 0;
  return Math.min(1, (since - start) / RAIL_CHARGE_TICKS);
};

/** What the new look asks of the battle screen; everything has a fallback. */
export interface TowerFxOptions {
  readonly look?: TowerLook;
  /** Where the painted bits go (see `ShotFx`); without it the new look throws none. */
  readonly sparks?: Container;
  /** A layer drawn in additive light, for the bolts' and the rail's glow; `graphics` without it. */
  readonly glow?: Graphics;
  /** Jolts the yard on a big hit: `amp` screen px over `life` ticks. The host caps it and never stacks two. */
  readonly shake?: (tick: number, amp: number, life: number) => void;
  /** The sheet's loader, for tests. */
  readonly load?: (url: string) => Promise<Texture>;
}

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
  /** A Spurtz Cannon shell's size (issue #313), 0.4 to 1. */
  readonly scale?: number;
}

interface Beam {
  readonly towerId: number;
  readonly bornTick: number;
  /** The engine's sweep (issue #267), in world px: its end is where the pulses land. */
  readonly sweep: LaserSweep;
  /** The last tick it left a scorch mark and sparks (new look). */
  marked: number;
}

interface Bolt {
  readonly from: Point;
  readonly to: Point;
  readonly tick: number;
  /** The first zap of a charge: the new look draws it bigger and jolts the yard. */
  readonly big: boolean;
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
  readonly type: number;
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
  /** The charge the Tesla's last zap belonged to, so the first of each is told (new look). */
  zapCharge: number;
  /** The gun's kick after a shot (new look): when, and how far back at most, world px. */
  recoil: { readonly tick: number; readonly dx: number; readonly dy: number } | null;
  /** The last tick the coil crackled (new look). */
  crackle: number;
  /** Where a Laser's or Railgun's gun points in the new look, degrees, turned a little each tick; null until it first turns. */
  heading: number | null;
}

/** What the effects ask of the yard renderer. */
export interface TowerFxHost {
  setAnimFrame(id: number, layer: number, frame: number): void;
  /** Draws one of a building's animation layers `dx`, `dy` world px off its place: a gun's kick. */
  nudge?(id: number, layer: number, dx: number, dy: number): void;
  /**
   * A bullet reached its target on `tick` (#77): the moment Flash's
   * `PROJECTILE.Move` dealt its damage, so the moment the wound is shown.
   */
  landed?(key: number, tick: number): void;
  /**
   * Where the Spurtz Cannon's shells are drawn off their sheet (issue #313),
   * over the same px as the graphics; without it they are plain dots.
   */
  shellLayer?(): Container;
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
  /** A Spurtz Cannon's shell (issue #313): from its muzzle to where it goes off. */
  readonly lob?: LobLine;
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
  private readonly shells: ShellSprites | null;
  /** The new look (beta.5): its painted bits, its light layer and its jolt. */
  private readonly look: TowerLook;
  private readonly sparks: ShotFx | null;
  private readonly glow: Graphics;
  private readonly shake: ((tick: number, amp: number, life: number) => void) | undefined;

  /**
   * `graphics` is redrawn every frame; `origin` turns isometric yard px into
   * world px, the yard's `bounds.originX/Y`. `options` picks the look; the
   * Flash one without them.
   */
  constructor(
    private readonly graphics: Graphics,
    towers: readonly TowerInfo[],
    private readonly host: TowerFxHost,
    private readonly origin: Point,
    options: TowerFxOptions = {},
  ) {
    const shellLayer = host.shellLayer?.bind(host);
    this.shells = shellLayer ? new ShellSprites(shellLayer) : null;
    if (towers.some((info) => isSpurtzCannon(info.type))) this.shells?.preload();
    this.look = options.look ?? "classic";
    this.sparks =
      this.look !== "classic" && options.sparks ? new ShotFx(options.sparks, this.look === "low", options.load) : null;
    if (towers.some((info) => NEW_LOOK_TYPES.has(info.type))) this.sparks?.preload();
    this.glow = options.glow ?? graphics;
    this.shake = this.look === "classic" ? undefined : options.shake;
    for (const info of towers) {
      this.towers.set(info.id, {
        info,
        lastShotTick: Number.NEGATIVE_INFINITY,
        targetCreep: -1,
        cell: null,
        tesla: TESLA_IDLE,
        chargeTick: Number.NEGATIVE_INFINITY,
        chargePending: false,
        zapCharge: Number.NaN,
        recoil: null,
        crackle: Number.NEGATIVE_INFINITY,
        heading: null,
      });
    }
  }

  /** Whether shots are drawn the new way: the look asks for it and the sheet is in. */
  private get painted(): boolean {
    return this.sparks?.ready === true;
  }

  /** Bits of the new look alive, for tests and the frame-rate check. */
  get sparkCount(): number {
    return this.sparks?.bitCount ?? 0;
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
        marked: Number.NEGATIVE_INFINITY,
      });
      return null;
    }
    if (type === 25) {
      // `BUILDING25.as:150`: the bolt leaves from 50 px above the origin.
      const coil = { x: tower.info.worldX, y: tower.info.worldY - COIL_HEIGHT };
      const big = tower.zapCharge !== tower.chargeTick;
      tower.zapCharge = tower.chargeTick;
      this.bolts.push({ from: coil, to: aim, tick: event.tick, big });
      if (this.painted) this.zapFx(event.tick, coil, aim, big);
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
      this.flashes.push({ at: from, tick: event.tick, type });
      if (this.painted) this.railFx(event.tick, tower, from, start, dx / distance, dy / distance, aim);
      return null;
    }

    const stats = towerStats(type, tower.info.level);
    const speed = (stats?.speed ?? 10) * BULLET_SPEED_FACTOR;
    const lob = event.lob;
    if (lob && isSpurtzCannon(type)) {
      // A shell at a point on the ground (issue #313), not at a creep: the
      // engine hurts what is round it when it lands, so no wound waits on it.
      const start = this.groundAt(lob.fromIx, lob.fromIy);
      this.bullets.push({
        key: 0,
        type,
        creepId: -1,
        bornTick: event.tick,
        x: start.x,
        y: start.y,
        speed: Math.max(speed, 1),
        // Drawn at half its splash: the blast's own screen radius.
        splash: spurtzBlastRadius(lob.scale) * 2,
        aim: this.groundAt(lob.toIx, lob.toIy),
        stepX: 0,
        stepY: 0,
        ticks: 0,
        landedTick: null,
        scale: lob.scale,
      });
      return null;
    }
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
    this.flashes.push({ at: from, tick: event.tick, type });
    if (type === 20 && this.painted) this.cannonFx(event.tick, from, aim);
    return key;
  }

  /** Bullets still in the air. */
  get flyingCount(): number {
    return this.bullets.filter((bullet) => bullet.landedTick === null).length;
  }

  /**
   * Turns every gun and redraws every projectile for `tick`. `creepAt` is
   * the creep by id right now, or undefined once it is gone; `creeps` is
   * every creep on the field, which the new look's guns watch to line up on
   * one as it comes into range.
   */
  update(
    tick: number,
    creepAt: (id: number) => CreepSnapshot | undefined,
    creeps: readonly CreepSnapshot[] = [],
  ): void {
    const elapsed = Math.max(0, Math.min(tick - this.lastTick, 400));
    this.lastTick = tick;

    for (const tower of this.towers.values()) this.turn(tower, tick, elapsed, creepAt, creeps);

    this.sparks?.begin();
    const graphics = this.graphics;
    graphics.clear();
    if (this.glow !== graphics) this.glow.clear();
    this.drawFlashes(tick);
    this.drawBullets(tick, elapsed, creepAt);
    this.drawBeams(tick);
    this.drawCoils(tick);
    this.drawBolts(tick);
    this.drawRails(tick);
    if (this.painted) this.drawWindUps(tick);
    this.sparks?.update(tick);
  }

  /**
   * Every gun at rest and nothing in the air: the battle is over (#308). A
   * Tesla goes back to its idle cell; the other guns keep the way they face.
   */
  standDown(): void {
    this.bullets.length = 0;
    this.shells?.sweep();
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
      if (tower.recoil) this.host.nudge?.(tower.info.id, 0, 0, 0);
      tower.recoil = null;
    }
    this.graphics.clear();
    this.glow.clear();
    this.sparks?.clear();
  }

  destroy(): void {
    this.towers.clear();
    this.bullets.length = 0;
    this.shells?.destroy();
    this.sparks?.destroy();
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
    creeps: readonly CreepSnapshot[],
  ): void {
    const { info } = tower;
    if (info.type === 25) {
      this.stepCoil(tower, tick, elapsed);
      if (info.frames > 0) this.setCell(tower, tower.tesla.cell);
      return;
    }
    if (tower.recoil) this.kick(tower, tick);
    if (info.frames <= 0) return;
    if (this.look !== "classic" && AIMING_TYPES.has(info.type)) {
      this.aim(tower, tick, elapsed, creepAt, creeps);
      return;
    }
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
    if (cell === null) return;
    this.setCell(tower, cell);
  }

  /**
   * A Laser's or Railgun's gun in the new look: as soon as a creep it could
   * shoot is in range it turns, a little each tick, onto the nearest, so it
   * is already aimed when the engine fires; once it fires it follows its
   * beam or its target, faster but never in one frame. Looks only: the
   * engine picks the targets and fires when it always did.
   */
  private aim(
    tower: TowerState,
    tick: number,
    elapsed: number,
    creepAt: (id: number) => CreepSnapshot | undefined,
    creeps: readonly CreepSnapshot[],
  ): void {
    const { info } = tower;
    let wanted: number | null = null;
    let speed = CATCH_UP_DEGREES_PER_TICK;
    if (info.type === 23) {
      let beam: Beam | undefined;
      for (const candidate of this.beams) if (candidate.towerId === info.id) beam = candidate;
      const end = beam ? laserEnd(beam.sweep, Math.max(0, tick - beam.bornTick)) : null;
      if (beam && end) wanted = Math.atan2(end.y - beam.sweep.ay, end.x - beam.sweep.ax) * DEGREES;
    } else if (tick - tower.lastShotTick <= FACING_HOLD_TICKS) {
      const creep = creepAt(tower.targetCreep);
      if (creep) wanted = bearingDegrees({ x: info.x, y: info.y }, { x: creep.ix, y: creep.iy });
    }
    if (wanted === null) {
      const creep = this.nearestInRange(info, creeps);
      if (!creep) return;
      speed = TURN_DEGREES_PER_TICK;
      if (info.type === 23) {
        // The beam's screen angle, from where it starts below the tower to the creep's feet.
        const feet = this.groundAt(creep.ix, creep.iy);
        wanted = Math.atan2(feet.y - (info.worldY + LASER_DROP), feet.x - info.worldX) * DEGREES;
      } else {
        wanted = bearingDegrees({ x: info.x, y: info.y }, { x: creep.ix, y: creep.iy });
      }
    }
    const from = tower.heading ?? cellHeading(info.type, tower.cell ?? 0);
    tower.heading = stepDegrees(from, wanted, speed * Math.max(1, elapsed));
    const cell =
      info.type === 23 ? laserCell(tower.heading, info.frames) : facingCell(info.type, tower.heading, info.frames);
    if (cell !== null) this.setCell(tower, cell);
  }

  /**
   * The nearest creep on the field a tower could shoot, inside its range plus
   * {@link AIM_WATCH_MARGIN}, or undefined.
   */
  private nearestInRange(info: TowerInfo, creeps: readonly CreepSnapshot[]): CreepSnapshot | undefined {
    const stat = towerStats(info.type, info.level)?.range ?? 0;
    if (stat <= 0) return undefined;
    const range = stat + AIM_WATCH_MARGIN;
    const flags = towerTargets(info.type);
    // Measured from the middle of the tower, as the engine scans (`towerScanPoint`).
    const x = info.x + TOWER_CENTRE;
    const y = info.y + TOWER_CENTRE;
    let nearest: CreepSnapshot | undefined;
    let best = range * range;
    for (const creep of creeps) {
      if (creep.friendly || creep.hp <= 0) continue;
      if (!canHit(flags, defenseFlags(false, creep.flying, false))) continue;
      const distance = (creep.ix - x) * (creep.ix - x) + (creep.iy - y) * (creep.iy - y);
      if (distance < best || (distance === best && nearest && creep.id < nearest.id)) {
        best = distance;
        nearest = creep;
      }
    }
    return nearest;
  }

  /** The gun's kick after a shot (new look), easing home; it ends back in place. */
  private kick(tower: TowerState, tick: number): void {
    const recoil = tower.recoil;
    if (!recoil) return;
    const age = tick - recoil.tick;
    if (age >= RECOIL_TICKS || age < 0) {
      tower.recoil = null;
      this.host.nudge?.(tower.info.id, 0, 0, 0);
      return;
    }
    const share = recoilKick(age);
    this.host.nudge?.(tower.info.id, 0, recoil.dx * share, recoil.dy * share);
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
    return { x, y: y - aimLift(creep) };
  }

  private drawFlashes(tick: number): void {
    let keep = 0;
    for (const flash of this.flashes) {
      const age = tick - flash.tick;
      if (age > FLASH_TICKS) continue;
      this.flashes[keep] = flash;
      keep += 1;
      // The new look paints its own muzzle flash for these.
      if (this.painted && NEW_LOOK_TYPES.has(flash.type)) continue;
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
        if (!(bullet.type === 20 && this.painted)) this.drawImpact(bullet, age);
      } else {
        this.drawRound(bullet);
      }
      this.bullets[keep] = bullet;
      keep += 1;
    }
    this.bullets.length = keep;
    this.shells?.sweep();
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
      if (bullet.type === 20 && bullet.ticks % 5 === 0 && this.look === "full" && this.painted) {
        // A thin wisp of smoke behind the cannon ball.
        this.sparks?.emit(stepTick, {
          look: "wisp", at: { x: bullet.x, y: bullet.y }, life: 26, size0: 6, size1: 14,
          vz: 0.15, peak: 0.32, rotation: blastNoise(stepTick, 3) * 6.28, colours: SMOKE_TINTS,
        });
      }
      const left = Math.hypot(bullet.aim.x - bullet.x, bullet.aim.y - bullet.y);
      // `PROJECTILE.Move` lands once within a full speed of the target. The
      // landing is stamped with the tick it happened on, not the frame's,
      // so a long frame does not restart the impact.
      if (left <= bullet.speed * 2) {
        bullet.x = bullet.aim.x;
        bullet.y = bullet.aim.y;
        bullet.landedTick = stepTick;
        if (bullet.creepId >= 0) this.host.landed?.(bullet.key, stepTick);
        if (bullet.type === 20 && this.painted) this.cannonHitFx(stepTick, bullet);
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
    if (isSpurtzCannon(bullet.type)) {
      // Flash's shell off its sheet, facing where it flies (`FIREBALL.as:199-203`);
      // a plain dot until the sheet is in.
      const heading = Math.atan2(bullet.aim.y - bullet.y, bullet.aim.x - bullet.x) * (180 / Math.PI);
      if (this.shells?.draw(bullet, bullet.x, bullet.y, heading, bullet.ticks, bullet.scale ?? 1)) return;
      graphics.circle(bullet.x, bullet.y, 3).fill({ color: SPURTZ_SHELL, alpha: 0.95 });
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
      if (this.painted) {
        this.drawLitBeam(beam, tick, age, power, start, end);
        continue;
      }
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
    if (this.painted) {
      this.drawLitCoils(tick);
      return;
    }
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
    if (this.painted) {
      this.drawLitBolts(tick);
      return;
    }
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
      if (this.painted) {
        this.drawLitRail(rail, life);
        continue;
      }
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

  /* ── The new look (beta.5) ──────────────────────────────────────────── */

  /**
   * A beam of light from `from` to `to`, painted rays stacked: a wide soft
   * glow (full look only), a narrower brighter band, a thin white-hot core.
   * `width` is the band's; the others are sized from it.
   */
  private ray(from: Point, to: Point, width: number, glow: number, band: number, core: number, alpha: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    if (this.look === "full") sparks.line({ look: "ray", from, to, width: width * 2.6, alpha: 0.32 * alpha, tint: glow });
    sparks.line({ look: "ray", from, to, width, alpha: 0.75 * alpha, tint: band });
    sparks.line({ look: "ray", from, to, width: width * 0.42, alpha, tint: core });
  }

  /**
   * One painted bolt from `from` to `to`, `across` world px from its lowest
   * bend to its highest: the bolt in pale blue, its own bright core in white
   * on top. `pick` chooses the painting and which way up it lies.
   */
  private bolt(from: Point, to: Point, across: number, pick: number, alpha: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const flip = pick % 2 === 1;
    const look: StripLook = boltLook(Math.floor(pick / 2));
    sparks.line({ look, from, to, width: across, alpha, tint: ARC_MID, flip });
    sparks.line({ look: boltLook(Math.floor(pick / 2), true), from, to, width: across, alpha, tint: 0xffffff, flip });
  }

  /**
   * The Tesla's coil while it charges and zaps: a painted glow that swells
   * with the charge and flickers at full, sparks crackling off it, and small
   * painted arcs licking round the top once it is well charged.
   */
  private drawLitCoils(tick: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    for (const tower of this.towers.values()) {
      const { phase, cell } = tower.tesla;
      if (phase !== "charge" && phase !== "loop") continue;
      const power = phase === "charge" ? cell / TESLA_CHARGE_END : 0.85 + blastNoise(tick, 7) * 0.15;
      const coil = { x: tower.info.worldX, y: tower.info.worldY - COIL_HEIGHT };
      sparks.lamp(tower, {
        look: "glow",
        at: coil,
        size: 16 + 46 * power,
        alpha: 0.25 + 0.6 * power * (0.8 + blastNoise(tick, 11) * 0.2),
        tint: BOLT_COLOUR,
      });
      if (power < 0.35) continue;
      const beat = Math.floor(tick / ZAP_FLICKER_TICKS);
      for (let arc = 0; arc < (this.look === "full" ? 2 : 1); arc += 1) {
        const angle = blastNoise(beat, arc + 20) * Math.PI * 2;
        const reach = 12 + blastNoise(beat, arc + 30) * 14 * power;
        const end = { x: coil.x + Math.cos(angle) * reach, y: coil.y + Math.sin(angle) * reach * 0.7 };
        this.bolt(coil, end, 4 + reach * 0.25, beat * 3 + arc, 0.5 + 0.5 * power);
      }
      if (tick - tower.crackle >= 6) {
        tower.crackle = tick;
        sparks.emit(tick, {
          look: "zap",
          at: coil,
          add: true,
          life: 6,
          size0: 14 + 14 * power,
          size1: 22 + 16 * power,
          rotation: blastNoise(tick, 40) * 6.28,
          colours: [0xffffff, ARC_MID, BOLT_COLOUR],
          peak: 0.8,
        });
      }
    }
  }

  /**
   * The Tesla's zaps: a painted bolt stretched from coil to creep over a wide
   * faint blue glow and a narrower brighter band, its white core on top,
   * swapped for another painting every {@link ZAP_FLICKER_TICKS} as it fades
   * over {@link ZAP_TICKS}. Looks only: each still hurts the one creep at its end.
   */
  private drawLitBolts(tick: number): void {
    const sparks = this.sparks;
    let keep = 0;
    for (const bolt of this.bolts) {
      const age = tick - bolt.tick;
      if (age > ZAP_TICKS) continue;
      this.bolts[keep] = bolt;
      keep += 1;
      if (age < 0 || !sparks) continue;
      const flick = Math.floor(age / ZAP_FLICKER_TICKS);
      const fade = 1 - age / (ZAP_TICKS + 1);
      const alpha = fade * (0.8 + 0.2 * blastNoise(bolt.tick + age, 3));
      const length = Math.hypot(bolt.to.x - bolt.from.x, bolt.to.y - bolt.from.y);
      const across = Math.min(34, Math.max(14, length * 0.15)) * (bolt.big ? 1.3 : 1);
      const blue = Math.min(1, 0.6 + 0.4 * fade);
      if (this.look === "full") {
        sparks.line({ look: "ray", from: bolt.from, to: bolt.to, width: across * 2.2, alpha: 0.3 * blue, tint: BOLT_COLOUR });
      }
      sparks.line({ look: "ray", from: bolt.from, to: bolt.to, width: across * 0.9, alpha: 0.55 * blue, tint: 0x48b8ff });
      this.bolt(bolt.from, bolt.to, across, Math.floor(blastNoise(bolt.tick, flick + 5) * 12), alpha);
    }
    this.bolts.length = keep;
  }

  /** The Railgun's line in light, painted rays stacked blue, pale and white, and its gun-balls. */
  private drawLitRail(rail: Rail, life: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const end = { x: rail.from.x + rail.dirX * rail.length, y: rail.from.y + rail.dirY * rail.length };
    const thin = 0.55 + 0.45 * life;
    this.ray(rail.from, end, 12 * thin, RAIL_GLOW, RAIL_MID, 0xffffff, life);
    const every = this.look === "full" ? RAIL_SEGMENT : RAIL_SEGMENT * 2;
    for (let along = every; along <= rail.length; along += every) {
      const at = { x: rail.from.x + rail.dirX * along, y: rail.from.y + rail.dirY * along };
      sparks.spot({ look: "orb", at, size: 16, alpha: 0.9 * life, tint: GUN_BALL_CORE });
    }
  }

  /**
   * The Laser's beam in light: a short charge-up glow at the barrel, then the
   * painted rays stacked orange, amber and white-hot, breathing a little in
   * width, with a glow, sparks and scorch marks where it burns.
   */
  private drawLitBeam(beam: Beam, tick: number, age: number, power: number, start: Point, end: Point): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const charge = Math.min(1, age / LASER_CHARGE_TICKS);
    const pulse = 1 + 0.14 * Math.sin(age * 0.9) + 0.06 * (blastNoise(tick, 31) - 0.5);
    // The barrel: swelling as it charges, then holding a hot glow while it fires.
    sparks.spot({
      look: "orb",
      at: start,
      size: (8 + 22 * charge) * (charge < 1 ? 1 : pulse),
      alpha: Math.max(charge, power),
      tint: tintAt([BEAM_GLOW, LASER_BAND, LASER_HOT], charge),
    });
    // The beam itself only once the charge is mostly in.
    const lit = power * Math.max(0, Math.min(1, (age - LASER_CHARGE_TICKS * 0.4) / (LASER_CHARGE_TICKS * 0.6)));
    if (lit <= 0) return;
    this.ray(start, end, 9 * pulse, BEAM_GLOW, LASER_BAND, LASER_HOT, lit);
    sparks.spot({ look: "glow", at: end, size: 34 * pulse, squash: 0.6, alpha: 0.85 * lit, tint: BEAM_GLOW });
    sparks.spot({ look: "flare", at: end, size: 22 * pulse, alpha: lit, tint: LASER_HOT, rotation: tick * 0.05 });
    if (tick - beam.marked < LASER_MARK_TICKS) return;
    beam.marked = tick;
    sparks.emit(tick, {
      look: "scorch",
      at: { x: end.x, y: end.y },
      life: 90,
      size0: 14,
      size1: 18,
      squash: 0.5,
      fadeIn: 3,
      peak: 0.55,
      hold: 0.4,
      rotation: blastNoise(tick, 41) * 6.28,
      colours: [0x2a1a10, 0x302822],
    });
    const count = sparks.many(3);
    for (let index = 0; index < count; index += 1) {
      const angle = -Math.PI / 2 + (blastNoise(tick, index + 50) - 0.5) * 2.6;
      const speed = 1.8 + blastNoise(tick, index + 60) * 2.2;
      sparks.emit(tick, {
        look: "spark",
        at: end,
        add: true,
        life: 9 + Math.round(blastNoise(tick, index + 70) * 6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6,
        vz: 1,
        gravity: 0.15,
        drag: 0.08,
        size0: 7,
        size1: 2,
        stretch: true,
        colours: [0xffffff, LASER_BAND, BEAM_GLOW],
      });
    }
    if (this.look === "full") {
      sparks.emit(tick, {
        look: "wisp",
        at: end,
        life: 30,
        vz: 0.35,
        size0: 6,
        size1: 16,
        fadeIn: 3,
        peak: 0.3,
        rotation: blastNoise(tick, 43) * 6.28,
        colours: SMOKE_TINTS,
      });
    }
  }

  /**
   * Each Railgun winding up for its next shot: a blue orb gathering at the
   * muzzle over the last {@link RAIL_CHARGE_TICKS} before it, with sparks
   * drawn into it. Only after a first shot: the engine says nothing before.
   */
  private drawWindUps(tick: number): void {
    const sparks = this.sparks;
    if (!sparks) return;
    for (const tower of this.towers.values()) {
      if (tower.info.type !== 118 || !Number.isFinite(tower.lastShotTick)) continue;
      const rate = towerStats(tower.info.type, tower.info.level)?.rate ?? 160;
      const charge = railCharge(tick - tower.lastShotTick, rate);
      if (charge <= 0) continue;
      const at = muzzleOf(tower.info.type, tower.info.worldX, tower.info.worldY);
      const flicker = 0.85 + blastNoise(tick, 17) * 0.15;
      sparks.lamp(tower, {
        look: "orb",
        at,
        size: 6 + 30 * charge,
        alpha: charge * flicker,
        tint: tintAt([0x1060ff, 0x40c0ff, 0xe0f8ff], charge),
      });
      if (this.look !== "full" || charge < 0.3 || tick - tower.crackle < 5) continue;
      tower.crackle = tick;
      const angle = blastNoise(tick, 23) * Math.PI * 2;
      const reach = 24;
      sparks.emit(tick, {
        look: "spark",
        add: true,
        life: 9,
        at: { x: at.x + Math.cos(angle) * reach, y: at.y + Math.sin(angle) * reach * 0.6 },
        vx: (-Math.cos(angle) * reach) / 9,
        vy: (-Math.sin(angle) * reach * 0.6) / 9,
        size0: 6,
        size1: 3,
        stretch: true,
        colours: [0xffffff, RAIL_PALE],
      });
    }
  }

  /**
   * A Tesla's zap lands: an electric burst and sparks on the creep, a flare
   * on the coil; the first zap of a charge rings the ground and jolts the yard.
   */
  private zapFx(tick: number, coil: Point, at: Point, big: boolean): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const size = big ? 1.4 : 1;
    sparks.emit(tick, {
      look: "flare",
      at: coil,
      add: true,
      life: 8,
      size0: 46 * size,
      size1: 28,
      rotation: blastNoise(tick, 1) * 0.6,
      colours: [0xffffff, ARC_MID],
    });
    // A short white flash where it lands.
    sparks.emit(tick, {
      look: "glow",
      at,
      add: true,
      life: ZAP_FLASH_TICKS,
      size0: 40 * size,
      size1: 30 * size,
      colours: [0xffffff],
    });
    sparks.emit(tick, {
      look: "glow",
      at,
      add: true,
      life: 12,
      size0: 30 * size,
      size1: 60 * size,
      easeOut: true,
      peak: 0.8,
      colours: [0xe8f8ff, BOLT_COLOUR, 0x0060a0],
    });
    sparks.emit(tick, {
      look: "zap",
      at,
      add: true,
      life: 12,
      size0: 24 * size,
      size1: 46 * size,
      easeOut: true,
      rotation: blastNoise(tick, 2) * 6.28,
      colours: [0xffffff, ARC_MID, BOLT_COLOUR],
    });
    const count = sparks.many(big ? 9 : 5);
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + blastNoise(tick, index + 10)) / count) * Math.PI * 2;
      const speed = 2.5 + blastNoise(tick, index + 30) * 3;
      sparks.emit(tick, {
        look: "spark",
        at,
        add: true,
        life: 10 + Math.round(blastNoise(tick, index + 50) * 8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6,
        drag: 0.12,
        size0: 9,
        size1: 3,
        stretch: true,
        colours: [0xffffff, ARC_MID, BOLT_COLOUR],
      });
    }
    if (!big) return;
    sparks.emit(tick, {
      look: "ring",
      at: { x: at.x, y: at.y + BODY_HEIGHT },
      add: true,
      life: 16,
      size0: 12,
      size1: 80,
      squash: 0.5,
      easeOut: true,
      peak: 0.7,
      colours: [0xffffff, ARC_MID, BOLT_COLOUR],
    });
    this.shake?.(tick, 3, 16);
  }

  /**
   * A Railgun fires: a blue-white flare and a ring at the muzzle, the gun
   * kicking back, sparks shed along the line, a burst where it hits, a jolt.
   */
  private railFx(
    tick: number,
    tower: TowerState,
    muzzle: Point,
    start: Point,
    dirX: number,
    dirY: number,
    at: Point,
  ): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const heading = Math.atan2(dirY, dirX);
    sparks.emit(tick, {
      look: "flare",
      at: muzzle,
      add: true,
      life: 10,
      size0: 80,
      size1: 40,
      rotation: heading,
      colours: [0xffffff, RAIL_PALE, 0x2080ff],
    });
    sparks.emit(tick, {
      look: "glow",
      at: muzzle,
      add: true,
      life: 16,
      size0: 50,
      size1: 90,
      easeOut: true,
      peak: 0.8,
      colours: [0xe8f8ff, 0x40a8ff, 0x0050c0],
    });
    sparks.emit(tick, {
      look: "ring",
      at: { x: muzzle.x, y: muzzle.y + 6 },
      add: true,
      life: 18,
      size0: 14,
      size1: 100,
      squash: 0.5,
      easeOut: true,
      peak: 0.7,
      colours: [0xffffff, 0x60c0ff],
    });
    sparks.emit(tick, {
      look: "burst",
      at,
      add: true,
      life: 12,
      size0: 24,
      size1: 62,
      easeOut: true,
      rotation: blastNoise(tick, 5) * 6.28,
      colours: [0xffffff, RAIL_PALE, 0x1060ff],
    });
    sparks.emit(tick, {
      look: "glow",
      at,
      add: true,
      life: 14,
      size0: 40,
      size1: 80,
      easeOut: true,
      peak: 0.7,
      colours: [0xe8f8ff, 0x40a8ff, 0x0050c0],
    });
    const hits = sparks.many(8);
    for (let index = 0; index < hits; index += 1) {
      const angle = heading + (blastNoise(tick, index + 60) - 0.5) * 2.4;
      const speed = 3 + blastNoise(tick, index + 70) * 4;
      sparks.emit(tick, {
        look: "spark",
        at,
        add: true,
        life: 12 + Math.round(blastNoise(tick, index + 80) * 8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6,
        drag: 0.1,
        size0: 10,
        size1: 3,
        stretch: true,
        colours: [0xffffff, RAIL_PALE, 0x2060ff],
      });
    }
    // Sparks shed along the first stretch of the line, drifting off it.
    const shed = this.look === "full" ? sparks.many(6) : 0;
    for (let index = 0; index < shed; index += 1) {
      const along = 30 + blastNoise(tick, index + 90) * 420;
      const side = blastNoise(tick, index + 100) < 0.5 ? -1 : 1;
      sparks.emit(tick, {
        look: "spark",
        add: true,
        delay: Math.round(along / 120),
        life: 14,
        at: { x: start.x + dirX * along, y: start.y + dirY * along },
        vx: -dirY * side * 1.2 + dirX * 0.6,
        vy: dirX * side * 0.7 + dirY * 0.6,
        drag: 0.06,
        size0: 7,
        size1: 2,
        stretch: true,
        colours: [0xffffff, RAIL_PALE],
      });
    }
    tower.recoil = { tick, dx: -dirX * RECOIL_PX, dy: -dirY * RECOIL_PX };
    this.shake?.(tick, 4, 18);
  }

  /** The Cannon fires: a flash of flame out of the muzzle and a puff of smoke. */
  private cannonFx(tick: number, muzzle: Point, aim: Point): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const heading = Math.atan2(aim.y - muzzle.y, aim.x - muzzle.x);
    const ahead = { x: muzzle.x + Math.cos(heading) * 9, y: muzzle.y + Math.sin(heading) * 9 };
    sparks.emit(tick, {
      look: "muzzle",
      at: ahead,
      add: true,
      life: 7,
      size0: 30,
      size1: 38,
      squash: 0.7,
      rotation: heading,
      colours: FIRE_TINTS,
    });
    sparks.emit(tick, {
      look: "glow",
      at: muzzle,
      add: true,
      life: 8,
      size0: 26,
      size1: 40,
      peak: 0.8,
      colours: FIRE_TINTS,
    });
    const puffs = sparks.many(3);
    for (let index = 0; index < puffs; index += 1) {
      sparks.emit(tick, {
        look: index % 2 === 0 ? "smoke" : "wisp",
        at: ahead,
        delay: 1 + index,
        life: 46 + Math.round(blastNoise(tick, index + 10) * 16),
        vx: Math.cos(heading) * 0.5 + (blastNoise(tick, index + 20) - 0.5) * 0.3,
        vy: Math.sin(heading) * 0.3,
        vz: 0.25 + blastNoise(tick, index + 30) * 0.25,
        drag: 0.03,
        size0: 9,
        size1: 24,
        fadeIn: 3,
        peak: 0.5,
        hold: 0.2,
        rotation: blastNoise(tick, index + 40) * 6.28,
        colours: SMOKE_TINTS,
      });
    }
  }

  /**
   * A cannon ball lands: a burst of fire, a ring of dust over the ground it
   * covers, smoke rolling up, sparks, and a small jolt sized by its splash.
   */
  private cannonHitFx(tick: number, bullet: Bullet): void {
    const sparks = this.sparks;
    if (!sparks) return;
    const at = { x: bullet.x, y: bullet.y };
    const ground = { x: bullet.x, y: bullet.y + BODY_HEIGHT };
    const reach = Math.min(Math.max(bullet.splash, 30) / 2, 40);
    sparks.emit(tick, {
      look: "burst",
      at,
      add: true,
      life: 11,
      size0: reach * 0.8,
      size1: reach * 2,
      easeOut: true,
      rotation: blastNoise(tick, 1) * 6.28,
      colours: FIRE_TINTS,
    });
    sparks.emit(tick, {
      look: "glow",
      at,
      add: true,
      life: 10,
      size0: reach,
      size1: reach * 2.2,
      easeOut: true,
      peak: 0.75,
      colours: FIRE_TINTS,
    });
    sparks.emit(tick, {
      look: "ring",
      at: ground,
      life: 16,
      size0: reach * 0.5,
      size1: reach * 2.6,
      squash: 0.5,
      easeOut: true,
      peak: 0.45,
      colours: [0xe8d8b8, 0xa89878],
    });
    const puffs = sparks.many(4);
    for (let index = 0; index < puffs; index += 1) {
      const angle = (index / puffs) * Math.PI * 2 + blastNoise(tick, index + 10);
      sparks.emit(tick, {
        look: index % 2 === 0 ? "smoke" : "wisp",
        delay: 2 + (index % 3),
        at: { x: at.x + Math.cos(angle) * reach * 0.3, y: at.y + Math.sin(angle) * reach * 0.15 },
        life: 44 + Math.round(blastNoise(tick, index + 20) * 18),
        vx: Math.cos(angle) * 0.5,
        vy: Math.sin(angle) * 0.25,
        vz: 0.3 + blastNoise(tick, index + 30) * 0.3,
        drag: 0.04,
        size0: reach * 0.5,
        size1: reach * 1.2,
        fadeIn: 4,
        peak: 0.6,
        hold: 0.25,
        rotation: blastNoise(tick, index + 40) * 6.28,
        colours: [0x4a423c, 0x6a6460, 0x8a8682],
      });
    }
    const count = sparks.many(7);
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + blastNoise(tick, index + 50)) / count) * Math.PI * 2;
      const speed = 2.5 + blastNoise(tick, index + 60) * 3;
      sparks.emit(tick, {
        look: "spark",
        at,
        add: true,
        life: 12 + Math.round(blastNoise(tick, index + 70) * 8),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        vz: 1.5,
        gravity: 0.18,
        drag: 0.08,
        size0: 8,
        size1: 3,
        stretch: true,
        colours: [0xffffff, 0xffd060, 0xff6010],
      });
    }
    if (bullet.splash > 0) this.shake?.(tick, 1.5 + bullet.splash / 50, 12);
  }
}
