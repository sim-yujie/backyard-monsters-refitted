import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Renderer,
  type TextureSource,
} from "pixi.js";
import {
  BOMBS,
  TICKS_PER_SECOND,
  battleDefence,
  isSpurtzCannon,
  parseDefenderForces,
  type BattleVisualEvent,
  type CreepSnapshot,
} from "@/game/combat/rules";
import { damageStep } from "@/game/yard/YardBuildings";
import { depthKey, type Point } from "@/game/yard/YardGrid";
import type { Yard } from "@/game/yard/yardModel";
import type { AttackSession } from "./AttackSession";
import { BombFx, type BombArt } from "./bombFx";
import { bombCandidatesOf, bombHits, type BombCandidate } from "./bombTargets";
import { BuildingBars } from "./buildingBars";
import {
  BUILDING_NUMBER_LIFT,
  CreepFx,
  HURT_TICKS,
  drawsProjectile,
  lungeOffset,
} from "./creepFx";
import { MONSTER_SPRITES, type MonsterAnimation, type MonsterSheet } from "./monsterSpriteData";
import { ShotLedger, type Released, type WoundLike } from "./shotLedger";
import { BODY_HEIGHT, TowerFx, towersOf } from "./towerFx";
import { TrapReveal } from "./trapReveal";
import {
  anchorOffset,
  championFlightTop,
  flyerAltitude,
  frameRect,
  frameRow,
  hoverOffset,
  shadowOffset,
  sheetColumn,
  sheetUrl,
  spriteFor,
} from "./monsterSprites";

/**
 * Everything that moves during a battle (`docs/design/attack-flow.md` §F5, §6
 * WP5): the creeps and the champion drawn from the original sprite sheets, a
 * health bar over each, the shared death splat, the towers' shots, and the
 * enemy buildings darkening and falling to ruin as their health goes.
 *
 * The layer never simulates anything. Once a frame it reads the engine's
 * {@link CreepSnapshot} list and its recent shots and deaths
 * (`engine.ts` `creeps()`, `recentEvents()`) and moves sprites to match; the
 * yard itself stays `YardRenderer`'s, which this asks for two things — the
 * depth-sorted building container to put creeps into, and a per-building
 * damage fraction to draw.
 *
 * ## Depth
 *
 * Buildings sort by `depthKey` of their footprint's centre, times eight
 * (`YardBuildings.resortByDepth`). Creep bodies go into the same container with
 * a key from their own ground point, so a creep behind a building draws behind
 * it and one in front draws over it. The key is nudged `CREEP_MIDDLE` px down
 * the screen first, as Flash's is. A creep at a building's top corner, where
 * the pathing grid puts a melee attacker coming from the north, is half a
 * footprint behind its centre and so draws behind it (#270).
 * A flyer's key adds its altitude, as Flash's depth does (`MonsterBase.as:726`),
 * so a body hovering over a wall block sorts in front of it; its shadow lies in
 * the yard's shadow layer under every building (`MAP.DEPTH_SHADOW`). Both only
 * apply to creeps the engine flags as flying (issues #58, #78).
 * Health bars, shots and splats live in the scene's own overlay above every
 * building — a bar is a readout, not a thing in the yard.
 *
 * ## Motion
 *
 * Classic creeps have one pose per heading, so they glide as Flash drew them,
 * with a two-pixel hop while walking so a marching line does not read as a
 * slide. Flyers hover with the sine bob from `CreepBase.as:262-264` (a flying
 * champion at its own fixed height, `ChampionBase.as:1317-1322`) and cast
 * the shadow sheet. Champions and the later creeps play their walk and attack
 * rows at eight ticks a frame (`SPRITES.as:235`). Every clock here is the
 * battle tick, so 2x speed doubles all of it and nothing runs on wall time.
 * Under `prefers-reduced-motion` there is no hop, no bob and no gibs; a death
 * is still a fading splat.
 *
 * ## Bullets land before they hurt
 *
 * The engine takes a tower's damage off on the tick it fires; Flash took it
 * off when the bullet arrived (#77). A {@link ShotLedger} holds each bullet's
 * wounds until `TowerFx` says it landed, and the health bar, the red number,
 * the hurt tint and — for a wound that killed — the splat all wait for it. A
 * creep the engine has already removed stays on screen where it was last
 * seen, as a ghost, until then. A ranged creep's shot at a building holds the
 * building's damage the same way until the fireball lands.
 *
 * ## Bombs rain down
 *
 * A resource bomb is one event to the engine, applied whole on the tick it is
 * fired. On screen it is a rain of particles over a few seconds, as Flash drew
 * it ({@link BombFx}, #87): the layer asks which buildings the bomb hit — the
 * engine's own reach test, through `bombTargets` — holds back what each lost,
 * and lets a share of it go with every particle that lands, so the bars, the
 * darkening, the smoke and the numbers follow the rain. So does the HUD's
 * damage readout ({@link shownDamage}, #148). When a bomb ends the attack the
 * battle clock stops, but the rain does not: it carries on falling on the
 * wall clock, and {@link settling} holds the end panel back until it is down.
 *
 * ## Textures
 *
 * Each sheet is fetched once through `Assets` and cells are cut as
 * sub-textures over the one upload, cached per `(sheet, column, row)`. A sheet
 * wider or taller than the GPU's texture limit — `korath_5/6` on a 4096 device
 * (`docs/art/monster-sprites.md` §3.7) — is never uploaded whole: its cells are
 * copied one at a time through a canvas into small textures of their own.
 */

/* ── Pure layout ────────────────────────────────────────────────────────── */

/**
 * World px a creep's depth key is nudged down the screen: Flash's `_middle`
 * for a creep (`CreepBase.as:62`), added to its y for the depth
 * (`MonsterBase.as:720-726`). It used to be 20 px *up*, standing in for half a
 * footprint while buildings were keyed by their top corner (#270).
 */
export const CREEP_MIDDLE = 5;

/**
 * Where a creep's `zIndex` sits inside a building's block of eight keys:
 * above the building (`+0`) and its animation layers (`+1`..`+3`).
 */
const CREEP_Z_OFFSET = 4;

/** Ticks a death splat takes to fade: 400 ms at 1x. */
export const SPLAT_TICKS = 32;

/** The walking hop of a single-pose creep, in px, and its period in ticks. */
const HOP_HEIGHT = 2;
const HOP_PERIOD_TICKS = 12;

/**
 * Ticks a creep keeps its walk cycle after its last step, so a tick on which
 * the engine did not move it — arriving at a waypoint, a frame at 144 Hz that
 * saw no tick at all — does not drop it to its standing pose for one frame.
 */
export const STILL_LATCH_TICKS = 3;

/** The tint a creep's body shows for `HURT_TICKS` after it is hit. */
export const HURT_TINT = 0xff7070;

/** Health bar sizes: creeps and the champion. */
const BAR = { width: 18, height: 3, gap: 5 } as const;
const CHAMPION_BAR = { width: 40, height: 5, gap: 8 } as const;

/** The GPU texture limit assumed until the renderer says otherwise. */
export const DEFAULT_MAX_TEXTURE_SIZE = 4096;

/** How a creep should be drawn this frame, with no Pixi in it. */
export interface CreepLayout {
  readonly sheet: MonsterSheet;
  readonly column: number;
  readonly row: number;
  readonly animation: MonsterAnimation;
  /** Texture cache key: `sheet:column:row`. */
  readonly key: string;
  /** World px of the cell's top-left. */
  readonly x: number;
  readonly y: number;
  readonly zIndex: number;
  /** World px of the ground point. */
  readonly groundX: number;
  readonly groundY: number;
  /** World px of the shadow cell's top-left, for a flyer; null otherwise. */
  readonly shadow: Point | null;
}

/** What the layer knows about a creep beyond its snapshot. */
export interface CreepPose {
  /** Screen-space heading, radians, y down; 0 faces right. */
  readonly heading: number;
  /** Whether the creep moved since the last frame. */
  readonly moving: boolean;
  /** Ticks since the creep appeared: the animation clock. */
  readonly age: number;
}

export interface LayoutOptions {
  readonly reducedMotion: boolean;
}

/**
 * Isometric yard units to world px, without the floor `toIso` applies.
 *
 * Buildings are placed at floored positions because the save round-trips
 * through `GRID.as`; a creep is drawn wherever the engine has it, so its
 * motion is smooth rather than stepping a pixel at a time.
 */
