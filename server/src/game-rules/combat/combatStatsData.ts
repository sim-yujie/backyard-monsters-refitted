/**
 * Combat stats, one table per kind of number. GENERATED — do not edit by hand.
 *
 * Regenerate with `bun tools/gen-combat-stats.mjs` from `web/`, then
 * `node tools/sync-combat-rules.mjs` to copy this directory to
 * `server/src/game-rules/combat/`. Sources are cited per row: the Flash
 * client's `client/scripts/YARD_PROPS.as` for everything a building carries,
 * `BTOWER.as` for the flyer table, each building class's `_gridCost` for the
 * pathing rectangles, the Map Room 2 overrides in `GLOBAL.as`, and the
 * server's own `game-data/stats/` for the monsters and champions.
 *
 * This file imports nothing, because the shared rules module may not
 * (`docs/design/server-combat.md` §3.2): the server loads it under Bun with no
 * build step and the web client bundles the same bytes for the Wild Monster
 * Baiter, so a disagreement between the two would be a battle the player
 * watched and the server refused.
 *
 * Every ladder is indexed by level minus one. Reading one is `stats.ts`'s job,
 * including the clamp the client applies to a level past the end of an array
 * (`client/scripts/CREATURES.as:75-81`); nothing here interprets a number.
 */

/**
 * One level of a tower's `stats` block.
 *
 * The thirteen entries that carry one do not agree on the keys: the Monster
 * Bunker has `range` alone, the Quake Tower and the Stronghold have no
 * `speed` or `splash`, the two Spurtz Cannons add `shots`, and the Siege
 * Works has `duration` and `radius` rather than a weapon. Every key the props
 * file spells is kept, so the fields are
 * `range`, `damage`, `rate`, `speed`, `splash`, `duration`, `radius`, `shots`.
 *
 * `range` is in yard units, `damage` is per shot before fortification and
 * armour (`client/scripts/BFOUNDATION.as:508-512`), `rate` is the re-arm in
 * slow ticks — the tower waits `rate * 2` fast ticks (`BTOWER.as:179`) —
 * `speed` is the projectile's, and `splash` is the blast radius on impact.
 */
export interface TowerLevelStats {
  readonly range?: number;
  readonly damage?: number;
  readonly rate?: number;
  readonly speed?: number;
  readonly splash?: number;
  readonly duration?: number;
  readonly radius?: number;
  readonly shots?: number;
}

/** Per tower type, one entry per level (`YARD_PROPS.as`, `"stats"`). */
export const TOWER_STATS: Readonly<Record<number, readonly TowerLevelStats[]>> = {
  // 20 Cannon Tower (tower) — YARD_PROPS.as:1966, stats :1979
  20: [
    { range: 160, damage: 20, rate: 40, speed: 5, splash: 30 },
    { range: 170, damage: 40, rate: 40, speed: 6, splash: 35 },
    { range: 180, damage: 60, rate: 40, speed: 7, splash: 40 },
    { range: 190, damage: 80, rate: 40, speed: 8, splash: 45 },
    { range: 200, damage: 100, rate: 40, speed: 8, splash: 50 },
    { range: 210, damage: 120, rate: 40, speed: 8, splash: 55 },
    { range: 220, damage: 140, rate: 40, speed: 8, splash: 60 },
    { range: 230, damage: 160, rate: 40, speed: 8, splash: 65 },
    { range: 240, damage: 180, rate: 40, speed: 8, splash: 70 },
    { range: 250, damage: 200, rate: 40, speed: 8, splash: 75 },
  ],
  // 21 Sniper Tower (tower) — YARD_PROPS.as:2187, stats :2200
  21: [
    { range: 300, damage: 100, rate: 80, speed: 10, splash: 0 },
    { range: 308, damage: 210, rate: 80, speed: 10, splash: 0 },
    { range: 316, damage: 320, rate: 80, speed: 10, splash: 0 },
    { range: 324, damage: 430, rate: 80, speed: 12, splash: 0 },
    { range: 332, damage: 540, rate: 80, speed: 15, splash: 0 },
    { range: 340, damage: 650, rate: 80, speed: 17, splash: 0 },
    { range: 348, damage: 760, rate: 80, speed: 18, splash: 0 },
    { range: 356, damage: 870, rate: 80, speed: 19, splash: 0 },
    { range: 364, damage: 980, rate: 80, speed: 20, splash: 0 },
    { range: 372, damage: 1100, rate: 80, speed: 20, splash: 0 },
  ],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2410, stats :2423
  22: [
    { range: 300 }, { range: 350 }, { range: 400 }, { range: 450 }, { range: 500 },
  ],
  // 23 Laser Tower (tower) — YARD_PROPS.as:2487, stats :2498
  23: [
    { range: 160, damage: 120, rate: 80, speed: 0, splash: 40 },
    { range: 162, damage: 150, rate: 80, speed: 0, splash: 40 },
    { range: 164, damage: 180, rate: 80, speed: 0, splash: 40 },
    { range: 168, damage: 200, rate: 80, speed: 0, splash: 40 },
    { range: 170, damage: 220, rate: 80, speed: 0, splash: 40 },
    { range: 175, damage: 240, rate: 80, speed: 0, splash: 40 },
    { range: 178, damage: 260, rate: 80, speed: 0, splash: 40 },
    { range: 180, damage: 280, rate: 80, speed: 0, splash: 40 },
  ],
  // 25 Tesla Tower (tower) — YARD_PROPS.as:2728, stats :2739
  25: [
    { range: 250, damage: 100, rate: 10, speed: 10, splash: 0 },
    { range: 270, damage: 120, rate: 15, speed: 10, splash: 0 },
    { range: 300, damage: 140, rate: 20, speed: 10, splash: 0 },
    { range: 320, damage: 160, rate: 25, speed: 10, splash: 0 },
    { range: 340, damage: 180, rate: 25, speed: 10, splash: 0 },
    { range: 360, damage: 200, rate: 30, speed: 10, splash: 0 },
    { range: 380, damage: 220, rate: 30, speed: 10, splash: 0 },
    { range: 400, damage: 240, rate: 35, speed: 10, splash: 0 },
  ],
  // 115 Aerial Defense Tower (tower) — YARD_PROPS.as:6033, stats :6045
  115: [
    { range: 300, damage: 200, rate: 60, speed: 20, splash: 180 },
    { range: 320, damage: 250, rate: 60, speed: 24, splash: 185 },
    { range: 340, damage: 250, rate: 60, speed: 28, splash: 190 },
    { range: 360, damage: 250, rate: 60, speed: 32, splash: 195 },
    { range: 380, damage: 300, rate: 60, speed: 36, splash: 200 },
    { range: 400, damage: 350, rate: 60, speed: 40, splash: 215 },
    { range: 420, damage: 350, rate: 60, speed: 44, splash: 220 },
    { range: 440, damage: 400, rate: 60, speed: 48, splash: 225 },
  ],
  // 118 Railgun (tower) — YARD_PROPS.as:6324, stats :6337
  118: [
    { range: 300, damage: 400, rate: 160, speed: 20, splash: 0 },
    { range: 315, damage: 600, rate: 160, speed: 20, splash: 0 },
    { range: 330, damage: 900, rate: 160, speed: 20, splash: 0 },
    { range: 345, damage: 1200, rate: 160, speed: 20, splash: 0 },
    { range: 360, damage: 1600, rate: 160, speed: 20, splash: 0 },
    { range: 380, damage: 2000, rate: 160, speed: 20, splash: 0 },
    { range: 390, damage: 2200, rate: 160, speed: 20, splash: 0 },
    { range: 400, damage: 2500, rate: 160, speed: 20, splash: 0 },
  ],
  // 129 Quake Tower (tower) — YARD_PROPS.as:6872, stats :6886
  129: [
    { range: 160, damage: 1100, rate: 15 }, { range: 170, damage: 1680, rate: 15 },
    { range: 180, damage: 2220, rate: 15 }, { range: 190, damage: 2880, rate: 15 },
    { range: 200, damage: 3640, rate: 15 }, { range: 210, damage: 4400, rate: 15 },
  ],
  // 132 Magma Tower (tower) — YARD_PROPS.as:7142, stats :7157
  132: [
    { range: 180, damage: 180, rate: 20, speed: 14, splash: 0 },
    { range: 190, damage: 240, rate: 20, speed: 15, splash: 0 },
    { range: 200, damage: 300, rate: 20, speed: 16, splash: 0 },
    { range: 210, damage: 360, rate: 20, speed: 17, splash: 0 },
    { range: 220, damage: 420, rate: 20, speed: 18, splash: 0 },
    { range: 230, damage: 480, rate: 20, speed: 19, splash: 0 },
  ],
  // 134 b_siegeworks (special) — YARD_PROPS.as:7358, stats :7457
  134: [
    { range: 200, duration: 380, radius: 200 }, { range: 210, duration: 390, radius: 210 },
    { range: 235, duration: 400, radius: 235 }, { range: 335, duration: 410, radius: 335 },
    { range: 360, duration: 200, radius: 360 }, { range: 370, duration: 210, radius: 370 },
    { range: 380, duration: 235, radius: 380 }, { range: 390, duration: 335, radius: 390 },
    { range: 400, duration: 360, radius: 400 }, { range: 410, duration: 370, radius: 410 },
  ],
  // 136 bi_spurtzcannon (tower) — YARD_PROPS.as:7551, stats :7566
  136: [
    { range: 300, damage: 280, rate: 72, speed: 11, splash: 35, shots: 10 },
    { range: 350, damage: 300, rate: 96, speed: 12, splash: 45, shots: 20 },
    { range: 400, damage: 320, rate: 120, speed: 13, splash: 55, shots: 30 },
    { range: 450, damage: 340, rate: 144, speed: 14, splash: 65, shots: 40 },
    { range: 500, damage: 360, rate: 170, speed: 15, splash: 75, shots: 50 },
  ],
  // 137 bi_blackspurtzcannon (tower) — YARD_PROPS.as:7663, stats :7678
  137: [
    { range: 300, damage: 330, rate: 72, speed: 11, splash: 35, shots: 15 },
    { range: 350, damage: 350, rate: 96, speed: 12, splash: 45, shots: 25 },
    { range: 400, damage: 370, rate: 120, speed: 13, splash: 55, shots: 35 },
    { range: 450, damage: 390, rate: 144, speed: 14, splash: 65, shots: 45 },
    { range: 500, damage: 410, rate: 170, speed: 15, splash: 75, shots: 55 },
  ],
  // 138 b_stronghold (tower) — YARD_PROPS.as:7775, stats :7791
  138: [
    { range: 360, damage: 900, rate: 1 }, { range: 380, damage: 1000, rate: 1 },
    { range: 400, damage: 1100, rate: 1 },
  ],
};

