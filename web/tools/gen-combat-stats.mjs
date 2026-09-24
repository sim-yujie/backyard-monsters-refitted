/**
 * Regenerates the combat stats table for the shared rules module.
 *
 *   cd web && bun tools/gen-combat-stats.mjs
 *
 * Bun rather than Node, because this one imports the server's TypeScript stat
 * tables directly (`server/src/game-data/stats/`) so the monster and champion
 * props are re-emitted from the file that is already authoritative rather than
 * transcribed a second time. The other two generators stay on Node.
 *
 * Output is `web/src/game/combat/rules/combatStatsData.ts`, the source of truth
 * for the shared rules module; `tools/sync-combat-rules.mjs` copies it to
 * `server/src/game-rules/combat/` byte for byte
 * (`docs/design/server-combat.md` §3.2, §3.3).
 *
 * What it reads, and from where:
 *
 * | Table          | Source                                                   |
 * |----------------|----------------------------------------------------------|
 * | `TOWER_STATS`  | `YARD_PROPS.as`, the `"stats": [` block of 13 entries     |
 * | `BUILDING_HP`  | `YARD_PROPS.as`, the `"hp"` array of 137 of 140 entries    |
 * | `TRAP_STATS`   | `YARD_PROPS.as`, `damage[0]`, `size` and `hp[0]` of traps  |
 * | `MR2_CAPACITY` | `GLOBAL.as:682-683`, `:713`, the Map Room 2 overrides      |
 * | `FLYER_MODE`   | `client/scripts/BTOWER.as:25-35`                           |
 * | `GRID_COST`    | The `_gridCost = [...]` of each entry's `cls`, with        |
 * |                | `extends` followed until one is found                      |
 * | `MONSTER_PROPS`| `server/src/game-data/stats/monsterStats.ts`               |
 * | `CHAMPION_PROPS`| `server/src/game-data/stats/championStats.ts`             |
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lineCounter, matchBrace, readIntArray, readPropsSource } from "./lib/props.mjs";
import { monsterStats } from "../../server/src/game-data/stats/monsterStats.ts";
import { championStats } from "../../server/src/game-data/stats/championStats.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const PROPS = resolve(repo, "client/scripts/YARD_PROPS.as");
const GLOBAL = resolve(repo, "client/scripts/GLOBAL.as");
const BTOWER = resolve(repo, "client/scripts/BTOWER.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/archived/en.v612.txt");
const SCRIPTS = resolve(repo, "client/scripts");
const OUT = resolve(here, "../src/game/combat/rules/combatStatsData.ts");

const { source } = readPropsSource(PROPS);
const lineOf = lineCounter(source);
const strings = JSON.parse(readFileSync(STRINGS, "utf8")).core;

/* ── The props entries ────────────────────────────────────────────────────── */

/**
 * Every `_yardProps` entry, in file order, keyed by the `"id"` that opens it.
 *
 * `gen-building-costs.mjs` anchors on `"costs"` because that is the field it
 * wants; this table needs entries that have no `costs` at all, so it anchors on
 * `"id"` instead and takes the span to the next one. No nested object in the
 * file spells `"id"`, so the two walks see the same 140 entries — an assertion
 * below keeps that true.
 *
 * As in the cost generator, an id that appears twice keeps its first entry,
 * matching the client's `_buildingProps[id - 1]` lookup.
 */
const readEntries = () => {
  const hits = [...source.matchAll(/"id"\s*:\s*(\d+)/g)];
  const entries = [];
  const seen = new Set();
  for (let k = 0; k < hits.length; k++) {
    const id = Number(hits[k][1]);
    if (seen.has(id)) continue;
    seen.add(id);
    const start = hits[k].index;
    const end = k + 1 < hits.length ? hits[k + 1].index : source.length;
    const text = source.slice(start, end);
    const nameKey = /"name"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? "";
    entries.push({
      id,
      start,
      text,
      line: lineOf(start),
      name: strings[nameKey] ?? nameKey.replaceAll("#", ""),
      kind: /"type"\s*:\s*"([^"]*)"/.exec(text)?.[1] ?? "",
      cls: /"cls"\s*:\s*([A-Za-z0-9_]+)/.exec(text)?.[1] ?? null,
      size: Number(/"size"\s*:\s*(\d+)/.exec(text)?.[1] ?? 0),
    });
  }
  return entries;
};

