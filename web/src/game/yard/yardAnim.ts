/**
 * How fast each building type's animation layers run, and where they start.
 *
 * ## The clock
 *
 * The Flash client's stage runs at 40 frames a second (`asconfig.json`,
 * `"default-frame-rate": 40`). Every animated building listens for
 * `ENTER_FRAME` and does its work in `TickFast`
 * (`client/scripts/BFOUNDATION.as:1146-1148`), so one tick is 1/40 s. `TickFast`
 * on the base class is empty (`:1486-1487`); what actually advances a frame is
 * each subclass's override, and they do not agree on a rate. So there is no
 * single number: there is a rate per class, and this is that table.
 *
 * All the rates below are the ones that apply in a yard being *looked at* —
 * `GLOBAL.mode` is BUILD, VIEW or help and `CREEPS._creepCount` is 0, which is
 * exactly this client's read-only yard. The other branch of each `if` is the
 * slower during-a-raid rate, which does not arise here.
 *
 * ## The rates
 *
 * | ticks | at 40 fps | who |
 * | ----- | --------- | --- |
 * | 1     | 40 fps    | Outpost Defender (`OutpostDefender.as:34-40`) |
 * | 2     | 20 fps    | every decoration (`BDECORATION.as:35-41`), the hatchery (`BUILDING13.as:33-41`), the taunt totem (`BUILDING52.as:35-40`) |
 * | 3     | 13.3 fps  | the resource producers (`BUILDING1.as:28-38`), the Loot Locker (`BUILDING26.as:35-44`), the Monster Lab (`MONSTERLAB.as:208-217`) |
 *
 * ## The ones that do not run
 *
 * Every tower is in the table with no rate, and that is not an omission. A
 * tower's strip is not a loop, it is a turret facing: `_animTick` is set from
 * the angle to the target and `AnimFrame` only blits that cell without
 * advancing (`BUILDING21.as:27-32`, `BTOWER.as:450-480`, dividing the bearing
 * by 11.25 or 12 degrees a cell). With nothing attacking, a tower holds one
 * cell for ever — which is the whole reason a sniper tower in this client was
 * showing a base with no gun on it, rather than a gun that would not move.
 *
 * Several others are event-driven in the same way and idle on a fixed cell: the
 * silo's cell is its fill level (`BUILDING6.as:49-58`), the juicer's runs only
 * while it is blending (`BUILDING9.as:75-92`), the Monster Baiter's only while
 * it is baiting (`BUILDING19.as:42-62`), and the siege buildings' only while a
 * weapon is unlocking (`SiegeFactory.as:127`, `SiegeLab.as:90`).
 *
 * A type this table does not name has no animation layers at all, and asking
 * about it costs a map lookup that misses.
 */

/** The Flash stage's frame rate, which is the yard's tick. */
export const YARD_TICK_HZ = 40;

export interface AnimPolicy {
  /**
   * Ticks between frames, or null when the layer holds one cell.
   *
   * A rate of 3 means one frame every third tick: 40 / 3 = 13.3 frames a
   * second.
   */
  readonly ticksPerFrame: number | null;
  /**
   * Whether each building starts on its own cell rather than cell 0.
   *
   * `_animRandomStart` defaults to true (`BFOUNDATION.as:158`) and picks
   * `int(Math.random() * (frames - 2))` (`:1135-1137`), which is what stops a
   * row of identical towers from pointing the same way. A handful of classes
   * turn it off, and `BFOUNDATION.as:1141-1143` forces cell 0 for four types
   * regardless.
   */
  readonly randomStart: boolean;
  /**
   * Whether the strip holds still while a countdown is running on the building.
   *
   * The producers, the silo, the hatchery, the Loot Locker and the Monster Lab
   * all guard their `AnimFrame` with `_countdownBuild.Get() + ... == 0`
   * (`BUILDING1.as:30`, `BUILDING6.as:51`, `BUILDING13.as:34`,
   * `BUILDING26.as:37`, `MONSTERLAB.as:210`), so a building mid-build or
   * mid-upgrade shows its animation layer but does not run it. Decorations and
   * the taunt totem have no such guard and keep going.
   */
  readonly pauseWhileBusy: boolean;
}

const STATIC: AnimPolicy = { ticksPerFrame: null, randomStart: true, pauseWhileBusy: false };
const STATIC_FIXED: AnimPolicy = { ...STATIC, randomStart: false };

const every = (ticksPerFrame: number, randomStart = true): AnimPolicy => ({
  ticksPerFrame,
  randomStart,
  pauseWhileBusy: false,
});

/** The same rate, but held while the building is mid-build or mid-upgrade. */
const whenIdle = (policy: AnimPolicy): AnimPolicy => ({ ...policy, pauseWhileBusy: true });