export const groundWorld = (ix: number, iy: number, origin: Point): Point => ({
  x: ix - iy + origin.x,
  y: (ix + iy) / 2 + origin.y,
});

/**
 * The colour a champion's ability leaves on a creep's body (issue #222), in
 * place of Flash's glow filters: Korath's flame orange, Fomor's enrage the
 * pink of `Enrage`'s `GlowFilter(16724735)`, Krallen's loot aura the green of
 * `LootingMultiplier`'s `GlowFilter(5635873)`. White when none touches it.
 * Drawing only; nothing here reaches the battle.
 */
export const abilityTint = (creep: CreepSnapshot | null): number => {
  if (!creep) return 0xffffff;
  if (creep.burning) return 0xffb070;
  if (creep.enraged) return 0xff9cff;
  if (creep.lootBoosted) return 0xa8ff80;
  return 0xffffff;
};

/** Screen-space heading from one point to another, or null when they coincide. */
export const headingBetween = (from: Point, to: Point): number | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
};

/**
 * Which row cycle a creep shows: attacking, walking, or standing.
 *
 * A flyer never stands: it is in the air, and the only flyer sheets with a
 * standing row are Fomor's (`fly_3` to `fly_6`), whose row 0 has the wings
 * folded, for the ground. Flash shows that row only to a champion standing in
 * its pen and plays the walking cycle, the wing beat, in every other state
 * (`ChampionBase.getNextSprite`, `ChampionBase.as:1537-1549`), so a Fomor
 * waiting in the air keeps flapping (#206).
 */
export const animationFor = (creep: CreepSnapshot, moving: boolean): MonsterAnimation => {
  if (creep.state === "attacking") return "attack";
  return moving || creep.flying ? "walk" : "idle";
};

/** True when a sheet has no walk cycle to play: one pose per heading. */
const singlePose = (sheet: MonsterSheet): boolean => (sheet.animations.walk?.count ?? 1) <= 1;

/** The depth-sort key for a creep at a world ground point. */
export const creepZIndex = (groundX: number, groundY: number, id: number): number =>
  depthKey(groundX, groundY + CREEP_MIDDLE, id) * 8 + CREEP_Z_OFFSET;

/**
 * Where and how to draw a creep this frame.
 *
 * `origin` is the yard's `bounds.originX/Y`, what turns isometric px into
 * world px. The result is arithmetic on the sprite table and can be tested
 * without a renderer.
 */
export const layoutCreep = (
  creep: CreepSnapshot,
  sheet: MonsterSheet,
  pose: CreepPose,
  origin: Point,
  options: LayoutOptions,
): CreepLayout => {
  const ground = groundWorld(creep.ix, creep.iy, origin);
  const column = sheetColumn(sheet, pose.heading);
  const animation = animationFor(creep, pose.moving);
  const row = frameRow(sheet, animation, pose.age);
  const anchor = anchorOffset(sheet);

  let y = ground.y + anchor.y;
  let altitude = 0;
  if (creep.flying && creep.champion) {
    altitude = flyerAltitude(creep.monsterId);
    // A flying champion's cell goes to Flash's fixed height with its bob,
    // whatever its level's offset (#206).
    y = ground.y + championFlightTop(options.reducedMotion ? 0 : pose.age);
  } else if (creep.flying) {
    altitude = flyerAltitude(creep.monsterId);
    y += options.reducedMotion ? -altitude : hoverOffset(pose.age, altitude);
  } else if (pose.moving && !options.reducedMotion && singlePose(sheet)) {
    y -= Math.abs(Math.sin((pose.age / HOP_PERIOD_TICKS) * Math.PI)) * HOP_HEIGHT;
  }

  const shadowAt = creep.flying ? shadowOffset(sheet) : null;

  return {
    sheet,
    column,
    row,
    animation,
    key: `${sheet.key}:${column}:${row}`,
    x: ground.x + anchor.x,
    y,
    // A flyer sorts as if it stood its altitude further down the screen
    // (`MonsterBase.as:726` adds `_altitude` to the depth), so its body is not
    // hidden behind a building whose centre is just below its ground point.
    zIndex: creepZIndex(ground.x, ground.y + altitude, creep.id),
    groundX: ground.x,
    groundY: ground.y,
    shadow: shadowAt ? { x: ground.x + shadowAt.x, y: ground.y + shadowAt.y } : null,
  };
};

/* ── Sheet textures ─────────────────────────────────────────────────────── */

/** Fetches one sheet; `Assets.load` in the client, something else in a test. */
export type SheetLoader = (url: string) => Promise<Texture>;

/**
 * The cells of the monster sheets as textures, cut once and shared.
 *
 * Mirrors `YardTextures`: `frame` never blocks and never throws; it starts the
 * fetch on the first ask, returns null until the sheet is in, and remembers a
 * failure so a missing file is asked for once. Cells of a sheet within the
 * texture limit are `Texture`s framed over the one source. Cells of a sheet
 * over the limit are copied through a canvas into their own small source, so
 * the oversized image is never bound to the GPU.
 */
export class MonsterSheetTextures {
  private readonly sources = new Map<string, Texture>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly cells = new Map<string, Texture>();
  /** Cells that own their source (canvas copies) and must be destroyed fully. */
  private readonly owned = new Set<Texture>();
  private limit: number;

  constructor(
    private readonly load: SheetLoader = (url) => Assets.load<Texture>(url),
    maxTextureSize = DEFAULT_MAX_TEXTURE_SIZE,
  ) {
    this.limit = maxTextureSize;
  }

  /** The GPU's texture limit, once the renderer has said what it is. */
  setMaxTextureSize(size: number): void {
    if (Number.isFinite(size) && size > 0) this.limit = size;
  }

  get maxTextureSize(): number {
    return this.limit;
  }

  /** Whether a sheet needs cutting through a canvas rather than framing. */
  oversized(sheet: MonsterSheet): boolean {
    return sheet.width > this.limit || sheet.height > this.limit;
  }

  /** Starts fetching a sheet, so its first cell is ready sooner. */
  preload(sheet: MonsterSheet): void {
    this.source(sheet);
  }

  /** The texture for cell `(column, row)`, or null until the sheet is in. */
  frame(sheet: MonsterSheet, column: number, row: number): Texture | null {
    const key = `${sheet.key}:${column}:${row}`;
    const cached = this.cells.get(key);
    if (cached) return cached;

    const source = this.source(sheet);
    if (!source) return null;
    const rect = frameRect(sheet, column, row);

    let cell: Texture | null;
    if (this.oversized(sheet)) {
      cell = copyCell(source.source, rect);
      if (!cell) return null;
      this.owned.add(cell);
    } else {
      cell = new Texture({
        source: source.source,
        frame: new Rectangle(rect.x, rect.y, rect.width, rect.height),
      });
    }
    this.cells.set(key, cell);
    return cell;
  }

  /** True once this sheet is known not to be coming. */
  isMissing(sheet: MonsterSheet): boolean {
    return this.failed.has(sheet.key);
  }

  destroy(): void {
    for (const cell of this.cells.values()) cell.destroy(this.owned.has(cell));
    this.cells.clear();
    this.owned.clear();
    this.sources.clear();
    this.pending.clear();
    this.failed.clear();
  }

  private source(sheet: MonsterSheet): Texture | null {
    const ready = this.sources.get(sheet.key);
    if (ready) return ready;
    if (this.failed.has(sheet.key) || this.pending.has(sheet.key)) return null;
    this.pending.add(sheet.key);
    this.load(sheetUrl(sheet))
      .then((texture) => {
        this.sources.set(sheet.key, texture);
      })
      .catch((caught: unknown) => {
        console.warn(`Monster sheet ${sheet.file} did not load; drawing a marker.`, caught);
        this.failed.add(sheet.key);
      })
      .finally(() => {
        this.pending.delete(sheet.key);
      });
    return null;
  }
}

/**
 * One cell of an oversized sheet, copied through a canvas into a texture of
 * its own. Null where there is no canvas to draw with, or nothing drawable
 * behind the source, in which case the caller shows its marker instead.
 */
const copyCell = (
  source: TextureSource,
  rect: { x: number; y: number; width: number; height: number },
): Texture | null => {
  if (typeof document === "undefined") return null;
  const image = (source as { resource?: unknown }).resource;
  if (!image || typeof image !== "object") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rect.width);
  canvas.height = Math.ceil(rect.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(
      image as CanvasImageSource,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height,
    );
  } catch {
    return null;
  }
  return Texture.from(canvas);
};

