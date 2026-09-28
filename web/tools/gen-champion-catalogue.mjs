/**
 * Regenerates the champion catalogue from the Flash client's champion table.
 *
 *   cd web && npm run gen:champion-catalogue
 *   cd web && node tools/gen-champion-catalogue.mjs --check     (compare, write nothing)
 *
 * The catalogue is what the Champion Cage panel shows and what the server's
 * champion routes charge (`docs/design/yard-buildings.md` §7.2, WP5.4): per
 * champion its per-level stats, the feeding economy (feeds per level, the
 * Shiny prices, the feed interval) and the Map Room 2 feed recipes. The
 * server's `game-data/stats/championStats.ts` stays as it is: the attack
 * validator compares a submitted champion's props against every key there
 * (`services/maproom/validateAttack.ts:77-90`), so the feeding fields live
 * here instead.
 *
 * What it reads, and from where:
 *
 * | Field                     | Source                                              |
 * |---------------------------|-----------------------------------------------------|
 * | stats, prices, feedCount  | `client/scripts/CHAMPIONCAGE.as`, `_guardians`      |
 * | `feeds`, `bonusFeeds`     | the Map Room 2 overrides in `setFeedProps()`, for   |
 * |                           | G1-G4; Krallen (G5) keeps its table literal         |
 * | `STARVE_SECONDS`          | `CHAMPIONCAGE.STARVETIMER`                          |
 * | names, descriptions       | `server/public/gamestage/assets/english.json`       |
 *
 * `raisable` is `CanTrainGuardian` (`CHAMPIONCAGE.as:459-461`): `powerLevel > 0`
 * and a basic class, so Gorgo, Drull and Fomor; Korath stays unavailable
 * (decision D17) because the source gives it power level 0.
 *
 * Two files are written, byte for byte identical:
 *
 *   web/src/game/yard/championCatalogue.ts
 *   server/src/game-data/championCatalogue.ts
 *
 * Both import nothing, so the same text compiles in either package; the sync
 * tests beside each copy fail if the two ever differ. `--check` regenerates in
 * memory and exits 1 if either file on disk is stale, and `--scripts <dir>`
 * reads `CHAMPIONCAGE.as` from another directory (the generator's own test
 * uses it). Line endings are
 * compared normalised, because worktrees check files out with CRLF.
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, Ident, readAssignment, readAssignments, ShapeError } from "./lib/as3-literal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const scriptsAt = args.indexOf("--scripts");
const SCRIPTS =
  scriptsAt >= 0 ? resolve(args[scriptsAt + 1] ?? "") : resolve(repo, "client/scripts");
const CAGE = resolve(SCRIPTS, "CHAMPIONCAGE.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/english.json");
const WEB_OUT = resolve(here, "../src/game/yard/championCatalogue.ts");
const SERVER_OUT = resolve(repo, "server/src/game-data/championCatalogue.ts");

// A shape error is the expected way to fail: print where, not a stack trace.
process.on("uncaughtException", (error) => {
  if (!(error instanceof ShapeError)) throw error;
  console.error(`gen-champion-catalogue: ${error.message}`);
  process.exit(1);
});

const strings = JSON.parse(readFileSync(STRINGS, "utf8"));
const source = readFileSync(CAGE, "utf8");

/* ── Field checks ─────────────────────────────────────────────────────────── */

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

const numbers = (line, id, key, value, { min = 1 } = {}) => {
  if (!Array.isArray(value) || value.length < min || !value.every(isNumber)) {
    fail(CAGE, line, `${id}.${key} is not a list of at least ${min} numbers`);
  }
  return value;
};

const whole = (line, id, key, value) => {
  if (!Number.isInteger(value) || value < 0) fail(CAGE, line, `${id}.${key} is not a whole number`);
  return value;
};

const text = (line, id, key, value) => {
  if (typeof value !== "string" || value.length === 0) fail(CAGE, line, `${id}.${key} is not a string`);
  return value;
};

/** One feed recipe: `{ monsterId: count }`, at least one monster. */
const recipe = (line, id, key, value) => {
  const ok =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0 &&
    Object.entries(value).every(
      ([monster, count]) => /^I?C\d+$/.test(monster) && Number.isInteger(count) && count > 0,
    );
  if (!ok) fail(CAGE, line, `${id}.${key} has a recipe that is not { monsterId: count }`);
  return value;
};

const recipes = (line, id, key, value, length) => {
  if (!Array.isArray(value) || value.length !== length) {
    fail(CAGE, line, `${id}.${key} is not ${length} recipes`);
  }
  return value.map((one) => recipe(line, id, key, one));
};

/** A key in the live string table; a missing one is an error, not a blank. */
const lookup = (line, id, key) => {
  const found = strings[key];
  if (typeof found !== "string") fail(CAGE, line, `${id}: no English string for ${key}`);
  return found;
};