/**
 * Every type's health ladder, `hp[level - 1]` (`YARD_PROPS.as`, `"hp"`).
 *
 * 137 of the 140 entries have one; the rest are
 * placeholders and decorations that never take damage.
 */
export const BUILDING_HP: Readonly<Record<number, readonly number[]>> = {
  // 1 Twig Snapper (resource) — YARD_PROPS.as:10
  1: [
    500, 950, 1800, 3400, 6500, 12000, 24000, 45000, 85000, 165000,
  ],
  // 2 Pebble Shiner (resource) — YARD_PROPS.as:157
  2: [
    500, 950, 1800, 3400, 6500, 12000, 24000, 45000, 85000, 165000,
  ],
  // 3 Putty Squisher (resource) — YARD_PROPS.as:304
  3: [
    500, 950, 1800, 3400, 6500, 12000, 24000, 45000, 85000, 165000,
  ],
  // 4 Goo Factory (resource) — YARD_PROPS.as:451
  4: [
    500, 950, 1800, 3400, 6500, 12000, 24000, 45000, 85000, 165000,
  ],
  // 5 Flinger (special) — YARD_PROPS.as:598
  5: [
    4000, 8000, 16000, 28000, 56000,
  ],
  // 6 Storage Silo (special) — YARD_PROPS.as:713
  6: [
    750, 1400, 2550, 4750, 8800, 16250, 30000, 55600, 105000, 190000,
  ],
  // 7 Mushroom (mushroom) — YARD_PROPS.as:873
  7: [
    10,
  ],
  // 8 Monster Locker (special) — YARD_PROPS.as:901
  8: [
    4000, 16000, 32000, 64000,
  ],
  // 9 Monster Juicer (special) — YARD_PROPS.as:1002
  9: [
    16000, 32000, 64000,
  ],
  // 10 Yard Planner (special) — YARD_PROPS.as:1063
  10: [
    16000,
  ],
  // 11 Map Room (special) — YARD_PROPS.as:1110
  11: [
    5000, 10000, 10000,
  ],
  // 12 General Store (special) — YARD_PROPS.as:1170
  12: [
    4000,
  ],
  // 13 Hatchery (special) — YARD_PROPS.as:1216
  13: [
    4000, 16000, 32000,
  ],
  // 14 Town Hall (special) — YARD_PROPS.as:1299
  14: [
    4000, 8800, 20000, 42000, 94000, 200000, 300000, 400000, 500000, 600000,
  ],
  // 15 Housing (special) — YARD_PROPS.as:1553
  15: [
    4000, 14000, 25000, 43000, 75000, 130000, 145000, 160000, 175000, 190000,
  ],
  // 16 Hatchery Control Center (special) — YARD_PROPS.as:1663
  16: [
    64000,
  ],
  // 17 Block (wall) — YARD_PROPS.as:1710
  17: [
    1000, 2300, 5750, 18000, 27000,
  ],
  // 18 Stone Block (wall) — YARD_PROPS.as:1831
  18: [
    3600,
  ],
  // 19 Wild Monster Baiter (special) — YARD_PROPS.as:1875
  19: [
    1000, 1500, 2250, 3375, 5000, 7500, 12000,
  ],
  // 20 Cannon Tower (tower) — YARD_PROPS.as:1966
  20: [
    6000, 9000, 12600, 17640, 26460, 34400, 45000, 58000, 75500, 98200,
  ],
  // 21 Sniper Tower (tower) — YARD_PROPS.as:2187
  21: [
    6000, 9000, 12600, 17640, 26460, 34400, 45000, 58000, 75500, 98200,
  ],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2410
  22: [
    10000, 24500, 52000, 75000, 105000,
  ],
  // 23 Laser Tower (tower) — YARD_PROPS.as:2487
  23: [
    9000, 12600, 17640, 26460, 34400, 42200, 50000, 58000,
  ],
  // 24 Booby Trap (trap) — YARD_PROPS.as:2682
  24: [
    10,
  ],
  // 25 Tesla Tower (tower) — YARD_PROPS.as:2728
  25: [
    15000, 22000, 30000, 48000, 60000, 72000, 82000, 90000,
  ],
  // 26 Monster Academy (special) — YARD_PROPS.as:2923
  26: [
    6000, 10000, 14000, 20000, 30000,
  ],
  // 27 Horsey (enemy) — YARD_PROPS.as:3029
  27: [
    1,
  ],
  // 28 American Flag (decoration) — YARD_PROPS.as:3064
  28: [
    100,
  ],
  // 29 British Flag (decoration) — YARD_PROPS.as:3098
  29: [
    100,
  ],
  // 30 Australian Flag (decoration) — YARD_PROPS.as:3132
  30: [
    100,
  ],
  // 31 Brazilian Flag (decoration) — YARD_PROPS.as:3166
  31: [
    100,
  ],
  // 32 European Flag (decoration) — YARD_PROPS.as:3200
  32: [
    100,
  ],
  // 33 French Flag (decoration) — YARD_PROPS.as:3235
  33: [
    100,
  ],
  // 34 Indonesian Flag (decoration) — YARD_PROPS.as:3269
  34: [
    100,
  ],
  // 35 Italian Flag (decoration) — YARD_PROPS.as:3303
  35: [
    100,
  ],
  // 36 Malaysian Flag (decoration) — YARD_PROPS.as:3337
  36: [
    100,
  ],
  // 37 Dutch Flag (decoration) — YARD_PROPS.as:3371
  37: [
    100,
  ],
  // 38 New Zealand Flag (decoration) — YARD_PROPS.as:3405
  38: [
    100,
  ],
  // 39 Norwegian Flag (decoration) — YARD_PROPS.as:3439
  39: [
    100,
  ],
  // 40 Polish Flag (decoration) — YARD_PROPS.as:3473
  40: [
    100,
  ],
  // 41 Swedish Flag (decoration) — YARD_PROPS.as:3507
  41: [
    100,
  ],
  // 42 Turkish Flag (decoration) — YARD_PROPS.as:3541
  42: [
    100,
  ],
  // 43 Canadian Flag (decoration) — YARD_PROPS.as:3575
  43: [
    100,
  ],
  // 44 Danish Flag (decoration) — YARD_PROPS.as:3609
  44: [
    100,
  ],
  // 45 German Flag (decoration) — YARD_PROPS.as:3643
  45: [
    100,
  ],
  // 46 Filipino Flag (decoration) — YARD_PROPS.as:3677
  46: [
    100,
  ],
  // 47 Singaporean Flag (decoration) — YARD_PROPS.as:3711
  47: [
    100,
  ],
  // 48 Austrian Flag (decoration) — YARD_PROPS.as:3745
  48: [
    100,
  ],
  // 49 Pirate Flag (decoration) — YARD_PROPS.as:3779
  49: [
    100,
  ],
  // 50 Peace Flag (decoration) — YARD_PROPS.as:3814
  50: [
    100,
  ],
  // 51 Catapult (special) — YARD_PROPS.as:3849
  51: [
    4000, 8000, 16000, 32000,
  ],
  // 52 Simple Sign (taunt) — YARD_PROPS.as:3937
  52: [
    100,
  ],
  // 53 hwn_pumpkin (immovable) — YARD_PROPS.as:3973
  53: [
    10,
  ],
  // 54 hwn_massivepumpkin (immovable) — YARD_PROPS.as:3997
  54: [
    10,
  ],
  // 55 bdg_acorn (decoration) — YARD_PROPS.as:4022
  55: [
    100,
  ],
  // 56 bdg_beehive (decoration) — YARD_PROPS.as:4055
  56: [
    100,
  ],
  // 57 bdg_birdhous (decoration) — YARD_PROPS.as:4088
  57: [
    100,
  ],
  // 58 bdg_tent (decoration) — YARD_PROPS.as:4121
  58: [
    100,
  ],
  // 59 bdg_jax (decoration) — YARD_PROPS.as:4155
  59: [
    100,
  ],
  // 60 bdg_redgnome (decoration) — YARD_PROPS.as:4189
  60: [
    100,
  ],
  // 61 bdg_bluegnome (decoration) — YARD_PROPS.as:4222
  61: [
    100,
  ],
  // 62 bdg_greengnome (decoration) — YARD_PROPS.as:4255
  62: [
    100,
  ],
  // 63 bdg_hammock (decoration) — YARD_PROPS.as:4288
  63: [
    100,
  ],
  // 64 bdg_lawnchair (decoration) — YARD_PROPS.as:4321
  64: [
    100,
  ],
  // 65 bdg_outhouse (decoration) — YARD_PROPS.as:4354
  65: [
    100,
  ],
  // 66 bdg_pinecone (decoration) — YARD_PROPS.as:4387
  66: [
    100,
  ],
  // 67 bdg_rock (decoration) — YARD_PROPS.as:4420
  67: [
    100,
  ],
  // 68 bdg_scaleelectric (decoration) — YARD_PROPS.as:4454
  68: [
    100,
  ],
  // 69 bdg_scarecrow (decoration) — YARD_PROPS.as:4487
  69: [
    100,
  ],
  // 70 bdg_sundial (decoration) — YARD_PROPS.as:4521
  70: [
    100,
  ],
  // 71 bdg_tikitorch (decoration) — YARD_PROPS.as:4555
  71: [
    100,
  ],
  // 72 bdg_walnut (decoration) — YARD_PROPS.as:4589
  72: [
    100,
  ],
  // 73 bdg_tombstone (decoration) — YARD_PROPS.as:4622
  73: [
    100,
  ],
  // 74 bdg_pokeyhead (decoration) — YARD_PROPS.as:4655
  74: [
    100,
  ],
  // 75 bdg_octohead (decoration) — YARD_PROPS.as:4688
  75: [
    100,
  ],
  // 76 bdg_bolthead (decoration) — YARD_PROPS.as:4721
  76: [
    100,
  ],
  // 77 bdg_banditohead (decoration) — YARD_PROPS.as:4754
  77: [
    100,
  ],
  // 78 bdg_brainhead (decoration) — YARD_PROPS.as:4787
  78: [
    100,
  ],
  // 79 bdg_crabhead (decoration) — YARD_PROPS.as:4820
  79: [
    100,
  ],
  // 80 bdg_davehead (decoration) — YARD_PROPS.as:4853
  80: [
    100,
  ],
  // 81 bdg_eyerahead (decoration) — YARD_PROPS.as:4886
  81: [
    100,
  ],
  // 82 bdg_fanghead (decoration) — YARD_PROPS.as:4919
  82: [
    100,
  ],
  // 83 bdg_finkhead (decoration) — YARD_PROPS.as:4952
  83: [
    100,
  ],
  // 84 bdg_ichihead (decoration) — YARD_PROPS.as:4985
  84: [
    100,
  ],
  // 85 bdg_projectxhead (decoration) — YARD_PROPS.as:5018
  85: [
    100,
  ],
  // 86 bdg_blackberrybush (decoration) — YARD_PROPS.as:5051
  86: [
    100,
  ],
  // 87 bdg_bonsaitree (decoration) — YARD_PROPS.as:5081
  87: [
    100,
  ],
  // 88 bdg_cactus (decoration) — YARD_PROPS.as:5114
  88: [
    100,
  ],
  // 89 bdg_flytrap (decoration) — YARD_PROPS.as:5147
  89: [
    100,
  ],
  // 90 bdg_thorns (decoration) — YARD_PROPS.as:5180
  90: [
    100,
  ],
  // 91 bdg_pinkflowers (decoration) — YARD_PROPS.as:5213
  91: [
    100,
  ],
  // 92 bdg_purpleflowers (decoration) — YARD_PROPS.as:5246
  92: [
    100,
  ],
  // 93 bdg_redflowers (decoration) — YARD_PROPS.as:5279
  93: [
    100,
  ],
  // 94 bdg_whiteflowers (decoration) — YARD_PROPS.as:5312
  94: [
    100,
  ],
  // 95 bdg_yellowflowers (decoration) — YARD_PROPS.as:5345
  95: [
    100,
  ],
  // 96 bdg_baseballstatue (decoration) — YARD_PROPS.as:5378
  96: [
    100,
  ],
  // 97 bdg_footballstatue (decoration) — YARD_PROPS.as:5416
  97: [
    100,
  ],
  // 98 bdg_soccerstatue (decoration) — YARD_PROPS.as:5454
  98: [
    100,
  ],
  // 99 bdg_libertystatue (decoration) — YARD_PROPS.as:5492
  99: [
    100,
  ],
  // 100 bdg_eiffelstatue (decoration) — YARD_PROPS.as:5530
  100: [
    100,
  ],
  // 101 bdg_bigben (decoration) — YARD_PROPS.as:5568
  101: [
    100,
  ],
  // 102 bdg_pool (decoration) — YARD_PROPS.as:5606
  102: [
    100,
  ],
  // 103 bdg_pond (decoration) — YARD_PROPS.as:5639
  103: [
    100,
  ],
  // 104 bdg_zengarden (decoration) — YARD_PROPS.as:5669
  104: [
    100,
  ],
  // 105 bdg_fountain (decoration) — YARD_PROPS.as:5702
  105: [
    100,
  ],
  // 106 bdg_teagarden (decoration) — YARD_PROPS.as:5735
  106: [
    100,
  ],
  // 107 bdg_monsterskull (decoration) — YARD_PROPS.as:5768
  107: [
    100,
  ],
  // 108 bdg_rubikunsolved (decoration) — YARD_PROPS.as:5801
  108: [
    100,
  ],
  // 109 bdg_rubiksolved (decoration) — YARD_PROPS.as:5834
  109: [
    100,
  ],
  // 110 bdg_halloween (decoration) — YARD_PROPS.as:5867
  110: [
    100,
  ],
  // 111 bdg_halloween_small (decoration) — YARD_PROPS.as:5901
  111: [
    100,
  ],
  // 113 Radio Tower (special) — YARD_PROPS.as:5949
  113: [
    3400,
  ],
  // 114 Champion Cage (cage) — YARD_PROPS.as:5993
  114: [
    10000,
  ],
  // 115 Aerial Defense Tower (tower) — YARD_PROPS.as:6033
  115: [
    15000, 22000, 30000, 48000, 60000, 72000, 82000, 90000,
  ],
  // 116 Monster Lab (special) — YARD_PROPS.as:6225
  116: [
    9000, 16000, 24000, 32000,
  ],
  // 117 Heavy Trap (trap) — YARD_PROPS.as:6283
  117: [
    10,
  ],
  // 118 Railgun (tower) — YARD_PROPS.as:6324
  118: [
    17640, 34400, 45000, 58000, 75500, 90000, 100000, 110000,
  ],
  // 119 Champion Chamber (special) — YARD_PROPS.as:6521
  119: [
    16000,
  ],
  // 120 bdg_biggulp (decoration) — YARD_PROPS.as:6563
  120: [
    100,
  ],
  // 121 bdg_wmitotem1 (decoration) — YARD_PROPS.as:6597
  121: [
    100, 100, 100, 100, 100, 100,
  ],
  // 122 placeholder (placeholder) — YARD_PROPS.as:6694
  122: [
    1,
  ],
  // 123 placeholder (placeholder) — YARD_PROPS.as:6711
  123: [
    1,
  ],
  // 124 placeholder (placeholder) — YARD_PROPS.as:6728
  124: [
    1,
  ],
  // 125 placeholder (placeholder) — YARD_PROPS.as:6745
  125: [
    1,
  ],
  // 126 placeholder (placeholder) — YARD_PROPS.as:6762
  126: [
    1,
  ],
  // 127 Inferno Cavern (enemy) — YARD_PROPS.as:6779
  127: [
    1, 1, 1, 1, 1,
  ],
  // 129 Quake Tower (tower) — YARD_PROPS.as:6872
  129: [
    10000, 16000, 22000, 28000, 34000, 34000, 34000, 34000,
  ],
  // 131 bdg_wmi2totem (decoration) — YARD_PROPS.as:7045
  131: [
    100, 100, 100, 100, 100, 100,
  ],
  // 132 Magma Tower (tower) — YARD_PROPS.as:7142
  132: [
    15000, 22000, 30000, 49000, 59000, 70000,
  ],
  // 133 b_siegefactory (special) — YARD_PROPS.as:7312
  133: [
    10000,
  ],
  // 134 b_siegeworks (special) — YARD_PROPS.as:7358
  134: [
    10000, 14400, 19200, 26100, 35300, 43200, 52000, 60000, 72000, 84000,
  ],
  // 135 bdg_dave_trophy (decoration) — YARD_PROPS.as:7510
  135: [
    100,
  ],
  // 136 bi_spurtzcannon (tower) — YARD_PROPS.as:7551
  136: [
    15000, 22000, 30000, 48000, 60000,
  ],
  // 137 bi_blackspurtzcannon (tower) — YARD_PROPS.as:7663
  137: [
    16500, 24200, 33000, 52800, 66000,
  ],
  // 138 b_stronghold (tower) — YARD_PROPS.as:7775
  138: [
    400000, 500000, 600000,
  ],
  // 139 b_resourceop (cage) — YARD_PROPS.as:7851
  139: [
    1,
  ],
  // 140 b_opdefender (special) — YARD_PROPS.as:7890
  140: [
    8800, 42000, 200000, 400000, 600000,
  ],
};