/** The GPU texture limit a Pixi renderer reports, or null when it does not say. */
export const gpuTextureLimit = (renderer: Renderer): number | null => {
  const gl = (renderer as { gl?: WebGLRenderingContext }).gl;
  if (gl && typeof gl.getParameter === "function") {
    const size: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof size === "number" && size > 0) return size;
  }
  const device = (renderer as { device?: { limits?: { maxTextureDimension2D?: unknown } } })
    .device;
  const size = device?.limits?.maxTextureDimension2D;
  return typeof size === "number" && size > 0 ? size : null;
};

/* ── The layer ──────────────────────────────────────────────────────────── */

/** What the layer needs from the yard renderer; `YardRenderer` provides it. */
export interface BattleYardHost {
  /** The depth-sorted building container creep bodies go into. */
  depthSortedLayer(): Container;
  /**
   * The container the buildings' own shadows are drawn in, beneath every
   * building. A flyer's shadow goes there too, as Flash puts it at
   * `MAP.DEPTH_SHADOW` (`CreepBase.as:140`). A host without one gets the
   * shadow in the depth container, just under the flyer's body.
   */
  groundShadowLayer?(): Container;
  /** The middle of a building's footprint in world px, or null. */
  centreOf(id: number): Point | null;
  /** Draws a building as battered as `fraction` of its health says. */
  setBuildingDamage(id: number, fraction: number): void;
  /** Hides a building from the viewer, or shows it again: a trap until it fires. */
  setConcealed(id: number, concealed: boolean): void;
  /** Puts one of a building's animation layers on a cell: a tower's facing. */
  setAnimFrame(id: number, layer: number, frame: number): void;
  /** Switches a building's hit flash on or off (#63); a host without one shows no flash. */
  flashBuilding?(id: number, on: boolean): void;
  /** The camera's zoom, so damage numbers keep their size on screen (#68); 1 when absent. */
  readonly zoom?: number;
}

export interface AttackBattleLayerOptions {
  readonly session: AttackSession;
  readonly yard: Yard;
  readonly host: BattleYardHost;
  /** The scene's world-space overlay above the buildings (`mounts.battleLayer`). */
  readonly overlay: Container;
  readonly reducedMotion?: boolean;
  readonly textures?: MonsterSheetTextures;
  /** The bomb sheets; a test hands in its own (#87). */
  readonly bombArt?: BombArt;
  /** The bomb rain's randomness; `Math.random` unless a test fixes it. */
  readonly random?: () => number;
  /** Wall-clock milliseconds, for the rain after the end; `performance.now` unless a test fixes it. */
  readonly now?: () => number;
}

interface CreepView {
  id: number;
  monsterId: string;
  sheet: MonsterSheet | null;
  body: Sprite;
  shadow: Sprite | null;
  barBack: Sprite;
  barFront: Sprite;
  /** The ground point at the last tick that was looked at, for the heading. */
  lastX: number;
  lastY: number;
  /** The tick `lastX/lastY` were read on; a frame with no new tick changes nothing. */
  lastTick: number;
  heading: number;
  /** Whether the walk cycle is playing; latched `STILL_LATCH_TICKS` past the last step. */
  moving: boolean;
  /** The first tick the creep was seen standing still, or -1 while it walks. */
  stillSince: number;
  /** The building the creep was last seen attacking, for the facing. */
  facedBuilding: number;
  bornTick: number;
  cellKey: string;
  /** The tick of the last melee hit and the unit vector it lunged along (#63). */
  lungeTick: number;
  lungeX: number;
  lungeY: number;
  /** The tick the creep was last hurt, for the red tint (#68). */
  hurtTick: number;
  /** Health at the last tick looked at: a rise is healing, shown green (#68). */
  lastHp: number;
  /** World y of the top of the body as last drawn, for the numbers over it. */
  top: number;
  /** The engine's last word on the creep: what a ghost is drawn from (#77). */
  snapshot: CreepSnapshot | null;
  /** The body's tint when it is not hurt: white, or a marker's colour. */
  baseTint: number;
}

type DeathEvent = Extract<BattleVisualEvent, { kind: "death" }>;

/** A trap going off: a ring that grows and fades over a scorch that stays. */
interface Burst {
  readonly tick: number;
  readonly at: Point;
  readonly ring: Graphics;
}

interface Splat {
  readonly tick: number;
  readonly at: Point;
  readonly radius: number;
  readonly disc: Graphics;
  readonly gibs: Gib[];
}

