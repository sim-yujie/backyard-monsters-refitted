/**
 * The monster catalogue and the Monster Lab's abilities. GENERATED — do not edit
 * by hand; regenerate with `npm run gen:monster-catalogue` from `web/`
 * (`web/tools/gen-monster-catalogue.mjs`).
 *
 * Sources: `client/scripts/CREATURELOCKER.as` (`_mainCreatures`, declared at
 * :100) and `client/scripts/MONSTERLAB.as` (`_powerupProps`, declared at
 * :77); names and descriptions from
 * `server/public/gamestage/assets/english.json`. Decision D7
 * (`docs/design/yard-buildings.md` §4.8) is applied on top: Vorg (C16),
 * Slimeattikus (C17) and Rezghul (C19) are obtainable, Rezghul in locker slot
 * page 4 / order 4; Slimeattikus Mini (C18) stays blocked as C17's spawn. C200
 * and the Inferno roster are not included.
 *
 * This file exists twice, byte for byte: `web/src/game/monsters/monsterCatalogue.ts`
 * (what the Monsters screen shows) and `server/src/game-data/monsterCatalogue.ts`
 * (what the yard routes charge). A sync test beside each copy fails if they
 * differ, because a price the client shows and the server does not charge is a
 * bug the player pays for. Combat stats are not here: they stay in the shared
 * combat rules and `server/src/game-data/stats/monsterStats.ts`.
 */

/** One paid step: `[putty, seconds]`. */
export type PaidStep = readonly [putty: number, seconds: number];

/** One surface monster. */
export interface MonsterEntry {
  /** Roster id, `C1`..`C19`. */
  readonly id: string;
  readonly name: string;
  /** The game's own blurb; contains `<br>` and `<b>` markup. */
  readonly description: string;
  /**
   * Locker list place: page 1-4, then `order` within the page
   * (`client/scripts/CREATURELOCKERPOPUP.as:113-120`). 0 for C18, never listed.
   */
  readonly page: number;
  readonly order: number;
  /**
   * The hatchery and housing sort key (`CREATURELOCKER.as:1240`,
   * `client/scripts/HOUSING.as:288`). Not unique: C9 and C17 are both 10, so
   * sort with {@link compareListOrder}, which breaks the tie by locker slot.
   */
  readonly index: number;
  /** Unlock price in putty. */
  readonly resource: number;
  /** Unlock time in seconds. */
  readonly time: number;
  /** Monster Locker level the unlock needs. */
  readonly level: number;
  /** True when the monster is never offered: only C18 after D7. */
  readonly blocked: boolean;
  /** The monster whose death spawns this one (C18 → "C17"), else null. */
  readonly spawnedBy: string | null;
  /**
   * Academy training, entry `i` paying for level `i + 1` → `i + 2`, so the
   * highest level is `trainingCosts.length + 1` (`client/scripts/ACADEMY.as:65-67`).
   */
  readonly trainingCosts: readonly PaidStep[];
  /** Goo per hatch, by academy level (see {@link atLevel}). */
  readonly cResource: readonly number[];
  /** Hatch seconds, by academy level. */
  readonly cTime: readonly number[];
  /** Housing space, by academy level. */
  readonly cStorage: readonly number[];
}

/** One Monster Lab ability; rank `r` (1-3) costs `costs[r - 1]` and gives `effect[r - 1]`. */
export interface LabAbility {
  /** The monster it belongs to. */
  readonly id: string;
  /** Lab list order (`client/scripts/MONSTERLABPOPUP.as:452`). */
  readonly order: number;
  /** The ability's name, e.g. "Teleportation". */
  readonly name: string;
  /**
   * The label the original printed after the effect value, e.g. "Blink Range";
   * how the value is formatted differs per monster
   * (`client/scripts/MONSTERLABPOPUP.as:215-250`).
   */
  readonly effectLabel: string;
  readonly description: string;
  readonly upgradeDescription: string;
  readonly costs: readonly PaidStep[];
  readonly effect: readonly number[];
}

