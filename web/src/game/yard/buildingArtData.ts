/**
 * Building art, one row per building type. GENERATED — do not edit by hand.
 *
 * Source: `client/scripts/YARD_PROPS.as`, the `imageData` block of each entry
 * in `_yardProps` (declared at :9). Regenerate with
 * `node tools/gen-building-art.mjs` from `web/`.
 *
 * A row is `[typeId, name, folder, levels]`. `folder` is the `baseurl` the
 * Flash client prefixed every filename with, and is served by the game server
 * under `/assets/`. `levels` holds one entry per *image* level — the levels at
 * which the art changes, which is usually far fewer than the levels a building
 * can reach. A level with no entry of its own uses the nearest lower one; see
 * `resolveArt` in buildingArt.ts, mirroring `BFOUNDATION.as:896-914`.
 *
 * Each image is `[file, offsetX, offsetY]`, where the offset places the
 * bitmap's top-left corner relative to the building's isometric origin
 * (`BFOUNDATION.as:1108-1111`, `:1250-1252`). Shadows are JPEGs with no alpha
 * and are drawn with a multiply blend (`BFOUNDATION.as:1108`).
 */

/**
 * `[file, offsetX, offsetY]`, or null when this building has no such image.
 *
 * A fourth and fifth number mean the file is a horizontal animation strip and
 * only its first `width` x `height` cell should be drawn: a handful of
 * buildings, the Monster Bunker among them, ship no still art at all.
 */
export type ArtImage =
  | readonly [file: string, x: number, y: number]
  | readonly [file: string, x: number, y: number, width: number, height: number]
  | null;

/**
 * One animation layer: a horizontal strip of `frames` cells of `width` x
 * `height`, the first of which sits at `x`, `y` from the building's origin.
 *
 * Cell `i` is the rectangle `(i * width, 0, width, height)`
 * (`BFOUNDATION.as:1495`).
 */
export type ArtAnim = readonly [
  file: string,
  x: number,
  y: number,
  width: number,
  height: number,
  frames: number,
];

/**
 * `[level, top, topDamaged, topDestroyed, shadow, shadowDamaged, shadowDestroyed,
 * anims?, animsDamaged?]`.
 *
 * The two animation lists hold `anim`, `anim2` and `anim3` in the order they
 * stack above the top, and are omitted entirely for the 78 types that have
 * none. There is no destroyed list because the props table has no
 * `animdestroyed` anywhere: a wrecked building does not animate.
 */
export type ArtLevel = readonly [
  level: number,
  top: ArtImage,
  damaged: ArtImage,
  destroyed: ArtImage,
  shadow: ArtImage,
  shadowDamaged: ArtImage,
  shadowDestroyed: ArtImage,
  anims?: readonly ArtAnim[],
  animsDamaged?: readonly ArtAnim[],
];

export type ArtRow = readonly [
  type: number,
  name: string,
  folder: string,
  levels: readonly ArtLevel[],
  /** Maximum health per level, `hp[level - 1]`. Empty when the props table has none. */
  hp: readonly number[],
  /**
   * The props table's `size`. A build-menu size class for most buildings, but
   * the actual footprint for decorations
   * (`client/scripts/BDECORATION.as:20-25`). 0 when the entry has none.
   */
  size: number,
];

