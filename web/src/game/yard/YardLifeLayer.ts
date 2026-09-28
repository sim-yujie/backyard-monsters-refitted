import { Sprite, Texture, type Container, type Renderer } from "pixi.js";
import {
  creepZIndex,
  gpuTextureLimit,
  MonsterSheetTextures,
} from "@/game/attack/AttackBattleLayer";
import { MONSTER_SPRITES, type MonsterSheet } from "@/game/attack/monsterSpriteData";
import {
  anchorOffset,
  frameRow,
  sheetColumn,
  shadowOffset,
  spriteFor,
} from "@/game/attack/monsterSprites";
import type { Rect, YardBounds } from "./YardGrid";
import {
  CREATURE_TICK_HZ,
  EMPTY_LIFE,
  MAX_TICKS_PER_FRAME,
  reconcileWalkers,
  stepWalker,
  walkerSpecs,
  type Random,
  type Walker,
  type YardLife,
} from "./yardLifeModel";

/**
 * Draws what lives on the player's own yard (issue #158): housed monsters in
 * their pens and the champion in its cage. The rules are in
 * `yardLifeModel.ts`; this owns the sprites.
 *
 * Bodies go into the buildings' own container, sorted by depth the way the
 * attack screen sorts its creeps (`creepZIndex`), so a monster behind a hut is
 * behind it; flyers' shadows go into the buildings' shadow layer. The yard
 * rebuilds that container on every redraw, so the renderer `detach`es the
 * sprites before it does and `attach`es them after: the creatures keep their
 * places through a redraw rather than being born again.
 *
 * Cells are cut from the attack screen's sheets by the same helpers
 * (`MonsterSheetTextures`, `monsterSprites.ts`).
 *
 * Off-screen creatures still walk, which is a few additions each, but touch no
 * sprite. Under `prefers-reduced-motion` nothing walks and no row cycles: every
 * creature stands where it was put.
 */

/** World px of slack around the view before a creature counts as off screen. */
const CULL_MARGIN = 120;

interface Body {
  readonly body: Sprite;
  readonly shadow: Sprite | null;
  readonly sheet: MonsterSheet | null;
  readonly shadowSheet: MonsterSheet | null;
  cellKey: string;
}

export interface YardLifeOptions {
  readonly reducedMotion?: boolean;
  readonly random?: Random;
  readonly textures?: MonsterSheetTextures;
}

export class YardLifeLayer {
  private readonly textures: MonsterSheetTextures;
  private readonly random: Random;
  private readonly reducedMotion: boolean;

  private walkers = new Map<string, Walker>();
  private readonly walkerBodies = new Map<string, Body>();
  private bounds: YardBounds | null = null;

  private tops: Container | null = null;
  private shadows: Container | null = null;
  private hidden = false;
  private limitRead = false;
  /** Fractions of a tick carried between frames. */
  private creatureClock = 0;

  constructor(options: YardLifeOptions = {}) {
    this.textures = options.textures ?? new MonsterSheetTextures();
    this.random = options.random ?? Math.random;
    this.reducedMotion = options.reducedMotion ?? false;
  }

  /** How many creatures there are to draw. */
  get count(): number {
    return this.walkers.size;
  }

  /** The walkers, for tests. */
  get walkerList(): readonly Walker[] {
    return [...this.walkers.values()];
  }

  /** Reads the GPU's texture limit once, so an oversized sheet is cut rather than bound. */
  useRenderer(renderer: Renderer): void {
    if (this.limitRead) return;
    this.limitRead = true;
    const limit = gpuTextureLimit(renderer);
    if (limit !== null) this.textures.setMaxTextureSize(limit);
  }

  /**
   * Brings the creatures in line with a yard's life, or clears them all when
   * passed null. `bounds` is the yard's, for world positions.
   */
  set(life: YardLife | null, bounds: YardBounds): void {
    const next = life ?? EMPTY_LIFE;
    this.bounds = bounds;

    this.walkers = reconcileWalkers(this.walkers, walkerSpecs(next, this.random), this.random);
    for (const [key, body] of this.walkerBodies) {
      if (this.walkers.has(key)) continue;
      this.release(body);
      this.walkerBodies.delete(key);
    }
    for (const [key, walker] of this.walkers) {
      if (this.walkerBodies.has(key)) continue;
      const sheet = spriteFor(walker.monsterId, walker.sheetLevel) ?? null;
      if (sheet) this.textures.preload(sheet);
      this.walkerBodies.set(key, this.makeBody(sheet));
    }

    this.mount();
  }

  /** Takes every sprite out of the yard's containers, before the yard clears them. */
  detach(): void {
    for (const body of this.bodies()) {
      body.body.parent?.removeChild(body.body);
      body.shadow?.parent?.removeChild(body.shadow);
    }
    this.tops = null;
    this.shadows = null;
  }

  /**
   * Puts the sprites into the yard's containers. Returns whether there is
   * anything to put, so the caller knows to switch depth sorting on.
   */
  attach(tops: Container, shadows: Container): boolean {
    this.tops = tops;
    this.shadows = shadows;
    return this.mount();
  }