/** A trap's one-shot blast (`client/scripts/BTRAP.as:98`, `:106`). */
export interface TrapStats {
  /** Full-strength damage at the centre, `YARD_PROPS.as` `"damage"[0]`. */
  readonly damage: number;
  /** The blast radius, and the denominator of the linear falloff. */
  readonly size: number;
  /** What it takes to destroy the trap before it fires. */
  readonly hp: number;
}

/** The Booby Trap and the Heavy Trap. Both have a single level. */
export const TRAP_STATS: Readonly<Record<number, TrapStats>> = {
  // 24 Booby Trap (trap) — YARD_PROPS.as:2682
  24: { damage: 1000, size: 50, hp: 10 },
  // 117 Heavy Trap (trap) — YARD_PROPS.as:6283
  117: { damage: 10000, size: 90, hp: 10 },
};

/**
 * The three `capacity` ladders Map Room 2 replaces, `capacity[level - 1]`.
 *
 * `GLOBAL.changeNotMaproom3SpecificBuildings()` overwrites these whenever the
 * account is not in Map Room 3, and this project runs Map Room 2 as the default
 * overworld. The cost table deliberately carries none of them, because a
 * bunker's room and a flinger's payload are not resource amounts
 * (`web/tools/gen-building-costs.mjs:158-167`).
 */