export const MONSTER_CATALOGUE: readonly MonsterEntry[] = [
  // C1 Pokey — CREATURELOCKER.as:101
  {
    id: "C1",
    name: "Pokey",
    description: "Like a swarm of ants, a roaming pack of Pokeys can devour a grown cow in less than five minutes.<br><b>Favorite Target:</b> Anything",
    page: 1,
    order: 1,
    index: 1,
    resource: 4000,
    time: 600,
    level: 1,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[4000, 7200], [8000, 10800], [12000, 18000], [16000, 28800], [22000, 43200]],
    cResource: [250, 450, 675, 800, 1000, 1250],
    cTime: [15, 10, 8, 7, 6, 5],
    cStorage: [10, 10, 10, 9, 8, 7],
  },
  // C2 Octo-ooze — CREATURELOCKER.as:126
  {
    id: "C2",
    name: "Octo-ooze",
    description: "The slimy Octoooze soaks up fire power like a sponge so other monsters can wreak havoc.<br><b>Favorite Target:</b> Defensive Towers",
    page: 1,
    order: 2,
    index: 2,
    resource: 8000,
    time: 3600,
    level: 1,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[8000, 14400], [16000, 21600], [24000, 36000], [48000, 57600], [64000, 86400]],
    cResource: [500, 900, 1350, 1800, 2100, 2500],
    cTime: [15, 16],
    cStorage: [10],
  },
  // C3 Bolt — CREATURELOCKER.as:150
  {
    id: "C3",
    name: "Bolt",
    description: "Bolt is fast as lightning and can run ahead of your other monsters to munch on buildings with its razor sharp teeth.<br><b>Favorite Target:</b> Harvesters, Town Halls and Silos",
    page: 1,
    order: 3,
    index: 3,
    resource: 16000,
    time: 7200,
    level: 1,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[16000, 14400], [32000, 21600], [48000, 28800], [96000, 43200], [144000, 57600]],
    cResource: [350, 675, 1015, 1400, 1800, 2400],
    cTime: [23],
    cStorage: [15],
  },
  // C4 Fink — CREATURELOCKER.as:175
  {
    id: "C4",
    name: "Fink",
    description: "Found deep inside Amazonia, Fink's chemo-receptors make its attacks deadly accurate.<br><b>Favorite Target:</b> Anything",
    page: 1,
    order: 4,
    index: 4,
    resource: 32000,
    time: 14400,
    level: 1,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[32000, 28800], [64000, 43200], [96000, 64800], [128000, 86400], [160000, 108000]],
    cResource: [1500, 2250, 3375, 4800, 7200, 10000],
    cTime: [100, 100, 100, 100, 90, 90],
    cStorage: [20],
  },
  // C5 Eye-ra — CREATURELOCKER.as:200
  {
    id: "C5",
    name: "Eye-ra",
    description: "Warning: Eye-ra's chemical makeup combusts within close proximity to walls.<br><b>Favorite Target:</b> Walls",
    page: 2,
    order: 1,
    index: 5,
    resource: 64000,
    time: 28800,
    level: 2,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[64000, 18000], [128000, 25200], [192000, 43200], [384000, 86400], [512000, 129600]],
    cResource: [5000, 15000, 30000, 45000, 60000, 80000],
    cTime: [1500],
    cStorage: [60],
  },
  // C6 Ichi — CREATURELOCKER.as:226
  {
    id: "C6",
    name: "Ichi",
    description: "Discovered on the peak of Mt. Fuji, Ichi is one of the deadliest monsters and can withstand intense damage from towers and traps.<br><b>Favorite Target:</b> Defensive Towers",
    page: 2,
    order: 2,
    index: 6,
    resource: 128000,
    time: 57600,
    level: 2,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[128000, 43200], [256000, 64800], [409600, 86400], [640000, 172800], [820000, 259200]],
    cResource: [5000, 5625, 8440, 11200, 16000, 24000],
    cTime: [100, 100, 90],
    cStorage: [20],
  },
  // C7 Bandito — CREATURELOCKER.as:250
  {
    id: "C7",
    name: "Bandito",
    description: "Bandito's thick exoskeleton and impeccable accuracy make it the perfect monster assassin.<br><b>Favorite Target:</b> Anything",
    page: 2,
    order: 3,
    index: 7,
    resource: 256000,
    time: 100800,
    level: 2,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[256000, 43200], [512000, 57600], [756000, 86400], [1024000, 129600], [1440000, 172800]],
    cResource: [2500, 4500, 6750, 8750, 11200, 14400],
    cTime: [225, 225, 225, 225, 180, 180],
    cStorage: [20],
  },
  // C8 Fang — CREATURELOCKER.as:275
  {
    id: "C8",
    name: "Fang",
    description: "Fang's bite releases a toxic venom which liquidates any target.<br><b>Favorite Target:</b> Anything",
    page: 2,
    order: 4,
    index: 8,
    resource: 512000,
    time: 144000,
    level: 2,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[512000, 43200], [512000, 57600], [756000, 86400], [1024000, 129600], [1440000, 172800]],
    cResource: [18000, 27000, 40500, 60500, 80000, 100000],
    cTime: [450, 350, 250, 225, 195, 195],
    cStorage: [30],
  },
  // C9 Brain — CREATURELOCKER.as:300
  {
    id: "C9",
    name: "Brain",
    description: "Cunning and greedy, Brain's pulsating cerebral cortex and high intelligence make him perfect for looting resources.<br><b>Favorite Target:</b> Harvesters, Town Halls and Silos",
    page: 3,
    order: 1,
    index: 10,
    resource: 1024000,
    time: 187200,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[1024000, 43200], [2056000, 57600], [2870000, 72000], [4500000, 144000], [6000000, 216000]],
    cResource: [12000, 20250, 30375, 35000, 50000, 75000],
    cTime: [342],
    cStorage: [30],
  },
  // C10 Crabatron — CREATURELOCKER.as:325
  {
    id: "C10",
    name: "Crabatron",
    description: "Using its claws to snap towers like twigs, Crabatron strikes fear into the heart of its enemies.<br><b>Favorite Target:</b> Defensive Towers",
    page: 3,
    order: 3,
    index: 11,
    resource: 2048000,
    time: 208800,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[2048000, 43200], [3000000, 64800], [4400000, 86400], [6000000, 172800], [7500000, 259200]],
    cResource: [30000, 45000, 67500, 75000, 90000, 120000],
    cTime: [750],
    cStorage: [40],
  },
  // C11 Project X — CREATURELOCKER.as:349
  {
    id: "C11",
    name: "Project X",
    description: "A government experiment gone terribly wrong, Project X is programmed to attack defense towers in battle.<br><b>Favorite Target:</b> Defensive Towers",
    page: 3,
    order: 4,
    index: 12,
    resource: 4096000,
    time: 223200,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[4096000, 86400], [7000000, 129600], [12000000, 172800], [18000000, 345600], [24000000, 460800]],
    cResource: [60000, 90000, 135000, 180000, 234000, 280000],
    cTime: [1384],
    cStorage: [70],
  },
  // C12 D.A.V.E. — CREATURELOCKER.as:374
  {
    id: "C12",
    name: "D.A.V.E.",
    description: "D.A.V.E. only listens to its master and has a habit of completely destroying bases.<br><b>Favorite Target:</b> Anything",
    page: 4,
    order: 3,
    index: 16,
    resource: 8192000,
    time: 259200,
    level: 4,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[8192000, 172800], [10000000, 259200], [12200000, 345600], [19200000, 518400], [28000000, 691200]],
    cResource: [150000, 225000, 337500, 440000, 600000, 800000],
    cTime: [3600],
    cStorage: [160],
  },
  // C13 Wormzer — CREATURELOCKER.as:399
  {
    id: "C13",
    name: "Wormzer",
    description: "Wormzer utilizes his burrowing ability to launch surprise attacks and evade even the toughest walled defense.<br><b>Favorite Target:</b> Anything",
    page: 4,
    order: 2,
    index: 15,
    resource: 4096000,
    time: 223200,
    level: 4,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[4096000, 86400], [8192000, 172800], [8192000, 259200], [8192000, 345600], [12800000, 460800]],
    cResource: [20000, 25000, 30000, 35000, 40000, 47500],
    cTime: [1384],
    cStorage: [70],
  },
  // C14 Teratorn — CREATURELOCKER.as:426
  {
    id: "C14",
    name: "Teratorn",
    description: "With its swift wings and fiery breath, the flying Teratorn rains death from above.<br><b>Favorite Target:</b> Anything",
    page: 4,
    order: 1,
    index: 14,
    resource: 4096000,
    time: 216000,
    level: 4,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[4096000, 129600], [7000000, 194400], [10000000, 288000], [16000000, 489600], [24000000, 648000]],
    cResource: [70000, 95000, 145000, 200000, 300000, 400000],
    cTime: [1800, 1920, 2040, 2160, 2280, 2400],
    cStorage: [70],
  },
  // C15 Zafreeti — CREATURELOCKER.as:455
  {
    id: "C15",
    name: "Zafreeti",
    description: "From deep within the Sahara, comes the mystical Zafreeti healer.",
    page: 3,
    order: 5,
    index: 13,
    resource: 6192000,
    time: 216000,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[6192000, 129600], [7800000, 194400], [12000000, 288000], [18000000, 489600]],
    cResource: [120000, 180000, 256000, 324000, 468000],
    cTime: [2400],
    cStorage: [200],
  },
  // C16 Vorg — CREATURELOCKER.as:485; D7 sets blocked
  {
    id: "C16",
    name: "Vorg",
    description: "Hatched in giant hives deep inside the asteroid belt, Vorg are flying alien healers with a penchant for mischief.",
    page: 2,
    order: 5,
    index: 9,
    resource: 384000,
    time: 129600,
    level: 2,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[384000, 86400], [384000, 129600], [512000, 172800], [768000, 216000], [1024000, 259200]],
    cResource: [16000, 25000, 38500, 62500, 75000, 90000],
    cTime: [1200],
    cStorage: [60],
  },
  // C17 Slimeattikus — CREATURELOCKER.as:517; D7 sets blocked
  {
    id: "C17",
    name: "Slimeattikus",
    description: "An unholy biological terror birthed in the Bangweulu Swamps of Zambia, the Slimeattikus dissolves foes on contact and fissions when attacked.<br><b>Favorite Target:</b> Anything",
    page: 3,
    order: 2,
    index: 10,
    resource: 2048000,
    time: 129600,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[2560000, 86400], [3840000, 129600], [4096000, 172800], [6250000, 216000], [8500000, 288000]],
    cResource: [27000, 40500, 60750, 90000, 125000, 150000],
    cTime: [500, 450, 400, 350, 300, 250],
    cStorage: [40],
  },
  // C18 Slimeattikus (mini) — CREATURELOCKER.as:544
  {
    id: "C18",
    name: "Slimeattikus (mini)",
    description: "",
    page: 0,
    order: 0,
    index: 0,
    resource: 2048000,
    time: 129600,
    level: 3,
    blocked: true,
    spawnedBy: "C17",
    trainingCosts: [[2560000, 86400], [3840000, 129600], [4096000, 172800], [6250000, 216000], [8500000, 288000]],
    cResource: [27000, 40500, 60750, 90000, 125000, 150000],
    cTime: [500, 450, 400, 350, 300, 250],
    cStorage: [40],
  },
  // C19 Rezghul — CREATURELOCKER.as:570; D7 sets blocked, page, order
  {
    id: "C19",
    name: "Rezghul",
    description: "This mighty monster can bring fellow monsters back from the dead at will, making Rezghul the perfect addition to any Backyard barrage. ",
    page: 4,
    order: 4,
    index: 17,
    resource: 2048000,
    time: 129600,
    level: 3,
    blocked: false,
    spawnedBy: null,
    trainingCosts: [[16000000, 86400], [19000000, 129600], [22000000, 172800], [25000000, 216000], [28000000, 259200]],
    cResource: [1000000],
    cTime: [4500],
    cStorage: [250],
  },
];