  /** Hides every creature, for the blueprint and the planner, or shows them again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) for (const body of this.bodies()) this.show(body, false);
  }

  /**
   * One frame: walks everybody on by `deltaSeconds`, then places the ones in
   * `visible` and hides the rest.
   */
  update(visible: Rect, deltaSeconds: number): void {
    const bounds = this.bounds;
    if (!bounds || this.count === 0) return;

    if (!this.reducedMotion && deltaSeconds > 0) {
      this.creatureClock += deltaSeconds * CREATURE_TICK_HZ;
      const creatureTicks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(this.creatureClock));
      this.creatureClock = Math.min(this.creatureClock - creatureTicks, 1);
      for (let tick = 0; tick < creatureTicks; tick++) {
        for (const walker of this.walkers.values()) stepWalker(walker, this.random);
      }

    }

    if (this.hidden) return;

    const left = visible.x - CULL_MARGIN;
    const top = visible.y - CULL_MARGIN;
    const right = visible.x + visible.width + CULL_MARGIN;
    const bottom = visible.y + visible.height + CULL_MARGIN;
    const onScreen = (x: number, y: number): boolean =>
      x >= left && x <= right && y >= top && y <= bottom;

    let depthId = 0;
    for (const [key, walker] of this.walkers) {
      depthId++;
      const body = this.walkerBodies.get(key);
      if (!body) continue;
      const x = walker.x - walker.y + bounds.originX;
      const y = (walker.x + walker.y) / 2 + bounds.originY;
      if (!onScreen(x, y)) {
        this.show(body, false);
        continue;
      }
      const tick = this.reducedMotion ? 0 : walker.age;
      this.place(body, x, y, walker.heading, walker.moving ? "walk" : "idle", tick, depthId);
    }

  }

  destroy(): void {
    this.detach();
    for (const body of this.bodies()) {
      body.body.destroy();
      body.shadow?.destroy();
    }
    this.walkerBodies.clear();
    this.walkers.clear();
    this.textures.destroy();
  }

  /* ── Sprites ──────────────────────────────────────────────────────── */

  private *bodies(): Generator<Body> {
    yield* this.walkerBodies.values();
  }

  private makeBody(sheet: MonsterSheet | null): Body {
    const body = new Sprite(Texture.EMPTY);
    body.eventMode = "none";
    body.visible = false;
    const shadowSheet = sheet?.shadow ? (MONSTER_SPRITES[sheet.shadow] ?? null) : null;
    let shadow: Sprite | null = null;
    if (shadowSheet) {
      this.textures.preload(shadowSheet);
      shadow = new Sprite(Texture.EMPTY);
      shadow.eventMode = "none";
      shadow.visible = false;
    }
    const made: Body = { body, shadow, sheet, shadowSheet, cellKey: "" };
    this.mountBody(made);
    return made;
  }

  private release(body: Body): void {
    body.body.parent?.removeChild(body.body);
    body.body.destroy();
    body.shadow?.parent?.removeChild(body.shadow);
    body.shadow?.destroy();
  }

  private mount(): boolean {
    if (!this.tops) return false;
    for (const body of this.bodies()) this.mountBody(body);
    return this.count > 0;
  }

  private mountBody(body: Body): void {
    if (this.tops && body.body.parent !== this.tops) this.tops.addChild(body.body);
    if (body.shadow && this.shadows && body.shadow.parent !== this.shadows) {
      this.shadows.addChild(body.shadow);
    }
  }

  private show(body: Body, on: boolean): void {
    body.body.visible = on;
    if (body.shadow) body.shadow.visible = on;
  }

  /** Puts one body on its cell at a world ground point, or hides it until its sheet is in. */
  private place(
    body: Body,
    x: number,
    y: number,
    heading: number,
    animation: "walk" | "idle",
    tick: number,
    depthId: number,
  ): void {
    const sheet = body.sheet;
    if (!sheet) return;
    const column = sheetColumn(sheet, heading);
    const row = frameRow(sheet, animation, tick);
    const key = `${sheet.key}:${column}:${row}`;
    if (key !== body.cellKey) {
      const cell = this.textures.frame(sheet, column, row);
      if (!cell) {
        this.show(body, false);
        return;
      }
      body.body.texture = cell;
      body.cellKey = key;
    }
    const anchor = anchorOffset(sheet);
    body.body.position.set(x + anchor.x, y + anchor.y);
    const zIndex = creepZIndex(x, y, depthId);
    if (body.body.zIndex !== zIndex) body.body.zIndex = zIndex;
    body.body.visible = true;

    const shadow = body.shadow;
    const shadowSheet = body.shadowSheet;
    if (!shadow || !shadowSheet) return;
    const at = shadowOffset(sheet);
    const cell = at ? this.textures.frame(shadowSheet, 0, 0) : null;
    if (!at || !cell) {
      shadow.visible = false;
      return;
    }
    if (shadow.texture !== cell) shadow.texture = cell;
    shadow.position.set(x + at.x, y + at.y);
    shadow.visible = true;
  }
}
