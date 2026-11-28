/**
 * Krampus's battle sheets (G6, beta 10's frost tribe champion), by level.
 * Hand-written: Krampus has no Flash original, so it is not in the generated
 * `monsterSpriteData.ts`. Built by `web/tools/frost-kit/krampus_sheets.py`:
 * the walk from Codex sheets (`art-samples/frost-tribe/kb-*-walk` Modern,
 * `classic/cl-*-walk` Classic), three looks like Krallen's (kid at levels
 * 1-2, beast at 3-4, armoured at 5-6), each level its own size; the attack
 * and stomp are each heading's idle pose moved (`krampus_motion.py`), so the
 * body never changes between frames (owner, 28 Nov 2026).
 *
 * Eight headings, `directionOffset` -22.5: column 0 faces right, 2 towards the
 * viewer, 4 left, 6 away; columns 0, 1 and 7 are 4, 3 and 5 mirrored. Rows 0-3
 * walk, 4-13 attack (a horns-first lunge, the blow on its frame
 * {@link KRAMPUS_STRIKE_FRAME}), 14-22 stomp (rears up and slams down on
 * frame 6, tick 48, when his Blizzard Stomp lands, as Korath's quake does).
 * `file` is the Classic look's 1x sheet (Flash's rendered look, painted
 * for it); the Modern look draws its painting through `REPAINTED_SHEETS`
 * (`krampus_<n>-anim@2x.png`, with Quality copies `@1.5x` and 1x) with
 * `KRAMPUS_LAYOUTS`, which play the attack once per blow.
 */

import type { MonsterSheet } from "./monsterSpriteData";

/** Rows to a level's sheet: 4 walk, 10 attack, 9 stomp. */
export const KRAMPUS_ROWS = 23;

/** The attack frame the blow lands on (Modern: played once per blow, `attackRow`). */
export const KRAMPUS_STRIKE_FRAME = 5;

const krampus = (
  level: number,
  frame: {
    frameWidth: number;
    frameHeight: number;
    anchorX: number;
    anchorY: number;
  },
): MonsterSheet => ({
  key: `G6_${level}`,
  family: "G6",
  file: `monsters/krampus_${level}.png`,
  width: frame.frameWidth * 8,
  height: frame.frameHeight * KRAMPUS_ROWS,
  frameWidth: frame.frameWidth,
  frameHeight: frame.frameHeight,
  columns: 8,
  rows: KRAMPUS_ROWS,
  anchorX: frame.anchorX,
  anchorY: frame.anchorY,
  directions: 8,
  directionOffset: -22.5,
  animations: {
    idle: { first: 0, count: 1, ticksPerFrame: 8 },
    walk: { first: 0, count: 4, ticksPerFrame: 6 },
    // 50 ticks, inside his 56-tick swing; the Classic look loops it.
    attack: { first: 4, count: 10, ticksPerFrame: 5 },
    // 72 ticks, his quake's whole stand (`QUAKE_END_FRAME`).
    stomp: { first: 14, count: 9, ticksPerFrame: 8 },
  },
  movement: "ground",
  shadow: null,
  skins: [],
});

/** Krampus's six sheets, `G6_1` to `G6_6`, as `MONSTER_SPRITES` keys champions. */
export const KRAMPUS_SPRITES: Readonly<Record<string, MonsterSheet>> = {
  G6_1: krampus(1, {
    frameWidth: 66,
    frameHeight: 62,
    anchorX: 33,
    anchorY: 48,
  }),
  G6_2: krampus(2, {
    frameWidth: 80,
    frameHeight: 74,
    anchorX: 40,
    anchorY: 58,
  }),
  G6_3: krampus(3, {
    frameWidth: 94,
    frameHeight: 88,
    anchorX: 47,
    anchorY: 78,
  }),
  G6_4: krampus(4, {
    frameWidth: 108,
    frameHeight: 102,
    anchorX: 54,
    anchorY: 90,
  }),
  G6_5: krampus(5, {
    frameWidth: 122,
    frameHeight: 110,
    anchorX: 61,
    anchorY: 94,
  }),
  G6_6: krampus(6, {
    frameWidth: 138,
    frameHeight: 122,
    anchorX: 69,
    anchorY: 106,
  }),
};

/**
 * The Modern look's layout for each sheet (`REPAINT_LAYOUTS`): the table's,
 * with the blow's frame, so the lunge lands on the tick the hit does and the
 * juiced wind-up plays into the next one. The Classic look loops the cycle,
 * as Flash's champions do.
 */
export const KRAMPUS_LAYOUTS: Readonly<Record<string, { readonly strikeFrame: number }>> = Object.fromEntries(
  Object.values(KRAMPUS_SPRITES).map((sheet) => [sheet.file, { strikeFrame: KRAMPUS_STRIKE_FRAME }]),
);
