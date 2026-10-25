import { MONSTER_SPRITES, type MonsterAnimation, type MonsterSheet, type RowCycle } from "./monsterSpriteData";
import { windUpFrame } from "./juice";

/**
 * Picking a cell out of a monster sprite sheet.
 *
 * The table itself is generated (`monsterSpriteData.ts`). What lives here is
 * the handful of rules the Flash client applied to it: how a heading becomes a
 * column, how a tick becomes a row, and where the cell and its shadow sit
 * relative to the monster's ground point. Everything is arithmetic on the
 * table, with no renderer involved, so it runs under node and the unit tests
 * can check every sheet against the PNGs on disk.
 *
 * ## Headings
 *
 * A monster's heading is the screen-space angle of its velocity,
 * `atan2(dy, dx)` in degrees wrapped to `[0, 360)`
 * (`client/scripts/com/monsters/monsters/MonsterBase.as:591`, `:608-613`; the
 * `-90` and `+90` there cancel and only serve the shortest-turn comparison).
 * Screen y points down, so 0° faces right, 90° faces down the screen, 180°
 * left and 270° up: headings increase clockwise as seen on screen.
 *
 * `SPRITES.GetSprite` takes that heading as an `int` (`SPRITES.as:119`),
 * wraps a negative one by adding 360 (`:127-129`) and divides by the column
 * width: 12° for the 30-column sheets (`:369`), 11.25° for the 32-column ones
 * (`:182`, `:207`, `:213`, `:357`) and 22.5° for champions (`:233-246`).
 * Column 0 is therefore the cell for a monster moving right, and columns run
 * clockwise from there. Champions alone are offset: `ChampionBase.as:1539-1545`
 * passes `m_rotation - 45`, so their column 0 is a monster moving down-right.
 *
 * ## Rows
 *
 * `_frameNumber` counts game ticks (`MonsterBase.as:558`) and every walk and
 * attack cycle reads `first + floor(tick / 8) % count`
 * (`SPRITES.as:200`, `:235-242`, `:257-260`, `:277-308`, `:318-333`), so a
 * frame lasts 8 ticks. The Teratorn and Vorg wing flap is `tick % 9 / 3`
 * (`:182`, `:188`), a 3-tick step over three rows. Single-pose sheets always
 * read row 0.
 *
 * ## Placement
 *
 * A creep's cell is copied into a 52x50 canvas at `(26 - anchorX, 36 - anchorY)`
 * (`SpriteData.as:27-28`) and the canvas sits at `(-26, -36)` from the
 * monster (`CreepBase.as:135-136`), so the cell's top-left is the ground point
 * minus the anchor. Champions use a one-cell canvas at the level's
 * `CHAMPIONCAGE` offset (`ChampionBase.as:242-243`); the generator folds that
 * into the anchor so the same rule holds.
 */

/** Where the game server keeps the sheets. Proxied in development. */
export const ASSET_ROOT = "/assets/";

/** Ticks a walk or attack frame is shown for (`SPRITES.as:235`, `param5 / 8`). */
export const TICKS_PER_FRAME = 8;

/**
 * The canvas point a cell's anchor is copied to (`SpriteData.as:8-10`).
 * Only the shadow placement below still needs it; monster anchors are folded
 * into the table.
 */
const FUBAR_X = 26;
const FUBAR_Y = 36;

/**
 * Where the shadow canvas sits relative to the ground point:
 * `CreepBase.as:123-124` for creeps, `ChampionBase.as:235-236` for champions.
 */
const CREEP_SHADOW_CANVAS = { x: -21, y: -16 } as const;
const CHAMPION_SHADOW_CANVAS = { x: -21, y: -26 } as const;

/**
 * How high a flyer hovers, in pixels above its ground point
 * (`CreepBase.as:144-150`): everything at 108 unless the creature table says
 * otherwise, which for the shipped creatures it never does, and Balthazar low
 * at 40.
 *
 * The owner lifts four of them higher (#211; drawing only, the rules never
 * read this): Teratorn, Zafreeti and Vorg to 144, level with a flying
 * champion's cell top ({@link championFlightTop}), and Balthazar to the
 * ordinary 108, where at 40 it barely cleared its shadow. In a Housing pen
 * they stay on the ground as Flash had them (`CreepBase.as:260`).
 */
export const FLYER_ALTITUDE: Readonly<Record<string, number>> = {
  default: 108,
  C14: 144,
  C15: 144,
  C16: 144,
  IC5: 108,
};