const entries = readEntries();
if (entries.length !== 140) {
  throw new Error(`YARD_PROPS.as holds ${entries.length} entries, not the 140 this table expects`);
}

const byId = new Map(entries.map((one) => [one.id, one]));

/* ── Tower stats ──────────────────────────────────────────────────────────── */

/**
 * The `"stats": [ ... ]` block of one entry, one object per level.
 *
 * The keys are not the same across the thirteen entries that have one: the
 * Monster Bunker carries `range` alone, the Quake Tower and the Stronghold have
 * no `speed` or `splash`, the two Spurtz Cannons add `shots`, and the Siege
 * Works has `duration` and `radius` instead of a weapon at all. Rather than
 * fixing a shape, every numeric key present is emitted and the reader decides
 * what it needs, so a field the plan has not traced yet is still in the table.
 */
const readTowerStats = (entry) => {
  const hit = /"stats"\s*:\s*\[/.exec(entry.text);
  if (!hit) return null;
  const open = hit.index + hit[0].length - 1;
  const body = entry.text.slice(open, matchBrace(entry.text, open) + 1);
  const levels = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{") continue;
    const close = matchBrace(body, i);
    const one = body.slice(i, close + 1);
    i = close;
    const level = {};
    for (const field of one.matchAll(/"([a-zA-Z]+)"\s*:\s*(-?[\d.]+)/g)) {
      level[field[1]] = Number(field[2]);
    }
    levels.push(level);
  }
  if (levels.length === 0) throw new Error(`id ${entry.id}: empty "stats" block`);
  return { levels, line: lineOf(entry.start + hit.index) };
};

const towers = [];
for (const entry of entries) {
  const stats = readTowerStats(entry);
  if (stats) towers.push({ entry, ...stats });
}

/* ── Health ladders ───────────────────────────────────────────────────────── */

const hp = [];
for (const entry of entries) {
  const values = readIntArray(entry.text, "hp");
  if (values.length > 0) hp.push({ entry, values });
}

/* ── Traps ────────────────────────────────────────────────────────────────── */

/**
 * The two traps.
 *
 * `damage[0]` is the full-strength hit, `size` is the blast radius the client
 * passes to `Targeting.getCreepsInRange` and the denominator of its linear
 * falloff, `damage / size * (size - dist * 0.5)` (`client/scripts/BTRAP.as:98`,
 * `:106`), and `hp[0]` is what it takes to destroy one before it fires. A trap
 * has a single level, so each is a scalar rather than a ladder.
 */
const traps = entries
  .filter((entry) => entry.kind === "trap")
  .map((entry) => {
    const damage = readIntArray(entry.text, "damage");
    const health = readIntArray(entry.text, "hp");
    if (damage.length === 0 || health.length === 0 || !entry.size) {
      throw new Error(`YARD_PROPS.as:${entry.line}: trap ${entry.id} is missing damage, hp or size`);
    }
    return { entry, damage: damage[0], size: entry.size, hp: health[0] };
  });

if (traps.length !== 2) throw new Error(`Expected 2 trap entries, found ${traps.length}`);

/* ── Map Room 2 capacity overrides ────────────────────────────────────────── */

/**
 * Three `capacity` ladders Map Room 2 replaces.
 *
 * `GLOBAL.changeNotMaproom3SpecificBuildings()` shallow-copies the props table
 * and overwrites these whenever the account is not in Map Room 3
 * (`client/scripts/GLOBAL.as:716-746`), and this project runs Map Room 2 as the
 * default overworld. `gen-building-costs.mjs` reads the same function for the
 * cost changes and explicitly leaves these three out, because a bunker's room
 * and a flinger's payload are not resource amounts
 * (`gen-building-costs.mjs:158-167`); combat is where they belong.
 *
 * `_buildingProps` is indexed by `id - 1`, so indexes 4, 14 and 21 are ids 5,
 * 15 and 22. The values are transcribed rather than parsed — three AS3
 * statements, not table entries — and `verify` below re-reads the cited line
 * and fails the build if it moved or now says something else.
 */
const MR2_CAPACITY = [
  { id: 5, index: 4, line: 713, values: [500, 1000, 1750, 2250, 3000, 4000] }, // Flinger payload
  { id: 15, index: 14, line: 682, values: [200, 260, 320, 380, 450, 540] }, //     Monster Housing
  { id: 22, index: 21, line: 683, values: [380, 450, 540, 660, 800] }, //          Monster Bunker
];

const globalLines = readFileSync(GLOBAL, "utf8").split("\n");
for (const override of MR2_CAPACITY) {
  const text = globalLines[override.line - 1] ?? "";
  const expected = `_buildingProps[${override.index}].capacity = [${override.values.join(", ")}];`;
  if (!text.includes(expected)) {
    throw new Error(
      `GLOBAL.as:${override.line} no longer reads "${expected}" (id ${override.id}); ` +
        `re-read changeNotMaproom3SpecificBuildings().`,
    );
  }
}

/* ── Flyer mode ───────────────────────────────────────────────────────────── */

/**
 * `BTOWER._targetFlyerMode`: whether a tower can shoot at flying creeps.
 *
 * 0 is ground only, 1 is both, 2 is air only — the client tests it twice, once
 * to refuse a flying target outright and once to pick the firing animation
 * (`BTOWER.as:165`, `:390`). Parsed from the object literal rather than
 * transcribed, with the declaration line asserted so a move is noticed.
 */
const readFlyerMode = () => {
  const text = readFileSync(BTOWER, "utf8");
  const lines = text.split("\n");
  const DECLARED = 25; // BTOWER.as:25-35
  if (!(lines[DECLARED - 1] ?? "").includes("_targetFlyerMode:Object = {")) {
    throw new Error(`BTOWER.as:${DECLARED} no longer declares _targetFlyerMode; re-read the class.`);
  }
  const open = text.indexOf("{", text.indexOf("_targetFlyerMode"));
  const body = text.slice(open, matchBrace(text, open) + 1);
  const modes = [...body.matchAll(/"(\d+)"\s*:\s*([012])/g)].map((one) => [
    Number(one[1]),
    Number(one[2]),
  ]);
  if (modes.length === 0) throw new Error("BTOWER._targetFlyerMode parsed empty");
  return modes.sort((a, b) => a[0] - b[0]);
};

const flyerMode = readFlyerMode();

/* ── Grid costs ───────────────────────────────────────────────────────────── */

/**
 * The pathing cost rectangles a building stamps onto the grid.
 *
 * Every building class declares `_gridCost` as `[[new Rectangle(x, y, w, h),
 * cost], ...]` in its constructor and `PATHING.RegisterBuilding` adds each
 * rectangle's cost to the cells it covers (`client/scripts/BUILDING17.as:14`,
 * `BUILDING20.as:19`; `com/monsters/pathing/PATHING.as:158-159`). Three things
 * make reading them less than a one-line regex:
 *
 * 1. **The class is not named after the type.** A props entry names its class
 *    in `"cls"`, and thirteen of them are not `BUILDING<id>` — `HOUSINGBUNKER`,
 *    `SpurtzCannon`, `GuardTower`, `SiegeLab` and so on — so the `cls` field is
 *    the lookup, not the id.
 * 2. **Several classes inherit it.** `BUILDING13` and `BUILDING16` extend
 *    `HatcheryBase`, `BlackSpurtzCannon` extends `SpurtzCannon`, `SiegeFactory`
 *    and `SiegeLab` extend `SiegeBuilding`, `BTOTEM` extends `BDECORATION`, so
 *    the walk follows `extends` until an assignment turns up.
 * 3. **Two are not literals.** `BDECORATION` sizes its rectangle from the
 *    entry's own `size` prop (`BDECORATION.as:22-26`), and `BUILDING14` picks
 *    between an Inferno and a main-yard rectangle with a ternary
 *    (`BUILDING14.as:19`). The first is substituted per entry, the second takes
 *    the main-yard branch because this project runs Map Room 2.
 *
 * The traps resolve to nothing, which is correct: `BTRAP` declares no
 * `_gridCost`, so a trap is invisible to pathing and a creep walks over it.
 */
const classFile = (name) => {
  for (const candidate of [
    `${SCRIPTS}/${name}.as`,
    `${SCRIPTS}/com/monsters/siege/${name}.as`,
    `${SCRIPTS}/com/monsters/monsters/${name}.as`,
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

/** The `? a : b` branches of one expression, split at depth zero. */
const ternaryBranches = (text) => {
  let depth = 0;
  let question = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === "?" && depth === 0 && question < 0) question = i;
    else if (c === ":" && depth === 0 && question >= 0) {
      return [text.slice(question + 1, i), text.slice(i + 1)];
    }
  }
  return null;
};

const parseRects = (text, size) => {
  const pattern = /new Rectangle\(\s*([-\w]+)\s*,\s*([-\w]+)\s*,\s*([-\w]+)\s*,\s*([-\w]+)\s*\)\s*,\s*(-?\d+)/g;
  const rects = [];
  for (const hit of text.matchAll(pattern)) {
    const numbers = hit.slice(1, 5).map((one) => (/^-?\d+$/.test(one) ? Number(one) : size));
    if (numbers.some((one) => !Number.isFinite(one))) return null;
    rects.push([...numbers, Number(hit[5])]);
  }
  return rects.length > 0 ? rects : null;
};

const gridCostOf = (entry) => {
  const chain = [];
  let name = entry.cls;
  while (name && name !== "null" && chain.length < 8) {
    const path = classFile(name);
    if (!path) return { rects: null, chain };
    chain.push(name);
    const text = readFileSync(path, "utf8");
    const hit = /_gridCost\s*=\s*([^\n]+)/.exec(text);
    if (hit) {
      const branches = ternaryBranches(hit[1]);
      // The main-yard branch: this project runs Map Room 2, and the Inferno
      // yard has its own props file anyway (`BUILDING14.as:19`).
      const rhs = branches ? branches[1] : hit[1];
      return { rects: parseRects(rhs, entry.size), chain, ternary: Boolean(branches) };
    }
    name = /public class\s+\w+\s+extends\s+(\w+)/.exec(text)?.[1] ?? null;
  }
  return { rects: null, chain };
};

const gridCosts = [];
for (const entry of entries) {
  const { rects, chain, ternary } = gridCostOf(entry);
  if (rects) gridCosts.push({ entry, rects, cls: chain[chain.length - 1], ternary });
}

/**
 * A wall's inner rectangle is priced by its level, not by the table.
 *
 * `BFOUNDATION.SetProps` rewrites `_gridCost[1][1]` to `100 + level * 25` for
 * type 17 (`client/scripts/BFOUNDATION.as:3150-3152`), so the 200 the class
 * constructor sets is never what a placed wall costs. Type 18 never reaches
 * this: the loader rewrites it to `t: 17, l: 2` (`BASE.as:1523-1526`).
 */
const WALL_GRID_FORMULA = { id: 17, rect: 1, base: 100, perLevel: 25, line: 3151 };

const foundationLines = readFileSync(resolve(SCRIPTS, "BFOUNDATION.as"), "utf8").split("\n");
{
  const text = foundationLines[WALL_GRID_FORMULA.line - 1] ?? "";
  const expected = `this._gridCost[1][1] = 100 + this._lvl.Get() * 25;`;
  if (!text.includes(expected)) {
    throw new Error(
      `BFOUNDATION.as:${WALL_GRID_FORMULA.line} no longer reads "${expected}"; ` +
        `re-read SetProps() for the wall grid cost.`,
    );
  }
}

/* ── Monsters and champions ───────────────────────────────────────────────── */

/**
 * The combat-relevant half of the server's monster props, re-emitted.
 *
 * The server's `monsterStats.ts` is already authoritative — `validateAttack`
 * bans a client whose declared stats differ from it
 * (`server/src/services/maproom/validateAttack.ts:25-91`) — so the shared
 * module copies rather than re-derives, and `combatStatsData.test.ts` asserts
 * the copy still equals the source key for key. The training and hatching
 * ladders (`cTime`, `cResource`, `hTime`, `hResource`) are economy, not combat,
 * and stay out. `mr3MonsterStats` is not emitted: Map Room 3 is out of scope
 * (`docs/design/server-combat.md` §1.4).
 */
const MONSTER_KEYS = [
  "speed",
  "health",
  "damage",
  "range",
  "attackDelay",
  "targetGroup",
  "bucket",
  "cStorage",
  "explode",
  "splits",
  "zombieHealthMultiplier",
  "zombieSpeedMultiplier",
  "zombieDamageMultiplier",
  "resurrectCooldown",
];

const monsters = Object.entries(monsterStats).map(([id, stat]) => {
  const props = {};
  for (const key of MONSTER_KEYS) {
    if (Array.isArray(stat.props[key])) props[key] = stat.props[key];
  }
  return { id, movement: stat.movement, pathing: stat.pathing, props };
});

/**
 * The champions, with the three power-level bonus tiers.
 *
 * `t` is the numeric type an `attackerchampion` entry carries, which is how the
 * audit matches a submitted champion to the stored one
 * (`docs/design/server-combat.md` §2.5). `bonusFeedShiny` and `bonusFeedTime`
 * are feeding economy and stay out; the other five bonus arrays are three
 * entries long, one per power level.
 */
const CHAMPION_KEYS = [
  "speed",
  "health",
  "damage",
  "range",
  "buffs",
  "buffRadius",
  "bucket",
  "targetGroup",
  "movement",
  "attack",
  "bonusSpeed",
  "bonusHealth",
  "bonusDamage",
  "bonusRange",
  "bonusBuffs",
];

const champions = Object.entries(championStats).map(([id, stat]) => {
  const props = {};
  for (const key of CHAMPION_KEYS) {
    if (Array.isArray(stat.props[key])) props[key] = stat.props[key];
  }
  return { id, t: stat.t, name: stat.name, props };
});

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const LIMIT = 100;

/** `items` joined onto as few lines of at most 100 columns as they fit on. */
const pack = (items, indent) => {
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? `${line} ${item}` : item;
    if (line && indent.length + next.length > LIMIT) {
      lines.push(indent + line);
      line = item;
    } else {
      line = next;
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
};

/** `{ range: 160, damage: 20 }`, keys in the order the props file spells them. */
const object = (fields) =>
  `{ ${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")} }`;

const comment = (entry, extra = "") =>
  `  // ${entry.id} ${entry.name}${entry.kind ? ` (${entry.kind})` : ""} ` +
  `— YARD_PROPS.as:${entry.line}${extra}`;

const towerRows = towers
  .map(
    (one) =>
      `${comment(one.entry, `, stats :${one.line}`)}\n` +
      `  ${one.entry.id}: [\n` +
      pack(
        one.levels.map((level) => `${object(level)},`),
        "    ",
      ) +
      `\n  ],`,
  )
  .join("\n");

const hpRows = hp
  .map(
    (one) =>
      `${comment(one.entry)}\n` +
      `  ${one.entry.id}: [\n` +
      pack(
        one.values.map((value) => `${value},`),
        "    ",
      ) +
      `\n  ],`,
  )
  .join("\n");

const trapRows = traps
  .map(
    (one) =>
      `${comment(one.entry)}\n` +
      `  ${one.entry.id}: ${object({ damage: one.damage, size: one.size, hp: one.hp })},`,
  )
  .join("\n");

const capacityRows = MR2_CAPACITY.sort((a, b) => a.id - b.id)
  .map(
    (one) =>
      `${comment(byId.get(one.id), `, Map Room 2 override GLOBAL.as:${one.line}`)}\n` +
      `  ${one.id}: [${one.values.join(", ")}],`,
  )
  .join("\n");

const flyerRows = pack(
  flyerMode.map(([type, mode]) => `${type}: ${mode},`),
  "  ",
);

const gridRows = gridCosts
  .map((one) => {
    const rects = one.rects.map((rect) => `[${rect.join(", ")}]`);
    const head = `${comment(one.entry, ` via ${one.cls}${one.ternary ? " (main-yard branch)" : ""}`)}\n`;
    const flat = `  ${one.entry.id}: [${rects.join(", ")}],`;
    if (flat.length <= LIMIT) return head + flat;
    return `${head}  ${one.entry.id}: [\n${pack(
      rects.map((rect) => `${rect},`),
      "    ",
    )}\n  ],`;
  })
  .join("\n");

const propsBlock = (props, indent) =>
  Object.entries(props)
    .map(([key, values]) => {
      const body = values.map((one) => JSON.stringify(one)).join(", ");
      const flat = `${indent}${key}: [${body}],`;
      if (flat.length <= LIMIT) return flat;
      return (
        `${indent}${key}: [\n` +
        pack(
          values.map((one) => `${JSON.stringify(one)},`),
          `${indent}  `,
        ) +
        `\n${indent}],`
      );
    })
    .join("\n");

const monsterRows = monsters
  .map((one) => {
    const root = [
      one.movement === undefined ? null : `    movement: ${JSON.stringify(one.movement)},`,
      one.pathing === undefined ? null : `    pathing: ${JSON.stringify(one.pathing)},`,
    ].filter(Boolean);
    return (
      `  ${one.id}: {\n` +
      (root.length > 0 ? `${root.join("\n")}\n` : "") +
      `    props: {\n${propsBlock(one.props, "      ")}\n    },\n` +
      `  },`
    );
  })
  .join("\n");

const championRows = champions
  .map(
    (one) =>
      `  // ${one.id} ${one.name}\n` +
      `  ${one.id}: {\n` +
      `    t: ${one.t},\n` +
      `    name: ${JSON.stringify(one.name)},\n` +
      `    props: {\n${propsBlock(one.props, "      ")}\n    },\n` +
      `  },`,
  )
  .join("\n");

const towerKeys = [...new Set(towers.flatMap((one) => one.levels.flatMap(Object.keys)))];

const body = `/**
 * Combat stats, one table per kind of number. GENERATED — do not edit by hand.
 *
 * Regenerate with \`bun tools/gen-combat-stats.mjs\` from \`web/\`, then
 * \`node tools/sync-combat-rules.mjs\` to copy this directory to
 * \`server/src/game-rules/combat/\`. Sources are cited per row: the Flash
 * client's \`client/scripts/YARD_PROPS.as\` for everything a building carries,
 * \`BTOWER.as\` for the flyer table, each building class's \`_gridCost\` for the
 * pathing rectangles, the Map Room 2 overrides in \`GLOBAL.as\`, and the
 * server's own \`game-data/stats/\` for the monsters and champions.
 *
 * This file imports nothing, because the shared rules module may not
 * (\`docs/design/server-combat.md\` §3.2): the server loads it under Bun with no
 * build step and the web client bundles the same bytes for the Wild Monster
 * Baiter, so a disagreement between the two would be a battle the player
 * watched and the server refused.
 *
 * Every ladder is indexed by level minus one. Reading one is \`stats.ts\`'s job,
 * including the clamp the client applies to a level past the end of an array
 * (\`client/scripts/CREATURES.as:75-81\`); nothing here interprets a number.
 */

/**
 * One level of a tower's \`stats\` block.
 *
 * The thirteen entries that carry one do not agree on the keys${
   ""
 }: the Monster
 * Bunker has \`range\` alone, the Quake Tower and the Stronghold have no
 * \`speed\` or \`splash\`, the two Spurtz Cannons add \`shots\`, and the Siege
 * Works has \`duration\` and \`radius\` rather than a weapon. Every key the props
 * file spells is kept, so the fields are
 * ${towerKeys.map((key) => `\`${key}\``).join(", ")}.
 *
 * \`range\` is in yard units, \`damage\` is per shot before fortification and
 * armour (\`client/scripts/BFOUNDATION.as:508-512\`), \`rate\` is the re-arm in
 * slow ticks — the tower waits \`rate * 2\` fast ticks (\`BTOWER.as:179\`) —
 * \`speed\` is the projectile's, and \`splash\` is the blast radius on impact.
 */
export interface TowerLevelStats {
${towerKeys.map((key) => `  readonly ${key}?: number;`).join("\n")}
}

/** Per tower type, one entry per level (\`YARD_PROPS.as\`, \`"stats"\`). */
export const TOWER_STATS: Readonly<Record<number, readonly TowerLevelStats[]>> = {
${towerRows}
};

/**
 * Every type's health ladder, \`hp[level - 1]\` (\`YARD_PROPS.as\`, \`"hp"\`).
 *
 * ${hp.length} of the ${entries.length} entries have one; the rest are
 * placeholders and decorations that never take damage.
 */
export const BUILDING_HP: Readonly<Record<number, readonly number[]>> = {
${hpRows}
};

/** A trap's one-shot blast (\`client/scripts/BTRAP.as:98\`, \`:106\`). */
export interface TrapStats {
  /** Full-strength damage at the centre, \`YARD_PROPS.as\` \`"damage"[0]\`. */
  readonly damage: number;
  /** The blast radius, and the denominator of the linear falloff. */
  readonly size: number;
  /** What it takes to destroy the trap before it fires. */
  readonly hp: number;
}

/** The Booby Trap and the Heavy Trap. Both have a single level. */
export const TRAP_STATS: Readonly<Record<number, TrapStats>> = {
${trapRows}
};

/**
 * The three \`capacity\` ladders Map Room 2 replaces, \`capacity[level - 1]\`.
 *
 * \`GLOBAL.changeNotMaproom3SpecificBuildings()\` overwrites these whenever the
 * account is not in Map Room 3, and this project runs Map Room 2 as the default
 * overworld. The cost table deliberately carries none of them, because a
 * bunker's room and a flinger's payload are not resource amounts
 * (\`web/tools/gen-building-costs.mjs:158-167\`).
 */
export const MR2_CAPACITY: Readonly<Record<number, readonly number[]>> = {
${capacityRows}
};

/**
 * Which creeps a tower may shoot at: 0 ground only, 1 both, 2 air only.
 *
 * \`BTOWER._targetFlyerMode\` (\`client/scripts/BTOWER.as:25-35\`), read twice by
 * the client — once to refuse a flying target and once to pick the firing
 * animation (\`:165\`, \`:390\`). A tower type absent from this table is ground
 * only, which is what the client's truthiness test on a missing key means.
 */
export const FLYER_MODE: Readonly<Record<number, 0 | 1 | 2>> = {
${flyerRows}
};

/** One pathing cost rectangle: \`[x, y, w, h, cost]\` in yard units. */
export type GridCostRect = readonly [x: number, y: number, w: number, h: number, cost: number];

/**
 * What each type stamps onto the pathing grid.
 *
 * Read from the \`_gridCost\` of the class the props entry names in \`"cls"\`,
 * following \`extends\` when the class inherits it. \`PATHING.RegisterBuilding\`
 * adds each rectangle's cost to the cells it covers, so a creep routes around
 * the expensive middle of a building rather than through it
 * (\`client/scripts/com/monsters/pathing/PATHING.as:158-159\`).
 *
 * The traps have no row, which is correct: \`BTRAP\` declares no \`_gridCost\`,
 * so a trap is invisible to pathing and a creep walks straight over it.
 */
export const GRID_COST: Readonly<Record<number, readonly GridCostRect[]>> = {
${gridRows}
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
 * \`BFOUNDATION.SetProps\` rewrites \`_gridCost[1][1]\` to \`100 + level * 25\` for
 * type 17 (\`client/scripts/BFOUNDATION.as:${WALL_GRID_FORMULA.line}\`), so the ${
   gridCosts.find((one) => one.entry.id === 17)?.rects[1]?.[4]
 } the
 * class constructor sets is never what a placed wall costs. Type 18 never
 * reaches it: the loader rewrites type 18 to \`t: 17, l: 2\`
 * (\`client/scripts/BASE.as:1523-1526\`).
 */
export const GRID_COST_FORMULA: Readonly<Record<number, GridCostFormula>> = {
  ${WALL_GRID_FORMULA.id}: { rect: ${WALL_GRID_FORMULA.rect}, base: ${WALL_GRID_FORMULA.base}, perLevel: ${WALL_GRID_FORMULA.perLevel} },
};

/**
 * The combat half of a monster's props, indexed by level minus one.
 *
 * Copied from \`server/src/game-data/stats/monsterStats.ts\`, which is already
 * what the attack gate checks a client's declared stats against
 * (\`server/src/services/maproom/validateAttack.ts:25-91\`). The training and
 * hatching ladders are economy and stay out.
 */
export interface MonsterCombatProps {
  /** Yard units per slow tick, before the two halvings \`stats.ts\` applies. */
  readonly speed?: readonly number[];
  readonly health?: readonly number[];
  readonly damage?: readonly number[];
  /** Absent means melee, which the client reads as a range of 1 (\`CreepBase.as:112-114\`). */
  readonly range?: readonly number[];
  /** Fast ticks between swings; absent means 60 (\`CreepBase.as:108-111\`). */
  readonly attackDelay?: readonly number[];
  /** 1 all, 2 walls, 3 resources, 4 towers, 5 monsters, 6 champions. */
  readonly targetGroup?: readonly number[];
  /** Flinger payload units one of these costs. */
  readonly bucket?: readonly number[];
  /** Housing space one of these takes. */
  readonly cStorage?: readonly number[];
  /** Present and 1 on a creep that dies on its own blast (\`CreepBase.as:896-898\`). */
  readonly explode?: readonly number[];
  /** How many children a Slimeattikus leaves (\`creeps/Slimeattikus.as:11-13\`). */
  readonly splits?: readonly number[];
  readonly zombieHealthMultiplier?: readonly number[];
  readonly zombieSpeedMultiplier?: readonly number[];
  readonly zombieDamageMultiplier?: readonly number[];
  readonly resurrectCooldown?: readonly number[];
}

/** One monster: its root movement and pathing strings, and its props. */
export interface MonsterCombatStat {
  /** \`ground\`, \`fly\`, \`fly_low\`, \`burrow\`, … */
  readonly movement?: string;
  readonly pathing?: string;
  readonly props: MonsterCombatProps;
}

/** Every Map Room 2 monster, keyed by the id a roster spells (\`C1\`, \`IC7\`, …). */
export const MONSTER_PROPS: Readonly<Record<string, MonsterCombatStat>> = {
${monsterRows}
};

/**
 * The combat half of a champion's props.
 *
 * The five \`bonus*\` ladders are three entries long, one per power level, and
 * add to the level figure. Feeding economy (\`feedShiny\`, \`evolveShiny\`,
 * \`feedCount\`, \`feedTime\`, \`bonusFeedShiny\`, \`bonusFeedTime\`) and the render
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

/** One champion, with the \`t\` an \`attackerchampion\` entry carries. */
export interface ChampionCombatStat {
  readonly t: number;
  readonly name: string;
  readonly props: ChampionCombatProps;
}

/** Every champion, keyed by the id the stat table spells (\`G1\`..\`G5\`). */
export const CHAMPION_PROPS: Readonly<Record<string, ChampionCombatStat>> = {
${championRows}
};
`;

writeFileSync(OUT, body, "utf8");

const over = body
  .split("\n")
  .map((line, index) => ({ line: index + 1, width: line.length }))
  .filter((one) => one.width > LIMIT);
if (over.length > 0) {
  throw new Error(
    `${OUT} has ${over.length} line(s) over ${LIMIT} columns, which boundary.test.ts refuses: ` +
      over
        .slice(0, 5)
        .map((one) => `:${one.line} (${one.width})`)
        .join(", "),
  );
}

console.log(
  `${towers.length} tower stat blocks, ${hp.length}/${entries.length} hp ladders, ` +
    `${traps.length} traps, ${MR2_CAPACITY.length} capacity overrides, ` +
    `${flyerMode.length} flyer modes, ${gridCosts.length} grid costs, ` +
    `${monsters.length} monsters, ${champions.length} champions`,
);
console.log(`-> ${OUT}`);
console.log(
  towers
    .map(
      (one) =>
        `${one.entry.id}\t${one.entry.name}\t${one.entry.kind}\t` +
        `${one.levels.length} levels\t${[...new Set(one.levels.flatMap(Object.keys))].join(",")}`,
    )
    .join("\n"),
);