export const LAB_ABILITIES: readonly LabAbility[] = [
  // C3 Bolt — MONSTERLAB.as:78
  {
    id: "C3",
    order: 1,
    name: "Teleportation",
    effectLabel: "Blink Range",
    description: "Adds the ability to blink increasing speed.",
    upgradeDescription: "Blinks faster and more frequently.",
    costs: [[48000, 86400], [72000, 86400], [108000, 86400]],
    effect: [150, 300, 450],
  },
  // C4 Fink — MONSTERLAB.as:89
  {
    id: "C4",
    order: 2,
    name: "Claws",
    effectLabel: "Extra Target(s)",
    description: "Fink uses all of his claws to slaughter multiple buildings and monsters surrounding him.",
    upgradeDescription: "Fink can attack more targets simultaneously.",
    costs: [[96000, 108000], [128000, 108000], [144000, 108000]],
    effect: [1, 2, 3],
  },
  // C7 Bandito — MONSTERLAB.as:100
  {
    id: "C7",
    order: 3,
    name: "Whirlwind",
    effectLabel: "Whirlwind",
    description: "Attacks multiple enemies around him.",
    upgradeDescription: "Attacks multiple enemies around him.",
    costs: [[1000000, 115200], [1500000, 115200], [2000000, 115200]],
    effect: [1, 1.5, 2],
  },
  // C8 Fang — MONSTERLAB.as:111
  {
    id: "C8",
    order: 4,
    name: "Venom",
    effectLabel: "Venom Damage",
    description: "Fang injects venom into the veins of his enemies, which continues to cause damage well after the bite.",
    upgradeDescription: "Increases potency of Fang's venom, causing more damage over time.",
    costs: [[2000000, 129600], [3000000, 129600], [4500000, 129600]],
    effect: [0.1, 0.2, 0.3],
  },
  // C5 Eye-ra — MONSTERLAB.as:122
  {
    id: "C5",
    order: 5,
    name: "Airburst",
    effectLabel: "Airburst Bonus",
    description: "Eye-ra launches himself up dealing partial damage to air units and increased splash range and damage to ground targets.",
    upgradeDescription: "Increases Eye-ra's damage and ground splash radius.",
    costs: [[3560000, 172800], [4120000, 194400], [5120000, 216000]],
    effect: [0.2, 0.3, 0.4],
  },
  // C9 Brain — MONSTERLAB.as:133
  {
    id: "C9",
    order: 6,
    name: "Invisibility",
    effectLabel: "s Cloak Delay",
    description: "Gives the Brain the ability to turn invisible causing towers not to attack it.",
    upgradeDescription: "Increases the duration of invisibility.",
    costs: [[3000000, 172800], [4500000, 172800], [6000000, 172800]],
    effect: [0, 4, 8],
  },
  // C11 Project X — MONSTERLAB.as:144
  {
    id: "C11",
    order: 7,
    name: "Acid Spores",
    effectLabel: "Acid Damage",
    description: "Adds the ability to unleash acid when the Project X dies.",
    upgradeDescription: "Add more damage from acid.",
    costs: [[8000000, 259200], [12000000, 259200], [18000000, 259200]],
    effect: [1, 2, 3],
  },
  // C13 Wormzer — MONSTERLAB.as:166
  {
    id: "C13",
    order: 8,
    name: "Splash Damage",
    effectLabel: "Splash Damage",
    description: "Adds the ability to do extra splash damage when Wormzer pops up.",
    upgradeDescription: "Additional damage when popping up.",
    costs: [[10000000, 345600], [15000000, 345600], [22500000, 345600]],
    effect: [1, 2, 3],
  },
  // C14 Teratorn — MONSTERLAB.as:177
  {
    id: "C14",
    order: 9,
    name: "Ricochet",
    effectLabel: "Fireball Bounces",
    description: "Adds the ability for attacks to bounce off of buildings doing damage to multiple targets.",
    upgradeDescription: "Increases the number of targets struck.",
    costs: [[12000000, 432000], [18000000, 432000], [27000000, 432000]],
    effect: [1, 2, 3],
  },
  // C12 D.A.V.E. — MONSTERLAB.as:155
  {
    id: "C12",
    order: 10,
    name: "Rockets",
    effectLabel: "Rocket Range",
    description: "Gives D.A.V.E. the ability to fire rockets increasing the damage he does.",
    upgradeDescription: "Increases the range of DAVES rockets.",
    costs: [[15000000, 518400], [22500000, 518400], [33750000, 518400]],
    effect: [140, 180, 220],
  },
];