export interface Offset {
  readonly x: number;
  readonly y: number;
}

export interface FrameRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A repaint that redraws a sheet with a different animation layout (more
 * rows, taller cells). Every field is optional and replaces the generated
 * Flash value of the same name; leave a field out to keep the original. The
 * numbers are in 1x cell units, as in the table, even when the PNG is `@4x`.
 */
export interface SheetLayoutOverride {
  readonly frameWidth?: number;
  readonly frameHeight?: number;
  readonly anchorX?: number;
  readonly anchorY?: number;
  readonly rows?: number;
  readonly animations?: Readonly<Partial<Record<MonsterAnimation, RowCycle>>>;
  /**
   * Which frame of the `attack` cycle is the blow itself (0-based). When set,
   * the attack is played once per swing with that frame landing on the tick
   * the hit connects; see `attackRow`. Leave out to loop the cycle.
   */
  readonly strikeFrame?: number;
}

/** A sheet as the game draws it: the Flash table row plus any repaint layout. */
export interface AnimatedSheet extends MonsterSheet {
  readonly strikeFrame?: number;
}

/**
 * Animation layouts for repainted sheets, by original file (the same key as
 * `REPAINTED_SHEETS`). A sheet with no entry is drawn exactly as the table
 * says. Add an entry only together with the matching repaint entry.
 */
