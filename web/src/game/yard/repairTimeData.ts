/**
 * Building repair times, per type and level. GENERATED — do not edit by hand.
 *
 * Source: the `repairTime` array of each entry in `client/scripts/YARD_PROPS.as`.
 * Regenerate with `node tools/gen-repair-times.mjs` from `web/`.
 *
 * A repairing building heals `ceil(maxHealth / min(3600, repairTime[lvl - 1]))`
 * health a second, a building still under construction reading `repairTime[0]`
 * (`client/scripts/BFOUNDATION.as:1367-1370`), so no repair takes longer than
 * an hour. The two copies, `web/src/game/yard/repairTimeData.ts` and
 * `server/src/game-data/repairTimes.ts`, hold identical rows: the client shows
 * the countdown and the Shiny price the server heals and charges by.
 */

/** Seconds, indexed by level minus one; keyed by building type. */
export const REPAIR_TIMES: Readonly<Record<number, readonly number[]>> = {
  1: [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360], // YARD_PROPS.as:155
  2: [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360], // YARD_PROPS.as:302
  3: [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360], // YARD_PROPS.as:449
  4: [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360], // YARD_PROPS.as:596
  5: [100, 300, 600, 900, 900], // YARD_PROPS.as:711
  6: [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360], // YARD_PROPS.as:871
  7: [10], // YARD_PROPS.as:899
  8: [480, 1920, 3840, 15360], // YARD_PROPS.as:1000
  9: [480, 1920, 7680], // YARD_PROPS.as:1061
  10: [3840], // YARD_PROPS.as:1108
  11: [300, 600, 600], // YARD_PROPS.as:1168
  12: [10], // YARD_PROPS.as:1214
  13: [60, 150, 300], // YARD_PROPS.as:1297
  14: [480, 1920, 3840, 7680, 15360, 30720, 64800, 86400, 172800, 345600], // YARD_PROPS.as:1550
  15: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000], // YARD_PROPS.as:1661
  16: [300], // YARD_PROPS.as:1708
  17: [5, 5, 5, 5, 5], // YARD_PROPS.as:1829
  18: [20], // YARD_PROPS.as:1873
  19: [120, 240, 480, 960, 1920, 3840, 7680], // YARD_PROPS.as:1964
  20: [360, 720, 1440, 2880, 5760, 11520, 23000, 46000, 64800, 86400], // YARD_PROPS.as:2185
  21: [360, 720, 1440, 2880, 5760, 11520, 23000, 46000, 64800, 86400], // YARD_PROPS.as:2408
  22: [120, 240, 480, 960, 1920], // YARD_PROPS.as:2485
  23: [1440, 2880, 5760, 11520, 23000, 46000, 92000, 184000], // YARD_PROPS.as:2680
  24: [1], // YARD_PROPS.as:2726
  25: [1920, 3840, 7680, 9260, 12000, 18000, 24000, 30000], // YARD_PROPS.as:2921
  26: [3800, 7680, 10640, 15600, 22800], // YARD_PROPS.as:3027
  27: [1], // YARD_PROPS.as:3062
  28: [1], // YARD_PROPS.as:3096
  29: [1], // YARD_PROPS.as:3130
  30: [1], // YARD_PROPS.as:3164
  31: [1], // YARD_PROPS.as:3198
  32: [1], // YARD_PROPS.as:3233
  33: [1], // YARD_PROPS.as:3267
  34: [1], // YARD_PROPS.as:3301
  35: [1], // YARD_PROPS.as:3335
  36: [1], // YARD_PROPS.as:3369
  37: [1], // YARD_PROPS.as:3403
  38: [1], // YARD_PROPS.as:3437
  39: [1], // YARD_PROPS.as:3471
  40: [1], // YARD_PROPS.as:3505
  41: [1], // YARD_PROPS.as:3539
  42: [1], // YARD_PROPS.as:3573
  43: [1], // YARD_PROPS.as:3607
  44: [1], // YARD_PROPS.as:3641
  45: [1], // YARD_PROPS.as:3675
  46: [1], // YARD_PROPS.as:3709
  47: [1], // YARD_PROPS.as:3743
  48: [1], // YARD_PROPS.as:3777
  49: [1], // YARD_PROPS.as:3812
  50: [1], // YARD_PROPS.as:3847
  51: [120, 240, 480, 960], // YARD_PROPS.as:3935
  52: [1], // YARD_PROPS.as:3971
  53: [10], // YARD_PROPS.as:3988
  54: [10], // YARD_PROPS.as:4012
  55: [1], // YARD_PROPS.as:4053
  56: [1], // YARD_PROPS.as:4086
  57: [1], // YARD_PROPS.as:4119
  58: [1], // YARD_PROPS.as:4153
  59: [1], // YARD_PROPS.as:4187
  60: [1], // YARD_PROPS.as:4220
  61: [1], // YARD_PROPS.as:4253
  62: [1], // YARD_PROPS.as:4286
  63: [1], // YARD_PROPS.as:4319
  64: [1], // YARD_PROPS.as:4352
  65: [1], // YARD_PROPS.as:4385
  66: [1], // YARD_PROPS.as:4418
  67: [1], // YARD_PROPS.as:4452
  68: [1], // YARD_PROPS.as:4485
  69: [1], // YARD_PROPS.as:4519
  70: [1], // YARD_PROPS.as:4553
  71: [1], // YARD_PROPS.as:4587
  72: [1], // YARD_PROPS.as:4620
  73: [1], // YARD_PROPS.as:4653
  74: [1], // YARD_PROPS.as:4686
  75: [1], // YARD_PROPS.as:4719
  76: [1], // YARD_PROPS.as:4752
  77: [1], // YARD_PROPS.as:4785
  78: [1], // YARD_PROPS.as:4818
  79: [1], // YARD_PROPS.as:4851
  80: [1], // YARD_PROPS.as:4884
  81: [1], // YARD_PROPS.as:4917
  82: [1], // YARD_PROPS.as:4950
  83: [1], // YARD_PROPS.as:4983
  84: [1], // YARD_PROPS.as:5016
  85: [1], // YARD_PROPS.as:5049
  86: [1], // YARD_PROPS.as:5079
  87: [1], // YARD_PROPS.as:5112
  88: [1], // YARD_PROPS.as:5145
  89: [1], // YARD_PROPS.as:5178
  90: [1], // YARD_PROPS.as:5211
  91: [1], // YARD_PROPS.as:5244
  92: [1], // YARD_PROPS.as:5277
  93: [1], // YARD_PROPS.as:5310
  94: [1], // YARD_PROPS.as:5343
  95: [1], // YARD_PROPS.as:5376
  96: [1], // YARD_PROPS.as:5414
  97: [1], // YARD_PROPS.as:5452
  98: [1], // YARD_PROPS.as:5490
  99: [1], // YARD_PROPS.as:5528
  100: [1], // YARD_PROPS.as:5566
  101: [1], // YARD_PROPS.as:5604
  102: [1], // YARD_PROPS.as:5637
  103: [1], // YARD_PROPS.as:5667
  104: [1], // YARD_PROPS.as:5700
  105: [1], // YARD_PROPS.as:5733
  106: [1], // YARD_PROPS.as:5766
  107: [1], // YARD_PROPS.as:5799
  108: [1], // YARD_PROPS.as:5832
  109: [1], // YARD_PROPS.as:5865
  110: [1], // YARD_PROPS.as:5899
  111: [1], // YARD_PROPS.as:5932
  113: [240], // YARD_PROPS.as:5991
  114: [1080], // YARD_PROPS.as:6031
  115: [1920, 3840, 7680, 9260, 12000, 18000, 24000, 30000], // YARD_PROPS.as:6223
  116: [3800, 7680, 10640, 15600], // YARD_PROPS.as:6281
  117: [1], // YARD_PROPS.as:6322
  118: [2880, 5760, 11520, 23000, 46000, 69000, 103500, 155250], // YARD_PROPS.as:6519
  119: [3600], // YARD_PROPS.as:6561
  120: [1], // YARD_PROPS.as:6595
  121: [1, 1, 1, 1, 1, 1], // YARD_PROPS.as:6692
  122: [1], // YARD_PROPS.as:6709
  123: [1], // YARD_PROPS.as:6726
  124: [1], // YARD_PROPS.as:6743
  125: [1], // YARD_PROPS.as:6760
  126: [1], // YARD_PROPS.as:6777
  127: [1, 1, 1, 1, 1], // YARD_PROPS.as:6855
  129: [1440, 2880, 5760, 11520, 23000, 23000, 23000, 23000], // YARD_PROPS.as:7028
  131: [1, 1, 1, 1, 1, 1, 1], // YARD_PROPS.as:7140
  132: [1440, 2880, 5760, 11520, 23000, 46000, 92000], // YARD_PROPS.as:7310
  133: [3600], // YARD_PROPS.as:7356
  134: [3600, 3600, 3600, 3600, 3600, 3600, 3600, 3600, 3600, 3600], // YARD_PROPS.as:7508
  135: [1], // YARD_PROPS.as:7549
  136: [1920, 3840, 7680, 9260, 12000], // YARD_PROPS.as:7661
  137: [2110, 4220, 8450, 10190, 13200], // YARD_PROPS.as:7773
  138: [86400, 172800, 345600], // YARD_PROPS.as:7849
  139: [1], // YARD_PROPS.as:7888
  140: [1920, 7680, 30720, 86400, 345600], // YARD_PROPS.as:7960
};

/** No repair takes longer than this (`BFOUNDATION.as:1369`). */
export const REPAIR_CAP_SECONDS = 3600;

/**
 * A type's `repairTime` at a level: `[0]` for level 0 (a building still under
 * construction), the last entry past the top of the ladder, and the one-hour
 * cap for a type the table does not have.
 */
export const repairTimeOf = (type: number, level: number): number => {
  const times = REPAIR_TIMES[type];
  if (!times || times.length === 0) return REPAIR_CAP_SECONDS;
  const index = Math.min(Math.max(Math.floor(level) - 1, 0), times.length - 1);
  return times[index] ?? REPAIR_CAP_SECONDS;
};
