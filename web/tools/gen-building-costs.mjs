/**
 * Regenerates the building cost tables from the Flash client's props table.
 *
 *   cd web && node tools/gen-building-costs.mjs
 *
 * The source of truth is `client/scripts/YARD_PROPS.as`, where every building
 * entry carries a `costs` array: one step per *upgrade*, so `costs[k]` is what
 * it takes to go from level `k` to level `k + 1` and `costs[0]` is the initial
 * build (`client/scripts/BFOUNDATION.as:2668-2700`). A step holds the four
 * resource amounts `r1`..`r4`, a build `time` in seconds, and `re`, the
 * prerequisite list, whose entries are `[type, count, level]`: at least `count`
 * buildings of `type` at `level` or above (`client/scripts/BASE.as:3884-3932`).
 *
 * The entry's `quantity` array caps how many of that type a yard may hold,
 * indexed by Town Hall level (`docs/specs/base-building.md:400`).
 *
 * Display names come from the game's own English string table
 * (`server/public/gamestage/assets/archived/en.v612.txt`), because the props
 * table stores a `#b_key#` placeholder rather than a name — the same lookup
 * `gen-building-art.mjs` makes.
 *
 * Two files are written, with identical rows:
 *
 *   web/src/game/yard/buildingCostData.ts   -> web/src/game/yard/buildingCosts.ts
 *   server/src/game-data/buildingCosts.ts   -> server/src/services/yardplanner/costs.ts
 *
 * The server copy carries a few lookup helpers on top of the rows and imports
 * nothing, so `bun` can load it without a build step.
 *
 * Nothing here runs in the browser and nothing in the client imports it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const PROPS = resolve(repo, "client/scripts/YARD_PROPS.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/archived/en.v612.txt");
const WEB_OUT = resolve(here, "../src/game/yard/buildingCostData.ts");
const SERVER_OUT = resolve(repo, "server/src/game-data/buildingCosts.ts");

/**
 * The props file, with `//` line comments stripped.
 *
 * Several entries keep dead lines commented out, and reading those as live
 * would price a building from a step the game never charges. No string literal
 * in this file contains `//`, so stripping to end of line is safe. Line numbers
 * are taken from the original text, so citations still point at the right place.
 */
const original = readFileSync(PROPS, "utf8");
const source = original.replace(/\/\/[^\n]*/g, "");
const strings = JSON.parse(readFileSync(STRINGS, "utf8")).core;

/**
 * Index of the bracket matching the one at `open`, which may be `{` or `[`.
 *
 * `gen-building-art.mjs:49-63` does the same for braces only; the cost table
 * needs it for arrays as well, because `costs` and `re` are both arrays with
 * objects and arrays nested inside them.
 */
const matchBrace = (text, open) => {
  const opener = text[open];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Skip a string literal; AS3 has no escapes worth worrying about here.
      i = text.indexOf('"', i + 1);
      if (i < 0) break;
      continue;
    }
    if (c === opener) depth++;
    else if (c === closer && --depth === 0) return i;
  }
  throw new Error(`Unbalanced brackets from ${open}`);
};

const lineOf = (index) => source.slice(0, index).split("\n").length;

/**
 * One `"rN": new SecNum(1000)` or `"time": new SecNum(5)` field.
 *
 * Every amount in the table is wrapped in `SecNum`, the client's tamper-checked
 * integer, but a bare number is accepted too so a hand-edited table does not
 * silently read as zero. A missing field is zero, which is how the entries that
 * omit `r4` are meant to read.
 */
const readAmount = (step, key) => {
  const hit = new RegExp(
    `"${key}"\\s*:\\s*(?:new SecNum\\(\\s*(-?\\d+)\\s*\\)|(-?\\d+))`,
  ).exec(step);
  if (!hit) return 0;
  return Number(hit[1] ?? hit[2]);
};