/* ── The table ────────────────────────────────────────────────────────────── */

const EXPECTED_IDS = ["G1", "G2", "G3", "G4", "G5"];
const CLASS_TYPES = { CLASS_TYPE_BASIC: "basic", CLASS_TYPE_SPECIAL: "special" };

const starve = /STARVETIMER\s*:\s*uint\s*=\s*3600\s*\*\s*24\s*;/.exec(source);
if (!starve) fail(CAGE, 0, "STARVETIMER is no longer `3600 * 24`");
const STARVE_SECONDS = 3600 * 24;

const table = readAssignment(CAGE, "_guardians");
const ids = Object.keys(table.value).filter((key) => key !== "length");
if (ids.join() !== EXPECTED_IDS.join()) {
  fail(CAGE, table.declaredAt, `_guardians ids changed: ${ids.join(", ")}`);
}

/** The Map Room 2 override of `_guardians.<id>.props.<key>`, or null when there is none. */
const override = (id, key) => {
  const found = readAssignments(CAGE, `_guardians.${id}.props.${key}`);
  if (found.length > 1) fail(CAGE, found[1].declaredAt, `${id}.${key} is overridden twice`);
  return found[0] ?? null;
};

const champions = EXPECTED_IDS.map((id, index) => {
  const raw = table.value[id];
  const line = table.lines[id];
  const props = raw.props;
  if (!props || typeof props !== "object") fail(CAGE, line, `${id} has no props block`);
  if (!(raw.classType instanceof Ident) || !CLASS_TYPES[raw.classType.name]) {
    fail(CAGE, line, `${id}.classType is not a known class constant`);
  }
  const kind = CLASS_TYPES[raw.classType.name];
  const powerLevel = whole(line, id, "powerLevel", props.powerLevel);

  const health = numbers(line, id, "health", props.health);
  const levels = health.length;
  const ladder = (key) => {
    const value = numbers(line, id, key, props[key]);
    if (value.length > levels) fail(CAGE, line, `${id}.${key} is longer than health`);
    return value;
  };
  const single = (key) => {
    const value = numbers(line, id, key, props[key]);
    if (value.length !== 1) fail(CAGE, line, `${id}.${key} is no longer a single value`);
    return value[0];
  };
  const bonus = (key) => numbers(line, id, key, props[key]);

  const feedsOverride = override(id, "feeds");
  const bonusOverride = override(id, "bonusFeeds");
  if (id === "G5" ? feedsOverride || bonusOverride : !feedsOverride || !bonusOverride) {
    fail(CAGE, line, `the Map Room 2 feed overrides no longer cover exactly G1-G4 (${id})`);
  }
  const feeds = recipes(
    feedsOverride?.declaredAt ?? line,
    id,
    "feeds",
    feedsOverride?.value ?? props.feeds,
    5,
  );
  const bonusFeeds = recipes(
    bonusOverride?.declaredAt ?? line,
    id,
    "bonusFeeds",
    bonusOverride?.value ?? props.bonusFeeds,
    3,
  );

  // `mon_<name>title` is "GORGO<br>High Defense"; the role is the second half.
  // Krallen borrows Gorgo's title key in the source, so it gets no role.
  const title = lookup(line, id, text(line, id, "title", raw.title));
  const [head, role] = title.split("<br>");
  const name = text(line, id, "name", raw.name);

  return {
    id,
    line,
    t: index + 1,
    name,
    role: role && head.toLowerCase() === name.toLowerCase() ? role : null,
    description: lookup(line, id, text(line, id, "description", raw.description)),
    kind,
    powerLevel,
    raisable: powerLevel > 0 && kind === "basic",
    levels,
    feedTime: single("feedTime"),
    bonusFeedTime: single("bonusFeedTime"),
    health,
    damage: ladder("damage"),
    speed: ladder("speed"),
    range: ladder("range"),
    healtime: ladder("healtime"),
    buffs: ladder("buffs"),
    feedCount: numbers(line, id, "feedCount", props.feedCount),
    feedShiny: numbers(line, id, "feedShiny", props.feedShiny),
    bonusFeedShiny: bonus("bonusFeedShiny"),
    bonusHealth: bonus("bonusHealth"),
    bonusDamage: bonus("bonusDamage"),
    bonusSpeed: bonus("bonusSpeed"),
    bonusRange: bonus("bonusRange"),
    bonusBuffs: bonus("bonusBuffs"),
    feeds,
    bonusFeeds,
    feedsAt: feedsOverride ? feedsOverride.declaredAt : line,
  };
});

const raisable = champions.filter((one) => one.raisable).map((one) => one.id);
if (raisable.join() !== "G1,G2,G3") {
  fail(CAGE, table.declaredAt, `the raisable champions changed (${raisable.join(", ")}); revisit D17`);
}