export const MR2_CAPACITY: Readonly<Record<number, readonly number[]>> = {
  // 5 Flinger (special) — YARD_PROPS.as:598, Map Room 2 override GLOBAL.as:713
  5: [500, 1000, 1750, 2250, 3000, 4000],
  // 15 Housing (special) — YARD_PROPS.as:1553, Map Room 2 override GLOBAL.as:682
  15: [200, 260, 320, 380, 450, 540],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2410, Map Room 2 override GLOBAL.as:683
  22: [380, 450, 540, 660, 800],
};

/**
 * Which creeps a tower may shoot at: 0 ground only, 1 both, 2 air only.
 *
 * `BTOWER._targetFlyerMode` (`client/scripts/BTOWER.as:25-35`), read twice by
 * the client — once to refuse a flying target and once to pick the firing
 * animation (`:165`, `:390`). A tower type absent from this table is ground
 * only, which is what the client's truthiness test on a missing key means.
 */
export const FLYER_MODE: Readonly<Record<number, 0 | 1 | 2>> = {
  20: 0, 21: 1, 23: 0, 25: 1, 115: 2, 118: 0, 129: 0, 130: 0, 132: 1,
};

/** One pathing cost rectangle: `[x, y, w, h, cost]` in yard units. */
export type GridCostRect = readonly [x: number, y: number, w: number, h: number, cost: number];

/**
 * What each type stamps onto the pathing grid.
 *
 * Read from the `_gridCost` of the class the props entry names in `"cls"`,
 * following `extends` when the class inherits it. `PATHING.RegisterBuilding`
 * adds each rectangle's cost to the cells it covers, so a creep routes around
 * the expensive middle of a building rather than through it
 * (`client/scripts/com/monsters/pathing/PATHING.as:158-159`).
 *
 * The traps have no row, which is correct: `BTRAP` declares no `_gridCost`,
 * so a trap is invisible to pathing and a creep walks straight over it.
 */