export const BUILDING_ART_ROWS: readonly ArtRow[] = [
  // 1 Twig Snapper (resource) — YARD_PROPS.as:94
  [1, "Twig Snapper", "buildings/twigsnapper.v2/", [
    [1,["top.1.png",-30,-19],["top.1.damaged.png",-30,-19],["top.destroyed.png",-34,2],["shadow.1.jpg",-23,29],["shadow.1.damaged.jpg",-28,28],["shadow.destroyed.jpg",-31,20],[["anim.1.png",-4,10,23,33,34]]],
    [3,["top.3.png",-32,-40],["top.3.damaged.png",-33,-37],["top.destroyed.png",-34,2],["shadow.3.jpg",-38,11],["shadow.3.damaged.jpg",-27,25],["shadow.destroyed.jpg",-31,20],[["anim.3.png",0,6,23,30,34]]],
    [6,["top.6.png",-34,-42],["top.6.damaged.png",-35,-42],["top.destroyed.png",-34,2],["shadow.6.jpg",-25,26],["shadow.6.damaged.jpg",-28,25],["shadow.destroyed.jpg",-31,20],[["anim.6.png",-1,1,34,34,34]]],
    [10,["top.10.png",-34,-54],["top.10.damaged.png",-35,-41],["top.destroyed.png",-34,2],["shadow.10.jpg",-26,26],["shadow.10.damaged.jpg",-28,22],["shadow.destroyed.jpg",-31,20],[["anim.10.png",-2,3,35,33,34]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 2 Pebble Shiner (resource) — YARD_PROPS.as:241
  [2, "Pebble Shiner", "buildings/pebbleshiner.v2/", [
    [1,["top.1.png",-34,-12],["top.1.damaged.png",-34,-6],["top.destroyed.png",-35,-2],["shadow.1.jpg",-33,27],["shadow.1.damaged.jpg",-31,27],["shadow.destroyed.jpg",-33,22],[["anim.1.png",-21,8,42,24,26]]],
    [3,["top.3.png",-34,-27],["top.3.damaged.png",-33,-26],["top.destroyed.png",-35,-2],["shadow.3.jpg",-33,27],["shadow.3.damaged.jpg",-31,22],["shadow.destroyed.jpg",-32,22],[["anim.3.png",-29,3,58,31,26]]],
    [6,["top.6.png",-34,-34],["top.6.damaged.png",-45,-32],["top.destroyed.png",-35,-2],["shadow.6.jpg",-34,20],["shadow.6.damaged.jpg",-34,20],["shadow.destroyed.jpg",-33,22],[["anim.6.png",-29,-5,58,41,26]]],
    [10,["top.10.png",-34,-32],["top.10.damaged.png",-34,-36],["top.destroyed.png",-35,-2],["shadow.10.jpg",-34,22],["shadow.10.damaged.jpg",-34,15],["shadow.destroyed.jpg",-33,22],[["anim.10.png",-29,-37,62,72,24]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 3 Putty Squisher (resource) — YARD_PROPS.as:388
  [3, "Putty Squisher", "buildings/puttysquisher.v2/", [
    [1,["top.1.png",-26,5],["top.1.damaged.png",-29,4],["top.destroyed.png",-39,5],["shadow.1.jpg",-21,29],["shadow.1.damaged.jpg",-28,28],["shadow.destroyed.jpg",-36,21],[["anim.1.png",-10,8,28,18,26]]],
    [3,["top.3.png",-28,-20],["top.3.damaged.png",-38,-20],["top.destroyed.png",-39,5],["shadow.3.jpg",-33,18],["shadow.3.damaged.jpg",-37,26],["shadow.destroyed.jpg",-36,21],[["anim.3.png",-10,-7,29,20,26]]],
    [6,["top.6.png",-30,-43],["top.6.damaged.png",-28,-38],["top.destroyed.png",-39,5],["shadow.6.jpg",-28,23],["shadow.6.damaged.jpg",-29,25],["shadow.destroyed.jpg",-36,21],[["anim.6.png",-10,-6,29,19,26]]],
    [10,["top.10.png",-31,-42],["top.10.damaged.png",-40,-40],["top.destroyed.png",-39,5],["shadow.10.jpg",-31,22],["shadow.10.damaged.jpg",-38,24],["shadow.destroyed.jpg",-36,21],[["anim.10.png",-10,-39,44,52,25]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 4 Goo Factory (resource) — YARD_PROPS.as:535
  [4, "Goo Factory", "buildings/goofactory.v2/", [
    [1,["top.1.png",-26,-33],["top.1.damaged.png",-32,-15],["top.destroyed.png",-31,0],["shadow.1.jpg",-25,29],["shadow.1.damaged.jpg",-30,27],["shadow.destroyed.jpg",-35,24],[["anim.1.png",3,14,22,40,26]]],
    [3,["top.3.png",-27,-33],["top.3.damaged.png",-28,-31],["top.destroyed.png",-31,0],["shadow.3.jpg",-31,21],["shadow.3.damaged.jpg",-31,20],["shadow.destroyed.jpg",-35,24],[["anim.3.png",4,12,25,45,26]]],
    [6,["top.6.png",-33,-33],["top.6.damaged.png",-37,-29],["top.destroyed.png",-31,0],["shadow.6.jpg",-26,27],["shadow.6.damaged.jpg",-36,25],["shadow.destroyed.jpg",-35,24],[["anim.6.png",-21,12,51,48,26]]],
    [10,["top.10.png",-40,-48],["top.10.damaged.png",-45,-42],["top.destroyed.png",-31,0],["shadow.10.jpg",-35,28],["shadow.10.damaged.jpg",-37,25],["shadow.destroyed.jpg",-35,24],[["anim.10.png",-21,11,51,47,26]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 5 Flinger (special) — YARD_PROPS.as:646
  [5, "Flinger", "buildings/flinger/", [
    [1,["top.1.png",-46,-43],["top.1.damaged.png",-63,-36],["top.2.destroyed.png",-75,-3],["shadow.1.jpg",-50,20],["shadow.1.damaged.jpg",-63,23],["shadow.2.destroyed.jpg",-70,24]],
    [2,["top.2.png",-45,-40],["top.2.damaged.png",-63,-18],["top.2.destroyed.png",-75,-3],["shadow.2.jpg",-48,19],["shadow.2.damaged.jpg",-63,26],["shadow.2.destroyed.jpg",-70,24]],
    [3,["top.3.png",-47,-45],["top.3.damaged.png",-75,-37],["top.2.destroyed.png",-75,-3],["shadow.3.jpg",-44,20],["shadow.3.damaged.jpg",-73,23],["shadow.2.destroyed.jpg",-70,24]],
    [4,["top.4.png",-45,-66],["top.4.damaged.png",-76,-53],["top.2.destroyed.png",-75,-3],["shadow.4.jpg",-47,22],["shadow.4.damaged.jpg",-76,23],["shadow.2.destroyed.jpg",-70,24]],
    [5,["top.4.png",-45,-66],["top.4.damaged.png",-76,-53],["top.2.destroyed.png",-75,-3],["shadow.4.jpg",-47,22],["shadow.4.damaged.jpg",-76,23],["shadow.2.destroyed.jpg",-70,24]],
  ], [4000,8000,16000,28000,56000], 190],
  // 6 Storage Silo (special) — YARD_PROPS.as:826
  [6, "Storage Silo", "buildings/storagesilo/", [
    [1,["top.3.png",-37,-52],["top.3.damaged.png",-37,-50],["top.3.destroyed.png",-51,23],["shadow.3.jpg",-37,25],["shadow.3.damaged.jpg",-36,33],["shadow.3.destroyed.jpg",-45,29],[["anim.3.png",-37,-52,74,121,26]]],
  ], [750,1400,2550,4750,8800,16250,30000,55600,105000,190000], 120],
  // 8 Monster Locker (special) — YARD_PROPS.as:942
  [8, "Monster Locker", "buildings/monsterlocker/", [
    [1,["top.1.png",-31,-29],["top.1.damaged.png",-38,-23],["top.2.destroyed.png",-53,-41],["shadow.1.jpg",-27,37],["shadow.1.damaged.jpg",-52,26],["shadow.2.destroyed.jpg",-52,25],[["anim.1.png",-42,-44,36,41,21]]],
    [2,["top.2.png",-51,-64],["top.2.damaged.png",-57,-47],["top.2.destroyed.png",-53,-41],["shadow.2.jpg",-40,18],["shadow.2.damaged.jpg",-52,26],["shadow.2.destroyed.jpg",-52,25],[["anim.2.png",-46,-93,61,69,20]]],
    [3,["top.3.png",-53,-79],["top.3.damaged.png",-54,-69],["top.2.destroyed.png",-53,-41],["shadow.3.jpg",-55,23],["shadow.3.damaged.jpg",-56,31],["shadow.2.destroyed.jpg",-52,25],[["anim.3.png",-48,-90,87,89,20]]],
    [4,["top.4.png",-54,-98],["top.4.damaged.png",-69,-78],["top.2.destroyed.png",-53,-41],["shadow.4.jpg",-54,30],["shadow.4.damaged.jpg",-59,30],["shadow.2.destroyed.jpg",-52,25],[["anim.4.png",-50,-91,92,89,21]]],
  ], [4000,16000,32000,64000], 120],
  // 9 Monster Juicer (special) — YARD_PROPS.as:1036
  [9, "Monster Juicer", "buildings/monsterjuiceloosener/", [
    [1,["top.2.png",-44,-8],["top.2.damaged.png",-59,-8],["top.2.destroyed.png",-55,0],["shadow.2.jpg",-44,16],["shadow.2.damaged.jpg",-59,21],["shadow.2.destroyed.jpg",-49,17],[["anim.2.png",-30,-17,60,39,51]]],
  ], [16000,32000,64000], 120],
  // 10 Yard Planner (special) — YARD_PROPS.as:1084
  [10, "Yard Planner", "buildings/yardplanner/", [
    [1,["top.1.png",-45,-29],["top.1.damaged.png",-58,-27],["top.1.destroyed.png",-52,6],["shadow.1.jpg",-57,16],["shadow.1.damaged.jpg",-46,23],["shadow.1.destroyed.jpg",-50,32]],
  ], [16000], 120],
  // 11 Map Room (special) — YARD_PROPS.as:1144
  [11, "Map Room", "buildings/maproom/", [
    [1,["top.1.png",-58,-67],["top.1.damaged.png",-73,-44],["top.1.destroyed.png",-70,0],["shadow.1.jpg",-68,15],["shadow.1.damaged.jpg",-67,23],["shadow.1.destroyed.jpg",-67,27]],
  ], [5000,10000,10000], 120],
  // 12 General Store (special) — YARD_PROPS.as:1190
  [12, "General Store", "buildings/generalstore/", [
    [1,["top.1.png",-40,-37],["top.1.damaged.png",-44,-49],["top.1.destroyed.png",-49,-28],["shadow.1.jpg",-44,13],["shadow.1.damaged.jpg",-44,15],["shadow.1.destroyed.jpg",-48,13]],
  ], [4000], 80],
  // 13 Hatchery (special) — YARD_PROPS.as:1250
  [13, "Hatchery", "buildings/hatchery/", [
    [1,["top.2.png",-50,-52],["top.2.damaged.png",-78,-92],["top.1.destroyed.png",-58,0],["shadow.2.jpg",-31,32],["shadow.2.damaged.jpg",-48,36],["shadow.1.destroyed.jpg",-58,32],[["anim.2.png",-53,-104,103,80,31]]],
    [2,["top.3.png",-51,-62],["top.3.damaged.png",-53,-113],["top.1.destroyed.png",-58,0],["shadow.3.jpg",-48,26],["shadow.3.damaged.jpg",-45,32],["shadow.1.destroyed.jpg",-58,32],[["anim.3.png",-40,-123,105,124,31]]],
    [3,["top.4.png",-50,-114],["top.4.damaged.png",-60,-117],["top.1.destroyed.png",-58,0],["shadow.4.jpg",-44,25],["shadow.4.damaged.jpg",-52,23],["shadow.1.destroyed.jpg",-58,32],[["anim.4.png",-12,-112,113,105,31]]],
  ], [4000,16000,32000], 120],
  // 14 Town Hall (special) — YARD_PROPS.as:1413
  [14, "Town Hall", "buildings/townhall/", [
    [1,["top.1.png",-45,-52],["top.1.damaged.png",-50,-50],["top.1.destroyed.png",-57,17],["shadow.1.jpg",-55,37],["shadow.1.damaged.jpg",-55,38],["shadow.1.destroyed.jpg",-54,37]],
    [2,["top.2.png",-48,-62],["top.2.damaged.png",-49,-59],["top.2.destroyed.png",-61,6],["shadow.2.jpg",-55,36],["shadow.2.damaged.jpg",-65,32],["shadow.2.destroyed.jpg",-59,28]],
    [3,["top.3.png",-65,-67],["top.3.damaged.png",-69,-68],["top.3.destroyed.png",-70,-8],["shadow.3.jpg",-70,28],["shadow.3.damaged.jpg",-74,29],["shadow.3.destroyed.jpg",-70,30]],
    [4,["top.4.png",-66,-72],["top.4.damaged.png",-66,-72],["top.4.destroyed.png",-92,-18],["shadow.4.jpg",-88,20],["shadow.4.damaged.jpg",-77,25],["shadow.4.destroyed.jpg",-91,25]],
    [5,["top.5.png",-67,-75],["top.5.damaged.png",-70,-69],["top.5.destroyed.png",-89,-16],["shadow.5.jpg",-67,33],["shadow.5.damaged.jpg",-17,20],["shadow.5.destroyed.jpg",-88,30]],
    [6,["top.6.png",-72,-82],["top.6.damaged.png",-72,-67],["top.6.destroyed.png",-92,-8],["shadow.6.jpg",-84,26],["shadow.6.damaged.jpg",-85,25],["shadow.6.destroyed.jpg",-90,25]],
    [7,["top.7.png",-81,-88],["top.7.damaged.png",-81,-89],["top.7.destroyed.png",-84,-13],["shadow.7.jpg",-121,-3],["shadow.7.damaged.jpg",-103,3],["shadow.7.destroyed.jpg",-102,8]],
    [8,["top.8.png",-80,-87],["top.8.damaged.png",-86,-91],["top.8.destroyed.png",-84,-13],["shadow.8.jpg",-94,8],["shadow.8.damaged.jpg",-86,13],["shadow.8.destroyed.jpg",-102,8]],
    [9,["top.9.png",-77,-97],["top.9.damaged.png",-86,-71],["top.9.destroyed.png",-80,-54],["shadow.9.jpg",-76,24],["shadow.9.damaged.jpg",-88,23],["shadow.9.destroyed.jpg",-81,23]],
    [10,["top.10.png",-77,-110],["top.10.damaged.png",-77,-110],["top.10.destroyed.png",-75,-45],["shadow.10.jpg",-85,24],["shadow.10.damaged.jpg",-85,24],["shadow.10.destroyed.jpg",-82,20]],
  ], [4000,8800,20000,42000,94000,200000,300000,400000,500000,600000], 190],
  // 15 Housing (special) — YARD_PROPS.as:1636
  [15, "Housing", "buildings/monsterhousing/", [
    [1,["top.3.v2.png",-109,11],["top.3.damaged.v2.png",-107,12],["top.3.destroyed.v2.png",-108,21],["shadow.3.v2.jpg",-112,23],["shadow.3.damaged.v2.jpg",-110,25],["shadow.3.destroyed.v2.jpg",-109,25]],
  ], [4000,14000,25000,43000,75000,130000,145000,160000,175000,190000], 200],
  // 16 Hatchery Control Center (special) — YARD_PROPS.as:1684
  [16, "Hatchery Control Center", "buildings/hatcherycontrolcenter/", [
    [1,["top.1.png",-40,-58],["top.1.damaged.png",-51,-59],["top.1.destroyed.png",-53,-7],["shadow.1.jpg",-51,20],["shadow.1.damaged.jpg",-50,25],["shadow.1.destroyed.jpg",-57,24]],
  ], [64000], 120],
  // 17 Block (wall) — YARD_PROPS.as:1759
  [17, "Block", "buildings/walls/", [
    [1,["top.1.png",-21,-21],["top.1.damaged.png",-21,-21],["top.1.destroyed.png",-21,-5],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7]],
    [2,["top.2.png",-20,-20],["top.2.damaged.png",-21,-20],["top.2.destroyed.png",-19,0],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7]],
    [3,["top.3.png",-21,-21],["top.3.damaged.png",-22,-21],["top.3.destroyed.png",-21,-3],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7]],
    [4,["top.4.v2.png",-20,-22],["top.4.damaged.v2.png",-20,-22],["top.4.destroyed.png",-20,-2],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7]],
    [5,["top.5.png",-20,-22],["top.5.damaged.png",-20,-19],["top.5.destroyed.png",-20,-3],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7],["shadow.jpg",-28,-7]],
  ], [1000,2300,5750,18000,27000], 50],
  // 18 Stone Block (wall) — YARD_PROPS.as:1852
  [18, "Stone Block", "buildings/walls/stone/", [
    [1,["top.1.png",-16,-21],["top.1.damaged.png",-17,-19],["top.1.destroyed.png",-16,0],["shadow.1.jpg",-19,-1],["shadow.1.jpg",-19,-1],["shadow.1.destroyed.jpg",-14,5]],
  ], [3600], 50],
  // 19 Wild Monster Baiter (special) — YARD_PROPS.as:1937
  [19, "Wild Monster Baiter", "buildings/monsterbaiter/", [
    [1,["top.1.png",-37,-6],["top.1.damaged.png",-37,-14],["top.1.destroyed.png",-37,10],["shadow.1.jpg",-9,16],["shadow.1.jpg",-9,16],["shadow.1.jpg",-9,16],[["anim.1.png",-33,-23,67,77,41]]],
  ], [1000,1500,2250,3375,5000,7500,12000], 120],
  // 20 Cannon Tower (tower) — YARD_PROPS.as:2141
  [20, "Cannon Tower", "buildings/cannontower/", [
    [1,["top.3.png",-33,-25],["top.3.damaged.png",-48,-25],["top.3.destroyed.png",-46,8],["shadow.3.jpg",-38,20],["shadow.3.jpg",-47,20],["shadow.3.jpg",-43,22]],
  ], [6000,9000,12600,17640,26460,34400,45000,58000,75500,98200], 64],
  // 21 Sniper Tower (tower) — YARD_PROPS.as:2362
  [21, "Sniper Tower", "buildings/snipertower/", [
    [1,["top.3.png",-40,-30],["top.3.damaged.png",-39,-25],["top.3.destroyed.png",-45,-13],["shadow.3.jpg",-43,12],["shadow.3.jpg",-39,15],["shadow.3.jpg",-45,-4],[["anim.3.png",-27,-50,55,47,30]],[["anim.3.damaged.png",-28,-49,55,46,30]]],
  ], [6000,9000,12600,17640,26460,34400,45000,58000,75500,98200], 64],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2460
  [22, "Monster Bunker", "buildings/bunker/", [
    [1,["anim.1.png",-46,-15,90,83],["top.1.damaged.png",-45,-8],["top.1.destroyed.png",-50,4],["shadow.1.jpg",-66,10],["shadow.1.damaged.jpg",-66,5],["shadow.1.destroyed.jpg",-61,14],[["anim.1.png",-46,-15,90,83,15]]],
  ], [10000,24500,52000,75000,105000], 120],
  // 23 Laser Tower (tower) — YARD_PROPS.as:2634
  [23, "Laser Tower", "buildings/lasertower/", [
    [1,["top.1.png",-33,-29],["top.1.damaged.png",-40,-28],["top.1.destroyed.png",-39,-3],["shadow.1.jpg",-36,15],["shadow.1.jpg",-37,-17],["shadow.1.jpg",-37,14],[["anim.1.png",-13,-50,29,32,54]],[["anim.1.damaged.png",-22,-46,52,44,54]]],
  ], [9000,12600,17640,26460,34400,42200,50000,58000], 120],
  // 24 Booby Trap (trap) — YARD_PROPS.as:2703
  [24, "Booby Trap", "buildings/boobytrap/", [
    [1,["top.1.png",-15,1],null,["top.1.destroyed.png",-15,2],["shadow.1.jpg",-13,3],null,["shadow.1.jpg",-13,3]],
  ], [10], 50],
  // 25 Tesla Tower (tower) — YARD_PROPS.as:2875
  [25, "Tesla Tower", "buildings/lightningtower/", [
    [1,["top.3.png",-33,-57],["top.3.damaged.png",-46,-58],["top.3.destroyed.png",-46,6],["shadow.3.jpg",-38,18],["shadow.3.jpg",-44,21],["shadow.3.jpg",-44,17],[["anim.3.png",-25,-15,27,53,55]],[["anim.3.damaged.png",-26,-19,30,57,55]]],
  ], [15000,22000,30000,48000,60000,72000,82000,90000], 50],
  // 26 Monster Academy (special) — YARD_PROPS.as:2969
  [26, "Monster Academy", "buildings/academy/", [
    [1,["top.1.png",-42,-12],["top.1.damaged.png",-50,-12],["top.1.destroyed.png",-50,11],["shadow.1.jpg",-47,27],["shadow.1.damaged.jpg",-47,20],["shadow.1.destroyed.jpg",-48,26],[["anim.1.v2.png",-22,-13,48,26,21]]],
    [2,["top.2.png",-43,-14],["top.2.damaged.png",-46,-15],["top.1.destroyed.png",-50,11],["shadow.2.jpg",-48,27],["shadow.2.damaged.jpg",-35,27],["shadow.1.destroyed.jpg",-48,26],[["anim.2.png",-22,-11,47,24,21]]],
    [3,["top.3.png",-53,-18],["top.3.damaged.png",-53,-17],["top.1.destroyed.png",-50,11],["shadow.3.jpg",-53,27],["shadow.3.damaged.jpg",-57,26],["shadow.1.destroyed.jpg",-48,26],[["anim.3.png",-24,-17,48,24,21]]],
    [4,["top.4.png",-53,-37],["top.4.damaged.png",-71,-35],["top.1.destroyed.png",-50,11],["shadow.4.jpg",-53,27],["shadow.4.damaged.jpg",-69,22],["shadow.1.destroyed.jpg",-48,26],[["anim.3.png",-24,-36,48,24,21]]],
  ], [6000,10000,14000,20000,30000], 50],
  // 27 Horsey (enemy) — YARD_PROPS.as:3051
  [27, "Horsey", "buildings/trojanhorse/", [
    [1,["top.1.png",-91,-65],null,null,["shadow.1.jpg",-72,11],null,null,[["anim.1.png",-92,-23,39,31,2]]],
  ], [1], 100],
  // 28 American Flag (decoration) — YARD_PROPS.as:3086
  [28, "American Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-usa.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 29 British Flag (decoration) — YARD_PROPS.as:3120
  [29, "British Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-britain.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 30 Australian Flag (decoration) — YARD_PROPS.as:3154
  [30, "Australian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-australia.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 31 Brazilian Flag (decoration) — YARD_PROPS.as:3188
  [31, "Brazilian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-brazil.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 32 European Flag (decoration) — YARD_PROPS.as:3223
  [32, "European Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-europe.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 33 French Flag (decoration) — YARD_PROPS.as:3257
  [33, "French Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-france.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 34 Indonesian Flag (decoration) — YARD_PROPS.as:3291
  [34, "Indonesian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-indonesian.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 35 Italian Flag (decoration) — YARD_PROPS.as:3325
  [35, "Italian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-italy.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 36 Malaysian Flag (decoration) — YARD_PROPS.as:3359
  [36, "Malaysian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-malaysia.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 37 Dutch Flag (decoration) — YARD_PROPS.as:3393
  [37, "Dutch Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-dutch.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 38 New Zealand Flag (decoration) — YARD_PROPS.as:3427
  [38, "New Zealand Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-newzealand.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 39 Norwegian Flag (decoration) — YARD_PROPS.as:3461
  [39, "Norwegian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-norway.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 40 Polish Flag (decoration) — YARD_PROPS.as:3495
  [40, "Polish Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-poland.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 41 Swedish Flag (decoration) — YARD_PROPS.as:3529
  [41, "Swedish Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-sweden.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 42 Turkish Flag (decoration) — YARD_PROPS.as:3563
  [42, "Turkish Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-turkey.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 43 Canadian Flag (decoration) — YARD_PROPS.as:3597
  [43, "Canadian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-canadian.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 44 Danish Flag (decoration) — YARD_PROPS.as:3631
  [44, "Danish Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-denmark.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 45 German Flag (decoration) — YARD_PROPS.as:3665
  [45, "German Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-germany.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 46 Filipino Flag (decoration) — YARD_PROPS.as:3699
  [46, "Filipino Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-philippines.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 47 Singaporean Flag (decoration) — YARD_PROPS.as:3733
  [47, "Singaporean Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-singapore.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 48 Austrian Flag (decoration) — YARD_PROPS.as:3767
  [48, "Austrian Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-austria.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 49 Pirate Flag (decoration) — YARD_PROPS.as:3802
  [49, "Pirate Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-pirate.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 50 Peace Flag (decoration) — YARD_PROPS.as:3837
  [50, "Peace Flag", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-43],null,null,["shadow.jpg",-3,5],null,null,[["flag-peace.png",1,-35,24,30,21]]],
  ], [100], 20],
  // 51 Catapult (special) — YARD_PROPS.as:3891
  [51, "Catapult", "buildings/catapult/", [
    [1,["top.1.png",-43,12],["top.1.damaged.png",-40,12],["top.3.destroyed.png",-48,9],["shadow.1.jpg",-42,28],["shadow.1.damaged.jpg",-39,28],["shadow.3.destroyed.jpg",-47,23]],
    [2,["top.2.png",-44,-21],["top.2.damaged.png",-43,-16],["top.3.destroyed.png",-48,9],["shadow.2.jpg",-49,19],["shadow.2.damaged.jpg",-41,29],["shadow.3.destroyed.jpg",-47,23]],
    [3,["top.3.png",-43,-29],["top.3.damaged.png",-51,-29],["top.3.destroyed.png",-48,9],["shadow.3.jpg",-39,27],["shadow.3.damaged.jpg",-51,30],["shadow.3.destroyed.jpg",-47,23]],
  ], [4000,8000,16000,32000], 190],
  // 52 Simple Sign (taunt) — YARD_PROPS.as:3961
  [52, "Simple Sign", "buildings/decorations/flags/", [
    [1,["flagpole.png",-5,-33],null,null,["shadow.jpg",-3,15],null,null,[["flag-pirate.png",1,-25,24,30,21]]],
  ], [100], 100],
  // 53 hwn_pumpkin (immovable) — YARD_PROPS.as:3989
  [53, "hwn_pumpkin", "buildings/decorations/pumpkins/", [
    [1,["anim.png",-18,-15,37,36],null,null,["shadow.jpg",-22,-1],null,null,[["anim.png",-18,-15,37,36,30]]],
  ], [], 10],
  // 54 hwn_massivepumpkin (immovable) — YARD_PROPS.as:4013
  [54, "hwn_massivepumpkin", "buildings/decorations/pumpkins/", [
    [1,["large-top-6.png",-169,-60],null,null,["large-shadow-6.jpg",-168,5],null,null,[["large-anim-6.png",-119,-113,189,155,45]]],
  ], [], 10],
  // 55 bdg_acorn (decoration) — YARD_PROPS.as:4044
  [55, "bdg_acorn", "buildings/decorations/acorn/", [
    [1,["top.png",-10,-9],null,null,["shadow.jpg",-9,8],null,null],
  ], [100], 30],
  // 56 bdg_beehive (decoration) — YARD_PROPS.as:4077
  [56, "bdg_beehive", "buildings/decorations/beehive/", [
    [1,["top.png",-18,-15],null,null,["shadow.jpg",-14,6],null,null],
  ], [100], 40],
  // 57 bdg_birdhous (decoration) — YARD_PROPS.as:4110
  [57, "bdg_birdhous", "buildings/decorations/birdhouse/", [
    [1,["top.png",-16,-46],null,null,["shadow.jpg",-2,17],null,null],
  ], [100], 30],
  // 58 bdg_tent (decoration) — YARD_PROPS.as:4144
  [58, "bdg_tent", "buildings/decorations/campingtent/", [
    [1,["top.png",-30,-12],null,null,["shadow.jpg",-29,6],null,null],
  ], [100], 40],
  // 59 bdg_jax (decoration) — YARD_PROPS.as:4178
  [59, "bdg_jax", "buildings/decorations/childrensjax/", [
    [1,["top.png",-11,-11],null,null,["shadow.jpg",-7,5],null,null],
  ], [100], 20],
  // 60 bdg_redgnome (decoration) — YARD_PROPS.as:4211
  [60, "bdg_redgnome", "buildings/decorations/gnomes/", [
    [1,["top-red.png",-10,-31],null,null,["shadow.jpg",-13,2],null,null],
  ], [100], 20],
  // 61 bdg_bluegnome (decoration) — YARD_PROPS.as:4244
  [61, "bdg_bluegnome", "buildings/decorations/gnomes/", [
    [1,["top-blue.png",-10,-31],null,null,["shadow.jpg",-13,2],null,null],
  ], [100], 20],
  // 62 bdg_greengnome (decoration) — YARD_PROPS.as:4277
  [62, "bdg_greengnome", "buildings/decorations/gnomes/", [
    [1,["top-green.png",-10,-31],null,null,["shadow.jpg",-13,2],null,null],
  ], [100], 20],
  // 63 bdg_hammock (decoration) — YARD_PROPS.as:4310
  [63, "bdg_hammock", "buildings/decorations/hammock/", [
    [1,["top.png",-25,-8],null,null,["shadow.jpg",-26,6],null,null],
  ], [100], 40],
  // 64 bdg_lawnchair (decoration) — YARD_PROPS.as:4343
  [64, "bdg_lawnchair", "buildings/decorations/lawnchair/", [
    [1,["top.png",-24,-14],null,null,["shadow.jpg",-25,4],null,null],
  ], [100], 40],
  // 65 bdg_outhouse (decoration) — YARD_PROPS.as:4376
  [65, "bdg_outhouse", "buildings/decorations/outhouse/", [
    [1,["top.png",-16,-19],null,null,["shadow.jpg",-11,10],null,null],
  ], [100], 30],
  // 66 bdg_pinecone (decoration) — YARD_PROPS.as:4409
  [66, "bdg_pinecone", "buildings/decorations/pinecone/", [
    [1,["top.png",-13,-10],null,null,["shadow.jpg",-23,3],null,null],
  ], [100], 30],
  // 67 bdg_rock (decoration) — YARD_PROPS.as:4443
  [67, "bdg_rock", "buildings/decorations/rock/", [
    [1,["top.png",-15,0],null,null,["shadow.jpg",-15,9],null,null],
  ], [100], 30],
  // 68 bdg_scaleelectric (decoration) — YARD_PROPS.as:4476
  [68, "bdg_scaleelectric", "buildings/decorations/scaleelectriccartoyset/", [
    [1,["top.png",-48,0],null,null,["shadow.jpg",-57,8],null,null],
  ], [100], 100],
  // 69 bdg_scarecrow (decoration) — YARD_PROPS.as:4510
  [69, "bdg_scarecrow", "buildings/decorations/scarecrow/", [
    [1,["top.png",-25,-43],null,null,["shadow.jpg",-20,8],null,null],
  ], [100], 40],
  // 70 bdg_sundial (decoration) — YARD_PROPS.as:4544
  [70, "bdg_sundial", "buildings/decorations/sundial/", [
    [1,["top.png",-23,-6],null,null,["shadow.jpg",-23,8],null,null],
  ], [100], 40],
  // 71 bdg_tikitorch (decoration) — YARD_PROPS.as:4577
  [71, "bdg_tikitorch", "buildings/decorations/tikitorch/", [
    [1,["top.png",-8,-38],null,null,["shadow.jpg",-6,3],null,null,[["anim.png",-11,-71,16,36,25]]],
  ], [100], 20],
  // 72 bdg_walnut (decoration) — YARD_PROPS.as:4611
  [72, "bdg_walnut", "buildings/decorations/walnut/", [
    [1,["top.png",-12,-2],null,null,["shadow.jpg",-23,3],null,null],
  ], [100], 30],
  // 73 bdg_tombstone (decoration) — YARD_PROPS.as:4644
  [73, "bdg_tombstone", "buildings/decorations/graveyardtombstone/", [
    [1,["top.png",-22,-13],null,null,["shadow.jpg",-20,9],null,null],
  ], [100], 40],
  // 74 bdg_pokeyhead (decoration) — YARD_PROPS.as:4677
  [74, "bdg_pokeyhead", "buildings/decorations/headsonsticks/", [
    [1,["top-pokey.png",-6,-28],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 75 bdg_octohead (decoration) — YARD_PROPS.as:4710
  [75, "bdg_octohead", "buildings/decorations/headsonsticks/", [
    [1,["top-octo.png",-6,-23],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 76 bdg_bolthead (decoration) — YARD_PROPS.as:4743
  [76, "bdg_bolthead", "buildings/decorations/headsonsticks/", [
    [1,["top-bolt.png",-10,-23],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 77 bdg_banditohead (decoration) — YARD_PROPS.as:4776
  [77, "bdg_banditohead", "buildings/decorations/headsonsticks/", [
    [1,["top-bandito.png",-5,-26],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 78 bdg_brainhead (decoration) — YARD_PROPS.as:4809
  [78, "bdg_brainhead", "buildings/decorations/headsonsticks/", [
    [1,["top-brain.png",-9,-28],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 79 bdg_crabhead (decoration) — YARD_PROPS.as:4842
  [79, "bdg_crabhead", "buildings/decorations/headsonsticks/", [
    [1,["top-crabatron.png",-10,-29],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 80 bdg_davehead (decoration) — YARD_PROPS.as:4875
  [80, "bdg_davehead", "buildings/decorations/headsonsticks/", [
    [1,["top-dave.png",-14,-30],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 81 bdg_eyerahead (decoration) — YARD_PROPS.as:4908
  [81, "bdg_eyerahead", "buildings/decorations/headsonsticks/", [
    [1,["top-eyera.png",-4,-23],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 82 bdg_fanghead (decoration) — YARD_PROPS.as:4941
  [82, "bdg_fanghead", "buildings/decorations/headsonsticks/", [
    [1,["top-fang.png",-10,-30],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 83 bdg_finkhead (decoration) — YARD_PROPS.as:4974
  [83, "bdg_finkhead", "buildings/decorations/headsonsticks/", [
    [1,["top-fink.png",-11,-29],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 84 bdg_ichihead (decoration) — YARD_PROPS.as:5007
  [84, "bdg_ichihead", "buildings/decorations/headsonsticks/", [
    [1,["top-ichi.png",-6,-29],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 85 bdg_projectxhead (decoration) — YARD_PROPS.as:5040
  [85, "bdg_projectxhead", "buildings/decorations/headsonsticks/", [
    [1,["top-projectx.png",-19,-24],null,null,["shadow.jpg",-1,7],null,null],
  ], [100], 20],
  // 86 bdg_blackberrybush (decoration) — YARD_PROPS.as:5073
  [86, "bdg_blackberrybush", "buildings/decorations/blackberrybush/", [
    [1,["top.png",-25,-13],null,null,null,null,null],
  ], [100], 40],
  // 87 bdg_bonsaitree (decoration) — YARD_PROPS.as:5103
  [87, "bdg_bonsaitree", "buildings/decorations/bonsaitree/", [
    [1,["top.png",-41,-36],null,null,["shadow.jpg",-22,15],null,null],
  ], [100], 40],
  // 88 bdg_cactus (decoration) — YARD_PROPS.as:5136
  [88, "bdg_cactus", "buildings/decorations/cactus/", [
    [1,["top.png",-14,-30],null,null,["shadow.jpg",-12,2],null,null],
  ], [100], 20],
  // 89 bdg_flytrap (decoration) — YARD_PROPS.as:5169
  [89, "bdg_flytrap", "buildings/decorations/flytrap/", [
    [1,["top.png",-33,-5],null,null,["shadow.jpg",-38,20],null,null],
  ], [100], 70],
  // 90 bdg_thorns (decoration) — YARD_PROPS.as:5202
  [90, "bdg_thorns", "buildings/decorations/thorns/", [
    [1,["top.png",-23,-18],null,null,["shadow.jpg",-25,7],null,null],
  ], [100], 40],
  // 91 bdg_pinkflowers (decoration) — YARD_PROPS.as:5235
  [91, "bdg_pinkflowers", "buildings/decorations/flowers/", [
    [1,["top-pink.png",-18,-21],null,null,["shadow.jpg",-10,2],null,null],
  ], [100], 20],
  // 92 bdg_purpleflowers (decoration) — YARD_PROPS.as:5268
  [92, "bdg_purpleflowers", "buildings/decorations/flowers/", [
    [1,["top-purple.png",-18,-21],null,null,["shadow.jpg",-10,2],null,null],
  ], [100], 20],
  // 93 bdg_redflowers (decoration) — YARD_PROPS.as:5301
  [93, "bdg_redflowers", "buildings/decorations/flowers/", [
    [1,["top-red.png",-18,-21],null,null,["shadow.jpg",-10,2],null,null],
  ], [100], 20],
  // 94 bdg_whiteflowers (decoration) — YARD_PROPS.as:5334
  [94, "bdg_whiteflowers", "buildings/decorations/flowers/", [
    [1,["top-white.png",-18,-21],null,null,["shadow.jpg",-10,2],null,null],
  ], [100], 20],
  // 95 bdg_yellowflowers (decoration) — YARD_PROPS.as:5367
  [95, "bdg_yellowflowers", "buildings/decorations/flowers/", [
    [1,["top-yellow.png",-18,-21],null,null,["shadow.jpg",-10,2],null,null],
  ], [100], 20],
  // 96 bdg_baseballstatue (decoration) — YARD_PROPS.as:5405
  [96, "bdg_baseballstatue", "buildings/decorations/statue-baseball/", [
    [1,["top.v2.png",-20,-36],null,null,["shadow.v2.jpg",-21,10],null,null],
  ], [100], 40],
  // 97 bdg_footballstatue (decoration) — YARD_PROPS.as:5443
  [97, "bdg_footballstatue", "buildings/decorations/statue-football/", [
    [1,["top.v2.png",-19,-39],null,null,["shadow.v2.jpg",-17,10],null,null],
  ], [100], 40],
  // 98 bdg_soccerstatue (decoration) — YARD_PROPS.as:5481
  [98, "bdg_soccerstatue", "buildings/decorations/statue-soccer/", [
    [1,["top.v2.png",-23,-36],null,null,["shadow.v2.jpg",-15,12],null,null],
  ], [100], 40],
  // 99 bdg_libertystatue (decoration) — YARD_PROPS.as:5519
  [99, "bdg_libertystatue", "buildings/decorations/statue-liberty/", [
    [1,["top.v2.png",-37,-118],null,null,["shadow.v2.jpg",-31,20],null,null],
  ], [100], 70],
  // 100 bdg_eiffelstatue (decoration) — YARD_PROPS.as:5557
  [100, "bdg_eiffelstatue", "buildings/decorations/statue-eiffeltower/", [
    [1,["top.v2.png",-60,-121],null,null,["shadow.v2.jpg",-60,5],null,null],
  ], [100], 70],
  // 101 bdg_bigben (decoration) — YARD_PROPS.as:5595
  [101, "bdg_bigben", "buildings/decorations/statue-bigben/", [
    [1,["top.v2.png",-32,-104],null,null,["shadow.v2.jpg",-32,19],null,null],
  ], [100], 70],
  // 102 bdg_pool (decoration) — YARD_PROPS.as:5628
  [102, "bdg_pool", "buildings/decorations/pool/", [
    [1,["top.png",-65,8],null,null,["shadow.jpg",-65,15],null,null],
  ], [100], 100],
  // 103 bdg_pond (decoration) — YARD_PROPS.as:5661
  [103, "bdg_pond", "buildings/decorations/pond/", [
    [1,["top.png",-40,14],null,null,null,null,null],
  ], [100], 100],
  // 104 bdg_zengarden (decoration) — YARD_PROPS.as:5691
  [104, "bdg_zengarden", "buildings/decorations/zengarden/", [
    [1,["top.png",-72,-5],null,null,["shadow.jpg",-72,16],null,null],
  ], [100], 100],
  // 105 bdg_fountain (decoration) — YARD_PROPS.as:5724
  [105, "bdg_fountain", "buildings/decorations/fountain/", [
    [1,["anim.png",-47,-51,89,114],null,null,["shadow.jpg",-41,16],null,null,[["anim.png",-47,-51,89,114,42]]],
  ], [100], 70],
  // 106 bdg_teagarden (decoration) — YARD_PROPS.as:5757
  [106, "bdg_teagarden", "buildings/decorations/japaneseteagarden/", [
    [1,["top.png",-62,-38],null,null,["shadow.jpg",-57,12],null,null],
  ], [100], 100],
  // 107 bdg_monsterskull (decoration) — YARD_PROPS.as:5790
  [107, "bdg_monsterskull", "buildings/decorations/headsonsticks/", [
    [1,["top-skull.png",-7,-39],null,null,["shadow.jpg",-1,-7],null,null],
  ], [100], 20],
  // 108 bdg_rubikunsolved (decoration) — YARD_PROPS.as:5823
  [108, "bdg_rubikunsolved", "buildings/decorations/rubikscube/", [
    [1,["top-unsolved.png",-20,-23],null,null,["shadow.jpg",-22,-5],null,null],
  ], [100], 20],
  // 109 bdg_rubiksolved (decoration) — YARD_PROPS.as:5856
  [109, "bdg_rubiksolved", "buildings/decorations/rubikscube/", [
    [1,["top-solved.png",-20,-23],null,null,["shadow.jpg",-22,-5],null,null],
  ], [100], 20],
  // 110 bdg_halloween (decoration) — YARD_PROPS.as:5890
  [110, "bdg_halloween", "buildings/decorations/pumpkins/", [
    [1,["attended-large-top.png",-24,-32],null,null,["attended-large-shadow.jpg",-25,1],null,null],
  ], [100], 40],
  // 111 bdg_halloween_small (decoration) — YARD_PROPS.as:5923
  [111, "bdg_halloween_small", "buildings/decorations/pumpkins/", [
    [1,["attended-small-top.png",-10,-4],null,null,["attended-small-shadow.jpg",-12,2],null,null],
  ], [100], 20],
  // 113 Radio Tower (special) — YARD_PROPS.as:5971
  [113, "Radio Tower", "buildings/radiotower/", [
    [1,["top.1.png",-40,-80],["top.1.damaged.png",-40,-83],["top.1.destroyed.png",-41,11],["shadow.1.jpg",-44,7],["shadow.1.damaged.jpg",-44,7],["shadow.1.destroyed.jpg",-41,19]],
  ], [3400], 80],
  // 114 Champion Cage (cage) — YARD_PROPS.as:6013
  [114, "Champion Cage", "buildings/monstercage/", [
    [1,["top.1.png",-128,-13],null,null,["shadow.1.jpg",-132,10],null,null],
  ], [10000], 200],
  // 115 Aerial Defense Tower (tower) — YARD_PROPS.as:6181
  [115, "Aerial Defense Tower", "buildings/flaktower/", [
    [1,["top.3.png",-39,6],["top.3.damaged.png",-39,5],["top.3.destroyed.png",-36,13],["shadow.3.jpg",-43,14],["shadow.3.jpg",-40,24],["shadow.3.destroyed.jpg",-33,26],[["anim.3.png",-32,-23,62,52,32]],[["anim.3.damaged.png",-29,-17,62,53,32]]],
  ], [15000,22000,30000,48000,60000,72000,82000,90000], 200],
  // 116 Monster Lab (special) — YARD_PROPS.as:6258
  [116, "Monster Lab", "buildings/monsterlab/", [
    [1,["top.1.v2.png",-74,-96],["top.1.damaged.png",-73,-80],["top.1.destroyed.png",-80,-10],["shadow.1.jpg",-73,-6],["shadow.1.jpg",-72,-6],["shadow.1.destroyed.jpg",-77,2],[["anim.1.png",-28,-30,54,48,32],["anim.2.png",-66,26,33,31,5],["anim.3.png",32,26,33,31,5]]],
  ], [9000,16000,24000,32000], 200],
  // 117 Heavy Trap (trap) — YARD_PROPS.as:6303
  [117, "Heavy Trap", "buildings/heavytrap/", [
    [1,["top.1.png",-16,-5],null,["top.1.destroyed.png",-16,5],["shadow.1.jpg",-18,1],null,["shadow.1.jpg",-18,1]],
  ], [10], 90],
  // 118 Railgun (tower) — YARD_PROPS.as:6473
  [118, "Railgun", "buildings/railguntower/", [
    [1,["top.3.png",-39,7],["top.3.damaged.png",-39,7],["top.3.destroyed.png",-34,-5],["shadow.3.jpg",-40,20],["shadow.3.jpg",-40,20],["shadow.3.destroyed.jpg",-36,23],[["anim.3.loaded.png",-49,-9,96,56,32]],[["anim.3.damaged.png",-49,-9,97,56,32]]],
  ], [17640,34400,45000,58000,75500,90000,100000,110000], 64],
  // 119 Champion Chamber (special) — YARD_PROPS.as:6541
  [119, "Champion Chamber", "buildings/champchamber/", [
    [1,["top.3.png",-66,-62],["top.3.damaged.png",-66,-54],["top.3.destroyed.png",-73,-32],["shadow.3.jpg",-66,10],["shadow.3.jpg",-66,4],["shadow.3.destroyed.jpg",-67,14]],
  ], [16000], 64],
  // 120 bdg_biggulp (decoration) — YARD_PROPS.as:6586
  [120, "bdg_biggulp", "buildings/decorations/biggulp/", [
    [1,["top.png",-27,-36],null,null,["shadow.jpg",-35,16],null,null],
  ], [100], 70],
  // 121 bdg_wmitotem1 (decoration) — YARD_PROPS.as:6663
  [121, "bdg_wmitotem1", "buildings/decorations/wmitotem/", [
    [1,["top1.png",-31,-23],null,null,["shadow1.jpg",-60,-18],null,null],
    [2,["top2.png",-30,-60],null,null,["shadow2.jpg",-71,-44],null,null],
    [3,["top3.png",-30,-90],null,null,["shadow3.jpg",-64,-61],null,null],
    [4,["top4.png",-30,-110],null,null,["shadow4.jpg",-67,-82],null,null],
    [5,["top5.v2.png",-30,-110],null,null,["shadow4.jpg",-67,-82],null,null],
    [6,["top6.png",-30,-110],null,null,["shadow4.jpg",-67,-82],null,null],
  ], [100,100,100,100,100,100], 40],
  // 127 Inferno Cavern (enemy) — YARD_PROPS.as:6829
  [127, "Inferno Cavern", "buildings/iportal/", [
    [1,["top.1.v2.png",-85,-5],null,null,null,null,null],
    [2,["top.2.v2.png",-105,-29],null,null,null,null,null],
    [3,["top.3.v2.png",-136,-64],null,null,null,null,null],
    [4,["top.4.v2.png",-140,-114],null,null,null,null,null],
    [5,["top.5.v2.png",-160,-172],null,null,["shadow.5.v2.jpg",-169,0],null,null],
  ], [1,1,1,1,1], 100],
  // 129 Quake Tower (tower) — YARD_PROPS.as:6983
  [129, "Quake Tower", "buildings/iquaketower/", [
    [1,["anim.1.png",-37,-75,75,132],["top.1.damaged.png",-40,-75],["top.1.destroyed.png",-42,-8],["shadow.1.v2.jpg",-37,17],["shadow.1.v2.jpg",-40,16],null,[["anim.1.png",-37,-75,75,132,33]],[["anim.1.damaged.png",-40,-75,84,133,33]]],
  ], [10000,16000,22000,28000,34000,34000,34000,34000], 64],
  // 131 bdg_wmi2totem (decoration) — YARD_PROPS.as:7111
  [131, "bdg_wmi2totem", "buildings/decorations/wmitotem2/", [
    [1,["top1.png",-31,-25],null,null,["shadow1.jpg",-55,-20],null,null],
    [2,["top2.png",-31,-60],null,null,["shadow2.jpg",-64,-44],null,null],
    [3,["top3.png",-31,-86],null,null,["shadow3.jpg",-66,-61],null,null],
    [4,["top4.png",-31,-122],null,null,["shadow4.jpg",-66,-83],null,null],
    [5,["top5.v2.png",-30,-125],null,null,["shadow4.jpg",-66,-83],null,null],
    [6,["top6.png",-31,-128],null,null,["shadow4.jpg",-66,-83],null,null],
  ], [100,100,100,100,100,100], 40],
  // 132 Magma Tower (tower) — YARD_PROPS.as:7266
  [132, "Magma Tower", "buildings/imagmatower/", [
    [1,["top.1.v2.png",-34,-9],["top.1.damaged.v2.png",-38,-4],["top.1.destroyed.v2.png",-36,6],["shadow.1.v2.jpg",-31,10],["shadow.1.v2.jpg",-38,16],null,[["anim.1.v2.png",-26,-50,54,42,31],["anim.2.v2.png",-17,26,38,19,31]]],
  ], [15000,22000,30000,49000,59000,70000], 64],
  // 133 b_siegefactory (special) — YARD_PROPS.as:7334
  [133, "b_siegefactory", "buildings/siegefactory/", [
    [1,["top.1.v3.png",-75,-23],["top.1.damaged.v3.png",-75,-88],["top.1.destroyed.png",-75,-48],["shadow.1.jpg",-29,14],["shadow.1.jpg",-29,14],["shadow.1.jpg",-29,14],[["anim.1.v2.png",-58,-99,129,77,35]]],
  ], [10000], 90],
  // 134 b_siegeworks (special) — YARD_PROPS.as:7443
  [134, "b_siegeworks", "buildings/siegelab/", [
    [1,["top.1.v6.png",-69,-68],["top.1.damaged.v4.png",-66,-98],["top.1.destroyed.png",-57,-44],["shadow.1.jpg",-50,4],["shadow.1.jpg",-50,4],["shadow.1.jpg",-50,4],[["anim1.v4.png",-54,22,43,39,60],["anim2.v3.png",-24,-92,59,100,60],["anim3.v3.png",19,11,38,40,60]]],
  ], [10000,14400,19200,26100,35300,43200,52000,60000,72000,84000], 90],
  // 135 bdg_dave_trophy (decoration) — YARD_PROPS.as:7536
  [135, "bdg_dave_trophy", "buildings/decorations/dave_trophy/", [
    [1,["top.png",-38,-30],null,null,["shadow.jpg",-38,20],null,null],
  ], [100], 70],
  // 136 bi_spurtzcannon (tower) — YARD_PROPS.as:7638
  [136, "bi_spurtzcannon", "buildings/spurtztower/", [
    [1,["normal_base.png",-39,-35],["damaged_base.png",-39,-35],["destroyed_base.png",-39,-13],["normal_damaged_shadow.jpg",-31,10],["normal_damaged_shadow.jpg",-38,16],null,[["top-normal-anim.v2.png",-27,-57,51,43,31]],[["top-damaged-anim.v2.png",-27,-57,50,43,31]]],
  ], [15000,22000,30000,48000,60000], 64],
  // 137 bi_blackspurtzcannon (tower) — YARD_PROPS.as:7750
  [137, "bi_blackspurtzcannon", "buildings/blackspurtztower/", [
    [1,["normal_base.png",-39,-35],["damaged_base.png",-39,-35],["destroyed_base.png",-39,-13],["normal_damaged_shadow.jpg",-31,10],["normal_damaged_shadow.jpg",-38,16],null,[["top-normal-anim.v2.png",-27,-57,54,42,31]],[["top-damaged-anim.v2.png",-27,-57,54,42,31]]],
  ], [16500,24200,33000,52800,66000], 64],
  // 138 b_stronghold (tower) — YARD_PROPS.as:7826
  [138, "b_stronghold", "buildings/guardtower/", [
    [1,["top.v2.1.png",-98,-100],["top.v2.1.damaged.png",-98,-95],["top.v2.1.destroyed.png",-102,-65],null,null,null],
  ], [400000,500000,600000], 64],
  // 139 b_resourceop (cage) — YARD_PROPS.as:7876
  [139, "b_resourceop", "buildings/resourceoutpost/", [
    [1,["top.v2.1.png",-86,-64],null,null,null,null,null],
  ], [1], 64],
  // 140 b_opdefender (special) — YARD_PROPS.as:7942
  [140, "b_opdefender", "buildings/outpostdefender/", [
    [1,["top.1.png",-59,-19],["top.1.damaged.png",-59,-55],["top.1.destroyed.png",-74,-4],["shadow.1.png",-59,39],["shadow.1.png",-59,39],["shadow.1.destroyed.png",-70,41],[["anim.1.png",-91,-101,178,156,32]]],
  ], [8800,42000,200000,400000,600000], 64],
];