export const REPAINT_LAYOUTS: Readonly<Record<string, SheetLayoutOverride>> = {
  // Bandito: 41x40 cells (the old 29x28 cell plus 6 px each side and 12 px on
  // top), so the anchor moves by (6, 12) and the feet stay on the same ground
  // point. Rows: 0 idle, 1-6 walk, 7-11 attack (strike is the third frame).
  "monsters/bandito.png": {
    frameWidth: 41,
    frameHeight: 40,
    anchorX: 17,
    anchorY: 29,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Pokey: 36x29 cells (the old 24x21 cell plus 6 px each side and 8 px on
  // top), so the anchor moves by (6, 8) and the ball and its shadow stay put.
  // Same rows as the Bandito: 0 idle, 1-6 bouncing roll, 7-11 attack.
  "monsters/sprite.1.v1.png": {
    frameWidth: 36,
    frameHeight: 29,
    anchorX: 14,
    anchorY: 22,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Bolt: 42x38 cells (the old 30x28 cell plus 6 px each side and 10 px on
  // top), so the anchor moves by (6, 10) and the worm and its shadow stay put.
  // Same rows as the Bandito: 0 idle, 1-6 crawl, 7-11 attack.
  "monsters/sprite.3.v2.png": {
    frameWidth: 42,
    frameHeight: 38,
    anchorX: 13,
    anchorY: 30,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Fink: 46x42 cells (the old 34x32 cell plus 6 px each side and 10 px on
  // top), so the anchor moves by (6, 10) and the creature and its shadow stay
  // put. Same rows as the Bandito: 0 idle, 1-6 scuttle, 7-11 attack.
  "monsters/fink.png": {
    frameWidth: 46,
    frameHeight: 42,
    anchorX: 21,
    anchorY: 31,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Eye-ra: 40x32 cells (the old 26x23 cell plus 7 px each side and 9 px on
  // top), so the anchor moves by (7, 9) and the creature and its shadow stay
  // put. Same rows as the Bandito: 0 idle, 1-6 slither, 7-11 attack.
  "monsters/eyera.png": {
    frameWidth: 40,
    frameHeight: 32,
    anchorX: 18,
    anchorY: 24,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Fang: 46x42 cells (the old 34x31 cell plus 6 px each side and 11 px on
  // top), so the anchor moves by (6, 11) and the creature and its shadow stay
  // put. Same rows as the Bandito: 0 idle, 1-6 scuttle, 7-11 attack.
  "monsters/fang.png": {
    frameWidth: 46,
    frameHeight: 42,
    anchorX: 22,
    anchorY: 30,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Ichi: 47x38 cells (the old 27x26 cell plus 10 px each side and 12 px on
  // top), so the anchor moves by (10, 12) and the creature and its shadow stay
  // put. Same rows as the Bandito: 0 idle, 1-6 plod, 7-11 attack.
  "monsters/ichi.png": {
    frameWidth: 47,
    frameHeight: 38,
    anchorX: 21,
    anchorY: 29,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Crabatron: 57x39 cells (the old 37x27 cell plus 10 px each side and 12 px on
  // top), so the anchor moves by (10, 12) and the creature and its shadow stay
  // put. Same rows as the Bandito: 0 idle, 1-6 scuttle, 7-11 attack.
  "monsters/crabatron.png": {
    frameWidth: 57,
    frameHeight: 39,
    anchorX: 25,
    anchorY: 30,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // D.A.V.E. (normal and gold skin share one layout): 77x60 cells (the old 53x46 cell plus
  // 12 px each side and 14 px on top), so the anchor moves by (12, 14) and the tank and its
  // shadow stay put. Same rows as the Bandito: 0 idle, 1-6 heavy tread crawl, 7-11 attack.
  "monsters/sprite.12.v2.png": {
    frameWidth: 77,
    frameHeight: 60,
    anchorX: 33,
    anchorY: 41,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Project X: 68x47 cells (the old 48x35 cell plus 10 px each side and 12 px on top), so the
  // anchor moves by (10, 12) and the creature and its shadow stay put. Same rows as the
  // Bandito: 0 idle, 1-6 tentacle crawl, 7-11 attack.
  "monsters/sprite.11.v2.png": {
    frameWidth: 68,
    frameHeight: 47,
    anchorX: 34,
    anchorY: 34,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Wormzer: 56x41 cells (the old 40x26 cell plus 8 px each side, 14 px on top and 1 px at the
  // bottom for the PNG's extra shadow row), so the anchor moves by (8, 14) and the worm and its
  // shadow stay put. The sheet keeps the Flash 32 columns (30 headings, then copies of 29 and 0).
  // Rows: 0 idle, 1-6 caterpillar crawl, 7-11 attack. Burrowing is not drawn: the normal sprite
  // is shown while it moves.
  "monsters/13.png": {
    frameWidth: 56,
    frameHeight: 41,
    anchorX: 27,
    anchorY: 31,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Zafreeti: 76x88 cells (the old 56x70 cell plus 10 px each side, 12 px on top and 6 at the
  // bottom), so the anchor moves by (10, 12) and the creature stays put (it flies; its shadow is a
  // separate sprite). The sheet keeps the 32 headings. Rows: 0 idle, 1-6 hover-float (a gentle bob
  // and sway), 7-11 attack.
  "monsters/zafreeti.v2.png": {
    frameWidth: 76,
    frameHeight: 88,
    anchorX: 38,
    anchorY: 47,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Slimeattikus: 64x48 cells (the old 48x31 cell plus 8 px each side and 17 px on top), so the
  // anchor moves by (8, 17) and the slime stays put. The sheet keeps the Flash 32 columns
  // (30 headings, then copies of 29 and 0). Rows: 0 idle (the old still), 1-6 ooze crawl
  // (squash and stretch), 7-11 attack (crouch, rear up, slam, spread, recover).
  "monsters/slimeattikus_anim.png": {
    frameWidth: 64,
    frameHeight: 48,
    anchorX: 34,
    anchorY: 32,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // The small slime: the same frames scaled down, 40x32 cells (old 30x20 plus 5 px each side, 11 px
  // on top and 1 at the bottom), anchor moves by (5, 11).
  "monsters/slimeattikusmini_anim.png": {
    frameWidth: 40,
    frameHeight: 32,
    anchorX: 20,
    anchorY: 22,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Rezghul: 64x56 cells (the old 48x43 cell plus 8 px each side and 13 px on top), so the anchor
  // moves by (8, 13) and the demon stays put. The sheet keeps the Flash 32 columns. Rows: 0 idle
  // (the still with the tail knob), 1-6 floating glide-walk, 7-11 attack (hunch, rear up, lunge,
  // sweep, recover). The old 6-row layout (idle and walk both on row 1-5) is gone.
  "monsters/rezghul.png": {
    frameWidth: 64,
    frameHeight: 56,
    anchorX: 34,
    anchorY: 49,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Brain: 46x38 cells (the old 34x24 cell plus 6 px each side, 12 px on top and 2 at the bottom),
  // so the anchor moves by (6, 12) and the creature stays put. The sheet keeps the 30 headings.
  // Rows: 0 idle (the old still), 1-6 walk, 7-11 attack. The old "invisible" row is gone: a cloaked
  // Brain is drawn from the walk/attack rows at the see-through alpha (AttackBattleLayer.paintMoves).
  "monsters/brain.v2.png": {
    frameWidth: 46,
    frameHeight: 38,
    anchorX: 22,
    anchorY: 25,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Teratorn: 40x44 cells (the old 28x28 cell plus 6 px each side, 10 px on top and 6 at the bottom),
  // so the anchor moves by (6, 10) and the flyer stays put (its shadow is a separate sprite).
  // Rows: 0-2 the wing flap exactly as before (`walk` steps through them every 3 ticks, `landed`
  // shows row 0), 3-7 attack (anticipation, wind-up, strike, follow-through, recovery), each with
  // its own clear wing pose. Between swings the flap goes on.
  "monsters/14.v1.png": {
    frameWidth: 40,
    frameHeight: 44,
    anchorX: 21,
    anchorY: 24,
    rows: 8,
    animations: {
      walk: { first: 0, count: 3, ticksPerFrame: 3 },
      landed: { first: 0, count: 1, ticksPerFrame: 8 },
      attack: { first: 3, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Vorg: 52x56 cells (the old 40x40 cell plus 6 px each side, 10 px on top and 6 at the bottom),
  // so the anchor moves by (6, 10) and the flyer stays put (its shadow is a separate sprite).
  // Rows: 0-2 the wing flap exactly as before (wings up, half open, down; `walk` steps through
  // them every 3 ticks, `landed` shows row 0), 3-7 attack (anticipation, wind-up, strike,
  // follow-through, recovery), each with its own clear wing pose. Between swings the flap goes on.
  "monsters/vorg_anim.png": {
    frameWidth: 52,
    frameHeight: 56,
    anchorX: 32,
    anchorY: 46,
    rows: 8,
    animations: {
      walk: { first: 0, count: 3, ticksPerFrame: 3 },
      landed: { first: 0, count: 1, ticksPerFrame: 8 },
      attack: { first: 3, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  "monsters/sprite.12.gold.png": {
    frameWidth: 77,
    frameHeight: 60,
    anchorX: 33,
    anchorY: 41,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
  // Octo-ooze: 55x36 cells (the old 39x28 cell plus 8 px each side and 8 px on
  // top), so the anchor moves by (8, 8) and the body and its shadow stay put.
  // Same rows as the Bandito: 0 idle, 1-6 tentacle crawl, 7-11 attack.
  "monsters/octoooze.png": {
    frameWidth: 55,
    frameHeight: 36,
    anchorX: 27,
    anchorY: 23,
    rows: 12,
    animations: {
      idle: { first: 0, count: 1, ticksPerFrame: 8 },
      walk: { first: 1, count: 6, ticksPerFrame: 8 },
      attack: { first: 7, count: 5, ticksPerFrame: 4 },
    },
    strikeFrame: 2,
  },
};

const layoutCache = new Map<MonsterSheet, AnimatedSheet>();

/** Applies a sheet's repaint layout, if it has one; the same object each time. */
export function applyLayout(
  sheet: MonsterSheet,
  layouts: Readonly<Record<string, SheetLayoutOverride>> = REPAINT_LAYOUTS,
): AnimatedSheet {
  const override = layouts[sheet.file];
  if (!override) return sheet;
  const cacheable = layouts === REPAINT_LAYOUTS;
  const cached = cacheable ? layoutCache.get(sheet) : undefined;
  if (cached) return cached;
  const frameWidth = override.frameWidth ?? sheet.frameWidth;
  const frameHeight = override.frameHeight ?? sheet.frameHeight;
  const rows = override.rows ?? sheet.rows;
  const result: AnimatedSheet = {
    ...sheet,
    frameWidth,
    frameHeight,
    rows,
    width: frameWidth * sheet.columns,
    height: frameHeight * rows,
    anchorX: override.anchorX ?? sheet.anchorX,
    anchorY: override.anchorY ?? sheet.anchorY,
    animations: override.animations ?? sheet.animations,
    ...(override.strikeFrame !== undefined ? { strikeFrame: override.strikeFrame } : {}),
  };
  if (cacheable) layoutCache.set(sheet, result);
  return result;
}

const withLayout = (sheet: MonsterSheet): AnimatedSheet => applyLayout(sheet);

/** Champion families and their sheets in level order, built once on first use. */
let familyIndex: ReadonlyMap<string, readonly MonsterSheet[]> | null = null;

const championSheets = (family: string): readonly MonsterSheet[] => {
  if (familyIndex === null) {
    const index = new Map<string, MonsterSheet[]>();
    for (const sheet of Object.values(MONSTER_SPRITES)) {
      if (sheet.family === sheet.key) continue;
      const list = index.get(sheet.family) ?? [];
      list.push(sheet);
      index.set(sheet.family, list);
    }
    for (const list of index.values()) {
      list.sort((a, b) => Number(a.key.slice(a.family.length + 1)) - Number(b.key.slice(b.family.length + 1)));
    }
    familyIndex = index;
  }
  return familyIndex.get(family) ?? [];
};

/** Krallen's sheets, `G5_1` to `G5_3`. */
const KRALLEN_SHEET_FAMILY = "G5";

/**
 * Krallen's look, 1 to 3, by her level (owner, 2026-10-25): levels 1-2 the
 * first, 3-4 the second, 5 the third. Her power level picks none of it.
 */
export const krallenLook = (level: number): number => (level >= 5 ? 3 : level >= 3 ? 2 : 1);

/**
 * The sheet for a creature.
 *
 * Creeps have one sheet under their own id. Champions have one per level,
 * keyed `G1_4`, chosen as `min(level, sheets)` (`ChampionBase.as:229`). Krallen
 * takes her sheet by her level too, through {@link krallenLook}, in the yard
 * and in battle alike (Flash used her power level, `Krallen.as:48`). A level
 * below 1 uses the first sheet. Undefined for an id the table does not know.
 */
export function spriteFor(creatureId: string, level = 1): AnimatedSheet | undefined {
  const direct = MONSTER_SPRITES[creatureId];
  if (direct) return withLayout(direct);
  const sheets = championSheets(creatureId);
  if (sheets.length === 0) return undefined;
  const look = creatureId === KRALLEN_SHEET_FAMILY ? krallenLook(level) : level;
  const index = Math.min(Math.max(1, Math.floor(look)), sheets.length) - 1;
  const chosen = sheets[index];
  return chosen ? withLayout(chosen) : undefined;
}

/**
 * The column for a heading, `directions` columns around the circle.
 *
 * `angleRadians` is the screen-space heading, `Math.atan2(dy, dx)` with y
 * down, so 0 faces right and positive angles turn clockwise on screen
 * (`MonsterBase.as:591`). Column 0 covers `[offset, offset + 360/directions)`
 * degrees and columns run clockwise; any angle is accepted and wrapped.
 *
 * The rounding follows Flash exactly: the heading is wrapped to `[0, 360)`
 * (`MonsterBase.as:610-613`), the offset is subtracted and the result cast to
 * `int`, which truncates toward zero (`SPRITES.as:119`, `ChampionBase.as:1539`),
 * a negative wraps by 360 (`SPRITES.as:127-129`) and the column is the
 * truncated quotient (`SPRITES.as:369`, `:182`, `:233`).
 */
export function directionColumn(angleRadians: number, directions: number, offsetDegrees = 0): number {
  if (directions <= 1) return 0;
  let heading = ((angleRadians * 180) / Math.PI) % 360;
  if (heading < 0) heading += 360;
  let degrees = Math.trunc(heading - offsetDegrees);
  if (degrees < 0) degrees += 360;
  // `+ 0` turns the -0 that truncating a small negative leaves into a plain 0.
  return (Math.floor(degrees / (360 / directions)) % directions) + 0;
}

/**
 * Repainted sheets whose headings were painted mirror-image, by original file
 * (the same key as `REPAINTED_SHEETS`). Their column `c` shows the monster
 * heading `180° - c × width` instead of `c × width`: column 0 faces left and
 * the middle column right, while straight down and straight up are where
 * they belong. Read without correction, the monster walks one way facing the
 * other. The held animated sheets were built from the same frames, so the
 * entry stays right for them.
 */
export const MIRRORED_HEADINGS: ReadonlySet<string> = new Set([
  "monsters/ichi.png", // Ichi repaint and its animated sheet
  "monsters/fang.png", // Fang repaint and its animated sheet
]);

/**
 * `directionColumn` with the sheet's own column count and offset, read through
 * the mirror for a sheet in {@link MIRRORED_HEADINGS}: column `c` swaps with
 * `directions / 2 - c`, which pairs each heading with its left-right mirror.
 */
export function sheetColumn(sheet: MonsterSheet, angleRadians: number): number {
  const column = directionColumn(angleRadians, sheet.directions, sheet.directionOffset);
  if (!MIRRORED_HEADINGS.has(sheet.file)) return column;
  return (sheet.directions / 2 - column + sheet.directions) % sheet.directions;
}

/** The row a cycle shows at `tick`: `first + floor(tick / ticksPerFrame) % count`. */
export function cycleRow(cycle: RowCycle, tick: number): number {
  const step = Math.floor(Math.max(0, tick) / cycle.ticksPerFrame);
  return cycle.first + (step % cycle.count);
}

/**
 * What to show when a sheet has no cycle for the animation asked for.
 *
 * Flash's `GetSprite` has one branch per creature, and an action a branch
 * does not name falls to whatever it does name: a single-pose creep shows
 * row 0 for everything (`SPRITES.as:367-372`), Fomor attacks with its walk
 * cycle (`:248-264`), and a champion asked to stomp that cannot keeps walking.
 */
const FALLBACK: Readonly<Record<MonsterAnimation, readonly MonsterAnimation[]>> = {
  idle: ["idle", "walk"],
  walk: ["walk", "idle"],
  attack: ["attack", "walk", "idle"],
  stomp: ["stomp", "walk", "idle"],
  invisible: ["invisible", "walk"],
  landed: ["landed", "walk"],
  carrying: ["carrying", "walk"],
  hardhat: ["hardhat", "walk"],
  burrowed: ["burrowed", "walk"],
  transition: ["transition", "walk"],
};

/**
 * The row for an animation at `tick`.
 *
 * The frame advances every `ticksPerFrame` ticks, 8 for every walk and attack
 * cycle (`SPRITES.as:235`). A sheet without the animation falls back as
 * `FALLBACK` lists, and a sheet with no cycles at all reads row 0.
 */
export function frameRow(sheet: MonsterSheet, animation: MonsterAnimation, tick: number): number {
  for (const name of FALLBACK[animation]) {
    const cycle = sheet.animations[name];
    if (cycle) return cycleRow(cycle, tick);
  }
  return 0;
}

/**
 * The row for an attacking monster.
 *
 * A sheet that names a `strikeFrame` plays its attack cycle once per swing,
 * timed so the strike frame shows on the tick the hit lands (`swingAge` is
 * ticks since then): the follow-through and recovery play out after it, and
 * once the cycle is over the monster stands (idle row) until the next hit.
 * If the next hit comes before the cycle ends, the cycle restarts at its
 * strike frame, so a fast attacker shows a shortened swing. With no
 * `strikeFrame`, or before the first hit has landed (`swingAge` undefined),
 * the cycle simply loops on the animation clock `age`.
 */
export function attackRow(
  sheet: AnimatedSheet,
  swingAge: number | undefined,
  age: number,
  swing?: SwingTiming,
): number {
  const cycle = sheet.animations.attack;
  const strikeFrame = sheet.strikeFrame ?? swing?.strike;
  if (!cycle || strikeFrame === undefined || swingAge === undefined || !Number.isFinite(swingAge)) {
    return frameRow(sheet, "attack", age);
  }
  const strike = Math.min(Math.max(0, strikeFrame), cycle.count - 1);
  const step = Math.floor(Math.max(0, swingAge) / cycle.ticksPerFrame) + strike;
  if (step >= cycle.count) {
    // The juiced wind-up (feat/attack-juice-demo): the frames before the
    // strike, played into the next expected blow.
    const windUp =
      swing === undefined
        ? null
        : windUpFrame(swingAge, swing.period, strike, cycle.count, cycle.ticksPerFrame);
    return windUp === null ? frameRow(sheet, "idle", age) : cycle.first + windUp;
  }
  return cycle.first + step;
}

/**
 * When the next blow is expected, for the juiced wind-up: ticks from one hit
 * to the next, and a strike frame for a sheet that names none (a champion).
 */
export interface SwingTiming {
  readonly period: number;
  readonly strike?: number;
}

/** The pixel rectangle of cell `(column, row)` in the sheet (`SPRITES.as:379-380`). */
export function frameRect(sheet: MonsterSheet, column: number, row: number): FrameRect {
  return {
    x: column * sheet.frameWidth,
    y: row * sheet.frameHeight,
    width: sheet.frameWidth,
    height: sheet.frameHeight,
  };
}

/**
 * Where the cell's top-left goes relative to the monster's ground point:
 * minus the anchor (`SpriteData.as:27-28` with `CreepBase.as:135-136`;
 * `ChampionBase.as:242-243` for champions, already folded into the table).
 * A flyer adds `hoverOffset` to `y` on top of this.
 */
export function anchorOffset(sheet: MonsterSheet): Offset {
  return { x: -sheet.anchorX, y: -sheet.anchorY };
}

/**
 * Where a flyer's shadow cell's top-left goes relative to the ground point,
 * or null when the sheet draws no shadow.
 *
 * The shadow is copied into its own canvas at `(26 - anchorX, 36 - anchorY)`
 * (`SpriteData.as:27-28`, `SPRITES.as:339`, `:343`), and that canvas sits at
 * `(-21, -16)` for a creep (`CreepBase.as:123-124`) or `(-21, -26)` for a
 * champion (`ChampionBase.as:235-236`). The shadow stays on the ground; only
 * the body hovers.
 */
export function shadowOffset(sheet: MonsterSheet): Offset | null {
  if (sheet.shadow === null) return null;
  const shadow = MONSTER_SPRITES[sheet.shadow];
  if (!shadow) return null;
  const canvas = sheet.family === sheet.key ? CREEP_SHADOW_CANVAS : CHAMPION_SHADOW_CANVAS;
  return {
    x: canvas.x + FUBAR_X - shadow.anchorX,
    y: canvas.y + FUBAR_Y - shadow.anchorY,
  };
}

/**
 * The vertical offset a hovering flyer's body gets on top of `anchorOffset`,
 * negative meaning up the screen.
 *
 * `CreepBase.as:262-264`: `bob = sin(tick / 50) * 5`, the altitude is
 * `altitudeMax - bob`, and the body is drawn at `-altitude + bob`, so the
 * visible bob is twice the sine, twenty pixels peak to peak, one cycle every
 * `100 * PI` ticks.
 */
export function hoverOffset(tick: number, altitudeMax: number = FLYER_ALTITUDE["default"] ?? 108): number {
  const bob = Math.sin(tick / 50) * 5;
  return -(altitudeMax - bob) + bob;
}

/**
 * Where a flying champion's cell top sits relative to its ground point,
 * negative meaning up the screen (#206).
 *
 * `ChampionBase.as:1317-1322`: in the air, `bob = sin(frame / 50) * 5`, the
 * altitude is `108 - bob`, and the body goes to `-altitude - 36 + bob`, which
 * replaces the level's `offset_y`: -144 plus twice the sine, twenty pixels peak to
 * peak, the same height whatever the level. The cell's x keeps the offset.
 */
export function championFlightTop(tick: number): number {
  const bob = Math.sin(tick / 50) * 5;
  return -((FLYER_ALTITUDE["default"] ?? 108) - bob) - 36 + bob;
}

/** How high a creature hovers when it flies (`CreepBase.as:144-150`). */
export function flyerAltitude(creatureId: string): number {
  return FLYER_ALTITUDE[creatureId] ?? FLYER_ALTITUDE["default"] ?? 108;
}

/**
 * Sheets repainted for the revamp, by original file. Each is the original
 * layout drawn at four times the size; the `@4x` in the name is how Pixi knows
 * the resolution, so the table's 1x cell rectangles still frame it. Art trial: the Pokey
 * (`gen-pokey-sprite.py`), the Teratorn (`gen-teratorn-sprite.py`) the Bolt (`gen-bolt-sprite.py`) and the Octo-ooze (`gen-octo-sprite.py`).
 * Remove an entry to go back to the original sheet; empty the table to
 * switch the trial off.
 */
export const REPAINTED_SHEETS: Readonly<Record<string, string>> = {
  "monsters/14.v1.png": "monsters/teratorn-anim@4x.png", // Teratorn animated repaint (3 flap rows + 5 attack rows)
  "monsters/sprite.1.v1.png": "monsters/pokey-anim@4x.png", // Pokey animated repaint
  "monsters/sprite.3.v2.png": "monsters/bolt-anim@4x.png", // Bolt animated repaint
  "monsters/octoooze.png": "monsters/octo-anim@4x.png", // Octo-ooze animated repaint
  "monsters/fink.png": "monsters/fink-anim@4x.png", // Fink animated repaint
  "monsters/bandito.png": "monsters/bandito-anim@4x.png", // Bandito animated repaint
  "monsters/fang.png": "monsters/fang-anim@4x.png", // Fang animated repaint
  "monsters/eyera.png": "monsters/eyera-anim@4x.png", // Eye-ra animated repaint
  "monsters/ichi.png": "monsters/ichi-anim@4x.png", // Ichi animated repaint
  "monsters/sprite.12.v2.png": "monsters/dave-anim@4x.png", // D.A.V.E. animated repaint
  "monsters/sprite.12.gold.png": "monsters/dave-gold-anim@4x.png", // D.A.V.E. animated gold skin (same frames, gold tone)
  "monsters/crabatron.png": "monsters/crabatron-anim@4x.png", // Crabatron animated repaint
  "monsters/brain.v2.png": "monsters/brain-anim@4x.png", // Brain animated repaint (walk + attack; cloak = alpha)
  "monsters/sprite.11.v2.png": "monsters/projectx-anim@4x.png", // Project X animated repaint
  "monsters/13.png": "monsters/wormzer-anim@4x.png", // Wormzer animated repaint
  "monsters/zafreeti.v2.png": "monsters/zafreeti-anim@4x.png", // Zafreeti animated repaint
  "monsters/vorg_anim.png": "monsters/vorg-anim@4x.png", // Vorg animated repaint (3 flap rows + 5 attack rows)
  "monsters/slimeattikus_anim.png": "monsters/slimeattikus-anim@4x.png", // Slimeattikus animated repaint
  "monsters/slimeattikusmini_anim.png": "monsters/slimeattikusmini-anim@4x.png", // mini slime animated repaint (same frames scaled)
  "monsters/rezghul.png": "monsters/rezghul-anim@4x.png", // Rezghul animated repaint (glide walk + attack, tail knob)
  "monsters/ape_1.png": "monsters/ape_1-repaint@4x.png", // Gorgo level 1 repaint (all 16 headings, idle + walk + attack)
  "monsters/fly_1.png": "monsters/fly_1-repaint@4x.png", // Fomor level 1 repaint (all 16 headings, idle + walk)
  "monsters/dragon_1.png": "monsters/dragon_1-repaint@4x.png", // Drull level 1 repaint (all 16 headings painted, idle + walk + attack)
  "monsters/ape_2.png": "monsters/ape_2-repaint@4x.png", // Gorgo level 2 repaint (all 16 headings, idle + walk + attack)
  "monsters/dragon_2.png": "monsters/dragon_2-repaint@4x.png", // Drull level 2 repaint (all 16 headings painted, idle + walk + attack)
  "monsters/fly_2.png": "monsters/fly_2-repaint@4x.png", // Fomor level 2 repaint (all 16 headings, idle + walk)
  "monsters/ape_3.png": "monsters/ape_3-repaint@4x.png", // Gorgo level 3 repaint (all 16 headings, idle + walk + attack)
  "monsters/dragon_3.png": "monsters/dragon_3-repaint@4x.png", // Drull level 3 repaint (all 16 headings painted, idle + walk + attack)
  "monsters/fly_3.png": "monsters/fly_3-repaint@4x.png", // Fomor level 3 repaint (all 16 headings painted, standing + wing beat)
  "monsters/ape_4.png": "monsters/ape_4-repaint@4x.png", // Gorgo level 4 repaint (all 16 headings, idle + walk + attack)
  "monsters/dragon_4.png": "monsters/dragon_4-repaint@4x.png", // Drull level 4 repaint (all 16 headings, idle + walk + attack)
  "monsters/fly_4.png": "monsters/fly_4-repaint@4x.png", // Fomor level 4 repaint (all 16 headings, standing + wing beat)
  "monsters/dragon_5.png": "monsters/dragon_5-repaint@4x.png", // Drull level 5 repaint (all 16 headings, idle + walk + attack)
  "monsters/fly_5.png": "monsters/fly_5-repaint@4x.png", // Fomor level 5 repaint (all 16 headings, standing + wing beat)
  "monsters/krallen_1_rev_65.png": "monsters/krallen_1_rev_65-repaint@4x.png", // Krallen look 1 repaint (all 16 headings, run + attack, ground shadow)
  "monsters/krallen_2_rev_65.png": "monsters/krallen_2_rev_65-repaint@4x.png", // Krallen look 2 repaint (all 16 headings, run + attack, ground shadow)
  "monsters/krallen_3_rev_65.png": "monsters/krallen_3_rev_65-repaint@4x.png", // Krallen look 3 repaint (all 16 headings, run + attack, ground shadow)
};

/** Whether a sheet URL names a high-resolution sheet (`name@4x.png`). */
export const isHighResolutionSheet = (url: string): boolean => /@\d+x\.\w+$/.test(url);

/** The URL the sheet is served from: `/assets/monsters/<file>`, or its repaint. */
export function sheetUrl(sheet: MonsterSheet | string): string {
  const file = typeof sheet === "string" ? sheet : sheet.file;
  return `${ASSET_ROOT}${REPAINTED_SHEETS[file] ?? file}`;
}