export const GRID_COST: Readonly<Record<number, readonly GridCostRect[]>> = {
  // 1 Twig Snapper (resource) — YARD_PROPS.as:10 via BUILDING1
  1: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 2 Pebble Shiner (resource) — YARD_PROPS.as:157 via BUILDING2
  2: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 3 Putty Squisher (resource) — YARD_PROPS.as:304 via BUILDING3
  3: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 4 Goo Factory (resource) — YARD_PROPS.as:451 via BUILDING4
  4: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 5 Flinger (special) — YARD_PROPS.as:598 via BUILDING5
  5: [[0, 0, 90, 90, 10], [10, 10, 70, 70, 200]],
  // 6 Storage Silo (special) — YARD_PROPS.as:713 via BUILDING6
  6: [[0, 0, 80, 80, 10], [10, 10, 60, 60, 200]],
  // 7 Mushroom (mushroom) — YARD_PROPS.as:873 via BUILDING7
  7: [[0, 0, 30, 30, 10]],
  // 8 Monster Locker (special) — YARD_PROPS.as:901 via BUILDING8
  8: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 9 Monster Juicer (special) — YARD_PROPS.as:1002 via BUILDING9
  9: [[0, 0, 80, 80, 50]],
  // 10 Yard Planner (special) — YARD_PROPS.as:1063 via BUILDING10
  10: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 11 Map Room (special) — YARD_PROPS.as:1110 via BUILDING11
  11: [[0, 0, 90, 90, 10], [10, 10, 70, 70, 200]],
  // 12 General Store (special) — YARD_PROPS.as:1170 via BUILDING12
  12: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 13 Hatchery (special) — YARD_PROPS.as:1216 via HatcheryBase
  13: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 14 Town Hall (special) — YARD_PROPS.as:1299 via BUILDING14 (main-yard branch)
  14: [[0, 0, 130, 130, 10], [10, 10, 110, 110, 200]],
  // 15 Housing (special) — YARD_PROPS.as:1553 via BUILDING15
  15: [
    [10, 10, 140, 20, 400], [130, 30, 20, 120, 400], [10, 30, 20, 120, 400], [30, 130, 30, 20, 400],
    [100, 130, 30, 20, 400],
  ],
  // 16 Hatchery Control Center (special) — YARD_PROPS.as:1663 via HatcheryBase
  16: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 17 Block (wall) — YARD_PROPS.as:1710 via BUILDING17
  17: [[-10, -10, 40, 40, 20], [0, 0, 20, 20, 200]],
  // 18 Stone Block (wall) — YARD_PROPS.as:1831 via BUILDING18
  18: [[-10, -10, 40, 40, 20], [0, 0, 20, 20, 200]],
  // 19 Wild Monster Baiter (special) — YARD_PROPS.as:1875 via BUILDING19
  19: [[0, 0, 80, 80, 50]],
  // 20 Cannon Tower (tower) — YARD_PROPS.as:1966 via BUILDING20
  20: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 21 Sniper Tower (tower) — YARD_PROPS.as:2187 via BUILDING21
  21: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2410 via BUILDING22
  22: [[0, 0, 10, 10, 50], [80, 0, 10, 10, 50], [0, 80, 10, 10, 50], [80, 80, 10, 10, 50]],
  // 23 Laser Tower (tower) — YARD_PROPS.as:2487 via BUILDING23
  23: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 25 Tesla Tower (tower) — YARD_PROPS.as:2728 via BUILDING25
  25: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 26 Monster Academy (special) — YARD_PROPS.as:2923 via BUILDING26
  26: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 27 Horsey (enemy) — YARD_PROPS.as:3029 via BUILDING27
  27: [[0, 0, 140, 140, 200]],
  // 28 American Flag (decoration) — YARD_PROPS.as:3064 via BDECORATION
  28: [[0, 0, 20, 20, 2]],
  // 29 British Flag (decoration) — YARD_PROPS.as:3098 via BDECORATION
  29: [[0, 0, 20, 20, 2]],
  // 30 Australian Flag (decoration) — YARD_PROPS.as:3132 via BDECORATION
  30: [[0, 0, 20, 20, 2]],
  // 31 Brazilian Flag (decoration) — YARD_PROPS.as:3166 via BDECORATION
  31: [[0, 0, 20, 20, 2]],
  // 32 European Flag (decoration) — YARD_PROPS.as:3200 via BDECORATION
  32: [[0, 0, 20, 20, 2]],
  // 33 French Flag (decoration) — YARD_PROPS.as:3235 via BDECORATION
  33: [[0, 0, 20, 20, 2]],
  // 34 Indonesian Flag (decoration) — YARD_PROPS.as:3269 via BDECORATION
  34: [[0, 0, 20, 20, 2]],
  // 35 Italian Flag (decoration) — YARD_PROPS.as:3303 via BDECORATION
  35: [[0, 0, 20, 20, 2]],
  // 36 Malaysian Flag (decoration) — YARD_PROPS.as:3337 via BDECORATION
  36: [[0, 0, 20, 20, 2]],
  // 37 Dutch Flag (decoration) — YARD_PROPS.as:3371 via BDECORATION
  37: [[0, 0, 20, 20, 2]],
  // 38 New Zealand Flag (decoration) — YARD_PROPS.as:3405 via BDECORATION
  38: [[0, 0, 20, 20, 2]],
  // 39 Norwegian Flag (decoration) — YARD_PROPS.as:3439 via BDECORATION
  39: [[0, 0, 20, 20, 2]],
  // 40 Polish Flag (decoration) — YARD_PROPS.as:3473 via BDECORATION
  40: [[0, 0, 20, 20, 2]],
  // 41 Swedish Flag (decoration) — YARD_PROPS.as:3507 via BDECORATION
  41: [[0, 0, 20, 20, 2]],
  // 42 Turkish Flag (decoration) — YARD_PROPS.as:3541 via BDECORATION
  42: [[0, 0, 20, 20, 2]],
  // 43 Canadian Flag (decoration) — YARD_PROPS.as:3575 via BDECORATION
  43: [[0, 0, 20, 20, 2]],
  // 44 Danish Flag (decoration) — YARD_PROPS.as:3609 via BDECORATION
  44: [[0, 0, 20, 20, 2]],
  // 45 German Flag (decoration) — YARD_PROPS.as:3643 via BDECORATION
  45: [[0, 0, 20, 20, 2]],
  // 46 Filipino Flag (decoration) — YARD_PROPS.as:3677 via BDECORATION
  46: [[0, 0, 20, 20, 2]],
  // 47 Singaporean Flag (decoration) — YARD_PROPS.as:3711 via BDECORATION
  47: [[0, 0, 20, 20, 2]],
  // 48 Austrian Flag (decoration) — YARD_PROPS.as:3745 via BDECORATION
  48: [[0, 0, 20, 20, 2]],
  // 49 Pirate Flag (decoration) — YARD_PROPS.as:3779 via BDECORATION
  49: [[0, 0, 20, 20, 2]],
  // 50 Peace Flag (decoration) — YARD_PROPS.as:3814 via BDECORATION
  50: [[0, 0, 20, 20, 2]],
  // 51 Catapult (special) — YARD_PROPS.as:3849 via BUILDING51
  51: [[0, 0, 90, 90, 10], [10, 10, 70, 70, 200]],
  // 52 Simple Sign (taunt) — YARD_PROPS.as:3937 via BUILDING52
  52: [[0, 0, 40, 40, 20]],
  // 53 hwn_pumpkin (immovable) — YARD_PROPS.as:3973 via BDECORATION
  53: [[0, 0, 10, 10, 2]],
  // 54 hwn_massivepumpkin (immovable) — YARD_PROPS.as:3997 via BDECORATION
  54: [[0, 0, 10, 10, 2]],
  // 55 bdg_acorn (decoration) — YARD_PROPS.as:4022 via BDECORATION
  55: [[0, 0, 30, 30, 2]],
  // 56 bdg_beehive (decoration) — YARD_PROPS.as:4055 via BDECORATION
  56: [[0, 0, 40, 40, 2]],
  // 57 bdg_birdhous (decoration) — YARD_PROPS.as:4088 via BDECORATION
  57: [[0, 0, 30, 30, 2]],
  // 58 bdg_tent (decoration) — YARD_PROPS.as:4121 via BDECORATION
  58: [[0, 0, 40, 40, 2]],
  // 59 bdg_jax (decoration) — YARD_PROPS.as:4155 via BDECORATION
  59: [[0, 0, 20, 20, 2]],
  // 60 bdg_redgnome (decoration) — YARD_PROPS.as:4189 via BDECORATION
  60: [[0, 0, 20, 20, 2]],
  // 61 bdg_bluegnome (decoration) — YARD_PROPS.as:4222 via BDECORATION
  61: [[0, 0, 20, 20, 2]],
  // 62 bdg_greengnome (decoration) — YARD_PROPS.as:4255 via BDECORATION
  62: [[0, 0, 20, 20, 2]],
  // 63 bdg_hammock (decoration) — YARD_PROPS.as:4288 via BDECORATION
  63: [[0, 0, 40, 40, 2]],
  // 64 bdg_lawnchair (decoration) — YARD_PROPS.as:4321 via BDECORATION
  64: [[0, 0, 40, 40, 2]],
  // 65 bdg_outhouse (decoration) — YARD_PROPS.as:4354 via BDECORATION
  65: [[0, 0, 30, 30, 2]],
  // 66 bdg_pinecone (decoration) — YARD_PROPS.as:4387 via BDECORATION
  66: [[0, 0, 30, 30, 2]],
  // 67 bdg_rock (decoration) — YARD_PROPS.as:4420 via BDECORATION
  67: [[0, 0, 30, 30, 2]],
  // 68 bdg_scaleelectric (decoration) — YARD_PROPS.as:4454 via BDECORATION
  68: [[0, 0, 100, 100, 2]],
  // 69 bdg_scarecrow (decoration) — YARD_PROPS.as:4487 via BDECORATION
  69: [[0, 0, 40, 40, 2]],
  // 70 bdg_sundial (decoration) — YARD_PROPS.as:4521 via BDECORATION
  70: [[0, 0, 40, 40, 2]],
  // 71 bdg_tikitorch (decoration) — YARD_PROPS.as:4555 via BDECORATION
  71: [[0, 0, 20, 20, 2]],
  // 72 bdg_walnut (decoration) — YARD_PROPS.as:4589 via BDECORATION
  72: [[0, 0, 30, 30, 2]],
  // 73 bdg_tombstone (decoration) — YARD_PROPS.as:4622 via BDECORATION
  73: [[0, 0, 40, 40, 2]],
  // 74 bdg_pokeyhead (decoration) — YARD_PROPS.as:4655 via BDECORATION
  74: [[0, 0, 20, 20, 2]],
  // 75 bdg_octohead (decoration) — YARD_PROPS.as:4688 via BDECORATION
  75: [[0, 0, 20, 20, 2]],
  // 76 bdg_bolthead (decoration) — YARD_PROPS.as:4721 via BDECORATION
  76: [[0, 0, 20, 20, 2]],
  // 77 bdg_banditohead (decoration) — YARD_PROPS.as:4754 via BDECORATION
  77: [[0, 0, 20, 20, 2]],
  // 78 bdg_brainhead (decoration) — YARD_PROPS.as:4787 via BDECORATION
  78: [[0, 0, 20, 20, 2]],
  // 79 bdg_crabhead (decoration) — YARD_PROPS.as:4820 via BDECORATION
  79: [[0, 0, 20, 20, 2]],
  // 80 bdg_davehead (decoration) — YARD_PROPS.as:4853 via BDECORATION
  80: [[0, 0, 20, 20, 2]],
  // 81 bdg_eyerahead (decoration) — YARD_PROPS.as:4886 via BDECORATION
  81: [[0, 0, 20, 20, 2]],
  // 82 bdg_fanghead (decoration) — YARD_PROPS.as:4919 via BDECORATION
  82: [[0, 0, 20, 20, 2]],
  // 83 bdg_finkhead (decoration) — YARD_PROPS.as:4952 via BDECORATION
  83: [[0, 0, 20, 20, 2]],
  // 84 bdg_ichihead (decoration) — YARD_PROPS.as:4985 via BDECORATION
  84: [[0, 0, 20, 20, 2]],
  // 85 bdg_projectxhead (decoration) — YARD_PROPS.as:5018 via BDECORATION
  85: [[0, 0, 20, 20, 2]],
  // 86 bdg_blackberrybush (decoration) — YARD_PROPS.as:5051 via BDECORATION
  86: [[0, 0, 40, 40, 2]],
  // 87 bdg_bonsaitree (decoration) — YARD_PROPS.as:5081 via BDECORATION
  87: [[0, 0, 40, 40, 2]],
  // 88 bdg_cactus (decoration) — YARD_PROPS.as:5114 via BDECORATION
  88: [[0, 0, 20, 20, 2]],
  // 89 bdg_flytrap (decoration) — YARD_PROPS.as:5147 via BDECORATION
  89: [[0, 0, 70, 70, 2]],
  // 90 bdg_thorns (decoration) — YARD_PROPS.as:5180 via BDECORATION
  90: [[0, 0, 40, 40, 2]],
  // 91 bdg_pinkflowers (decoration) — YARD_PROPS.as:5213 via BDECORATION
  91: [[0, 0, 20, 20, 2]],
  // 92 bdg_purpleflowers (decoration) — YARD_PROPS.as:5246 via BDECORATION
  92: [[0, 0, 20, 20, 2]],
  // 93 bdg_redflowers (decoration) — YARD_PROPS.as:5279 via BDECORATION
  93: [[0, 0, 20, 20, 2]],
  // 94 bdg_whiteflowers (decoration) — YARD_PROPS.as:5312 via BDECORATION
  94: [[0, 0, 20, 20, 2]],
  // 95 bdg_yellowflowers (decoration) — YARD_PROPS.as:5345 via BDECORATION
  95: [[0, 0, 20, 20, 2]],
  // 96 bdg_baseballstatue (decoration) — YARD_PROPS.as:5378 via BDECORATION
  96: [[0, 0, 40, 40, 2]],
  // 97 bdg_footballstatue (decoration) — YARD_PROPS.as:5416 via BDECORATION
  97: [[0, 0, 40, 40, 2]],
  // 98 bdg_soccerstatue (decoration) — YARD_PROPS.as:5454 via BDECORATION
  98: [[0, 0, 40, 40, 2]],
  // 99 bdg_libertystatue (decoration) — YARD_PROPS.as:5492 via BDECORATION
  99: [[0, 0, 70, 70, 2]],
  // 100 bdg_eiffelstatue (decoration) — YARD_PROPS.as:5530 via BDECORATION
  100: [[0, 0, 70, 70, 2]],
  // 101 bdg_bigben (decoration) — YARD_PROPS.as:5568 via BDECORATION
  101: [[0, 0, 70, 70, 2]],
  // 102 bdg_pool (decoration) — YARD_PROPS.as:5606 via BDECORATION
  102: [[0, 0, 100, 100, 2]],
  // 103 bdg_pond (decoration) — YARD_PROPS.as:5639 via BDECORATION
  103: [[0, 0, 100, 100, 2]],
  // 104 bdg_zengarden (decoration) — YARD_PROPS.as:5669 via BDECORATION
  104: [[0, 0, 100, 100, 2]],
  // 105 bdg_fountain (decoration) — YARD_PROPS.as:5702 via BDECORATION
  105: [[0, 0, 70, 70, 2]],
  // 106 bdg_teagarden (decoration) — YARD_PROPS.as:5735 via BDECORATION
  106: [[0, 0, 100, 100, 2]],
  // 107 bdg_monsterskull (decoration) — YARD_PROPS.as:5768 via BDECORATION
  107: [[0, 0, 20, 20, 2]],
  // 108 bdg_rubikunsolved (decoration) — YARD_PROPS.as:5801 via BDECORATION
  108: [[0, 0, 20, 20, 2]],
  // 109 bdg_rubiksolved (decoration) — YARD_PROPS.as:5834 via BDECORATION
  109: [[0, 0, 20, 20, 2]],
  // 110 bdg_halloween (decoration) — YARD_PROPS.as:5867 via BDECORATION
  110: [[0, 0, 40, 40, 2]],
  // 112 b_outpost (special) — YARD_PROPS.as:5934 via BUILDING112
  112: [[0, 0, 130, 130, 10], [10, 10, 110, 110, 200]],
  // 113 Radio Tower (special) — YARD_PROPS.as:5949 via BUILDING113
  113: [[0, 0, 80, 80, 200]],
  // 114 Champion Cage (cage) — YARD_PROPS.as:5993 via CHAMPIONCAGE
  114: [
    [10, 10, 140, 20, 400], [130, 30, 20, 120, 400], [10, 30, 20, 120, 400], [30, 130, 30, 20, 400],
    [100, 130, 30, 20, 400],
  ],
  // 115 Aerial Defense Tower (tower) — YARD_PROPS.as:6033 via BUILDING115
  115: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 116 Monster Lab (special) — YARD_PROPS.as:6225 via MONSTERLAB
  116: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 118 Railgun (tower) — YARD_PROPS.as:6324 via BUILDING118
  118: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 119 Champion Chamber (special) — YARD_PROPS.as:6521 via CHAMPIONCHAMBER
  119: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 120 bdg_biggulp (decoration) — YARD_PROPS.as:6563 via BDECORATION
  120: [[0, 0, 70, 70, 2]],
  // 121 bdg_wmitotem1 (decoration) — YARD_PROPS.as:6597 via BDECORATION
  121: [[0, 0, 40, 40, 2]],
  // 127 Inferno Cavern (enemy) — YARD_PROPS.as:6779 via INFERNOPORTAL
  127: [[0, 0, 190, 160, 200]],
  // 128 b_housingbunker (tower) — YARD_PROPS.as:6857 via HOUSINGBUNKER
  128: [
    [10, 10, 140, 20, 400], [10, 30, 20, 120, 400], [30, 130, 120, 20, 400], [130, 30, 20, 30, 400],
    [130, 100, 20, 30, 400],
  ],
  // 129 Quake Tower (tower) — YARD_PROPS.as:6872 via INFERNOQUAKETOWER
  129: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 130 b_icannontower (tower) — YARD_PROPS.as:7030 via INFERNO_CANNON_TOWER
  130: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 131 bdg_wmi2totem (decoration) — YARD_PROPS.as:7045 via BDECORATION
  131: [[0, 0, 40, 40, 2]],
  // 132 Magma Tower (tower) — YARD_PROPS.as:7142 via INFERNO_MAGMA_TOWER
  132: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 133 b_siegefactory (special) — YARD_PROPS.as:7312 via SiegeBuilding
  133: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 134 b_siegeworks (special) — YARD_PROPS.as:7358 via SiegeBuilding
  134: [[0, 0, 100, 100, 10], [10, 10, 80, 80, 200]],
  // 135 bdg_dave_trophy (decoration) — YARD_PROPS.as:7510 via BDECORATION
  135: [[0, 0, 70, 70, 2]],
  // 136 bi_spurtzcannon (tower) — YARD_PROPS.as:7551 via SpurtzCannon
  136: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 137 bi_blackspurtzcannon (tower) — YARD_PROPS.as:7663 via SpurtzCannon
  137: [[0, 0, 70, 70, 10], [10, 10, 50, 50, 200]],
  // 138 b_stronghold (tower) — YARD_PROPS.as:7775 via GuardTower
  138: [[0, 0, 130, 130, 10], [10, 10, 110, 110, 200]],
  // 139 b_resourceop (cage) — YARD_PROPS.as:7851 via ResourceOutpost
  139: [[0, 0, 130, 130, 10], [10, 10, 110, 110, 200]],
  // 140 b_opdefender (special) — YARD_PROPS.as:7890 via OutpostDefender
  140: [[0, 0, 130, 130, 10], [10, 10, 110, 110, 200]],
};