interface Gib {
  readonly sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** A creep with no sheet, or whose sheet has not arrived: a marker this big. */
const MARKER_SIZE = 8;

const SPLAT_COLOUR = 0x5da832;
/** `G4QuakeGraphic`'s line colour, 15893760 (`champions/Korath.as:233`). */
const QUAKE_COLOUR = 0xf28500;
const GIB_COLOURS = [0x5da832, 0x3f7a1e, 0x8ad14a] as const;
const BAR_BACK_COLOUR = 0x6b1616;
const BAR_FRONT_COLOUR = 0x5ee06a;
const BAR_CHAMPION_COLOUR = 0xffd24a;
/** The defender's side (issue #195): a bunker's monsters and the caged champion. */
const BAR_DEFENDER_COLOUR = 0x4f9dff;
const BAR_DEFENDER_CHAMPION_COLOUR = 0x9fd4ff;

/**
 * The colour a creep's health bar, and its marker before its sheet arrives,
 * are drawn in: green for the attacker's monsters and gold for its champion,
 * blue for the defender's side (issue #195), paler for the defender's
 * champion, so the player can tell who is fighting whom.
 */
export const creepColour = (creep: Pick<CreepSnapshot, "champion" | "friendly">): number => {
  if (creep.friendly) return creep.champion ? BAR_DEFENDER_CHAMPION_COLOUR : BAR_DEFENDER_COLOUR;
  return creep.champion ? BAR_CHAMPION_COLOUR : BAR_FRONT_COLOUR;
};

/** Ticks between the numbers a bomb's rain floats over a building: a quarter-second at 1x. */
const BOMB_NUMBER_TICKS = 20;

/** Ticks a trap's blast ring takes to fade. */
export const BURST_TICKS = 14;
const SCORCH_COLOUR = 0x1c1410;

/** Whether the viewer asked for less motion. */
export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class AttackBattleLayer {
  private readonly session: AttackSession;
  private readonly yard: Yard;
  private readonly host: BattleYardHost;
  private readonly overlay: Container;
  private readonly origin: Point;
  private readonly reducedMotion: boolean;
  readonly textures: MonsterSheetTextures;

  /** Creep bodies, inside the renderer's sorted container. */
  private readonly depth: Container;
  /** Flyer shadows: the yard's shadow layer, or `depth` when the host has none. */
  private readonly shadows: Container;
  /** In the overlay, in this order. */
  private readonly effects = new Container();
  private readonly fire = new Graphics();
  private readonly bars = new Container();

  private readonly views = new Map<number, CreepView>();
  private readonly pool: CreepView[] = [];
  private readonly splats: Splat[] = [];
  private readonly gibPool: Sprite[] = [];
  private readonly damageApplied = new Map<number, number>();
  private readonly maxHpById = new Map<number, number>();

  /* Buildings: the towers' guns and shots, the bars, the traps (#64, #66, #67). */
  private readonly towerFx: TowerFx;
  private readonly buildingBars: BuildingBars;
  private readonly traps = new TrapReveal();
  private readonly bursts: Burst[] = [];
  private readonly scorches: Graphics[] = [];
  /** Tower wounds and deaths waiting for their bullet to land (#77). */
  private readonly ledger = new ShotLedger<DeathEvent>();
  /** Building health a ranged creep's projectile has taken but not yet landed. */
  private readonly heldBuildingHp = new Map<number, number>();

  /* Resource bombs (#87): the rain, and the health its particles still carry. */
  private readonly bombFx: BombFx;
  /** Falling particles, above the buildings and the bars, under the shots; made on the first bomb. */
  private air: Container | null = null;
  /** Landed debris, on the ground under the buildings; made on the first bomb. */
  private debris: Container | null = null;
  /** Building health bombs have taken that no particle has brought down yet. */
  private readonly heldBombHp = new Map<number, number>();
  /** Per bomb, keyed by its place in the fling log: particles to land, health owed per building. */
  private readonly rains = new Map<number, { left: number; owed: Map<number, number> }>();
  /** Health landed particles took off each building since the last number. */
  private readonly bombNumbers = new Map<number, number>();
  private lastBombNumber = 0;
  private bombCandidates: BombCandidate[] | null = null;
  /** Fling-log events already looked at for bombs. */
  private eventsSeen = 0;
  /** The engine's health and ruins at the last pass, before any bomb since. */
  private lastHealth: Readonly<Record<string, number>> = {};
  private lastDestroyed: readonly number[] = [];

  /** Projectiles, smoke and damage numbers (#63, #68); its root sits last in the overlay. */
  private readonly fx: CreepFx;
  /** The damage step each building was last seen at, for the smoke on a crossing. */
  private readonly smokeStep = new Map<number, number>();
  private smokePrimed = false;

  private lastEventTick = 0;
  /** The tick and wall-clock time the layer first saw the attack over, for the rain after it (#148). */
  private endedAt: { tick: number; ms: number } | null = null;
  private readonly now: () => number;
  private damageDirty = true;
  private limitRead = false;
  private readonly unsubscribe: () => void;
  private destroyed = false;
  /** Put to rest by {@link settle}: no creeps, no guns, only what plays out. */
  private settled = false;

  constructor(options: AttackBattleLayerOptions) {
    this.session = options.session;
    this.yard = options.yard;
    this.host = options.host;
    this.overlay = options.overlay;
    this.origin = { x: options.yard.bounds.originX, y: options.yard.bounds.originY };
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    this.textures = options.textures ?? new MonsterSheetTextures();
    this.now = options.now ?? (() => performance.now());

    for (const building of options.yard.buildings) {
      if (building.maxHp !== null && building.maxHp > 0) {
        this.maxHpById.set(building.id, building.maxHp);
      }
    }

    this.depth = this.host.depthSortedLayer();
    this.shadows = this.host.groundShadowLayer?.() ?? this.depth;
    for (const layer of [this.effects, this.fire, this.bars]) layer.eventMode = "none";
    // Our own children only: the drop ring and anything else already in the
    // overlay stays where it is.
    this.overlay.addChild(this.effects, this.fire, this.bars);
    this.bombFx = new BombFx(
      {
        air: () => this.airLayer(),
        ground: () => this.debrisLayer(),
        landed: (key) => this.onBombParticle(key),
      },
      {
        reducedMotion: this.reducedMotion,
        ...(options.bombArt ? { art: options.bombArt } : {}),
        ...(options.random ? { random: options.random } : {}),
      },
    );
    this.fx = new CreepFx(
      {
        creepAnchor: (id) => this.creepAnchor(id),
        flashBuilding: (id, on) => this.host.flashBuilding?.(id, on),
        zoom: () => this.host.zoom ?? 1,
        landed: (id, amount) => this.onFireballLanded(id, amount),
      },
      this.reducedMotion,
    );
    this.overlay.addChild(this.fx.root);

    // The building side (issues #64, #66, #67). The towers draw into the same
    // `fire` graphics the tracers used; the building bars go under the splats,
    // where the Flash overlay put them, below the projectiles.
    this.towerFx = new TowerFx(
      this.fire,
      towersOf(options.yard),
      {
        setAnimFrame: (id, layer, frame) => this.host.setAnimFrame(id, layer, frame),
        landed: (key, tick) => this.showReleased(this.ledger.land(key), tick),
      },
      this.origin,
    );
    const originOf = new Map<number, Point>();
    for (const building of options.yard.buildings) {
      originOf.set(building.id, { x: building.worldX, y: building.worldY });
    }
    this.buildingBars = new BuildingBars(
      // No bar over a building the viewer cannot see: `centreOf` is null for
      // a concealed trap, whatever its saved health.
      (id) => (this.host.centreOf(id) ? (originOf.get(id) ?? null) : null),
      (id) => this.maxHpById.get(id),
    );
    this.effects.addChild(this.buildingBars.root);

    // Once a frame, inside the render the scene already drives, after the
    // scene's own `session.advance`. The renderer comes with the call.
    this.effects.onRender = (renderer) => this.onRender(renderer);

    this.unsubscribe = this.session.subscribe(() => {
      this.damageDirty = true;
    });

    this.preloadRoster();
  }

  /**
   * Moves everything to match the battle right now. Called by the render
   * hook; public so a test, or a scene without a renderer, can drive it.
   */
  update(): void {
    if (this.destroyed) return;
    const battle = this.session.battle();
    if (!battle) return;
    const tick = battle.tick;
    // The effects' clock: the battle's, and after the end the wall's.
    const shown = this.shownTick(tick);

    if (!this.settled) {
      // Creeps the engine still has first, then this frame's events, and only
      // then the ones it dropped: a creep a held bullet killed must still have
      // its view when its death is read, to stay on screen until the bullet lands.
      const seen = this.syncCreeps(battle.creeps(), tick);
      for (const event of battle.recentEvents(this.lastEventTick)) this.onEvent(event);
      this.lastEventTick = tick;
      this.settleGone(seen, tick);

      this.towerFx.update(tick, (id) => this.views.get(id)?.snapshot ?? undefined);
      this.showReleased(this.ledger.expire(tick), tick);
      this.paintCreeps(tick);
    }
    // Once put to rest, what is left — splats, trap rings — fades out on the wall clock.
    this.drawSplats(this.settled ? shown : tick);
    this.drawBursts(this.settled ? shown : tick);
    this.fx.update(shown);
    this.bombFx.update(shown);
    this.showBombNumbers(shown);

    if (this.damageDirty) {
      this.damageDirty = false;
      const state = battle.state();
      // Before the health is shown, so a new bomb's damage is held from its first frame.
      this.noticeBombs(state.health, shown);
      this.lastHealth = state.health;
      this.lastDestroyed = state.destroyedIds;
      this.revealTraps(state.firedTraps, tick);
      const health = this.shownHealth(state.health);
      this.syncDamage(health);
      this.syncSmoke(health, shown);
      this.buildingBars.sync(health);
    }
  }

  /**
   * The tick the effects are drawn at. While the attack runs it is the
   * battle's own; once it has ended the battle clock stands still, and the
   * effects — a bomb's rain above all — go on at the speed the attack ran at
   * on the wall clock, so a winning bomb is seen to land (#148).
   */
  private shownTick(tick: number): number {
    const state = this.session.state();
    if (state.phase !== "ended") {
      this.endedAt = null;
      return tick;
    }
    const now = this.now();
    this.endedAt ??= { tick, ms: now };
    const since = Math.max(0, now - this.endedAt.ms) / 1000;
    return this.endedAt.tick + Math.floor(since * TICKS_PER_SECOND * state.speed);
  }

  /**
   * Puts an ended battle to rest (#308). The engine stops on the tick the
   * battle ended, so its last frame — a champion mid-step, a laser mid-sweep,
   * a bullet in the air — would stand on screen behind the Baiter's report as
   * if the game had hung. Every creep goes, every gun stands down, shots in
   * the air go, and each building shows the engine's own health; splats,
   * smoke and numbers already made play out on the wall clock. Only the
   * Baiter's report asks for this (through `AttackPresentation.settle`): a
   * real attack's end screen is unchanged.
   */
  settle(): void {
    if (this.destroyed || this.settled) return;
    this.settled = true;
    for (const view of this.views.values()) this.release(view);
    this.views.clear();
    this.ledger.clear();
    this.heldBuildingHp.clear();
    this.towerFx.standDown();
    this.fx.dropProjectiles();
    this.damageDirty = true;
  }

  /** Whether {@link settle} has put the battle to rest. */
  get isSettled(): boolean {
    return this.settled;
  }

  /**
   * Whether a bomb is still coming down, or has been fired and not yet drawn:
   * the end panel waits while this is true (#148).
   */
  get settling(): boolean {
    if (this.destroyed) return false;
    if (this.bombFx.airborne > 0) return true;
    const events = this.session.flingLog().events;
    for (let index = this.eventsSeen; index < events.length; index += 1) {
      if (events[index]?.kind === "bomb") return true;
    }
    return false;
  }

  /**
   * The damage percentage the screen shows for the battle as it stands: the
   * engine's health with what the bombs' particles and the creeps' fireballs
   * have not brought down yet put back (#148). Never above the engine's.
   */
  shownDamage(): number {
    const battle = this.session.battle();
    if (this.destroyed || !battle) return 0;
    const state = battle.state();
    // A bomb fired since the last frame is held back now, not a frame late:
    // the scene reads this the moment the session says the bomb went in.
    if (this.eventsSeen < this.session.flingLog().events.length) {
      this.noticeBombs(state.health, this.shownTick(battle.tick));
      this.lastHealth = state.health;
      this.lastDestroyed = state.destroyedIds;
    }
    return this.session.damageFor(this.shownHealth(state.health), state.firedTraps);
  }

  /** How many creeps have a sprite right now. */
  get creepCount(): number {
    return this.views.size;
  }

  /** The projectiles, smoke and damage numbers, for a test or the dev hook to read. */
  get creepEffects(): CreepFx {
    return this.fx;
  }

  /** The towers' guns and bullets, for a test or the dev hook to read. */
  get towerEffects(): TowerFx {
    return this.towerFx;
  }

  /** The health bar a creep shows right now, 0 to 1, or null with no sprite. */
  shownHealthOf(id: number): number | null {
    const view = this.views.get(id);
    return view ? this.shownFraction(view) : null;
  }

  /** Tower shots whose wounds still wait for their bullets (#77). */
  get heldShots(): number {
    return this.ledger.heldShots;
  }

  /** The bomb rain, for a test or the dev hook to read (#87). */
  get bombEffects(): BombFx {
    return this.bombFx;
  }

  /** Building health bombs have taken that the screen does not show yet. */
  heldBombDamage(id: number): number {
    return this.heldBombHp.get(id) ?? 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.effects.onRender = null;

    for (const view of [...this.views.values(), ...this.pool]) this.dispose(view);
    this.views.clear();
    this.pool.length = 0;

    for (const splat of this.splats) {
      splat.disc.destroy();
      for (const gib of splat.gibs) gib.sprite.destroy();
    }
    this.splats.length = 0;
    for (const sprite of this.gibPool) sprite.destroy();
    this.gibPool.length = 0;

    this.towerFx.destroy();
    this.buildingBars.destroy();
    for (const burst of this.bursts) burst.ring.destroy();
    this.bursts.length = 0;
    for (const scorch of this.scorches) scorch.destroy();
    this.scorches.length = 0;
    this.ledger.clear();
    this.heldBuildingHp.clear();
    this.fx.destroy();
    this.bombFx.destroy();
    this.heldBombHp.clear();
    this.rains.clear();
    this.bombNumbers.clear();
    for (const layer of [this.air, this.debris]) {
      layer?.parent?.removeChild(layer);
      layer?.destroy({ children: true });
    }

    // Only what this added: the overlay and the sorted container are the
    // scene's and the renderer's, and keep their other children.
    for (const layer of [this.effects, this.fire, this.bars]) {
      this.overlay.removeChild(layer);
      layer.destroy({ children: true });
    }
    this.textures.destroy();
  }

  /* ── Frame ──────────────────────────────────────────────────────────── */

  private onRender(renderer: Renderer): void {
    if (!this.limitRead) {
      this.limitRead = true;
      const limit = gpuTextureLimit(renderer);
      if (limit !== null) this.textures.setMaxTextureSize(limit);
    }
    this.update();
  }

  /** Starts the sheets the attacker could send, so the first drop is not blank. */
  private preloadRoster(): void {
    const roster = this.session.target.roster;
    for (const id of Object.keys(roster.monsters)) {
      const sheet = spriteFor(id, roster.levels[id] ?? 1);
      if (sheet) this.textures.preload(sheet);
    }
    for (const champion of roster.champions) {
      const sheet = spriteFor(`G${champion.t}`, champion.l);
      if (sheet) this.textures.preload(sheet);
    }
    // And the defence's, so a bunker's monsters and the caged champions come
    // out drawn rather than as markers while their sheets arrive (#195, #310).
    const defence = parseDefenderForces(this.session.attackLoad()?.defenderforces);
    // The Spurtz a Spurtz Cannon hatches (issue #313), at the level the
    // battle gives it.
    if (this.yard.buildings.some((building) => isSpurtzCannon(building.type))) {
      const sheet = spriteFor("IC1", battleDefence(defence).defenderLevels?.IC1 ?? 1);
      if (sheet) this.textures.preload(sheet);
    }
    if (!defence) return;
    for (const garrison of Object.values(defence.bunkers)) {
      for (const id of Object.keys(garrison)) {
        const sheet = spriteFor(id, defence.defenderLevels[id] ?? 1);
        if (sheet) this.textures.preload(sheet);
      }
    }
    for (const caged of defence.defenderChampions) {
      const sheet = spriteFor(`G${caged.t}`, caged.l);
      if (sheet) this.textures.preload(sheet);
    }
  }

  /* ── Creeps ─────────────────────────────────────────────────────────── */

  /** Places every creep the engine has; returns their ids. */
  private syncCreeps(creeps: readonly CreepSnapshot[], tick: number): Set<number> {
    const seen = new Set<number>();
    for (const creep of creeps) {
      seen.add(creep.id);
      let view = this.views.get(creep.id);
      if (!view) {
        view = this.acquire(creep, tick);
        this.views.set(creep.id, view);
      }
      this.place(view, creep, tick);
    }
    return seen;
  }

  /**
   * The views of creeps the engine no longer has: kept standing where they
   * were last seen while a bullet is still on its way to them (#77), let go
   * otherwise.
   */
  private settleGone(seen: ReadonlySet<number>, tick: number): void {
    if (seen.size === this.views.size) return;
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      if (view.snapshot && this.ledger.holds(id)) {
        this.place(view, view.snapshot, tick);
        continue;
      }
      this.views.delete(id);
      this.release(view);
    }
  }