const MONSTERS_BY_ID: ReadonlyMap<string, MonsterEntry> = new Map(
  MONSTER_CATALOGUE.map((entry) => [entry.id, entry]),
);

const ABILITIES_BY_ID: ReadonlyMap<string, LabAbility> = new Map(
  LAB_ABILITIES.map((ability) => [ability.id, ability]),
);

/** The catalogue entry for `id`, or undefined for an id not in it (C200, Inferno, junk). */
export const monsterEntry = (id: string): MonsterEntry | undefined => MONSTERS_BY_ID.get(id);

/** The lab ability for `id`, or undefined for the monsters that have none. */
export const labAbility = (id: string): LabAbility | undefined => ABILITIES_BY_ID.get(id);

/**
 * Orders monsters as the hatchery and housing lists do: by `index`, ties broken
 * by locker page and order (C9 before C17).
 */
export const compareListOrder = (a: MonsterEntry, b: MonsterEntry): number =>
  a.index - b.index || a.page - b.page || a.order - b.order;

/** Every monster a player can unlock, hatch and house, in list order. */
export const LISTED_MONSTERS: readonly MonsterEntry[] = MONSTER_CATALOGUE.filter(
  (entry) => !entry.blocked,
).sort(compareListOrder);

/** True for a monster a player can unlock, hatch and house. */
export const isListed = (id: string): boolean => monsterEntry(id)?.blocked === false;

