/**
 * Building costs, one row per building type. GENERATED — do not edit by hand.
 *
 * Source: `client/scripts/YARD_PROPS.as`, the `costs` and `quantity` fields of
 * each entry in `_yardProps` (declared at :9), with the Map Room 2 price
 * changes from `GLOBAL.changeNotMaproom3SpecificBuildings()`
 * (`client/scripts/GLOBAL.as:615-714`) applied on top, because this project
 * runs Map Room 2 as the default overworld. Regenerate with
 * `node tools/gen-building-costs.mjs` from `web/`.
 *
 * A row is `[type, name, kind, group, costs, quantity]`, with a seventh
 * element, `stats`, on the five types that carry an economy ladder.
 *
 * `costs[k]` is the step that *leaves* level `k`: `costs[0]` is the initial
 * build, `costs[1]` the level 1 to 2 upgrade, and so on, so a type's maximum
 * level is `costs.length` (`client/scripts/BFOUNDATION.as:2668-2700`; spec
 * `docs/specs/base-building.md:412-413`). `kind` is the props `type` string —
 * `wall`, `trap`, `tower`, `resource`, `special`, `decoration` and a few
 * others — and `group` is the build-menu tab.
 *
 * `quantity[hall]` is how many of this type a yard may hold at Town Hall level
 * `hall` (spec `:400`); it is empty for a type the props table does not cap.
 *
 * `stats` is present only on the four harvesters (types 1 to 4) and the
 * Storage Silo (type 6), the types whose numbers the economy audit derives
 * from (spec `:484-526`). Other entries in the props file spell `capacity`
 * and `produce` for monsters, Flinger payloads and bunker room, none of which
 * is a resource amount, so they carry no `stats` here.
 *
 * The two copies of this table, here and in the other of
 * `web/src/game/yard/buildingCostData.ts` and
 * `server/src/game-data/buildingCosts.ts`, hold identical rows on purpose: the
 * client shows a price and the server charges it, and a disagreement between
 * them is a bug the player pays for.
 */

/**
 * One prerequisite: at least `count` buildings of `type` at `level` or above.
 *
 * The middle element is the count, not a spare
 * (`client/scripts/BASE.as:3884-3932`).
 */
export type CostRequirement = readonly [type: number, count: number, level: number];

/**
 * One cost step: `[r1, r2, r3, r4, time, re]`.
 *
 * `r1`..`r4` are twigs, pebbles, putty and goo; `time` is the build or upgrade
 * countdown in seconds, which is free to finish at 300 or below
 * (`client/scripts/BFOUNDATION.as:2063-2083`).
 */
export type CostStep = readonly [
  r1: number,
  r2: number,
  r3: number,
  r4: number,
  time: number,
  re: readonly CostRequirement[],
];

/**
 * A harvester's or silo's economy ladder, indexed by level minus one.
 *
 * `produce[l - 1]` is what a level `l` harvester adds to its buffer each
 * cycle, `cycleTime[l - 1]` is how many seconds that cycle takes at full
 * health, and `capacity[l - 1]` is the buffer it fills
 * (`client/scripts/BRESOURCE.as:425`, `:385`, `:444`). For the Storage Silo
 * `capacity[l - 1]` is instead what a finished silo adds to every resource
 * pool's cap (`client/scripts/BASE.as:4705-4828`), and `produce` and
 * `cycleTime` are empty because a silo produces nothing.
 */
export interface BuildingStats {
  readonly produce: readonly number[];
  readonly cycleTime: readonly number[];
  readonly capacity: readonly number[];
}

export type CostRow = readonly [
  type: number,
  name: string,
  /** The props `type` string: `wall`, `trap`, `tower`, `decoration`, … */
  kind: string,
  /** The build-menu group the props table files this type under. */
  group: number,
  costs: readonly CostStep[],
  /** Cap on how many of this type a yard may hold, indexed by Town Hall level. */
  quantity: readonly number[],
  /** Present on the harvesters (1 to 4) and the Storage Silo (6) only. */
  stats?: BuildingStats,
];