  /** A creep's health bar, 0 to 1: the engine's health plus what is still held. */
  private shownFraction(view: CreepView): number {
    const creep = view.snapshot;
    if (!creep || creep.maxHp <= 0) return 0;
    const engineHp = this.ledger.holdsDeath(view.id) ? 0 : creep.hp;
    const shown = Math.min(creep.maxHp, engineHp + this.ledger.heldAmount(view.id));
    return Math.max(0, Math.min(1, shown / creep.maxHp));
  }

  /** Bars and hurt tints, once this frame's bullets have landed. */
  private paintCreeps(tick: number): void {
    for (const view of this.views.values()) {
      const bar = view.snapshot?.champion ? CHAMPION_BAR : BAR;
      view.barFront.width = Math.max(0, bar.width * this.shownFraction(view));
      view.body.tint =
        tick - view.hurtTick < HURT_TICKS
          ? HURT_TINT
          : view.baseTint === 0xffffff
            ? abilityTint(view.snapshot)
            : view.baseTint;
    }
  }

  private acquire(creep: CreepSnapshot, tick: number): CreepView {
    const ground = groundWorld(creep.ix, creep.iy, this.origin);
    const view = this.pool.pop() ?? this.makeView();
    view.id = creep.id;
    view.monsterId = creep.monsterId;
    view.sheet = spriteFor(creep.monsterId, creep.level) ?? null;
    view.lastX = ground.x;
    view.lastY = ground.y;
    view.lastTick = tick;
    // Face the yard's middle until the first step says otherwise.
    view.heading =
      headingBetween(ground, {
        x: this.yard.bounds.width / 2,
        y: this.yard.bounds.height / 2,
      }) ?? 0;
    view.moving = false;
    view.stillSince = tick;
    view.facedBuilding = -1;
    view.bornTick = tick;
    view.cellKey = "";
    view.lungeTick = Number.NEGATIVE_INFINITY;
    view.lungeX = 0;
    view.lungeY = 0;
    view.hurtTick = Number.NEGATIVE_INFINITY;
    view.lastHp = creep.hp;
    view.top = ground.y;
    view.snapshot = creep;
    view.baseTint = 0xffffff;
    view.body.visible = true;
    view.barBack.visible = true;
    view.barFront.visible = true;
    const bar = creep.champion ? CHAMPION_BAR : BAR;
    view.barBack.width = bar.width;
    view.barBack.height = bar.height;
    view.barFront.height = bar.height;
    view.barFront.tint = creepColour(creep);
    return view;
  }