/** Types 28 to 50 plus 53, 54, 71 and 105 are all plain `BDECORATION`. */
const DECORATIONS = [...Array.from({ length: 23 }, (_, i) => 28 + i), 53, 71, 105];

const POLICIES = new Map<number, AnimPolicy>([
  // Resource producers, all `BRESOURCE` subclasses sharing one `TickFast`.
  // Type 4 turns off the random start (`BUILDING4.as:28`).
  [1, whenIdle(every(3))],
  [2, whenIdle(every(3))],
  [3, whenIdle(every(3))],
  [4, whenIdle(every(3, false))],
  [8, whenIdle(every(3))],
  // Storage silo: the cell is how full it is, not a frame (`BUILDING6.as:51-56`),
  // and it is not even re-read while the build countdown runs (`:51`).
  [6, whenIdle(STATIC)],
  // Juicer: runs only while blending, and starts on cell 0
  // (`BUILDING9.as:206`, and `BFOUNDATION.as:1141` names type 9 explicitly).
  [9, STATIC_FIXED],
  [13, whenIdle(every(2, false))],
  // Monster Baiter: `BFOUNDATION.as:1141` names type 19.
  [19, STATIC_FIXED],
  // Towers. The cell is a facing, set only when something is being shot at.
  [21, STATIC],
  [22, STATIC],
  [23, STATIC],
  [25, STATIC_FIXED],
  [115, STATIC],
  [118, STATIC],
  [129, STATIC_FIXED],
  [132, STATIC],
  [136, STATIC_FIXED],
  [137, STATIC_FIXED],
  [26, whenIdle(every(3))],
  // Enemy bank: only spews when raided (`BUILDING27.as:60-80`).
  [27, STATIC],
  [52, every(2)],
  // `BFOUNDATION.as:1141` names type 54.
  [54, every(2, false)],
  [116, whenIdle(every(3))],
  // Siege factory and lab: only while a weapon is unlocking.
  [133, STATIC_FIXED],
  [134, STATIC_FIXED],
  [140, every(1, false)],
  ...DECORATIONS.map((type): [number, AnimPolicy] => [type, every(2)]),
]);

/** How a type's animation layers behave, or null when it has none. */
export const animPolicy = (type: number): AnimPolicy | null => POLICIES.get(type) ?? null;

/**
 * The cell a building starts on.
 *
 * The original draws from `Math.random()`, so two visits to the same yard do
 * not match. This uses the building's own id instead: the same spread across a
 * row of towers, but stable, which is what makes a screenshot comparable and a
 * test possible. The range matches the original's `frames - 2`
 * (`BFOUNDATION.as:1136`), which never picks the last two cells.
 */
export const startFrame = (policy: AnimPolicy, frames: number, id: number): number => {
  if (!policy.randomStart || frames < 3) return 0;
  // A 32-bit mix, so neighbouring ids do not land on neighbouring cells.
  const mixed = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) >>> 8;
  return mixed % (frames - 2);
};

/** A strip's cell geometry after it has been fitted to the file on disk. */
export interface StripCells {
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

/**
 * The cells to cut from a strip, fitted to the image that actually arrived.
 *
 * Nine of the eighty-four strips in the props table describe a file that is not
 * the file on the server, and they have to be handled rather than trusted. The
 * Loot Locker's fourth strip claims twenty-one cells of a twenty-cell file; the
 * Lightning Tower's damaged strip claims cells twice as tall as the image; the
 * Spurtz Cannon claims a cell a pixel taller than its file is; and one pumpkin
 * strip is a fifteen-by-three grid described as forty-five cells in a row.
 *
 * The Flash client never noticed because `BitmapData.copyPixels` silently
 * copies only the overlap, so an over-large rectangle draws what exists and an
 * out-of-range one draws nothing (`BFOUNDATION.as:1495-1496`). A GPU
 * sub-texture has no such grace: a frame past the edge of its source samples
 * whatever is next to it. So the same clamp is applied here, deliberately.
 *
 * The count is only ever reduced. Four strips have *more* cells on disk than
 * the table asks for, and there the table is right: the game plays the first
 * `frames` of them and the rest are leftovers.
 */
export const stripCells = (
  anim: { readonly width: number; readonly height: number; readonly frames: number },
  sourceWidth: number,
  sourceHeight: number,
): StripCells => {
  const width = Math.max(1, Math.min(anim.width, sourceWidth));
  const height = Math.max(1, Math.min(anim.height, sourceHeight));
  const fit = Math.max(1, Math.floor(sourceWidth / width));
  return { width, height, frames: Math.max(1, Math.min(anim.frames, fit)) };
};