/** A rectangle whose cost is a function of the building's level, not a constant. */
export interface GridCostFormula {
  /** Index into this type's {@link GRID_COST} row. */
  readonly rect: number;
  readonly base: number;
  readonly perLevel: number;
}

/**
 * The wall, whose inner rectangle is priced by level.
 *
 * `BFOUNDATION.SetProps` rewrites `_gridCost[1][1]` to `100 + level * 25` for
 * type 17 (`client/scripts/BFOUNDATION.as:3151`), so the 200 the
 * class constructor sets is never what a placed wall costs. Type 18 never
 * reaches it: the loader rewrites type 18 to `t: 17, l: 2`
 * (`client/scripts/BASE.as:1523-1526`).
 */
export const GRID_COST_FORMULA: Readonly<Record<number, GridCostFormula>> = {
  17: { rect: 1, base: 100, perLevel: 25 },
};

/**
 * The combat half of a monster's props, indexed by level minus one.
 *
 * Copied from `server/src/game-data/stats/monsterStats.ts`, which is already
 * what the attack gate checks a client's declared stats against
 * (`server/src/services/maproom/validateAttack.ts:25-91`). The training and
 * hatching ladders are economy and stay out.
 */
export interface MonsterCombatProps {
  /** Yard units per slow tick, before the two halvings `stats.ts` applies. */
  readonly speed?: readonly number[];
  readonly health?: readonly number[];
  readonly damage?: readonly number[];
  /** Absent means melee, which the client reads as a range of 1 (`CreepBase.as:112-114`). */
  readonly range?: readonly number[];
  /** Fast ticks between swings; absent means 60 (`CreepBase.as:108-111`). */
  readonly attackDelay?: readonly number[];
  /** 1 all, 2 walls, 3 resources, 4 towers, 5 monsters, 6 champions. */
  readonly targetGroup?: readonly number[];
  /** Flinger payload units one of these costs. */
  readonly bucket?: readonly number[];
  /** Housing space one of these takes. */
  readonly cStorage?: readonly number[];
  /** Present and 1 on a creep that dies on its own blast (`CreepBase.as:896-898`). */
  readonly explode?: readonly number[];
  /** How many children a Slimeattikus leaves (`creeps/Slimeattikus.as:11-13`). */
  readonly splits?: readonly number[];
  readonly zombieHealthMultiplier?: readonly number[];
  readonly zombieSpeedMultiplier?: readonly number[];
  readonly zombieDamageMultiplier?: readonly number[];
  readonly resurrectCooldown?: readonly number[];
}