  private makeView(): CreepView {
    const body = new Sprite(Texture.WHITE);
    body.eventMode = "none";
    this.depth.addChild(body);
    const barBack = new Sprite(Texture.WHITE);
    barBack.tint = BAR_BACK_COLOUR;
    const barFront = new Sprite(Texture.WHITE);
    barFront.tint = BAR_FRONT_COLOUR;
    this.bars.addChild(barBack, barFront);
    return {
      id: -1,
      monsterId: "",
      sheet: null,
      body,
      shadow: null,
      barBack,
      barFront,
      lastX: 0,
      lastY: 0,
      lastTick: -1,
      heading: 0,
      moving: false,
      stillSince: -1,
      facedBuilding: -1,
      bornTick: 0,
      cellKey: "",
      lungeTick: Number.NEGATIVE_INFINITY,
      lungeX: 0,
      lungeY: 0,
      hurtTick: Number.NEGATIVE_INFINITY,
      lastHp: 0,
      top: 0,
      snapshot: null,
      baseTint: 0xffffff,
    };
  }

  private release(view: CreepView): void {
    view.body.visible = false;
    view.barBack.visible = false;
    view.barFront.visible = false;
    if (view.shadow) view.shadow.visible = false;
    view.id = -1;
    view.snapshot = null;
    this.pool.push(view);
  }

  private dispose(view: CreepView): void {
    this.depth.removeChild(view.body);
    view.body.destroy();
    if (view.shadow) {
      this.shadows.removeChild(view.shadow);
      view.shadow.destroy();
    }
    view.barBack.destroy();
    view.barFront.destroy();
  }

  private place(view: CreepView, creep: CreepSnapshot, tick: number): void {
    view.snapshot = creep;
    const ground = groundWorld(creep.ix, creep.iy, this.origin);
    // Heading and motion are read once per battle tick. A frame that saw no
    // tick — every other frame at 144 Hz, since the battle runs 80 ticks a
    // second — would otherwise see a zero step and drop a walking champion to
    // its standing pose for that frame: the flicker of issue #65.
    if (tick !== view.lastTick) {
      const stepped = headingBetween({ x: view.lastX, y: view.lastY }, ground);
      if (stepped !== null) {
        view.heading = stepped;
        view.facedBuilding = -1;
        view.stillSince = -1;
        view.moving = true;
      } else {
        if (view.stillSince < 0) view.stillSince = tick;
        view.moving = tick - view.stillSince < STILL_LATCH_TICKS;
        if (creep.state === "attacking" && creep.targetBuilding !== view.facedBuilding) {
          // Standing and swinging: turn to face what it is hitting.
          const centre = this.host.centreOf(creep.targetBuilding);
          const facing = centre ? headingBetween(ground, centre) : null;
          if (facing !== null) view.heading = facing;
          view.facedBuilding = creep.targetBuilding;
        }
      }
      // Health that rose since the last tick is healing — a Zafreeti's — and
      // shows green; losses come through the engine's "hurt" event instead,
      // which knows the exact amount of each wound.
      if (creep.hp > view.lastHp + 0.5) {
        const gained = creep.hp - view.lastHp;
        const over = { x: ground.x, y: view.top - 6 };
        this.fx.number(tick, `creep:${creep.id}`, creep.id, gained, over, "heal");
      }
      view.lastHp = creep.hp;
      view.lastX = ground.x;
      view.lastY = ground.y;
      view.lastTick = tick;
    }

    const sheet = view.sheet;
    const pose: CreepPose = { heading: view.heading, moving: view.moving, age: tick - view.bornTick };
    const body = view.body;

    // A melee hit nudges the body toward what it struck and back (#63). The
    // wound's tint (#68) and the health bar wait for `paintCreeps`, after
    // this frame's bullets have landed (#77).
    const lunge = this.reducedMotion ? 0 : lungeOffset(tick - view.lungeTick);

    let top: number;
    if (sheet) {
      const layout = layoutCreep(creep, sheet, pose, this.origin, {
        reducedMotion: this.reducedMotion,
      });
      const cell = this.textures.frame(sheet, layout.column, layout.row);
      if (cell) {
        if (view.cellKey !== layout.key) {
          view.cellKey = layout.key;
          body.texture = cell;
        }
        body.scale.set(1);
        view.baseTint = 0xffffff;
        // Whole pixels, as Flash drew them (`MonsterBase.as:613-616`): a cell
        // sampled at a fraction of a pixel shimmers as it moves.
        body.position.set(
          Math.round(layout.x + lunge * view.lungeX),
          Math.round(layout.y + lunge * view.lungeY),
        );
        top = layout.y;
      } else {
        view.baseTint = this.placeMarker(body, ground, creep);
        top = body.y;
        view.cellKey = "";
      }
      body.zIndex = layout.zIndex;
      this.placeShadow(view, layout);
    } else {
      view.baseTint = this.placeMarker(body, ground, creep);
      top = body.y;
      body.zIndex = creepZIndex(ground.x, ground.y, creep.id);
    }
    view.top = top;

    const bar = creep.champion ? CHAMPION_BAR : BAR;
    const barX = Math.round(ground.x - bar.width / 2);
    const barY = Math.round(top - bar.gap);
    view.barBack.position.set(barX, barY);
    view.barFront.position.set(barX, barY);
  }

  /** A creep with no sheet yet: a small square at its feet, tinted by kind. Returns the tint. */
  private placeMarker(
    body: Sprite,
    ground: Point,
    creep: Pick<CreepSnapshot, "champion" | "friendly">,
  ): number {
    const size = creep.champion ? MARKER_SIZE * 2 : MARKER_SIZE;
    if (body.texture !== Texture.WHITE) body.texture = Texture.WHITE;
    body.scale.set(size / Texture.WHITE.width);
    const tint = creep.champion || creep.friendly ? creepColour(creep) : SPLAT_COLOUR;
    body.tint = tint;
    body.position.set(ground.x - size / 2, ground.y - size);
    return tint;
  }

  private placeShadow(view: CreepView, layout: CreepLayout): void {
    if (!layout.shadow || !layout.sheet.shadow) {
      if (view.shadow) view.shadow.visible = false;
      return;
    }
    const shadowSheet = MONSTER_SPRITES[layout.sheet.shadow];
    if (!shadowSheet) return;
    const cell = this.textures.frame(shadowSheet, 0, 0);
    if (!cell) return;
    let shadow = view.shadow;
    if (!shadow) {
      shadow = new Sprite(cell);
      shadow.eventMode = "none";
      shadow.alpha = 0.8;
      this.shadows.addChild(shadow);
      view.shadow = shadow;
    } else if (shadow.texture !== cell) {
      shadow.texture = cell;
    }
    shadow.visible = true;
    shadow.position.set(Math.round(layout.shadow.x), Math.round(layout.shadow.y));
    // On the ground under every building (`MAP.DEPTH_SHADOW`); only a host
    // with no shadow layer sorts it, just under the body.
    shadow.zIndex = this.shadows === this.depth ? layout.zIndex - 1 : 0;
  }

  /* ── Creep hits and wounds (#63, #68) ───────────────────────────────── */

  /** Where a creep is drawn right now, for the numbers over it; null once gone. */
  private creepAnchor(id: number): { ground: Point; top: number } | null {
    const view = this.views.get(id);
    if (!view) return null;
    return { ground: { x: view.lastX, y: view.lastY }, top: view.top };
  }