/* ── Output ───────────────────────────────────────────────────────────────── */

const list = (values) => `[${values.join(", ")}]`;
const recipeText = (one) =>
  `{ ${Object.entries(one)
    .map(([monster, count]) => `${monster}: ${count}`)
    .join(", ")} }`;
const recipeList = (values) => `[${values.map(recipeText).join(", ")}]`;

const row = (one) => `  {
    // \`client/scripts/CHAMPIONCAGE.as:${one.line}\`; feeds at \`:${one.feedsAt}\`.
    id: "${one.id}",
    t: ${one.t},
    name: ${JSON.stringify(one.name)},
    role: ${JSON.stringify(one.role)},
    description: ${JSON.stringify(one.description)},
    kind: "${one.kind}",
    raisable: ${one.raisable},
    powerLevel: ${one.powerLevel},
    levels: ${one.levels},
    feedTime: ${one.feedTime},
    bonusFeedTime: ${one.bonusFeedTime},
    health: ${list(one.health)},
    damage: ${list(one.damage)},
    speed: ${list(one.speed)},
    range: ${list(one.range)},
    healtime: ${list(one.healtime)},
    buffs: ${list(one.buffs)},
    feedCount: ${list(one.feedCount)},
    feedShiny: ${list(one.feedShiny)},
    bonusFeedShiny: ${list(one.bonusFeedShiny)},
    bonusHealth: ${list(one.bonusHealth)},
    bonusDamage: ${list(one.bonusDamage)},
    bonusSpeed: ${list(one.bonusSpeed)},
    bonusRange: ${list(one.bonusRange)},
    bonusBuffs: ${list(one.bonusBuffs)},
    feeds: ${recipeList(one.feeds)},
    bonusFeeds: ${recipeList(one.bonusFeeds)},
  },`;