export const BUILDING_COST_ROWS: readonly CostRow[] = [
  // 1 Twig Snapper (resource) — YARD_PROPS.as:23
  [1, "Twig Snapper", "resource", 1, [
    [0,750,0,0,15,[[14,1,1]]],
    [0,1575,0,0,300,[[14,1,1]]],
    [0,3300,0,0,1200,[[14,1,1]]],
    [0,6950,0,0,3600,[[14,1,2]]],
    [0,14500,0,0,7200,[[14,1,2]]],
    [0,30600,0,0,18000,[[14,1,3]]],
    [0,64300,0,0,43200,[[14,1,3]]],
    [0,135000,0,0,86400,[[14,1,4]]],
    [0,283600,0,0,172800,[[14,1,4]]],
    [0,600000,0,0,259200,[[14,1,5]]],
  ], [0,1,2,4,5,6,6,6,6,6,6], {
    produce: [2,4,7,11,16,22,29,37,46,56],
    cycleTime: [10,10,10,10,10,10,10,10,10,10],
    capacity: [720,2160,5670,13365,29160,60142,118918,227584,424414,775018],
  }],
  // 2 Pebble Shiner (resource) — YARD_PROPS.as:170
  [2, "Pebble Shiner", "resource", 1, [
    [750,0,0,0,15,[[14,1,1]]],
    [1575,0,0,0,300,[[14,1,1]]],
    [3300,0,0,0,1200,[[14,1,1]]],
    [6950,0,0,0,3600,[[14,1,2]]],
    [14500,0,0,0,7200,[[14,1,2]]],
    [30600,0,0,0,18000,[[14,1,3]]],
    [64300,0,0,0,43200,[[14,1,3]]],
    [135000,0,0,0,86400,[[14,1,4]]],
    [283600,0,0,0,172800,[[14,1,4]]],
    [600000,0,0,0,259200,[[14,1,5]]],
  ], [0,1,2,4,5,6,6,6,6,6,6], {
    produce: [2,4,7,11,16,22,29,37,46,56],
    cycleTime: [10,10,10,10,10,10,10,10,10,10],
    capacity: [720,2160,5670,13365,29160,60142,118918,227584,424414,775018],
  }],
  // 3 Putty Squisher (resource) — YARD_PROPS.as:317
  [3, "Putty Squisher", "resource", 1, [
    [525,224,0,0,20,[[14,1,1]]],
    [1102,470,0,0,300,[[14,1,1]]],
    [2315,992,0,0,1200,[[14,1,1]]],
    [4862,2086,0,0,3600,[[14,1,2]]],
    [10210,4375,0,0,7200,[[14,1,2]]],
    [21441,9190,0,0,18000,[[14,1,3]]],
    [45027,19298,0,0,43200,[[14,1,3]]],
    [94557,40524,0,0,86400,[[14,1,4]]],
    [198570,85102,0,0,172800,[[14,1,4]]],
    [416997,178716,0,0,259200,[[14,1,5]]],
  ], [0,1,2,4,5,6,6,6,6,6,6], {
    produce: [2,4,7,11,16,22,29,37,46,56],
    cycleTime: [10,10,10,10,10,10,10,10,10,10],
    capacity: [720,2160,5670,13365,29160,60142,118918,227584,424414,775018],
  }],
  // 4 Goo Factory (resource) — YARD_PROPS.as:464
  [4, "Goo Factory", "resource", 1, [
    [247,577,0,0,20,[[14,1,1]]],
    [520,1212,0,0,300,[[14,1,1]]],
    [1090,2546,0,0,1200,[[14,1,1]]],
    [2290,5348,0,0,3600,[[14,1,2]]],
    [4810,11231,0,0,7200,[[14,1,2]]],
    [10108,23585,0,0,18000,[[14,1,3]]],
    [21227,49529,0,0,43200,[[14,1,3]]],
    [44580,104012,0,0,86400,[[14,1,4]]],
    [93600,218427,0,0,172800,[[14,1,4]]],
    [196584,458696,0,0,259200,[[14,1,5]]],
  ], [0,1,2,4,5,6,6,6,6,6,6], {
    produce: [2,4,7,11,16,22,29,37,46,56],
    cycleTime: [10,10,10,10,10,10,10,10,10,10],
    capacity: [720,2160,5670,13365,29160,60142,118918,227584,424414,775018],
  }],
  // 5 Flinger (special) — YARD_PROPS.as:610, Map Room 2 override GLOBAL.as:684-712
  [5, "Flinger", "special", 2, [
    [1000,1000,500,0,900,[[14,1,1]]],
    [64300,64300,32150,0,10800,[[14,1,3],[11,1,1]]],
    [283600,283600,141800,0,32400,[[14,1,4],[11,1,1]]],
    [1247840,1247840,623920,0,97200,[[14,1,4],[11,1,1]]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 6 Storage Silo (special) — YARD_PROPS.as:725
  [6, "Storage Silo", "special", 1, [
    [3010,1855,0,0,1200,[[14,1,1],[1,1,1],[2,1,1],[3,1,1],[4,1,1]]],
    [7421,3710,0,0,1800,[[14,1,2]]],
    [14843,7421,0,0,2700,[[14,1,2]]],
    [29687,14843,0,0,4050,[[14,1,3]]],
    [59375,29687,0,0,6075,[[14,1,3]]],
    [118750,59375,0,0,9112,[[14,1,3]]],
    [237500,118750,0,0,13668,[[14,1,4]]],
    [475000,237500,0,0,20503,[[14,1,4]]],
    [950000,475000,0,0,30754,[[14,1,5]]],
    [1900000,950000,0,0,46132,[[14,1,6]]],
  ], [0,1,2,3,4,5,5,5,5,6,6], {
    produce: [],
    cycleTime: [],
    capacity: [7500,15000,30000,60000,120000,240000,480000,960000,1920000,3840000],
  }],
  // 7 Mushroom (mushroom) — YARD_PROPS.as:885
  [7, "Mushroom", "mushroom", 999, [
    [0,0,0,0,0,[[0,0,0]]],
  ], [0]],
  // 8 Monster Locker (special) — YARD_PROPS.as:913
  [8, "Monster Locker", "special", 2, [
    [1800,2300,0,0,600,[[14,1,2]]],
    [28800,18400,0,0,18000,[[14,1,3]]],
    [115200,147200,0,0,72000,[[14,1,4]]],
    [460800,588800,0,0,129600,[[14,1,5]]],
  ], [0,0,1,1,1,1,1,1,1,1,1]],
  // 9 Monster Juicer (special) — YARD_PROPS.as:1014, Map Room 2 override GLOBAL.as:616-638
  [9, "Monster Juicer", "special", 2, [
    [1000000,1000000,1000000,0,43200,[[14,1,3],[15,1,1]]],
    [250000,250000,0,0,21600,[[14,1,3],[15,1,1]]],
    [500000,500000,0,0,43200,[[14,1,3],[15,1,1]]],
  ], [0,0,0,1,1,1,1,1,1,1,1]],
  // 10 Yard Planner (special) — YARD_PROPS.as:1075
  [10, "Yard Planner", "special", 2, [
    [250000,250000,0,0,43200,[[14,1,3]]],
  ], [0,0,0,1,1,1,1,1,1,1,1]],
  // 11 Map Room (special) — YARD_PROPS.as:1122
  [11, "Map Room", "special", 2, [
    [2000,2000,0,0,900,[[14,1,1]]],
    [0,0,0,0,345600,[[14,1,6]]],
    [0,0,0,0,345600,[[14,1,6]]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 12 General Store (special) — YARD_PROPS.as:1181
  [12, "General Store", "special", 2, [
    [1080,720,0,0,10,[[14,1,1]]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 13 Hatchery (special) — YARD_PROPS.as:1228
  [13, "Hatchery", "special", 2, [
    [2000,2000,0,0,900,[[14,1,1],[15,1,1]]],
    [21227,49529,0,0,3600,[[14,1,3],[8,1,1]]],
    [93600,218427,0,0,43200,[[14,1,4]]],
  ], [0,1,2,3,4,5,5,5,5,5,5]],
  // 14 Town Hall (special) — YARD_PROPS.as:1312
  [14, "Town Hall", "special", 2, [
    [0,0,0,0,10,[]],
    [7000,7000,0,0,600,[[14,1,1]]],
    [42000,42000,0,0,14400,[[14,1,2]]],
    [240000,240000,0,0,57600,[[14,1,3]]],
    [1400000,1400000,0,0,172800,[[14,1,4]]],
    [7560000,7560000,0,0,345600,[[14,1,5]]],
    [11340000,11340000,0,0,518400,[[14,1,6]]],
    [14420000,14420000,0,0,691200,[[14,1,7]]],
    [18680000,18680000,0,0,1036800,[[14,1,8]]],
    [25000000,25000000,0,0,1209600,[[14,1,9]]],
  ], [1,1,1,1,1,1,1,1,1,1,1]],
  // 15 Housing (special) — YARD_PROPS.as:1565, Map Room 2 override GLOBAL.as:639-681
  [15, "Housing", "special", 2, [
    [2160,2160,0,0,300,[[14,1,1]]],
    [8640,8640,0,0,4500,[[14,1,3],[8,1,1]]],
    [34560,34560,0,0,10800,[[14,1,4],[8,1,1]]],
    [138240,138240,0,0,28800,[[14,1,5],[8,1,1]]],
    [552960,552960,0,0,72000,[[14,1,6],[8,1,1]]],
    [2211840,2211840,0,0,144000,[[14,1,6],[8,1,1]]],
  ], [0,1,1,2,2,3,3,3,4,4,4]],
  // 16 Hatchery Control Center (special) — YARD_PROPS.as:1676
  [16, "Hatchery Control Center", "special", 2, [
    [4000000,4000000,4000000,0,90000,[[14,1,3],[13,3,2]]],
  ], [0,0,0,1,1,1,1,1,1,1,1]],
  // 17 Block (wall) — YARD_PROPS.as:1722
  [17, "Block", "wall", 3, [
    [1000,0,0,0,5,[[14,1,2]]],
    [0,10000,0,0,5,[[14,1,3]]],
    [100000,100000,0,0,5,[[14,1,4]]],
    [200000,200000,0,0,5,[[14,1,5]]],
    [400000,400000,0,0,5,[[14,1,6]]],
  ], [0,0,30,60,120,200,220,280,300,340,400]],
  // 18 Stone Block (wall) — YARD_PROPS.as:1844
  [18, "Stone Block", "wall", 3, [
    [0,2000,0,0,5,[[14,1,3]]],
  ], [0,0,10,20,40,60,70,90,90,90,90]],
  // 19 Wild Monster Baiter (special) — YARD_PROPS.as:1887
  [19, "Wild Monster Baiter", "special", 2, [
    [25000,25000,15000,0,18000,[[14,1,4],[8,1,1]]],
    [1000000,1000000,500000,0,36000,[[14,1,4],[8,1,2]]],
    [2000000,2000000,1000000,0,72000,[[14,1,4],[8,1,3]]],
    [4000000,4000000,2000000,0,144000,[[14,1,5],[8,1,4]]],
    [6000000,6000000,4000000,0,288000,[[14,1,6],[8,1,4]]],
    [10000000,10000000,6000000,0,576000,[[14,1,7],[8,1,4]]],
    [16000000,16000000,10000000,0,1152000,[[14,1,8],[8,1,4]]],
  ], [0,0,0,0,1,1,1,1,1,1,1]],
  // 20 Cannon Tower (tower) — YARD_PROPS.as:2040
  [20, "Cannon Tower", "tower", 3, [
    [2000,1500,500,0,30,[[14,1,1]]],
    [10000,7500,2500,0,900,[[14,1,2]]],
    [50000,37500,12500,0,2700,[[14,1,3]]],
    [250000,187500,62500,0,8100,[[14,1,4]]],
    [1250000,937500,312500,0,24300,[[14,1,4]]],
    [6250000,4687500,1562500,0,72900,[[14,1,5]]],
    [9375000,7000000,1562500,0,172800,[[14,1,6]]],
    [14000000,10500000,1562500,0,259200,[[14,1,7]]],
    [21000000,15800000,1562500,0,345600,[[14,1,8]]],
    [31600000,23700000,1562500,0,475200,[[14,1,8]]],
  ], [0,2,3,4,5,6,6,6,6,6,6]],
  // 21 Sniper Tower (tower) — YARD_PROPS.as:2261
  [21, "Sniper Tower", "tower", 3, [
    [1500,2000,500,0,30,[[14,1,1]]],
    [7500,10000,2500,0,900,[[14,1,2]]],
    [37500,50000,12500,0,2700,[[14,1,3]]],
    [187500,250000,62500,0,18000,[[14,1,4]]],
    [937500,1250000,312500,0,43200,[[14,1,5]]],
    [4687500,6250000,1562500,0,86400,[[14,1,6]]],
    [7031250,9375000,2343750,0,172800,[[14,1,7]]],
    [10547000,14062000,3515000,0,259200,[[14,1,8]]],
    [15820000,21095000,5275000,0,345600,[[14,1,8]]],
    [32730000,31650000,7900000,0,475200,[[14,1,8]]],
  ], [0,2,3,4,5,6,6,6,6,6,6]],
  // 22 Monster Bunker (tower) — YARD_PROPS.as:2424
  [22, "Monster Bunker", "tower", 3, [
    [250000,187500,62500,0,21600,[[14,1,3],[15,1,1]]],
    [1000000,1000000,500000,0,43200,[[14,1,4],[15,1,2]]],
    [2000000,2000000,1000000,0,86400,[[14,1,5],[15,1,3]]],
    [4000000,4000000,2000000,0,172800,[[14,1,9],[15,1,3]]],
    [8000000,8000000,4000000,0,345600,[[14,1,10],[15,1,3]]],
  ], [0,0,0,1,1,2,2,3,4,4,4]],
  // 23 Laser Tower (tower) — YARD_PROPS.as:2547
  [23, "Laser Tower", "tower", 3, [
    [500000,250000,100000,0,18000,[[14,1,4]]],
    [1000000,500000,200000,0,86400,[[14,1,5]]],
    [2000000,1000000,400000,0,172800,[[14,1,6]]],
    [4000000,2000000,800000,0,259200,[[14,1,7]]],
    [8000000,4000000,1600000,0,388800,[[14,1,8]]],
    [16000000,8000000,3200000,0,777600,[[14,1,9]]],
    [24000000,16000000,6400000,0,1036800,[[14,1,10]]],
    [27000000,25000000,12800000,0,1209600,[[14,1,10]]],
  ], [0,0,0,0,1,2,3,3,3,3,3]],
  // 24 Booby Trap (trap) — YARD_PROPS.as:2695
  [24, "Booby Trap", "trap", 3, [
    [1000,1000,1000,0,5,[[14,1,2]]],
  ], [0,0,8,15,20,28,35,42,50,60,75]],
  // 25 Tesla Tower (tower) — YARD_PROPS.as:2788
  [25, "Tesla Tower", "tower", 3, [
    [187500,250000,62500,0,18000,[[14,1,4]]],
    [750000,1000000,250000,0,86400,[[14,1,5]]],
    [2250000,3000000,750000,0,172800,[[14,1,6]]],
    [5250000,5000000,1250000,0,345600,[[14,1,7]]],
    [12000000,10000000,2000000,0,518400,[[14,1,7]]],
    [18000000,15000000,5000000,0,691200,[[14,1,9]]],
    [24000000,20000000,6500000,0,864000,[[14,1,10]]],
    [30000000,25000000,7800000,0,1209600,[[14,1,10]]],
  ], [0,0,0,0,1,2,3,3,3,3,3]],
  // 26 Monster Academy (special) — YARD_PROPS.as:2933
  [26, "Monster Academy", "special", 2, [
    [100000,100000,0,0,10800,[[14,1,3],[8,1,2]]],
    [250000,250000,0,0,21600,[[14,1,4],[8,1,3]]],
    [400000,400000,0,0,43200,[[14,1,5],[8,1,3]]],
    [600000,600000,0,0,86400,[[14,1,6],[8,1,4]]],
    [900000,900000,0,0,86400,[[14,1,7],[8,1,4]]],
  ], [0,0,0,1,1,2,2,2,2,2,2]],
  // 27 Horsey (enemy) — YARD_PROPS.as:3043
  [27, "Horsey", "enemy", 999, [
    [0,0,0,0,5,[[14,1,1]]],
  ], [1]],
  // 28 American Flag (decoration) — YARD_PROPS.as:3077
  [28, "American Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 29 British Flag (decoration) — YARD_PROPS.as:3111
  [29, "British Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 30 Australian Flag (decoration) — YARD_PROPS.as:3145
  [30, "Australian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 31 Brazilian Flag (decoration) — YARD_PROPS.as:3179
  [31, "Brazilian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 32 European Flag (decoration) — YARD_PROPS.as:3213
  [32, "European Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 33 French Flag (decoration) — YARD_PROPS.as:3248
  [33, "French Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 34 Indonesian Flag (decoration) — YARD_PROPS.as:3282
  [34, "Indonesian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 35 Italian Flag (decoration) — YARD_PROPS.as:3316
  [35, "Italian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 36 Malaysian Flag (decoration) — YARD_PROPS.as:3350
  [36, "Malaysian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 37 Dutch Flag (decoration) — YARD_PROPS.as:3384
  [37, "Dutch Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 38 New Zealand Flag (decoration) — YARD_PROPS.as:3418
  [38, "New Zealand Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 39 Norwegian Flag (decoration) — YARD_PROPS.as:3452
  [39, "Norwegian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 40 Polish Flag (decoration) — YARD_PROPS.as:3486
  [40, "Polish Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 41 Swedish Flag (decoration) — YARD_PROPS.as:3520
  [41, "Swedish Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 42 Turkish Flag (decoration) — YARD_PROPS.as:3554
  [42, "Turkish Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 43 Canadian Flag (decoration) — YARD_PROPS.as:3588
  [43, "Canadian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 44 Danish Flag (decoration) — YARD_PROPS.as:3622
  [44, "Danish Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 45 German Flag (decoration) — YARD_PROPS.as:3656
  [45, "German Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 46 Filipino Flag (decoration) — YARD_PROPS.as:3690
  [46, "Filipino Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 47 Singaporean Flag (decoration) — YARD_PROPS.as:3724
  [47, "Singaporean Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 48 Austrian Flag (decoration) — YARD_PROPS.as:3758
  [48, "Austrian Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 49 Pirate Flag (decoration) — YARD_PROPS.as:3792
  [49, "Pirate Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 50 Peace Flag (decoration) — YARD_PROPS.as:3827
  [50, "Peace Flag", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 51 Catapult (special) — YARD_PROPS.as:3862
  [51, "Catapult", "special", 2, [
    [75000,75000,75000,0,5400,[[14,1,3],[5,1,1]]],
    [128600,128600,128600,0,10800,[[14,1,4],[5,1,1]]],
    [257200,257200,257200,0,21600,[[14,1,5],[5,1,1]]],
    [514400,514400,514400,0,43200,[[14,1,6],[5,1,1]]],
  ], [0,0,0,1,1,1,1,1,1,1,1]],
  // 52 Simple Sign (taunt) — YARD_PROPS.as:3952
  [52, "Simple Sign", "taunt", 999, [
    [100000,100000,100000,100000,0,[]],
  ], [0]],
  // 55 bdg_acorn (decoration) — YARD_PROPS.as:4035
  [55, "bdg_acorn", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 56 bdg_beehive (decoration) — YARD_PROPS.as:4068
  [56, "bdg_beehive", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 57 bdg_birdhous (decoration) — YARD_PROPS.as:4101
  [57, "bdg_birdhous", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 58 bdg_tent (decoration) — YARD_PROPS.as:4135
  [58, "bdg_tent", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 59 bdg_jax (decoration) — YARD_PROPS.as:4169
  [59, "bdg_jax", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 60 bdg_redgnome (decoration) — YARD_PROPS.as:4202
  [60, "bdg_redgnome", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 61 bdg_bluegnome (decoration) — YARD_PROPS.as:4235
  [61, "bdg_bluegnome", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 62 bdg_greengnome (decoration) — YARD_PROPS.as:4268
  [62, "bdg_greengnome", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 63 bdg_hammock (decoration) — YARD_PROPS.as:4301
  [63, "bdg_hammock", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 64 bdg_lawnchair (decoration) — YARD_PROPS.as:4334
  [64, "bdg_lawnchair", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 65 bdg_outhouse (decoration) — YARD_PROPS.as:4367
  [65, "bdg_outhouse", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 66 bdg_pinecone (decoration) — YARD_PROPS.as:4400
  [66, "bdg_pinecone", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 67 bdg_rock (decoration) — YARD_PROPS.as:4434
  [67, "bdg_rock", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 68 bdg_scaleelectric (decoration) — YARD_PROPS.as:4467
  [68, "bdg_scaleelectric", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 69 bdg_scarecrow (decoration) — YARD_PROPS.as:4501
  [69, "bdg_scarecrow", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 70 bdg_sundial (decoration) — YARD_PROPS.as:4535
  [70, "bdg_sundial", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 71 bdg_tikitorch (decoration) — YARD_PROPS.as:4568
  [71, "bdg_tikitorch", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 72 bdg_walnut (decoration) — YARD_PROPS.as:4602
  [72, "bdg_walnut", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 73 bdg_tombstone (decoration) — YARD_PROPS.as:4635
  [73, "bdg_tombstone", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 74 bdg_pokeyhead (decoration) — YARD_PROPS.as:4668
  [74, "bdg_pokeyhead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 75 bdg_octohead (decoration) — YARD_PROPS.as:4701
  [75, "bdg_octohead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 76 bdg_bolthead (decoration) — YARD_PROPS.as:4734
  [76, "bdg_bolthead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 77 bdg_banditohead (decoration) — YARD_PROPS.as:4767
  [77, "bdg_banditohead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 78 bdg_brainhead (decoration) — YARD_PROPS.as:4800
  [78, "bdg_brainhead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 79 bdg_crabhead (decoration) — YARD_PROPS.as:4833
  [79, "bdg_crabhead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 80 bdg_davehead (decoration) — YARD_PROPS.as:4866
  [80, "bdg_davehead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 81 bdg_eyerahead (decoration) — YARD_PROPS.as:4899
  [81, "bdg_eyerahead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 82 bdg_fanghead (decoration) — YARD_PROPS.as:4932
  [82, "bdg_fanghead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 83 bdg_finkhead (decoration) — YARD_PROPS.as:4965
  [83, "bdg_finkhead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 84 bdg_ichihead (decoration) — YARD_PROPS.as:4998
  [84, "bdg_ichihead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 85 bdg_projectxhead (decoration) — YARD_PROPS.as:5031
  [85, "bdg_projectxhead", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 86 bdg_blackberrybush (decoration) — YARD_PROPS.as:5064
  [86, "bdg_blackberrybush", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 87 bdg_bonsaitree (decoration) — YARD_PROPS.as:5094
  [87, "bdg_bonsaitree", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 88 bdg_cactus (decoration) — YARD_PROPS.as:5127
  [88, "bdg_cactus", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 89 bdg_flytrap (decoration) — YARD_PROPS.as:5160
  [89, "bdg_flytrap", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 90 bdg_thorns (decoration) — YARD_PROPS.as:5193
  [90, "bdg_thorns", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 91 bdg_pinkflowers (decoration) — YARD_PROPS.as:5226
  [91, "bdg_pinkflowers", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 92 bdg_purpleflowers (decoration) — YARD_PROPS.as:5259
  [92, "bdg_purpleflowers", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 93 bdg_redflowers (decoration) — YARD_PROPS.as:5292
  [93, "bdg_redflowers", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 94 bdg_whiteflowers (decoration) — YARD_PROPS.as:5325
  [94, "bdg_whiteflowers", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 95 bdg_yellowflowers (decoration) — YARD_PROPS.as:5358
  [95, "bdg_yellowflowers", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 96 bdg_baseballstatue (decoration) — YARD_PROPS.as:5391
  [96, "bdg_baseballstatue", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 97 bdg_footballstatue (decoration) — YARD_PROPS.as:5429
  [97, "bdg_footballstatue", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 98 bdg_soccerstatue (decoration) — YARD_PROPS.as:5467
  [98, "bdg_soccerstatue", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 99 bdg_libertystatue (decoration) — YARD_PROPS.as:5505
  [99, "bdg_libertystatue", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 100 bdg_eiffelstatue (decoration) — YARD_PROPS.as:5543
  [100, "bdg_eiffelstatue", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 101 bdg_bigben (decoration) — YARD_PROPS.as:5581
  [101, "bdg_bigben", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 102 bdg_pool (decoration) — YARD_PROPS.as:5619
  [102, "bdg_pool", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 103 bdg_pond (decoration) — YARD_PROPS.as:5652
  [103, "bdg_pond", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 104 bdg_zengarden (decoration) — YARD_PROPS.as:5682
  [104, "bdg_zengarden", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 105 bdg_fountain (decoration) — YARD_PROPS.as:5715
  [105, "bdg_fountain", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 106 bdg_teagarden (decoration) — YARD_PROPS.as:5748
  [106, "bdg_teagarden", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 107 bdg_monsterskull (decoration) — YARD_PROPS.as:5781
  [107, "bdg_monsterskull", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 108 bdg_rubikunsolved (decoration) — YARD_PROPS.as:5814
  [108, "bdg_rubikunsolved", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 109 bdg_rubiksolved (decoration) — YARD_PROPS.as:5847
  [109, "bdg_rubiksolved", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 110 bdg_halloween (decoration) — YARD_PROPS.as:5881
  [110, "bdg_halloween", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 111 bdg_halloween_small (decoration) — YARD_PROPS.as:5914
  [111, "bdg_halloween_small", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [6]],
  // 113 Radio Tower (special) — YARD_PROPS.as:5963
  [113, "Radio Tower", "special", 2, [
    [2000,2000,2000,0,300,[[14,1,1]]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 114 Champion Cage (cage) — YARD_PROPS.as:6005
  [114, "Champion Cage", "cage", 3, [
    [500000,500000,250000,0,86400,[[14,1,4]]],
  ], [0,0,0,0,1,1,1,1,1,1,1]],
  // 115 Aerial Defense Tower (tower) — YARD_PROPS.as:6094
  [115, "Aerial Defense Tower", "tower", 3, [
    [215000,280000,62500,0,18000,[[14,1,4]]],
    [850000,1200000,250000,0,86400,[[14,1,5]]],
    [2750000,3400000,750000,0,172800,[[14,1,6]]],
    [5750000,5200000,1250000,0,345600,[[14,1,7]]],
    [13500000,11000000,2000000,0,518400,[[14,1,7]]],
    [16000000,14000000,4000000,0,691200,[[14,1,9]]],
    [19200000,16800000,8000000,0,864000,[[14,1,10]]],
    [23040000,21000000,16000000,0,1209600,[[14,1,10]]],
  ], [0,0,0,0,1,2,2,2,2,2,2]],
  // 116 Monster Lab (special) — YARD_PROPS.as:6236
  [116, "Monster Lab", "special", 2, [
    [100000,100000,0,0,10800,[[14,1,5],[8,1,3],[26,1,2]]],
    [300000,300000,0,0,43200,[[14,1,6],[8,1,4],[26,1,3]]],
    [600000,600000,0,0,86400,[[14,1,7],[8,1,4],[26,1,4]]],
  ], [0,0,0,0,0,1,1,1,1,1,1]],
  // 117 Heavy Trap (trap) — YARD_PROPS.as:6295
  [117, "Heavy Trap", "trap", 3, [
    [50000,50000,50000,0,5,[[14,1,4]]],
  ], [0,0,0,0,4,6,8,10,12,15,18]],
  // 118 Railgun (tower) — YARD_PROPS.as:6386
  [118, "Railgun", "tower", 3, [
    [2000000,2400000,1600000,0,43200,[[14,1,5]]],
    [3600000,4320000,2880000,0,86400,[[14,1,6]]],
    [6480000,7776000,5184000,0,172800,[[14,1,7]]],
    [11664000,13996800,9331200,0,345600,[[14,1,7]]],
    [16995200,18194240,16796160,0,518400,[[14,1,8]]],
    [20220000,24202000,19000000,0,691200,[[14,1,9]]],
    [25000000,25000000,22000000,0,864000,[[14,1,10]]],
    [27000000,27000000,26500000,0,1209600,[[14,1,10]]],
  ], [0,0,0,0,0,2,3,3,3,3,3]],
  // 119 Champion Chamber (special) — YARD_PROPS.as:6533
  [119, "Champion Chamber", "special", 3, [
    [500000,500000,250000,0,86400,[[14,1,4],[114,1,1]]],
  ], [0,0,0,0,1,1,1,1,1,1,1]],
  // 120 bdg_biggulp (decoration) — YARD_PROPS.as:6577
  [120, "bdg_biggulp", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 121 bdg_wmitotem1 (decoration) — YARD_PROPS.as:6611
  [121, "bdg_wmitotem1", "decoration", 4, [
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
  ], [0]],
  // 122 placeholder (placeholder) — YARD_PROPS.as:6706
  [122, "placeholder", "placeholder", 999, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 123 placeholder (placeholder) — YARD_PROPS.as:6723
  [123, "placeholder", "placeholder", 999, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 124 placeholder (placeholder) — YARD_PROPS.as:6740
  [124, "placeholder", "placeholder", 999, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 125 placeholder (placeholder) — YARD_PROPS.as:6757
  [125, "placeholder", "placeholder", 999, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 126 placeholder (placeholder) — YARD_PROPS.as:6774
  [126, "placeholder", "placeholder", 999, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 127 Inferno Cavern (enemy) — YARD_PROPS.as:6793
  [127, "Inferno Cavern", "enemy", 999, [
    [0,0,0,0,5,[[14,1,1]]],
    [0,0,0,0,5,[[14,1,1]]],
    [0,0,0,0,5,[[14,1,1]]],
    [0,0,0,0,5,[[14,1,1]]],
    [0,0,0,0,5,[[14,1,1]]],
  ], [1,1,1,1,1]],
  // 129 Quake Tower (tower) — YARD_PROPS.as:6911
  [129, "Quake Tower", "tower", 3, [
    [312500,187500,125000,0,18000,[]],
    [1250000,750000,500000,0,86400,[]],
    [3750000,2250000,1500000,0,172800,[]],
    [7187500,4312500,2875000,0,259200,[]],
    [12000000,9000000,6000000,0,388800,[]],
    [16500000,12687500,7562500,0,475200,[]],
  ], [0,1,1,2,2,4,4,4,4,4,4]],
  // 131 bdg_wmi2totem (decoration) — YARD_PROPS.as:7059
  [131, "bdg_wmi2totem", "decoration", 4, [
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
    [0,0,0,0,0,[]],
  ], [0]],
  // 132 Magma Tower (tower) — YARD_PROPS.as:7194
  [132, "Magma Tower", "tower", 3, [
    [187500,250000,62500,0,18000,[]],
    [750000,1000000,250000,0,86400,[]],
    [2250000,3000000,750000,0,172800,[]],
    [5250000,5000000,1250000,0,345600,[]],
    [12000000,10000000,2000000,0,518400,[]],
    [16000000,15000000,3000000,0,791200,[]],
  ], [0,1,1,1,2,2,2,2,2,2,2]],
  // 133 b_siegefactory (special) — YARD_PROPS.as:7326
  [133, "b_siegefactory", "special", 2, [
    [1500000,1500000,0,0,86400,[]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 134 b_siegeworks (special) — YARD_PROPS.as:7372
  [134, "b_siegeworks", "special", 2, [
    [600000,600000,0,0,43200,[]],
    [1200000,1200000,0,0,64800,[]],
    [1800000,1800000,0,0,86400,[]],
    [2400000,2400000,0,0,129600,[]],
    [3000000,3000000,0,0,172800,[]],
    [4000000,4000000,0,0,216000,[]],
    [5000000,5000000,0,0,259200,[]],
    [6000000,6000000,0,0,302400,[]],
    [7500000,7500000,0,0,345600,[]],
    [9000000,9000000,0,0,432000,[]],
  ], [0,1,1,1,1,1,1,1,1,1,1]],
  // 135 bdg_dave_trophy (decoration) — YARD_PROPS.as:7526
  [135, "bdg_dave_trophy", "decoration", 4, [
    [0,0,0,0,0,[]],
  ], [0]],
  // 136 bi_spurtzcannon (tower) — YARD_PROPS.as:7602
  [136, "bi_spurtzcannon", "tower", 3, [
    [0,0,0,0,0,[]],
    [500000,375000,250000,0,432000,[[14,1,7]]],
    [1000000,750000,500000,0,604800,[[14,1,8]]],
    [3000000,2250000,1500000,0,864000,[[14,1,9]]],
    [12000000,9000000,6000000,0,1209600,[[14,1,10]]],
  ], [0,2]],
  // 137 bi_blackspurtzcannon (tower) — YARD_PROPS.as:7714
  [137, "bi_blackspurtzcannon", "tower", 3, [
    [0,0,0,0,0,[]],
    [500000,375000,250000,0,432000,[[14,1,7]]],
    [1000000,750000,500000,0,604800,[[14,1,8]]],
    [3000000,2250000,1500000,0,864000,[[14,1,9]]],
    [12000000,9000000,6000000,0,1209600,[[14,1,10]]],
  ], [0,2]],
  // 138 b_stronghold (tower) — YARD_PROPS.as:7804
  [138, "b_stronghold", "tower", 3, [
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
  ], [0,1,1,1]],
  // 139 b_resourceop (cage) — YARD_PROPS.as:7867
  [139, "b_resourceop", "cage", 3, [
    [5,5,5,5,1,[]],
  ], [0,1]],
  // 140 b_opdefender (special) — YARD_PROPS.as:7906
  [140, "b_opdefender", "special", 3, [
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
    [5,5,5,5,1,[]],
  ], [0,1,1,1,1,1]],
];
