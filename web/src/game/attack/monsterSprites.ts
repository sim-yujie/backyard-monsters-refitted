import { MONSTER_SPRITES, type MonsterAnimation, type MonsterSheet, type RowCycle } from "./monsterSpriteData";

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
 * (`CreepBase.as:144-150`): Balthazar low, everything else at 108 unless the
 * creature table says otherwise, which for the shipped creatures it never does.
 */
export const FLYER_ALTITUDE: Readonly<Record<string, number>> = { default: 108, IC5: 40 };

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

/**
 * The sheet for a creature.
 *
 * Creeps have one sheet under their own id. Champions have one per level,
 * keyed `G1_4`, chosen as `min(level, sheets)` (`ChampionBase.as:229`); for
 * Krallen the number is its power level rather than its level
 * (`Krallen.as:48`), so pass that. A level below 1 uses the first sheet.
 * Undefined for an id the table does not know.
 */
export function spriteFor(creatureId: string, level = 1): MonsterSheet | undefined {
  const direct = MONSTER_SPRITES[creatureId];
  if (direct) return direct;
  const sheets = championSheets(creatureId);
  if (sheets.length === 0) return undefined;
  const index = Math.min(Math.max(1, Math.floor(level)), sheets.length) - 1;
  return sheets[index];
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

/** `directionColumn` with the sheet's own column count and offset. */
export function sheetColumn(sheet: MonsterSheet, angleRadians: number): number {
  return directionColumn(angleRadians, sheet.directions, sheet.directionOffset);
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
 * visible bob is twice the sine, ten pixels peak to peak, one cycle every
 * `100 * PI` ticks.
 */
export function hoverOffset(tick: number, altitudeMax: number = FLYER_ALTITUDE["default"] ?? 108): number {
  const bob = Math.sin(tick / 50) * 5;
  return -(altitudeMax - bob) + bob;
}

/** How high a creature hovers when it flies (`CreepBase.as:144-150`). */
export function flyerAltitude(creatureId: string): number {
  return FLYER_ALTITUDE[creatureId] ?? FLYER_ALTITUDE["default"] ?? 108;
}

/** The URL the sheet is served from: `/assets/monsters/<file>`. */
export function sheetUrl(sheet: MonsterSheet | string): string {
  return `${ASSET_ROOT}${typeof sheet === "string" ? sheet : sheet.file}`;
}