  /**
   * A swing that connected. A ranged monster's is a projectile from its body
   * to the target, flashing the building when it lands; anyone else's is a
   * lunge toward the target and the flash at once.
   */
  private onHit(event: Extract<BattleVisualEvent, { kind: "hit" }>): void {
    const view = this.views.get(event.creepId);
    const ground = groundWorld(event.ix, event.iy, this.origin);
    const monsterId = view?.monsterId ?? "";
    let target: Point | null = null;
    if (event.buildingId >= 0) {
      target = this.host.centreOf(event.buildingId);
    } else if (event.creepTargetId >= 0) {
      const other = this.views.get(event.creepTargetId);
      const at = other ? { x: other.lastX, y: other.lastY } : groundWorld(event.targetIx, event.targetIy, this.origin);
      target = { x: at.x, y: at.y - BODY_HEIGHT };
    }
    if (!target) target = groundWorld(event.targetIx, event.targetIy, this.origin);

    if (drawsProjectile(monsterId, event.ranged)) {
      const altitude = event.flying ? flyerAltitude(monsterId) : 0;
      const from = { x: ground.x, y: ground.y - BODY_HEIGHT - altitude };
      const champion = view?.sheet ? view.sheet.family !== view.sheet.key : false;
      // The number over the building lands with the shot, and so does the
      // damage to the building's art, bar and smoke (#77).
      if (event.buildingId >= 0 && event.amount > 0) {
        this.heldBuildingHp.set(
          event.buildingId,
          (this.heldBuildingHp.get(event.buildingId) ?? 0) + event.amount,
        );
      }
      this.fx.projectile(event.tick, from, target, event.buildingId, champion, event.amount);
      return;
    }
    if (view) {
      const dx = target.x - ground.x;
      const dy = target.y - ground.y;
      const length = Math.hypot(dx, dy);
      view.lungeTick = event.tick;
      view.lungeX = length > 0 ? dx / length : 0;
      view.lungeY = length > 0 ? dy / length : 0;
    }
    this.fx.flash(event.buildingId, event.tick);
    // Flash showed the same red numbers on buildings (`BFOUNDATION.as:534`).
    if (event.buildingId >= 0 && event.amount > 0) {
      const over = { x: target.x, y: target.y - BUILDING_NUMBER_LIFT };
      this.fx.number(event.tick, `building:${event.buildingId}`, -1, event.amount, over, "damage");
    }
  }

  /**
   * A creep lost health, shown on `tick`: tint it and float the number over
   * it. `tick` is the wound's own for one shown as it comes, and the landing's
   * for one a bullet held (#77), by when the creep has moved on from the
   * wound's `ix/iy` — so a creep still on screen is anchored where it is drawn.
   */
  private showWound(wound: WoundLike, tick: number): void {
    const view = this.views.get(wound.creepId);
    // `place` has already read this tick's health, so `lastHp` needs nothing here.
    if (view) view.hurtTick = tick;
    const ground = view
      ? { x: view.lastX, y: view.lastY }
      : groundWorld(wound.ix, wound.iy, this.origin);
    const at = { x: ground.x, y: (view?.top ?? ground.y - BODY_HEIGHT) - 6 };
    this.fx.number(tick, `creep:${wound.creepId}`, wound.creepId, wound.amount, at, "damage");
  }

  /** What landed bullets let go of: their wounds, then the deaths those held. */
  private showReleased(released: Released<DeathEvent>, tick: number): void {
    for (const wound of released.wounds) this.showWound(wound, tick);
    for (const death of released.deaths) {
      const view = this.views.get(death.creepId);
      const at = view
        ? { x: view.lastX, y: view.lastY }
        : groundWorld(death.ix, death.iy, this.origin);
      this.spawnSplat(tick, at, death.champion ? 22 : 12);
      // The engine let go of this creep a flight ago; its ghost goes with the splat.
      if (view && !this.ledger.holds(death.creepId)) {
        this.views.delete(death.creepId);
        this.release(view);
      }
    }
  }

  /** A ranged creep's fireball reached its building: show the damage it carried. */
  private onFireballLanded(buildingId: number, amount: number): void {
    const held = (this.heldBuildingHp.get(buildingId) ?? 0) - amount;
    if (held > 1e-6) this.heldBuildingHp.set(buildingId, held);
    else this.heldBuildingHp.delete(buildingId);
    this.damageDirty = true;
  }

  /**
   * The engine's building health with what fireballs still in the air have
   * taken added back, so a building darkens, smokes and loses its bar when the
   * fireball lands rather than when it was thrown.
   */
  private shownHealth(
    health: Readonly<Record<string, number>>,
  ): Readonly<Record<string, number>> {
    if (this.heldBuildingHp.size === 0 && this.heldBombHp.size === 0) return health;
    const shown: Record<string, number> = { ...health };
    for (const holding of [this.heldBuildingHp, this.heldBombHp]) {
      for (const [id, held] of holding) {
        const hp = shown[String(id)];
        if (hp === undefined) continue;
        const maxHp = this.maxHpById.get(id) ?? Number.POSITIVE_INFINITY;
        // The engine lets a building's health run below zero; the amount held is
        // what it actually lost, counted from what it had.
        shown[String(id)] = Math.min(maxHp, Math.max(0, hp) + held);
      }
    }
    return shown;
  }

  /* ── Bombs (#87) ────────────────────────────────────────────────────── */

  /** Where particles fall: just above the effects, under the shots. */
  private airLayer(): Container {
    if (!this.air) {
      this.air = new Container();
      this.air.eventMode = "none";
      this.overlay.addChildAt(this.air, this.overlay.getChildIndex(this.effects) + 1);
    }
    return this.air;
  }

  /**
   * Where debris lies: with the buildings' shadows, under every building, as
   * Flash's `MAP._BUILDINGBASES` did; a host without that layer gets it at
   * the bottom of the sorted container.
   */
  private debrisLayer(): Container {
    if (!this.debris) {
      this.debris = new Container();
      this.debris.eventMode = "none";
      const ground = this.host.groundShadowLayer?.();
      if (ground) {
        ground.addChild(this.debris);
      } else {
        this.debris.zIndex = Number.MIN_SAFE_INTEGER;
        this.depth.addChild(this.debris);
      }
    }
    return this.debris;
  }

  /**
   * Starts the rain for every bomb fired since the last pass and holds back
   * what it took off each building it hit. The engine has already applied
   * it; what a building lost is the bomb's share after fortification, capped
   * at the health it had at the last pass.
   */
  private noticeBombs(health: Readonly<Record<string, number>>, tick: number): void {
    const events = this.session.flingLog().events;
    for (; this.eventsSeen < events.length; this.eventsSeen += 1) {
      const event = events[this.eventsSeen];
      if (event?.kind !== "bomb") continue;
      const bomb = BOMBS.find((one) => one.id === event.id);
      if (!bomb) continue;
      this.bombCandidates ??= bombCandidatesOf(this.session.attackLoad());
      const owed = new Map<number, number>();
      for (const hit of bombHits(bomb, event, this.bombCandidates, this.lastDestroyed)) {
        const id = String(hit.id);
        const before = this.lastHealth[id] ?? hit.maxHp;
        // A building the last pass saw standing that fell before the bomb
        // landed took nothing from it: its health did not move.
        if (health[id] === undefined || health[id] === before) continue;
        const taken = Math.min(hit.damage, Math.max(0, before));
        if (taken <= 0) continue;
        owed.set(hit.id, taken);
        this.heldBombHp.set(hit.id, (this.heldBombHp.get(hit.id) ?? 0) + taken);
      }
      const key = this.eventsSeen;
      this.rains.set(key, { left: Math.trunc(bomb.particles), owed });
      const at = groundWorld(event.x, event.y, this.origin);
      this.bombFx.drop(key, bomb, at, Math.min(event.t, tick), this.host.zoom ?? 1);
    }
  }

  /**
   * One particle of a bomb landed: every building the bomb hit takes its
   * share, as `ResourceBomb.Damage` dealt it; the last particle brings down
   * whatever is left.
   */
  private onBombParticle(key: number): void {
    const rain = this.rains.get(key);
    if (!rain) return;
    for (const [id, owed] of rain.owed) {
      const share = rain.left <= 1 ? owed : owed / rain.left;
      rain.owed.set(id, owed - share);
      const held = (this.heldBombHp.get(id) ?? 0) - share;
      if (held > 1e-6) this.heldBombHp.set(id, held);
      else this.heldBombHp.delete(id);
      this.bombNumbers.set(id, (this.bombNumbers.get(id) ?? 0) + share);
    }
    rain.left -= 1;
    if (rain.left <= 0) this.rains.delete(key);
    this.damageDirty = true;
  }

  /**
   * Floats what the rain has taken off each building, gathered over a
   * quarter-second rather than one number per particle; the per-target cap
   * drops the rest, as it dropped Flash's.
   */
  private showBombNumbers(tick: number): void {
    if (this.bombNumbers.size === 0 || tick - this.lastBombNumber < BOMB_NUMBER_TICKS) return;
    this.lastBombNumber = tick;
    for (const [id, amount] of this.bombNumbers) {
      if (amount < 1) continue;
      this.bombNumbers.delete(id);
      const centre = this.host.centreOf(id);
      if (!centre) continue;
      const over = { x: centre.x, y: centre.y - BUILDING_NUMBER_LIFT };
      this.fx.number(tick, `building:${id}`, -1, amount, over, "damage");
    }
  }