/**
 * The value of a per-level ladder at academy `level`: `ladder[level - 1]`,
 * clamped to the last entry when the level runs past the ladder, as
 * `CREATURES.GetProperty` does (`client/scripts/CREATURES.as:74-80`). A level
 * below 1 reads as 1.
 */
export const atLevel = (ladder: readonly number[], level: number): number => {
  const clamped = Math.min(Math.max(Math.trunc(level), 1), ladder.length);
  return ladder[clamped - 1] ?? 0;
};

/** Goo to hatch one `id` at academy `level`; undefined for an unknown id. */
export const hatchCost = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cResource, level);
};

/** Seconds to hatch one `id` at academy `level`; undefined for an unknown id. */
export const hatchTime = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cTime, level);
};

/** Housing space one `id` takes at academy `level`; undefined for an unknown id. */
export const housingSpace = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cStorage, level);
};

/** The highest academy level `id` can reach; 0 for an unknown id. */
export const maxTrainingLevel = (id: string): number => {
  const entry = monsterEntry(id);
  return entry ? entry.trainingCosts.length + 1 : 0;
};

/**
 * What training `id` from academy `level` to `level + 1` costs, or undefined
 * when it is already at its highest level or the id is unknown.
 */
export const trainingStep = (id: string, level: number): PaidStep | undefined =>
  monsterEntry(id)?.trainingCosts[level - 1];

/** What researching rank `rank` (1-3) of `id`'s lab ability costs, or undefined. */
export const labStep = (id: string, rank: number): PaidStep | undefined =>
  labAbility(id)?.costs[rank - 1];
