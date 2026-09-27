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
import type { BattleVisualEvent, CreepSnapshot } from "@/game/combat/rules";
import { depthKey, type Point } from "@/game/yard/YardGrid";
import type { Yard } from "@/game/yard/yardModel";
import type { AttackSession } from "./AttackSession";
import { MONSTER_SPRITES, type MonsterAnimation, type MonsterSheet } from "./monsterSpriteData";
import {
  anchorOffset,
  flyerAltitude,
  frameRect,
  frameRow,
  hoverOffset,
  shadowOffset,
  sheetColumn,
  sheetUrl,
  spriteFor,
} from "./monsterSprites";
import { TrapReveal } from "./trapReveal";

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
 * Buildings sort by `depthKey` of their footprint's top corner, times eight
 * (`YardBuildings.resortByDepth`). Creep bodies go into the same container with
 * a key from their own ground point, so a creep behind a building draws behind
 * it and one in front draws over it. The key is nudged `DEPTH_BIAS` px up the
 * screen first: a building's key is its *top* corner, so without the nudge a
 * creep standing at that corner, where the pathing grid puts a melee attacker
 * coming from the north, would draw over the whole building it is behind.
 * Health bars, shots and splats live in the scene's own overlay above every
 * building — a bar is a readout, not a thing in the yard.
 *
 * ## Motion
 *
 * Classic creeps have one pose per heading, so they glide as Flash drew them,
 * with a two-pixel hop while walking so a marching line does not read as a
 * slide. Flyers hover with the sine bob from `CreepBase.as:262-264` and cast
 * the shadow sheet. Champions and the later creeps play their walk and attack
 * rows at eight ticks a frame (`SPRITES.as:235`). Every clock here is the
 * battle tick, so 2x speed doubles all of it and nothing runs on wall time.
 * Under `prefers-reduced-motion` there is no hop, no bob and no gibs; a death
 * is still a fading splat.
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
 * World px a creep's depth key is nudged up the screen, so a creep at a
 * building's top corner sorts behind it and one at its bottom corner in front.
 * Half the on-screen height of a default 40x40 footprint diamond.
 */
export const DEPTH_BIAS = 20;

/**
 * Where a creep's `zIndex` sits inside a building's block of eight keys:
 * above the building (`+0`) and its animation layers (`+1`..`+3`).
 */
const CREEP_Z_OFFSET = 4;

/** Ticks a shot's tracer and muzzle flash are shown for. */
export const SHOT_TICKS = 10;

/** Ticks a death splat takes to fade: 400 ms at 1x. */
export const SPLAT_TICKS = 32;

/** The walking hop of a single-pose creep, in px, and its period in ticks. */
const HOP_HEIGHT = 2;
const HOP_PERIOD_TICKS = 12;

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

/** Screen-space heading from one point to another, or null when they coincide. */
export const headingBetween = (from: Point, to: Point): number | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  return Math.atan2(dy, dx);
};

/** Which row cycle a creep shows: attacking, walking, or standing. */
export const animationFor = (creep: CreepSnapshot, moving: boolean): MonsterAnimation => {
  if (creep.state === "attacking") return "attack";
  return moving ? "walk" : "idle";
};

/** True when a sheet has no walk cycle to play: one pose per heading. */
const singlePose = (sheet: MonsterSheet): boolean => (sheet.animations.walk?.count ?? 1) <= 1;

/** The depth-sort key for a creep at a world ground point. */
export const creepZIndex = (groundX: number, groundY: number, id: number): number =>
  depthKey(groundX, groundY - DEPTH_BIAS, id) * 8 + CREEP_Z_OFFSET;

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

  let lift = 0;
  if (creep.flying) {
    const altitude = flyerAltitude(creep.monsterId);
    lift = options.reducedMotion ? -altitude : hoverOffset(pose.age, altitude);
  } else if (pose.moving && !options.reducedMotion && singlePose(sheet)) {
    lift = -Math.abs(Math.sin((pose.age / HOP_PERIOD_TICKS) * Math.PI)) * HOP_HEIGHT;
  }

  const shadowAt = creep.flying ? shadowOffset(sheet) : null;

  return {
    sheet,
    column,
    row,
    animation,
    key: `${sheet.key}:${column}:${row}`,
    x: ground.x + anchor.x,
    y: ground.y + anchor.y + lift,
    zIndex: creepZIndex(ground.x, ground.y, creep.id),
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
  /** The middle of a building's footprint in world px, or null. */
  centreOf(id: number): Point | null;
  /** Draws a building as battered as `fraction` of its health says. */
  setBuildingDamage(id: number, fraction: number): void;
  /** Hides a building from the viewer, or shows it again: a trap until it fires. */
  setConcealed(id: number, concealed: boolean): void;
}

export interface AttackBattleLayerOptions {
  readonly session: AttackSession;
  readonly yard: Yard;
  readonly host: BattleYardHost;
  /** The scene's world-space overlay above the buildings (`mounts.battleLayer`). */
  readonly overlay: Container;
  readonly reducedMotion?: boolean;
  readonly textures?: MonsterSheetTextures;
}