/** `"re": [[14, 1, 2], [8, 1, 1]]` -> `[[14, 1, 2], [8, 1, 1]]`. */
const readRequirements = (step) => {
  const hit = /"re"\s*:\s*\[/.exec(step);
  if (!hit) return [];
  const open = hit.index + hit[0].length - 1;
  const body = step.slice(open, matchBrace(step, open) + 1);
  return [...body.matchAll(/\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/g)].map((one) => [
    Number(one[1]),
    Number(one[2]),
    Number(one[3]),
  ]);
};

/** The `{ ... }` steps of a `costs` array, in order. */
const readSteps = (costs) => {
  const steps = [];
  for (let i = 0; i < costs.length; i++) {
    if (costs[i] !== "{") continue;
    const close = matchBrace(costs, i);
    const step = costs.slice(i, close + 1);
    i = close;
    steps.push({
      r1: readAmount(step, "r1"),
      r2: readAmount(step, "r2"),
      r3: readAmount(step, "r3"),
      r4: readAmount(step, "r4"),
      time: readAmount(step, "time"),
      re: readRequirements(step),
    });
  }
  return steps;
};

/** `[0, 0, 8, 15]` -> the same as numbers; `[]` when the entry has none. */
const readIntArray = (text, key) => {
  const hit = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(text);
  if (!hit) return [];
  return hit[1]
    .split(",")
    .map((one) => Number(one.trim()))
    .filter((one) => Number.isFinite(one));
};

/* ── Parse ────────────────────────────────────────────────────────────────── */

const entries = [];
const seen = new Set();

// `"fortify_costs"` is a different key and does not match: the pattern requires
// a quote immediately before `costs`.
const marker = /"costs"\s*:\s*\[/g;
for (let hit = marker.exec(source); hit; hit = marker.exec(source)) {
  const open = hit.index + hit[0].length - 1;
  const close = matchBrace(source, open);
  const costs = source.slice(open, close + 1);
  marker.lastIndex = close;

  // The owning entry's `id`, `group`, `type` and `name` all precede `costs`;
  // the nearest earlier occurrence of each is therefore this entry's.
  const before = source.slice(0, hit.index);
  const idHit = [...before.matchAll(/"id"\s*:\s*(\d+)/g)].pop();
  if (!idHit) continue;

  const id = Number(idHit[1]);

  // The first props table in the file is the main yard's. Outpost and Inferno
  // tables live in their own files, but were an id to appear twice inside
  // YARD_PROPS the first would win, matching `_buildingProps[id - 1]`.
  if (seen.has(id)) continue;
  seen.add(id);

  const nameHit = [...before.matchAll(/"name"\s*:\s*"([^"]*)"/g)].pop();
  const kindHit = [...before.matchAll(/"type"\s*:\s*"([^"]*)"/g)].pop();
  const groupHit = [...before.matchAll(/"group"\s*:\s*(\d+)/g)].pop();

  // `quantity` follows `costs` in every entry, so it is read forwards from
  // here, stopping at the next entry's `"id":` so an entry without one cannot
  // borrow the next building's cap.
  const nextId = source.indexOf('"id"', close);
  const after = source.slice(close, nextId < 0 ? source.length : nextId);

  const key = nameHit?.[1] ?? "";
  entries.push({
    id,
    name: strings[key] ?? key.replaceAll("#", ""),
    kind: kindHit?.[1] ?? "",
    group: groupHit ? Number(groupHit[1]) : 0,
    steps: readSteps(costs),
    quantity: readIntArray(after, "quantity"),
    line: lineOf(hit.index),
  });
}

entries.sort((a, b) => a.id - b.id);

/* ── Map Room 2 overrides ─────────────────────────────────────────────────────
 *
 * This project runs Map Room 2 as the default overworld, and Map Room 2 prices
 * four buildings differently from the props table. `GLOBAL.SetBuildingProps`
 * shallow-copies `_yardProps` and calls `changeNotMaproom3SpecificBuildings()`
 * over the copy whenever the account is not in Map Room 3
 * (`client/scripts/GLOBAL.as:716-746`; spec `docs/specs/base-building.md:379-388`).
 *
 * `_buildingProps` is indexed by `id - 1`, so the four indexes that function
 * touches — 4, 8, 14 and 21 — are ids 5, 9, 15 and 22.
 *
 * The replacements are transcribed by hand rather than parsed, because they are
 * AS3 statements rather than table entries and there are only four of them.
 * Each is cited by line. `verify` below re-reads the cited lines from GLOBAL.as
 * and fails the build if the source moved, so a stale transcription cannot ship
 * quietly.
 *
 * Walls (17, 18) and traps (24, 117) are untouched by any of this.
 */
const re14 = (level) => [[14, 1, level]];

const MR2_OVERRIDES = [
  {
    id: 9, // Monster Juicer, `GLOBAL.as:616-638` (`_buildingProps[8]`)
    from: 616,
    to: 638,
    costs: [
      { r1: 1000000, r2: 1000000, r3: 1000000, r4: 0, time: 43200, re: [[14, 1, 3], [15, 1, 1]] },
      { r1: 250000, r2: 250000, r3: 0, r4: 0, time: 21600, re: [[14, 1, 3], [15, 1, 1]] },
      { r1: 500000, r2: 500000, r3: 0, r4: 0, time: 43200, re: [[14, 1, 3], [15, 1, 1]] },
    ],
    quantity: [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    id: 15, // Monster Housing, `GLOBAL.as:639-681` (`_buildingProps[14]`)
    from: 639,
    to: 681,
    costs: [
      { r1: 2160, r2: 2160, r3: 0, r4: 0, time: 300, re: re14(1) },
      { r1: 8640, r2: 8640, r3: 0, r4: 0, time: 4500, re: [[14, 1, 3], [8, 1, 1]] },
      { r1: 34560, r2: 34560, r3: 0, r4: 0, time: 10800, re: [[14, 1, 4], [8, 1, 1]] },
      { r1: 138240, r2: 138240, r3: 0, r4: 0, time: 28800, re: [[14, 1, 5], [8, 1, 1]] },
      { r1: 552960, r2: 552960, r3: 0, r4: 0, time: 72000, re: [[14, 1, 6], [8, 1, 1]] },
      { r1: 2211840, r2: 2211840, r3: 0, r4: 0, time: 144000, re: [[14, 1, 6], [8, 1, 1]] },
    ],
    // `_buildingProps[14].capacity` at `:682` is the monster housing capacity,
    // which this table does not carry.
    quantity: null,
  },
  {
    id: 5, // Flinger, `GLOBAL.as:684-712` (`_buildingProps[4]`)
    from: 684,
    to: 712,
    costs: [
      { r1: 1000, r2: 1000, r3: 500, r4: 0, time: 900, re: re14(1) },
      { r1: 64300, r2: 64300, r3: 32150, r4: 0, time: 10800, re: [[14, 1, 3], [11, 1, 1]] },
      { r1: 283600, r2: 283600, r3: 141800, r4: 0, time: 32400, re: [[14, 1, 4], [11, 1, 1]] },
      { r1: 1247840, r2: 1247840, r3: 623920, r4: 0, time: 97200, re: [[14, 1, 4], [11, 1, 1]] },
    ],
    // `_buildingProps[4].capacity` at `:713` is the Flinger's payload capacity.
    quantity: null,
  },
  {
    id: 22, // Monster Bunker, `GLOBAL.as:683` (`_buildingProps[21]`)
    from: 683,
    to: 683,
    // Map Room 2 changes the Bunker's `capacity` only — `[380, 450, 540, 660,
    // 800]` — and neither its costs nor its quantity. It is listed here so the
    // set of overridden ids matches `changeNotMaproom3SpecificBuildings()` and
    // so the line check below notices if a future edit gives it a cost change.
    costs: null,
    quantity: null,
  },
];

const globalSource = readFileSync(resolve(repo, "client/scripts/GLOBAL.as"), "utf8");
const globalLines = globalSource.split("\n");

/**
 * The cited GLOBAL.as span still assigns to the index it claims to.
 *
 * A cheap tripwire, not a parse: it checks the first cited line assigns to
 * `_buildingProps[id - 1]` and that the span mentions `costs` whenever this
 * block carries replacement costs.
 */
for (const override of MR2_OVERRIDES) {
  const first = globalLines[override.from - 1] ?? "";
  const span = globalLines.slice(override.from - 1, override.to).join("\n");
  const index = override.id - 1;
  if (!first.includes(`_buildingProps[${index}]`)) {
    throw new Error(
      `GLOBAL.as:${override.from} no longer assigns _buildingProps[${index}] ` +
        `(id ${override.id}); re-read changeNotMaproom3SpecificBuildings().`,
    );
  }
  if (override.costs && !span.includes(`_buildingProps[${index}].costs`)) {
    throw new Error(`GLOBAL.as:${override.from}-${override.to} no longer sets .costs`);
  }
  if (override.quantity && !span.includes(`_buildingProps[${index}].quantity`)) {
    throw new Error(`GLOBAL.as:${override.from}-${override.to} no longer sets .quantity`);
  }

  const entry = entries.find((one) => one.id === override.id);
  if (!entry) throw new Error(`Map Room 2 override for id ${override.id}, which has no props entry`);
  if (override.costs) entry.steps = override.costs;
  if (override.quantity) entry.quantity = override.quantity;
  if (override.costs || override.quantity) {
    entry.mr2 =
      override.from === override.to
        ? `GLOBAL.as:${override.from}`
        : `GLOBAL.as:${override.from}-${override.to}`;
  }
}

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const re = (list) => `[${list.map((one) => `[${one.join(",")}]`).join(",")}]`;

const step = (one) => `[${one.r1},${one.r2},${one.r3},${one.r4},${one.time},${re(one.re)}]`;

const rows = entries
  .map(
    (entry) =>
      `  // ${entry.id} ${entry.name}${entry.kind ? ` (${entry.kind})` : ""} ` +
      `— YARD_PROPS.as:${entry.line}${entry.mr2 ? `, Map Room 2 override ${entry.mr2}` : ""}\n` +
      `  [${entry.id}, ${JSON.stringify(entry.name)}, ${JSON.stringify(entry.kind)}, ` +
      `${entry.group}, [\n` +
      entry.steps.map((one) => `    ${step(one)},`).join("\n") +
      `\n  ], [${entry.quantity.join(",")}]],`,
  )
  .join("\n");

const header = `/**
 * Building costs, one row per building type. GENERATED — do not edit by hand.
 *
 * Source: \`client/scripts/YARD_PROPS.as\`, the \`costs\` and \`quantity\` fields of
 * each entry in \`_yardProps\` (declared at :9), with the Map Room 2 price
 * changes from \`GLOBAL.changeNotMaproom3SpecificBuildings()\`
 * (\`client/scripts/GLOBAL.as:615-714\`) applied on top, because this project
 * runs Map Room 2 as the default overworld. Regenerate with
 * \`node tools/gen-building-costs.mjs\` from \`web/\`.
 *
 * A row is \`[type, name, kind, group, costs, quantity]\`.
 *
 * \`costs[k]\` is the step that *leaves* level \`k\`: \`costs[0]\` is the initial
 * build, \`costs[1]\` the level 1 to 2 upgrade, and so on, so a type's maximum
 * level is \`costs.length\` (\`client/scripts/BFOUNDATION.as:2668-2700\`; spec
 * \`docs/specs/base-building.md:412-413\`). \`kind\` is the props \`type\` string —
 * \`wall\`, \`trap\`, \`tower\`, \`resource\`, \`special\`, \`decoration\` and a few
 * others — and \`group\` is the build-menu tab.
 *
 * \`quantity[hall]\` is how many of this type a yard may hold at Town Hall level
 * \`hall\` (spec \`:400\`); it is empty for a type the props table does not cap.
 *
 * The two copies of this table, here and in the other of
 * \`web/src/game/yard/buildingCostData.ts\` and
 * \`server/src/game-data/buildingCosts.ts\`, hold identical rows on purpose: the
 * client shows a price and the server charges it, and a disagreement between
 * them is a bug the player pays for.
 */

/**
 * One prerequisite: at least \`count\` buildings of \`type\` at \`level\` or above.
 *
 * The middle element is the count, not a spare
 * (\`client/scripts/BASE.as:3884-3932\`).
 */
export type CostRequirement = readonly [type: number, count: number, level: number];

/**
 * One cost step: \`[r1, r2, r3, r4, time, re]\`.
 *
 * \`r1\`..\`r4\` are twigs, pebbles, putty and goo; \`time\` is the build or upgrade
 * countdown in seconds, which is free to finish at 300 or below
 * (\`client/scripts/BFOUNDATION.as:2063-2083\`).
 */
export type CostStep = readonly [
  r1: number,
  r2: number,
  r3: number,
  r4: number,
  time: number,
  re: readonly CostRequirement[],
];

export type CostRow = readonly [
  type: number,
  name: string,
  /** The props \`type\` string: \`wall\`, \`trap\`, \`tower\`, \`decoration\`, … */
  kind: string,
  /** The build-menu group the props table files this type under. */
  group: number,
  costs: readonly CostStep[],
  /** Cap on how many of this type a yard may hold, indexed by Town Hall level. */
  quantity: readonly number[],
];

export const BUILDING_COST_ROWS: readonly CostRow[] = [
`;

const SERVER_FOOTER = `
/** One building type's costs, keyed lookups over {@link BUILDING_COST_ROWS}. */
export interface BuildingCost {
  readonly name: string;
  readonly kind: string;
  readonly group: number;
  readonly costs: readonly CostStep[];
  readonly quantity: readonly number[];
}

/** Every row above, keyed by type id. */
export const COSTS: Record<number, BuildingCost> = Object.fromEntries(
  BUILDING_COST_ROWS.map(([type, name, kind, group, costs, quantity]) => [
    type,
    { name, kind, group, costs, quantity },
  ])
);

/** The costs for a building type, or undefined for a type this table has no row for. */
export const costOf = (type: number): BuildingCost | undefined => COSTS[type];

/**
 * The highest level a type can reach, which is the number of cost steps it has
 * (spec \`docs/specs/base-building.md:412-413\`). 0 for an unknown type.
 */
export const maxLevel = (type: number): number => COSTS[type]?.costs.length ?? 0;

/**
 * The wall types.
 *
 * 18 is a legacy entry the Flash client rewrites to \`t: 17, l: 2\` on load
 * (\`client/scripts/BASE.as:1523-1526\`), so it shares type 17's cost ladder and
 * has none of its own.
 */
export const WALL_TYPES: readonly number[] = [17, 18];

/** The trap types: Booby Trap and Heavy Trap. Both have a single level. */
export const TRAP_TYPES: readonly number[] = [24, 117];
`;

const body = `${header}${rows}\n];\n`;

writeFileSync(WEB_OUT, body, "utf8");
writeFileSync(SERVER_OUT, `${body}${SERVER_FOOTER}`, "utf8");

const steps = entries.reduce((total, one) => total + one.steps.length, 0);
console.log(`${entries.length} building types, ${steps} cost steps`);
console.log(`-> ${WEB_OUT}`);
console.log(`-> ${SERVER_OUT}`);
console.log(
  entries
    .map(
      (one) =>
        `${one.id}\t${one.name}\t${one.kind}\tg${one.group}\t` +
        `${one.steps.length} steps\tquantity ${one.quantity.length}${one.mr2 ? `\tMR2 ${one.mr2}` : ""}`,
    )
    .join("\n"),
);