/** One monster: its root movement and pathing strings, and its props. */
export interface MonsterCombatStat {
  /** `ground`, `fly`, `fly_low`, `burrow`, … */
  readonly movement?: string;
  readonly pathing?: string;
  readonly props: MonsterCombatProps;
}

/** Every Map Room 2 monster, keyed by the id a roster spells (`C1`, `IC7`, …). */
export const MONSTER_PROPS: Readonly<Record<string, MonsterCombatStat>> = {
  C1: {
    props: {
      speed: [1.2],
      health: [200, 220, 240, 260, 280, 300],
      damage: [60, 65, 70, 75, 80, 85],
      targetGroup: [1],
      bucket: [7],
      cStorage: [10, 10, 10, 9, 8, 7],
    },
  },
  C2: {
    props: {
      speed: [1.4],
      health: [1000, 1100, 1300, 1450, 1600, 1800],
      damage: [15, 15, 20, 25, 30, 35],
      targetGroup: [4],
      bucket: [10],
      cStorage: [10],
    },
  },
  C3: {
    props: {
      speed: [2.5, 2.55, 2.6, 2.8, 3, 3.2],
      health: [150],
      damage: [15, 20, 25, 35, 45, 55],
      targetGroup: [3],
      bucket: [15],
      cStorage: [15],
    },
  },
  C4: {
    props: {
      speed: [1.3],
      health: [200, 200, 200, 200, 220, 240],
      damage: [300, 330, 380, 430, 470, 520],
      targetGroup: [1],
      bucket: [20],
      cStorage: [20],
    },
  },
  C5: {
    props: {
      speed: [2, 2.2, 2.4, 2.6, 2.8, 3],
      health: [600, 900, 1200, 1600, 2000, 2400],
      damage: [4000, 8000, 12000, 16000, 20000, 24000],
      targetGroup: [2],
      bucket: [60],
      cStorage: [60],
      explode: [1],
    },
  },
  C6: {
    props: {
      speed: [1.2],
      health: [2000, 2100, 2200, 2300, 2500, 2800],
      damage: [50, 60, 70, 80, 95, 110],
      targetGroup: [4],
      bucket: [20],
      cStorage: [20],
    },
  },
  C7: {
    props: {
      speed: [1],
      health: [500, 550, 600, 650, 750, 900],
      damage: [200, 250, 300, 350, 400, 450],
      targetGroup: [1],
      bucket: [20],
      cStorage: [20],
    },
  },
  C8: {
    props: {
      speed: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6],
      health: [400],
      damage: [600, 600, 620, 660, 720, 800],
      targetGroup: [1],
      bucket: [30],
      cStorage: [30],
    },
  },
  C9: {
    props: {
      speed: [2, 2, 2, 2, 2.1, 2.2],
      health: [600, 700, 750, 800, 1100, 1400],
      damage: [100, 100, 200, 250, 300, 350],
      targetGroup: [3],
      bucket: [30],
      cStorage: [30],
    },
  },
  C10: {
    props: {
      speed: [1, 1, 1, 1.2, 1.4, 1.5],
      health: [4000, 4000, 4300, 4400, 4600, 4800],
      damage: [100, 120, 130, 140, 150, 170],
      targetGroup: [4],
      bucket: [40],
      cStorage: [40],
    },
  },
  C11: {
    props: {
      speed: [0.9, 0.9, 1, 1.2, 1.2, 1.3],
      health: [800, 900, 950, 1000, 1100, 1200],
      damage: [1200, 1400, 1600, 1800, 2000, 2200],
      targetGroup: [4],
      bucket: [70],
      cStorage: [70],
    },
  },
  C12: {
    props: {
      speed: [0.8, 0.85, 0.9, 1, 1.1, 1.2],
      health: [8000, 9100, 10000, 12000, 16500, 21000],
      damage: [1500, 1500, 1600, 1700, 1800, 1900],
      targetGroup: [1],
      bucket: [160],
      cStorage: [160],
    },
  },
  C13: {
    movement: "burrow",
    pathing: "direct",
    props: {
      speed: [3, 4],
      health: [600, 800, 1100, 1300, 1500, 1700],
      damage: [300, 400, 550, 600, 650, 700],
      targetGroup: [1],
      bucket: [70],
      cStorage: [70],
    },
  },
  C14: {
    props: {
      speed: [2.5, 2.75, 3, 3.25, 3.5],
      health: [1600, 1900, 2400, 3000, 3600, 4200],
      damage: [300, 350, 400, 500, 600, 700],
      range: [150],
      attackDelay: [90],
      targetGroup: [1],
      bucket: [70],
      cStorage: [70],
    },
  },
  C15: {
    props: {
      speed: [0.75, 0.8, 0.85, 0.9, 0.95],
      health: [8000],
      damage: [-400, -550, -700, -850, -1000],
      range: [150],
      attackDelay: [20],
      targetGroup: [5],
      bucket: [200],
      cStorage: [200],
    },
  },
  C16: {
    props: {
      speed: [1.5, 1.75, 2, 2.25, 2.5],
      health: [750],
      damage: [-60, -70, -80, -90, -100, -110],
      range: [150],
      attackDelay: [10],
      targetGroup: [5],
      bucket: [60],
      cStorage: [60],
    },
  },
  C17: {
    props: {
      speed: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
      health: [700, 725, 750, 800, 900, 1000],
      damage: [850, 850, 900, 1000, 1200, 1400],
      targetGroup: [1],
      bucket: [40],
      cStorage: [40],
      splits: [2, 2, 3, 3, 4, 5],
    },
  },
  C18: {
    props: {
      speed: [1.5, 1.6, 1.7, 1.8, 1.9, 2],
      health: [250],
      damage: [310, 320, 330, 340, 350],
      targetGroup: [1],
      bucket: [40],
      cStorage: [40],
    },
  },
  C19: {
    props: {
      speed: [0.8, 0.9, 1, 1.1, 1.2, 1.3],
      health: [7000, 7500, 8000, 8500, 9000, 10000],
      damage: [700, 800, 900, 1000, 1100, 1200],
      range: [200],
      targetGroup: [4],
      bucket: [250],
      cStorage: [250],
      zombieHealthMultiplier: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
      zombieSpeedMultiplier: [0.75],
      zombieDamageMultiplier: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
      resurrectCooldown: [7, 7, 6, 6, 5, 4],
    },
  },
  IC1: {
    props: {
      speed: [1.2],
      health: [400, 425, 450, 475, 510, 550],
      damage: [160, 200, 200, 250, 300, 350],
      targetGroup: [1],
      bucket: [15],
      cStorage: [15],
    },
  },
  IC2: {
    props: {
      speed: [1.8],
      health: [1500, 1820, 2300, 2800, 3350, 3600],
      damage: [80, 85, 90, 95, 100, 110],
      targetGroup: [4],
      bucket: [15],
      cStorage: [15],
    },
  },
  IC3: {
    props: {
      speed: [3.2],
      health: [450, 470, 500, 540, 580, 620],
      damage: [100, 105, 110, 120, 130, 140],
      targetGroup: [3],
      bucket: [15],
      cStorage: [15],
    },
  },
  IC4: {
    props: {
      speed: [2, 2, 2, 2, 2, 2],
      health: [2000, 2400, 2800, 3200, 3600, 4000],
      damage: [490, 530, 580, 645, 700, 775],
      targetGroup: [2],
      bucket: [30],
      cStorage: [30],
    },
  },
  IC5: {
    props: {
      speed: [4.5],
      health: [3200, 3600, 4000, 4500, 5000, 5600],
      damage: [600, 665, 730, 795, 860, 930],
      targetGroup: [6],
      bucket: [40],
      cStorage: [40],
    },
  },
  IC6: {
    props: {
      speed: [1.3, 1.3, 1.4, 1.4, 1.5, 1.6],
      health: [7600, 8750, 9900, 10100, 11300, 12500],
      damage: [400, 425, 450, 475, 500, 550],
      targetGroup: [3],
      bucket: [50],
      cStorage: [50],
    },
  },
  IC7: {
    props: {
      speed: [1.7, 1.8, 1.9, 2, 2.1, 2.2],
      health: [1120, 1260, 1400, 1650, 1900, 2200],
      damage: [700, 825, 950, 1075, 1200, 1350],
      range: [240],
      targetGroup: [4],
      bucket: [80],
      cStorage: [80],
    },
  },
  IC8: {
    props: {
      speed: [2.5, 2.6, 2.7, 2.8, 2.9, 3],
      health: [6200, 7600, 8700, 10900, 13100, 16000],
      damage: [1200, 1360, 1630, 1920, 2220, 2500],
      targetGroup: [1],
      bucket: [100],
      cStorage: [100],
    },
  },
};

