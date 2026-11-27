/**
 * Krampus's battle sheets (G6, beta 10's frost tribe champion), by level.
 * Hand-written: Krampus has no Flash original, so it is not in the generated
 * `monsterSpriteData.ts`. Built by `web/tools/frost-kit/krampus_sheets.py`
 * from six Codex sheets (`art-samples/frost-tribe/kb-*`): three looks like
 * Krallen's (kid at levels 1-2, beast at 3-4, armoured at 5-6), each level
 * its own size.
 *
 * Eight headings, `directionOffset` -22.5: column 0 faces right, 2 towards the
 * viewer, 4 left, 6 away; columns 0, 1 and 7 are 4, 3 and 5 mirrored. Rows 0-3
 * walk, rows 4-7 attack. `file` is the Classic look's 1x sheet (Flash tone);
 * the Modern look draws its painting through `REPAINTED_SHEETS`
 * (`krampus_<n>-anim@2x.png`, with Quality copies `@1.5x` and 1x).
 */

import type { MonsterSheet } from "./monsterSpriteData";

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
  height: frame.frameHeight * 8,
  frameWidth: frame.frameWidth,
  frameHeight: frame.frameHeight,
  columns: 8,
  rows: 8,
  anchorX: frame.anchorX,
  anchorY: frame.anchorY,
  directions: 8,
  directionOffset: -22.5,
  animations: {
    idle: { first: 0, count: 1, ticksPerFrame: 8 },
    walk: { first: 0, count: 4, ticksPerFrame: 6 },
    attack: { first: 4, count: 4, ticksPerFrame: 8 },
  },
  movement: "ground",
  shadow: null,
  skins: [],
});

/** Krampus's six sheets, `G6_1` to `G6_6`, as `MONSTER_SPRITES` keys champions. */
export const KRAMPUS_SPRITES: Readonly<Record<string, MonsterSheet>> = {
  G6_1: krampus(1, {
    frameWidth: 74,
    frameHeight: 52,
    anchorX: 37,
    anchorY: 44,
  }),
  G6_2: krampus(2, {
    frameWidth: 90,
    frameHeight: 60,
    anchorX: 45,
    anchorY: 52,
  }),
  G6_3: krampus(3, {
    frameWidth: 146,
    frameHeight: 79,
    anchorX: 73,
    anchorY: 71,
  }),
  G6_4: krampus(4, {
    frameWidth: 168,
    frameHeight: 88,
    anchorX: 84,
    anchorY: 80,
  }),
  G6_5: krampus(5, {
    frameWidth: 162,
    frameHeight: 93,
    anchorX: 81,
    anchorY: 85,
  }),
  G6_6: krampus(6, {
    frameWidth: 184,
    frameHeight: 103,
    anchorX: 92,
    anchorY: 95,
  }),
};