  /**
   * Smoke where a building has just crossed into damaged (below half) or
   * destroyed, as `BFOUNDATION.as:1070-1092` puffed it. The first pass only
   * records where every building already stands, so a yard opened with ruins
   * in it does not smoke on the first frame.
   */
  private syncSmoke(health: Readonly<Record<string, number>>, tick: number): void {
    for (const [key, hp] of Object.entries(health)) {
      const id = Number(key);
      const maxHp = this.maxHpById.get(id);
      const step = damageStep(maxHp === undefined ? (hp <= 0 ? 0 : 1) : hp / maxHp);
      const before = this.smokeStep.get(id) ?? 0;
      if (step === before) continue;
      this.smokeStep.set(id, step);
      if (!this.smokePrimed) continue;
      const crossedDestroyed = step >= 4 && before < 4;
      const crossedDamaged = step >= 2 && before < 2;
      if (!crossedDestroyed && !crossedDamaged) continue;
      const centre = this.host.centreOf(id);
      if (centre) this.fx.poof(tick, centre, crossedDestroyed);
    }
    this.smokePrimed = true;
  }

  /* ── Shots and deaths ───────────────────────────────────────────────── */

  private onEvent(event: BattleVisualEvent): void {
    if (event.kind === "hit") {
      this.ledger.interrupt();
      this.onHit(event);
      return;
    }
    if (event.kind === "hurt") {
      if (!this.ledger.hurt(event)) this.showWound(event, event.tick);
      return;
    }
    if (event.kind === "shot") {
      const key = this.towerFx.onShot(event, this.views.get(event.creepId)?.snapshot ?? undefined);
      this.ledger.shot(
        key === null
          ? null
          : {
              key,
              tick: event.tick,
              creepId: event.creepId,
              splash: this.towerFx.splashOf(event.towerId),
              ix: event.ix,
              iy: event.iy,
            },
      );
      return;
    }
    if (event.kind === "quake") {
      this.spawnQuake(event.tick, groundWorld(event.ix, event.iy, this.origin), event.radius);
      return;
    }
    if (event.kind === "charge") {
      this.towerFx.onCharge(event.towerId, event.tick);
      return;
    }
    // A death a held bullet dealt waits for it to land; the rest splat now.
    if (this.ledger.death(event)) return;
    const at = groundWorld(event.ix, event.iy, this.origin);
    this.spawnSplat(event.tick, at, event.champion ? 22 : 12);
  }

  private spawnSplat(tick: number, at: Point, radius: number): void {
    const disc = new Graphics();
    disc.ellipse(0, 0, radius, radius / 2).fill({ color: SPLAT_COLOUR, alpha: 0.85 });
    disc.position.set(at.x, at.y);
    this.effects.addChild(disc);

    const gibs: Gib[] = [];
    if (!this.reducedMotion) {
      const count = radius > 16 ? 10 : 6;
      for (let index = 0; index < count; index += 1) {
        const sprite = this.gibPool.pop() ?? this.makeGib();
        sprite.visible = true;
        sprite.alpha = 1;
        sprite.tint = GIB_COLOURS[index % GIB_COLOURS.length] ?? SPLAT_COLOUR;
        // Deterministic spread: the battle is replayable, the gibs may as well be.
        const angle = ((index + 0.5) / count) * Math.PI * 2 + tick * 0.37;
        const speed = 1.6 + ((index * 7 + tick) % 5) * 0.4;
        gibs.push({
          sprite,
          x: at.x,
          y: at.y - 6,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.5 - 2.4,
        });
      }
    }
    this.splats.push({ tick, at, radius, disc, gibs });
  }

  /**
   * Korath's quake (issue #222): three orange rings on the ground, as
   * `G4QuakeGraphic` draws them (`champions/Korath.as:221-244`), the outer one
   * the quake's reach, fading like a splat. Drawing only.
   */
  private spawnQuake(tick: number, at: Point, radius: number): void {
    const rings = new Graphics();
    for (const share of [1, 0.8, 0.6]) {
      rings.ellipse(0, 0, radius * share, (radius * share) / 2);
    }
    rings.stroke({ color: QUAKE_COLOUR, width: 2, alpha: 0.9 });
    rings.position.set(at.x, at.y);
    this.effects.addChild(rings);
    this.splats.push({ tick, at, radius, disc: rings, gibs: [] });
  }

  private makeGib(): Sprite {
    const sprite = new Sprite(Texture.WHITE);
    sprite.scale.set(3 / Texture.WHITE.width);
    sprite.eventMode = "none";
    this.effects.addChild(sprite);
    return sprite;
  }

  private drawSplats(tick: number): void {
    let keep = 0;
    for (const splat of this.splats) {
      const age = tick - splat.tick;
      if (age > SPLAT_TICKS) {
        splat.disc.destroy();
        for (const gib of splat.gibs) {
          gib.sprite.visible = false;
          this.gibPool.push(gib.sprite);
        }
        continue;
      }
      this.splats[keep] = splat;
      keep += 1;
      const life = 1 - age / SPLAT_TICKS;
      splat.disc.alpha = life;
      splat.disc.scale.set(1 + (1 - life) * 0.4);
      for (const gib of splat.gibs) {
        // Integrated once per frame rather than per tick: at 2x the gibs
        // simply fly for half as many frames, which is what faster means.
        gib.x += gib.vx;
        gib.y += gib.vy;
        gib.vy += 0.25;
        if (gib.y > splat.at.y) {
          gib.y = splat.at.y;
          gib.vy = 0;
          gib.vx *= 0.6;
        }
        gib.sprite.position.set(gib.x, gib.y);
        gib.sprite.alpha = life;
      }
    }
    this.splats.length = keep;
  }

  /* ── Buildings ──────────────────────────────────────────────────────── */

  /**
   * Shows every trap that has just gone off (issue #66): the renderer lifts
   * its concealment, `syncDamage` then draws it as the ruin its zero health
   * says, and a scorch with a fading ring marks the blast, as `BTRAP.Explode`
   * did (`client/scripts/BTRAP.as:88-153`).
   */
  private revealTraps(fired: readonly number[], tick: number): void {
    for (const id of this.traps.sync(fired)) {
      this.host.setConcealed(id, false);
      const building = this.yard.buildings.find((candidate) => candidate.id === id);
      if (!building) continue;
      // `EFFECTS.Scorch(_mc.x, _mc.y + 5)`: just below the origin.
      const at = { x: building.worldX, y: building.worldY + 5 };
      const scorch = new Graphics();
      scorch.ellipse(0, 0, 26, 13).fill({ color: SCORCH_COLOUR, alpha: 0.55 });
      scorch.position.set(at.x, at.y);
      this.effects.addChild(scorch);
      this.scorches.push(scorch);
      const ring = new Graphics();
      ring.position.set(at.x, at.y);
      this.effects.addChild(ring);
      this.bursts.push({ tick, at, ring });
    }
  }

  private drawBursts(tick: number): void {
    let keep = 0;
    for (const burst of this.bursts) {
      const age = tick - burst.tick;
      if (age > BURST_TICKS) {
        burst.ring.destroy();
        continue;
      }
      this.bursts[keep] = burst;
      keep += 1;
      const life = 1 - age / BURST_TICKS;
      const radius = 10 + (1 - life) * 40;
      burst.ring.clear();
      burst.ring
        .ellipse(0, 0, radius, radius / 2)
        .stroke({ width: 3, color: 0xffb347, alpha: 0.9 * life });
      if (age <= 3) {
        burst.ring.circle(0, -8, 12 - age * 3).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }
    this.bursts.length = keep;
  }

  /**
   * Hands the renderer a damage fraction for every building whose health has
   * changed since the last pass. `health` is the engine's map of buildings
   * below full health, so a building absent from it is whole; one already in
   * the map when the attack opened is drawn as damaged from the first frame,
   * which is what its saved condition shows anyway.
   */
  private syncDamage(health: Readonly<Record<string, number>>): void {
    for (const [key, hp] of Object.entries(health)) {
      const id = Number(key);
      const maxHp = this.maxHpById.get(id);
      const fraction = maxHp === undefined ? (hp <= 0 ? 0 : 1) : hp / maxHp;
      if (this.damageApplied.get(id) === fraction) continue;
      this.damageApplied.set(id, fraction);
      this.host.setBuildingDamage(id, fraction);
    }
  }
}