/**
 * The combat half of a champion's props.
 *
 * The five `bonus*` ladders are three entries long, one per power level, and
 * add to the level figure. Feeding economy (`feedShiny`, `evolveShiny`,
 * `feedCount`, `feedTime`, `bonusFeedShiny`, `bonusFeedTime`) and the render
 * offsets stay out.
 */
export interface ChampionCombatProps {
  readonly speed?: readonly number[];
  readonly health?: readonly number[];
  readonly damage?: readonly number[];
  readonly range?: readonly number[];
  readonly buffs?: readonly number[];
  readonly buffRadius?: readonly number[];
  readonly bucket?: readonly number[];
  readonly targetGroup?: readonly number[];
  readonly movement?: readonly string[];
  readonly attack?: readonly string[];
  readonly bonusSpeed?: readonly number[];
  readonly bonusHealth?: readonly number[];
  readonly bonusDamage?: readonly number[];
  readonly bonusRange?: readonly number[];
  readonly bonusBuffs?: readonly number[];
}

/** One champion, with the `t` an `attackerchampion` entry carries. */
export interface ChampionCombatStat {
  readonly t: number;
  readonly name: string;
  readonly props: ChampionCombatProps;
}

/** Every champion, keyed by the id the stat table spells (`G1`..`G5`). */
export const CHAMPION_PROPS: Readonly<Record<string, ChampionCombatStat>> = {
  // G1 Gorgo
  G1: {
    t: 1,
    name: "Gorgo",
    props: {
      speed: [1, 1.2, 1.4, 1.6, 1.8, 2],
      health: [40000, 80000, 120000, 140000, 160000, 200000],
      damage: [1000, 1200, 1500, 2000, 2500, 3000],
      range: [35, 45, 55, 65, 70, 70],
      buffs: [0],
      bucket: [240],
      targetGroup: [0],
      movement: ["ground"],
      attack: ["melee"],
      bonusSpeed: [0.1, 0.2, 0.4],
      bonusHealth: [12500, 27500, 50000],
      bonusDamage: [150, 330, 600],
      bonusRange: [0, 0, 0],
      bonusBuffs: [0, 0, 0],
    },
  },
  // G2 Drull
  G2: {
    t: 2,
    name: "Drull",
    props: {
      speed: [2, 2.2, 2.5, 2.8, 3.2, 3.6],
      health: [12000, 20000, 36000, 42000, 52000, 60000],
      damage: [3000, 3600, 4200, 5500, 6500, 8000],
      range: [35, 45, 55, 65, 85, 90],
      buffs: [0],
      bucket: [180],
      targetGroup: [0],
      movement: ["ground"],
      attack: ["melee"],
      bonusSpeed: [0.1, 0.2, 0.4],
      bonusHealth: [2500, 5500, 10000],
      bonusDamage: [400, 880, 1600],
      bonusRange: [0, 0, 0],
      bonusBuffs: [0, 0, 0],
    },
  },
  // G3 Fomor
  G3: {
    t: 3,
    name: "Fomor",
    props: {
      speed: [1.2, 1.4, 2, 2.1, 2.2, 2.3],
      health: [15000, 17500, 20000, 22500, 25000, 40000],
      damage: [70, 80, 90, 100, 110, 120],
      range: [140, 140, 180, 190, 200, 210],
      buffs: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      bucket: [200],
      targetGroup: [0],
      movement: ["ground", "ground", "fly"],
      attack: ["ranged"],
      bonusSpeed: [0.1, 0.2, 0.4],
      bonusHealth: [1000, 2200, 4000],
      bonusDamage: [3, 6, 10],
      bonusRange: [3, 6, 10],
      bonusBuffs: [0.03, 0.06, 0.15],
    },
  },
  // G4 Korath
  G4: {
    t: 4,
    name: "Korath",
    props: {
      speed: [1.4, 1.6, 1.8, 2, 2.3, 2.5],
      health: [28000, 62000, 96000, 120000, 144000, 175000],
      damage: [2000, 2400, 3000, 3800, 5000, 6500],
      range: [35, 45, 55, 60, 65, 65],
      buffs: [0],
      bucket: [200],
      targetGroup: [0],
      movement: ["ground"],
      attack: ["melee"],
      bonusSpeed: [0.1, 0.2, 0.4],
      bonusHealth: [1000, 2200, 4000],
      bonusDamage: [300, 600, 1000],
      bonusRange: [0, 0, 0],
      bonusBuffs: [0],
    },
  },
  // G5 Krallen
  G5: {
    t: 5,
    name: "Krallen",
    props: {
      speed: [2.2, 2.3, 2.4, 2.5, 2.6],
      health: [50000, 52000, 54000, 58000, 62000],
      damage: [800, 850, 900, 1000, 1200],
      range: [35, 45, 55, 60, 65],
      buffs: [0.2, 0.22, 0.24, 0.27, 0.3],
      buffRadius: [250, 275, 300, 325, 350],
      bucket: [200],
      targetGroup: [0],
      movement: ["ground"],
      attack: ["melee"],
      bonusSpeed: [0, 0, 0],
      bonusHealth: [0, 0, 0],
      bonusDamage: [0, 0, 0],
      bonusRange: [0, 0, 0],
      bonusBuffs: [0],
    },
  },
};