interface CreepView {
  id: number;
  sheet: MonsterSheet | null;
  body: Sprite;
  shadow: Sprite | null;
  barBack: Sprite;
  barFront: Sprite;
  /** The ground point last frame, for the heading. */
  lastX: number;
  lastY: number;
  heading: number;
  /** The building the creep was last seen attacking, for the facing. */
  facedBuilding: number;
  bornTick: number;
  cellKey: string;
}

interface Shot {
  readonly tick: number;
  readonly from: Point;
  readonly to: Point;
}

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
const GIB_COLOURS = [0x5da832, 0x3f7a1e, 0x8ad14a] as const;
const TRACER_COLOUR = 0xfff1a8;
const BAR_BACK_COLOUR = 0x6b1616;
const BAR_FRONT_COLOUR = 0x5ee06a;
const BAR_CHAMPION_COLOUR = 0xffd24a;

/** Ticks a trap's blast ring takes to fade. */
export const BURST_TICKS = 14;
const SCORCH_COLOUR = 0x1c1410;

/** World px a tower's gun sits above its footprint centre. */
const GUN_HEIGHT = 30;

/** World px a shot lands above a creep's ground point. */
const BODY_HEIGHT = 10;

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

  /** Creep bodies and flyer shadows, inside the renderer's sorted container. */
  private readonly depth: Container;
  /** In the overlay, in this order. */
  private readonly effects = new Container();
  private readonly fire = new Graphics();
  private readonly bars = new Container();

  private readonly views = new Map<number, CreepView>();
  private readonly pool: CreepView[] = [];
  private readonly shots: Shot[] = [];
  private readonly splats: Splat[] = [];
  private readonly gibPool: Sprite[] = [];
  private readonly damageApplied = new Map<number, number>();
  private readonly maxHpById = new Map<number, number>();

  /* Buildings: the traps the viewer is not shown until they fire (#66). */
  private readonly traps = new TrapReveal();
  private readonly bursts: Burst[] = [];
  private readonly scorches: Graphics[] = [];

  private lastEventTick = 0;
  private damageDirty = true;
  private limitRead = false;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(options: AttackBattleLayerOptions) {
    this.session = options.session;
    this.yard = options.yard;
    this.host = options.host;
    this.overlay = options.overlay;
    this.origin = { x: options.yard.bounds.originX, y: options.yard.bounds.originY };
    this.reducedMotion = options.reducedMotion ?? prefersReducedMotion();
    this.textures = options.textures ?? new MonsterSheetTextures();

    for (const building of options.yard.buildings) {
      if (building.maxHp !== null && building.maxHp > 0) {
        this.maxHpById.set(building.id, building.maxHp);
      }
    }

    this.depth = this.host.depthSortedLayer();
    for (const layer of [this.effects, this.fire, this.bars]) layer.eventMode = "none";
    // Our own children only: the drop ring and anything else already in the
    // overlay stays where it is.
    this.overlay.addChild(this.effects, this.fire, this.bars);

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

    this.syncCreeps(battle.creeps(), tick);
    for (const event of battle.recentEvents(this.lastEventTick)) this.onEvent(event);
    this.lastEventTick = tick;

    this.drawShots(tick);
    this.drawSplats(tick);
    this.drawBursts(tick);

    if (this.damageDirty) {
      this.damageDirty = false;
      const state = battle.state();
      this.revealTraps(state.firedTraps, tick);
      this.syncDamage(state.health);
    }
  }

  /** How many creeps have a sprite right now. */
  get creepCount(): number {
    return this.views.size;
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
    this.shots.length = 0;

    for (const burst of this.bursts) burst.ring.destroy();
    this.bursts.length = 0;
    for (const scorch of this.scorches) scorch.destroy();
    this.scorches.length = 0;

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
  }

  /* ── Creeps ─────────────────────────────────────────────────────────── */

  private syncCreeps(creeps: readonly CreepSnapshot[], tick: number): void {
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
    if (seen.size === this.views.size) return;
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.views.delete(id);
      this.release(view);
    }
  }

  private acquire(creep: CreepSnapshot, tick: number): CreepView {
    const ground = groundWorld(creep.ix, creep.iy, this.origin);
    const view = this.pool.pop() ?? this.makeView();
    view.id = creep.id;
    view.sheet = spriteFor(creep.monsterId, creep.level) ?? null;
    view.lastX = ground.x;
    view.lastY = ground.y;
    // Face the yard's middle until the first step says otherwise.
    view.heading =
      headingBetween(ground, {
        x: this.yard.bounds.width / 2,
        y: this.yard.bounds.height / 2,
      }) ?? 0;
    view.facedBuilding = -1;
    view.bornTick = tick;
    view.cellKey = "";
    view.body.visible = true;
    view.barBack.visible = true;
    view.barFront.visible = true;
    const bar = creep.champion ? CHAMPION_BAR : BAR;
    view.barBack.width = bar.width;
    view.barBack.height = bar.height;
    view.barFront.height = bar.height;
    view.barFront.tint = creep.champion ? BAR_CHAMPION_COLOUR : BAR_FRONT_COLOUR;
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
      sheet: null,
      body,
      shadow: null,
      barBack,
      barFront,
      lastX: 0,
      lastY: 0,
      heading: 0,
      facedBuilding: -1,
      bornTick: 0,
      cellKey: "",
    };
  }

  private release(view: CreepView): void {
    view.body.visible = false;
    view.barBack.visible = false;
    view.barFront.visible = false;
    if (view.shadow) view.shadow.visible = false;
    view.id = -1;
    this.pool.push(view);
  }

  private dispose(view: CreepView): void {
    this.depth.removeChild(view.body);
    view.body.destroy();
    if (view.shadow) {
      this.depth.removeChild(view.shadow);
      view.shadow.destroy();
    }
    view.barBack.destroy();
    view.barFront.destroy();
  }

  private place(view: CreepView, creep: CreepSnapshot, tick: number): void {
    const ground = groundWorld(creep.ix, creep.iy, this.origin);
    const stepped = headingBetween({ x: view.lastX, y: view.lastY }, ground);
    const moving = stepped !== null;
    if (stepped !== null) {
      view.heading = stepped;
      view.facedBuilding = -1;
    } else if (creep.state === "attacking" && creep.targetBuilding !== view.facedBuilding) {
      // Standing and swinging: turn to face what it is hitting.
      const centre = this.host.centreOf(creep.targetBuilding);
      const facing = centre ? headingBetween(ground, centre) : null;
      if (facing !== null) view.heading = facing;
      view.facedBuilding = creep.targetBuilding;
    }
    view.lastX = ground.x;
    view.lastY = ground.y;

    const sheet = view.sheet;
    const pose: CreepPose = { heading: view.heading, moving, age: tick - view.bornTick };
    const body = view.body;

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
        body.tint = 0xffffff;
        body.position.set(layout.x, layout.y);
        top = layout.y;
      } else {
        this.placeMarker(body, ground, creep.champion);
        top = body.y;
        view.cellKey = "";
      }
      body.zIndex = layout.zIndex;
      this.placeShadow(view, layout);
    } else {
      this.placeMarker(body, ground, creep.champion);
      top = body.y;
      body.zIndex = creepZIndex(ground.x, ground.y, creep.id);
    }

    const bar = creep.champion ? CHAMPION_BAR : BAR;
    const fraction = creep.maxHp > 0 ? Math.max(0, Math.min(1, creep.hp / creep.maxHp)) : 0;
    const barX = Math.round(ground.x - bar.width / 2);
    const barY = Math.round(top - bar.gap);
    view.barBack.position.set(barX, barY);
    view.barFront.position.set(barX, barY);
    view.barFront.width = Math.max(0, bar.width * fraction);
  }

  /** A creep with no sheet yet: a small square at its feet, tinted by kind. */
  private placeMarker(body: Sprite, ground: Point, champion: boolean): void {
    const size = champion ? MARKER_SIZE * 2 : MARKER_SIZE;
    if (body.texture !== Texture.WHITE) body.texture = Texture.WHITE;
    body.scale.set(size / Texture.WHITE.width);
    body.tint = champion ? BAR_CHAMPION_COLOUR : SPLAT_COLOUR;
    body.position.set(ground.x - size / 2, ground.y - size);
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
      this.depth.addChild(shadow);
      view.shadow = shadow;
    } else if (shadow.texture !== cell) {
      shadow.texture = cell;
    }
    shadow.visible = true;
    shadow.position.set(layout.shadow.x, layout.shadow.y);
    // Under the body, above whatever building the body is above.
    shadow.zIndex = layout.zIndex - 1;
  }

  /* ── Shots and deaths ───────────────────────────────────────────────── */

  private onEvent(event: BattleVisualEvent): void {
    if (event.kind === "shot") {
      const centre = this.host.centreOf(event.towerId);
      if (!centre) return;
      const target = groundWorld(event.ix, event.iy, this.origin);
      this.shots.push({
        tick: event.tick,
        from: { x: centre.x, y: centre.y - GUN_HEIGHT },
        to: { x: target.x, y: target.y - BODY_HEIGHT },
      });
      return;
    }
    const at = groundWorld(event.ix, event.iy, this.origin);
    this.spawnSplat(event.tick, at, event.champion ? 22 : 12);
  }

  private drawShots(tick: number): void {
    const fire = this.fire;
    fire.clear();
    let keep = 0;
    for (const shot of this.shots) {
      const age = tick - shot.tick;
      if (age > SHOT_TICKS) continue;
      this.shots[keep] = shot;
      keep += 1;
      const fade = 1 - age / SHOT_TICKS;
      fire
        .moveTo(shot.from.x, shot.from.y)
        .lineTo(shot.to.x, shot.to.y)
        .stroke({ width: 2, color: TRACER_COLOUR, alpha: 0.9 * fade });
      if (age <= 3) {
        fire.circle(shot.from.x, shot.from.y, 5 - age).fill({ color: 0xffffff, alpha: 0.9 });
      }
    }
    this.shots.length = keep;
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