const output = `/**
 * GENERATED by \`web/tools/gen-champion-catalogue.mjs\` from
 * \`client/scripts/CHAMPIONCAGE.as\` and the live English string table. Do not
 * edit by hand: change the generator and run \`npm run gen:champion-catalogue\`
 * from \`web/\`.
 *
 * Written twice, byte for byte identical: \`web/src/game/yard/championCatalogue.ts\`
 * and \`server/src/game-data/championCatalogue.ts\`. It imports nothing so the
 * same text compiles in either package.
 *
 * The champions (\`docs/specs/monsters-and-hatchery.md\` §7): per-level stats,
 * the feeding economy and the Map Room 2 feed recipes. Levels run 1 to
 * \`levels\` (6 for the four basic champions, 5 for Krallen); every per-level
 * ladder is read through {@link atChampionLevel}, which clamps like the
 * original \`CHAMPIONCAGE.GetGuardianProperty\` (\`CHAMPIONCAGE.as:401-416\`).
 */

/** Monsters one feed consumes: \`{ monsterId: count }\`. */
export type FeedRecipe = Readonly<Record<string, number>>;

export interface ChampionEntry {
  /** \`G1\`..\`G5\`. */
  readonly id: string;
  /** The \`t\` a save's \`champion\` entry carries. */
  readonly t: number;
  readonly name: string;
  /** The second line of the original title card, e.g. "High Defense"; null for Krallen. */
  readonly role: string | null;
  readonly description: string;
  /** \`basic\` champions live in the cage one at a time; Krallen is \`special\`. */
  readonly kind: "basic" | "special";
  /** True for a champion the cage offers to raise (\`CanTrainGuardian\`, \`CHAMPIONCAGE.as:459-461\`). */
  readonly raisable: boolean;
  readonly powerLevel: number;
  /** The highest evolution level. */
  readonly levels: number;
  /** Seconds a feed lasts before the champion is hungry. */
  readonly feedTime: number;
  readonly bonusFeedTime: number;
  readonly health: readonly number[];
  readonly damage: readonly number[];
  readonly speed: readonly number[];
  readonly range: readonly number[];
  /** Seconds from empty to full health in the cage, by level. */
  readonly healtime: readonly number[];
  readonly buffs: readonly number[];
  /** Feeds that evolve the champion out of each level (1..5). */
  readonly feedCount: readonly number[];
  /** Shiny for one feed at each level (1..5). */
  readonly feedShiny: readonly number[];
  /** Shiny for a level-6 food-bonus feed, by the rank it raises to (1..3). */
  readonly bonusFeedShiny: readonly number[];
  /** Food-bonus ranks 1..3 add these to the top level's stats. */
  readonly bonusHealth: readonly number[];
  readonly bonusDamage: readonly number[];
  readonly bonusSpeed: readonly number[];
  readonly bonusRange: readonly number[];
  readonly bonusBuffs: readonly number[];
  /** Map Room 2 feed recipe at each level (1..5). */
  readonly feeds: readonly FeedRecipe[];
  /** Map Room 2 food-bonus recipe, by the rank it raises to (1..3). */
  readonly bonusFeeds: readonly FeedRecipe[];
}

/** Seconds of grace after a champion turns hungry before it starves (\`CHAMPIONCAGE.STARVETIMER\`). */
export const STARVE_SECONDS = ${STARVE_SECONDS};

/** The highest food-bonus rank (\`CHAMPIONCAGE.as:697-786\`). */
export const MAX_FOOD_BONUS = 3;

export const CHAMPION_CATALOGUE: readonly ChampionEntry[] = [
${champions.map(row).join("\n")}
];

/** The champion with type \`t\` (1..5) or id \`G1\`..\`G5\`; undefined for anything else. */
export const championEntry = (key: number | string): ChampionEntry | undefined =>
  CHAMPION_CATALOGUE.find((entry) => entry.t === key || entry.id === key);

/**
 * \`ladder\` at \`level\`, clamped to its last entry and to at least level 1, as
 * \`CHAMPIONCAGE.GetGuardianProperty\` reads every per-level prop.
 */
export const atChampionLevel = (ladder: readonly number[], level: number): number => {
  const clamped = Math.min(Math.max(Math.trunc(level) || 1, 1), ladder.length);
  return ladder[clamped - 1] ?? 0;
};

/** The recipe \`ladder\` holds at \`step\`, clamped the same way. */
const recipeAt = (ladder: readonly FeedRecipe[], step: number): FeedRecipe => {
  const clamped = Math.min(Math.max(Math.trunc(step) || 1, 1), ladder.length);
  return ladder[clamped - 1] ?? {};
};

/**
 * Full health at \`level\` with \`foodBonus\` ranks: the level's health plus the
 * rank's bonus (\`client/scripts/com/monsters/monsters/champions/ChampionBase.as:127-132\`).
 */
export const championMaxHealth = (entry: ChampionEntry, level: number, foodBonus: number): number =>
  atChampionLevel(entry.health, level) +
  (foodBonus > 0 ? atChampionLevel(entry.bonusHealth, foodBonus) : 0);

/**
 * What one feed with monsters eats: the level's recipe below the top level,
 * the next food-bonus rank's at the top (\`FeedGuardian\`, \`CHAMPIONCAGE.as:691-697\`;
 * a champion already at rank 3 eats rank 3's).
 */
export const feedRecipe = (entry: ChampionEntry, level: number, foodBonus: number): FeedRecipe =>
  level >= entry.levels
    ? recipeAt(entry.bonusFeeds, foodBonus + 1)
    : recipeAt(entry.feeds, level);

/**
 * Shiny for one feed. Below the top level the level's \`feedShiny\`; at the top
 * the next rank's \`bonusFeedShiny\`, doubled when the champion is not hungry
 * (\`CHAMPIONCAGE.as:702-709\`, \`CHAMPIONCAGEPOPUP.as:1240-1246\`).
 */
export const feedShinyPrice = (
  entry: ChampionEntry,
  level: number,
  foodBonus: number,
  hungry: boolean,
): number =>
  level >= entry.levels
    ? atChampionLevel(entry.bonusFeedShiny, foodBonus + 1) * (hungry ? 1 : 2)
    : atChampionLevel(entry.feedShiny, level);

/**
 * Shiny to evolve now: \`feedShiny × 2 × feeds still needed\`
 * (\`CHAMPIONCAGEPOPUP.as:1208-1238\`; the \`evolveShiny\` table is never read).
 */
export const evolveShinyPrice = (entry: ChampionEntry, level: number, feeds: number): number =>
  atChampionLevel(entry.feedShiny, level) *
  2 *
  Math.max(0, atChampionLevel(entry.feedCount, level) - Math.max(0, Math.trunc(feeds) || 0));
`;

/* ── Write or check ───────────────────────────────────────────────────────── */

const lf = (value) => value.replace(/\r\n/g, "\n");

if (CHECK) {
  const stale = [WEB_OUT, SERVER_OUT].filter(
    (path) => !existsSync(path) || lf(readFileSync(path, "utf8")) !== output,
  );
  if (stale.length) {
    console.error(`Stale champion catalogue; run \`npm run gen:champion-catalogue\` from web/:`);
    for (const path of stale) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log(`champion catalogue up to date (${champions.length} champions)`);
} else {
  for (const path of [WEB_OUT, SERVER_OUT]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output, "utf8");
  }
  console.log(`${champions.length} champions (raisable: ${raisable.join(", ")})`);
  console.log(`-> ${WEB_OUT}`);
  console.log(`-> ${SERVER_OUT}`);
  for (const one of champions) {
    console.log(`${one.id}\t${one.name}\t${one.kind}\tL${one.levels}\tfeeds ${one.feeds.map(recipeText).join(" | ")}`);
  }
}
