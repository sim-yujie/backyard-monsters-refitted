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
 * Five entries also carry the economy ladders the server needs to derive
 * production and storage: the four harvesters' `produce`, `cycleTime` and
 * `capacity` (`client/scripts/YARD_PROPS.as:151-153` and the three parallel
 * entries) and the Storage Silo's `capacity` (`:869`). See `readStats`.
 *
 * Display names come from the game's own English string table
 * (`server/public/gamestage/assets/archived/en.v612.txt`), because the props
 * table stores a `#b_key#` placeholder rather than a name — the same lookup
 * `gen-building-art.mjs` makes.
 *
 * Outposts have a props table of their own, `client/scripts/OUTPOST_YARD_PROPS.as`,
 * which `GLOBAL.SetBuildingProps` swaps in wholesale for an outpost yard, for the
 * owner and an attacker alike (`client/scripts/GLOBAL.as:716-723`). It is read
 * the same way into a second table, `OUTPOST_COST_ROWS`, with none of the Map
 * Room 2 overrides below, which apply to the main table only (`:724-747`). Each
 * outpost row also gets a trait row in `OUTPOST_TRAIT_ROWS`. See "Outposts"
 * below.
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
import { lineCounter, matchBrace, readIntArray, readPropsSource } from "./lib/props.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const PROPS = resolve(repo, "client/scripts/YARD_PROPS.as");
const OUTPOST_PROPS = resolve(repo, "client/scripts/OUTPOST_YARD_PROPS.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/archived/en.v612.txt");
const WEB_OUT = resolve(here, "../src/game/yard/buildingCostData.ts");
const SERVER_OUT = resolve(repo, "server/src/game-data/buildingCosts.ts");

// The comment-stripped read, `matchBrace`, `readIntArray` and `lineCounter`
// live in `lib/props.mjs`, shared with `gen-combat-stats.mjs`
// (`docs/design/server-combat.md` §3.3). Their behaviour is unchanged.
const language = JSON.parse(readFileSync(STRINGS, "utf8"));

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

/**
 * The Storage Silo.
 *
 * Its `capacity` ladder is the only non-harvester one this table carries,
 * because `BASE.CalcResources` sums exactly it and nothing else when it works
 * out the pool cap (`client/scripts/BASE.as:4705-4828`; spec
 * `docs/specs/base-building.md:655-679`).
 */
const STORAGE_SILO = 6;

/**
 * The `produce`, `cycleTime` and `capacity` ladders of one entry, or null.
 *
 * Only the four harvesters and the Storage Silo get them. Several other
 * entries spell `capacity` too — the Flinger's payload (`:709`), Monster
 * Housing's monster room (`:1659`), the Monster Bunker's (`:2483`) — and the
 * Wild Monster Baiter has a `produce` array of monsters rather than resources
 * (`:1961`). None of those is a resource amount, so pricing an economy rule
 * from them would be a category error; they stay out of the table, as the Map
 * Room 2 override notes below already say for two of them.
 *
 * The silo produces nothing, so its `produce` and `cycleTime` come back empty
 * and `productionOf` reads that as "not a harvester".
 *
 * Every ladder is indexed by level minus one — `produce[l - 1]` is what a
 * level `l` harvester banks per cycle (`client/scripts/BRESOURCE.as:425`,
 * `:385`, `:444`) — so each must be exactly as long as the cost ladder. A
 * short one would silently price a top-level harvester at zero, which is why
 * the length mismatch throws rather than warns.
 */
const readStats = (entry, after, file) => {
  const harvester = entry.kind === "resource";
  if (!harvester && entry.id !== STORAGE_SILO) return null;

  const stats = {
    produce: harvester ? readIntArray(after, "produce") : [],
    cycleTime: harvester ? readIntArray(after, "cycleTime") : [],
    capacity: readIntArray(after, "capacity"),
  };

  const levels = entry.steps.length;
  for (const key of harvester ? ["produce", "cycleTime", "capacity"] : ["capacity"]) {
    if (stats[key].length !== levels) {
      throw new Error(
        `${file}:${entry.line}: id ${entry.id} has ${stats[key].length} ` +
          `"${key}" entries for ${levels} cost steps; re-read the entry.`,
      );
    }
  }

  return stats;
};

/* ── Parse ────────────────────────────────────────────────────────────────── */

/**
 * Every entry of one props file that has a `costs` array, sorted by id.
 *
 * `file` is the name citations use and `names` turns a props `"name"` into a
 * display name. Each entry also carries four fields only the outpost table
 * emits (see "Outposts" below): `blocked`, `hp`, `fortify` and `capacity`.
 */
const readTable = (path, file, names) => {
  const { source } = readPropsSource(path);
  const lineOf = lineCounter(source);
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

    // Each props table lives in its own file, but were an id to appear twice
    // inside one the first would win, matching `_buildingProps[id - 1]`.
    if (seen.has(id)) continue;
    seen.add(id);

    const nameHit = [...before.matchAll(/"name"\s*:\s*"([^"]*)"/g)].pop();
    const kindHit = [...before.matchAll(/"type"\s*:\s*"([^"]*)"/g)].pop();
    const groupHit = [...before.matchAll(/"group"\s*:\s*(\d+)/g)].pop();

    // `"block": true` keeps a type out of the build menu
    // (`client/scripts/BUILDINGSPOPUP.as:132`); it sits between the entry's
    // `id` and its `costs`.
    const head = source.slice(idHit.index, hit.index);

    // `quantity` follows `costs` in every entry, so it is read forwards from
    // here, stopping at the next entry's `"id":` so an entry without one cannot
    // borrow the next building's cap. `produce`, `cycleTime`, `capacity`, `hp`
    // and `fortify_costs` sit in the same span, beside `quantity`.
    const nextId = source.indexOf('"id"', close);
    const after = source.slice(close, nextId < 0 ? source.length : nextId);

    const fortifyHit = /"fortify_costs"\s*:\s*\[/.exec(after);
    const fortifyOpen = fortifyHit ? fortifyHit.index + fortifyHit[0].length - 1 : -1;

    const key = nameHit?.[1] ?? "";
    const entry = {
      id,
      name: names(key),
      kind: kindHit?.[1] ?? "",
      group: groupHit ? Number(groupHit[1]) : 0,
      steps: readSteps(costs),
      quantity: readIntArray(after, "quantity"),
      line: lineOf(hit.index),
      blocked: /"block"\s*:\s*true/.test(head),
      hp: readIntArray(after, "hp"),
      // `BASE.CanFortify` refuses an entry without `can_fortify`, whatever its
      // `fortify_costs` say (`client/scripts/BASE.as:4015-4017`), so a ladder
      // without the flag reads as none.
      fortify:
        fortifyHit && /"can_fortify"\s*:\s*true/.test(head + after)
          ? readSteps(after.slice(fortifyOpen, matchBrace(after, fortifyOpen) + 1))
          : [],
      capacity: readIntArray(after, "capacity"),
    };
    entry.stats = readStats(entry, after, file);
    entries.push(entry);
  }

  return entries.sort((a, b) => a.id - b.id);
};

// The main table has always named from the `core` section only; a type it
// misses keeps its key, hashes stripped.
const entries = readTable(
  PROPS,
  "YARD_PROPS.as",
  (key) => language.core[key] ?? key.replaceAll("#", ""),
);

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

/* ── Project decisions ────────────────────────────────────────────────────────
 *
 * Two rows this project changes on purpose, not because the Flash client did
 * (`docs/design/yard-buildings.md` §5.7, decisions D15 and D16):
 *
 * - The Map Room (11) stops at level 2. Its level is the map version, and Map
 *   Room 3 is not offered, so its third step (`YARD_PROPS.as:1122`, the L2 to
 *   L3 upgrade) is cut. Its L1 to L2 step is the move to Map Room 2.
 * - The Radio Tower (113) is dropped: email alerts are a Facebook-era feature
 *   with nothing behind them. The server's catch-up removes any Radio a yard
 *   still holds and refunds its build cost (`services/yard/mapRoom.ts`), so no
 *   yard needs its row afterwards, and a build menu read from this table
 *   cannot offer it.
 */
const MAP_ROOM = 11;
const MAP_ROOM_MAX_LEVEL = 2;
const RADIO_TOWER = 113;

const mapRoom = entries.find((one) => one.id === MAP_ROOM);
if (!mapRoom || mapRoom.steps.length < MAP_ROOM_MAX_LEVEL) {
  throw new Error(`YARD_PROPS.as: the Map Room (${MAP_ROOM}) has fewer than ${MAP_ROOM_MAX_LEVEL} steps`);
}
mapRoom.steps = mapRoom.steps.slice(0, MAP_ROOM_MAX_LEVEL);
mapRoom.capped = MAP_ROOM_MAX_LEVEL;

const radio = entries.findIndex((one) => one.id === RADIO_TOWER);
if (radio < 0) throw new Error(`YARD_PROPS.as: no Radio Tower (${RADIO_TOWER}) entry to drop`);
entries.splice(radio, 1);

/* ── Outposts ─────────────────────────────────────────────────────────────────
 *
 * An outpost yard runs on `OUTPOST_YARD_PROPS._outpostProps` in place of the
 * main table (`client/scripts/GLOBAL.as:716-723`). The Map Room 2 overrides
 * above are applied only on the `default:` branch of that switch (`:724-747`),
 * so none of them reach this table, and neither project decision above has a
 * row to act on: the outpost Map Room and Radio carry no `costs` at all.
 *
 * The core (112) stands in for the Town Hall: it registers itself as
 * `GLOBAL.townHall` (`client/scripts/BUILDING112.as:66-74`) and is always level
 * 1, so `quantity[1]` is every type's cap in an outpost. Every step requires
 * `[112, 1, 1]`, and a few also name another outpost building: the Juicer,
 * Hatchery and Bunker need a Housing (`OUTPOST_YARD_PROPS.as:751`, `:885`,
 * `:1846`), and the Hatchery Control Center two Hatcheries (`:1212`).
 *
 * Beside the cost row, each outpost type gets a trait row:
 *
 * - `blocked`: the entry's `"block": true`, which keeps it out of the build
 *   menu whatever its `quantity` says (`client/scripts/BUILDINGSPOPUP.as:132`).
 *   The Catapult is the case that matters: `quantity[1]` is 1 but it is
 *   blocked (`OUTPOST_YARD_PROPS.as:3118`, `:3190`).
 * - `hp`: the entry's `hp` ladder, `hp[level - 1]`. The laser, tesla, flak,
 *   railgun and bunker ladders are the outpost's own, and the core's is its
 *   200,000. Read verbatim: the railgun's level 6 is 13,200 below a level 5 of
 *   75,500, which looks like a typo for 132,000 but is what Flash ran.
 * - `fortify`: the `fortify_costs` ladder, for entries with `can_fortify`.
 *   `fortify[k]` is the step that takes fortification `k` to `k + 1`
 *   (`client/scripts/BFOUNDATION.as:2099-2102`, `BASE.as:4018-4040`).
 * - `capacity`: the entry's `capacity` ladder when it is not an economy one
 *   (the harvesters' is in `stats`): the Flinger's payload, Housing's and the
 *   Bunker's monster room.
 */
const OUTPOST_CORE = 112;

/**
 * Whether the outpost build menu can offer a type: filed under one of the four
 * menu tabs (`group` 1 to 4, `client/scripts/BUILDINGSPOPUP.as:28-35`), not
 * `block`ed (`:132`), and allowed at least one at core level 1.
 */
const inOutpostMenu = (entry) =>
  entry.group >= 1 && entry.group <= 4 && !entry.blocked && (entry.quantity[1] ?? 0) > 0;

const outposts = readTable(
  OUTPOST_PROPS,
  "OUTPOST_YARD_PROPS.as",
  (key) => language.core[key] ?? language.game[key] ?? key.replaceAll("#", ""),
);

{
  const core = outposts.find((one) => one.id === OUTPOST_CORE);
  if (!core) throw new Error(`OUTPOST_YARD_PROPS.as: no outpost core (${OUTPOST_CORE}) entry`);
  if (core.steps.length !== 1) {
    throw new Error(`OUTPOST_YARD_PROPS.as:${core.line}: the core has ${core.steps.length} cost steps, not 1`);
  }
  if (core.fortify.length === 0 || core.hp.length === 0) {
    throw new Error(`OUTPOST_YARD_PROPS.as:${core.line}: the core has lost its fortify or hp ladder`);
  }
  // A buildable type may only require the core or another buildable type;
  // anything else could never be met in an outpost.
  const buildable = new Set(
    outposts.filter(inOutpostMenu).map((one) => one.id),
  );
  for (const entry of outposts) {
    if (!buildable.has(entry.id)) continue;
    for (const one of [...entry.steps, ...entry.fortify]) {
      for (const [type] of one.re) {
        if (type !== OUTPOST_CORE && !buildable.has(type)) {
          throw new Error(
            `OUTPOST_YARD_PROPS.as:${entry.line}: id ${entry.id} requires type ${type}, ` +
              "which an outpost cannot hold",
          );
        }
      }
    }
  }
}

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const re = (list) => `[${list.map((one) => `[${one.join(",")}]`).join(",")}]`;

const step = (one) => `[${one.r1},${one.r2},${one.r3},${one.r4},${one.time},${re(one.re)}]`;

/** The trailing `, { produce, cycleTime, capacity }`, or nothing at all. */
const stats = (one) =>
  one
    ? `, {\n` +
      `    produce: [${one.produce.join(",")}],\n` +
      `    cycleTime: [${one.cycleTime.join(",")}],\n` +
      `    capacity: [${one.capacity.join(",")}],\n` +
      `  }`
    : "";

/** One cost row per entry, each under a comment citing `file`. */
const costRows = (list, file) =>
  list
    .map(
      (entry) =>
        `  // ${entry.id} ${entry.name}${entry.kind ? ` (${entry.kind})` : ""} ` +
        `— ${file}:${entry.line}${entry.mr2 ? `, Map Room 2 override ${entry.mr2}` : ""}` +
        `${entry.capped ? `, capped at level ${entry.capped} (D16)` : ""}\n` +
        `  [${entry.id}, ${JSON.stringify(entry.name)}, ${JSON.stringify(entry.kind)}, ` +
        `${entry.group}, [\n` +
        entry.steps.map((one) => `    ${step(one)},`).join("\n") +
        `\n  ], [${entry.quantity.join(",")}]${stats(entry.stats)}],`,
    )
    .join("\n");

const rows = costRows(entries, "YARD_PROPS.as");

/** `[type, blocked, hp, fortify, capacity]`, one line unless it fortifies. */
const traitRows = (list) =>
  list
    .map((entry) => {
      const fortify =
        entry.fortify.length === 0
          ? "[]"
          : `[\n${entry.fortify.map((one) => `    ${step(one)},`).join("\n")}\n  ]`;
      const capacity = entry.stats ? [] : entry.capacity;
      return (
        `  [${entry.id}, ${entry.blocked}, [${entry.hp.join(",")}], ${fortify}, ` +
        `[${capacity.join(",")}]],`
      );
    })
    .join("\n");

const OUTPOST_SECTION = `
/* ── Outposts ───────────────────────────────────────────────────────────────── */

/**
 * Which props table a yard builds from: a player's main yard, or one of their
 * Map Room 2 outposts, which swaps in \`OUTPOST_YARD_PROPS._outpostProps\` for the
 * whole table (\`client/scripts/GLOBAL.as:716-723\`).
 */
export type YardKind = "main" | "outpost";

/**
 * The outpost core, the outpost's Town Hall.
 *
 * It registers itself as \`GLOBAL.townHall\` (\`client/scripts/BUILDING112.as:66-74\`)
 * and never leaves level 1, so an outpost's caps are every row's \`quantity[1]\`.
 * It cannot be built, upgraded or recycled; the server places it when an empty
 * outpost loads (\`client/scripts/BASE.as:1605-1614\`).
 */
export const OUTPOST_CORE_TYPE = ${OUTPOST_CORE};

/**
 * The outpost yard's rows, in the same shape as {@link BUILDING_COST_ROWS}.
 *
 * Source: \`client/scripts/OUTPOST_YARD_PROPS.as\`, read exactly as the main
 * table is, with none of the Map Room 2 overrides: \`GLOBAL.SetBuildingProps\`
 * applies those to the main table only (\`client/scripts/GLOBAL.as:724-747\`).
 * Types the outpost table has no \`costs\` for, such as the Storage Silo, the
 * Map Room and the Radio, have no row.
 *
 * Not every row is buildable: see {@link OUTPOST_TRAIT_ROWS} for \`blocked\`.
 */
export const OUTPOST_COST_ROWS: readonly CostRow[] = [
${costRows(outposts, "OUTPOST_YARD_PROPS.as")}
];

/**
 * \`[type, blocked, hp, fortify, capacity]\`, one per outpost row.
 *
 * - \`blocked\` is the props \`"block": true\`, which keeps a type out of the build
 *   menu whatever its \`quantity\` says (\`client/scripts/BUILDINGSPOPUP.as:132\`).
 *   The Catapult has \`quantity[1]\` 1 and is blocked.
 * - \`hp[level - 1]\` is the maximum health, the outpost's own ladder. The
 *   railgun's level 6 reads 13,200, below its level 5's 75,500; it looks like a
 *   typo for 132,000, and is kept as Flash ran it.
 * - \`fortify[k]\` is the step that takes fortification \`k\` to \`k + 1\`
 *   (\`client/scripts/BFOUNDATION.as:2099-2102\`), present only on entries with
 *   \`can_fortify\` (\`client/scripts/BASE.as:4015-4017\`).
 * - \`capacity[level - 1]\` is the Flinger's payload or the monster room of
 *   Housing or a Bunker; empty on the harvesters, whose buffer is in \`stats\`.
 */
export type OutpostTraitRow = readonly [
  type: number,
  blocked: boolean,
  hp: readonly number[],
  fortify: readonly CostStep[],
  capacity: readonly number[],
];

export const OUTPOST_TRAIT_ROWS: readonly OutpostTraitRow[] = [
${traitRows(outposts)}
];
`;

const header = `/**
 * Building costs, one row per building type. GENERATED — do not edit by hand.
 *
 * Source: \`client/scripts/YARD_PROPS.as\`, the \`costs\` and \`quantity\` fields of
 * each entry in \`_yardProps\` (declared at :9), with the Map Room 2 price
 * changes from \`GLOBAL.changeNotMaproom3SpecificBuildings()\`
 * (\`client/scripts/GLOBAL.as:615-714\`) applied on top, because this project
 * runs Map Room 2 as the default overworld. Two rows are this project's own
 * decisions: the Map Room (11) stops at level 2, and the Radio Tower (113) has
 * no row (\`docs/design/yard-buildings.md\` §5.7). Regenerate with
 * \`node tools/gen-building-costs.mjs\` from \`web/\`.
 *
 * A row is \`[type, name, kind, group, costs, quantity]\`, with a seventh
 * element, \`stats\`, on the five types that carry an economy ladder.
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
 * \`stats\` is present only on the four harvesters (types 1 to 4) and the
 * Storage Silo (type 6), the types whose numbers the economy audit derives
 * from (spec \`:484-526\`). Other entries in the props file spell \`capacity\`
 * and \`produce\` for monsters, Flinger payloads and bunker room, none of which
 * is a resource amount, so they carry no \`stats\` here.
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

/**
 * A harvester's or silo's economy ladder, indexed by level minus one.
 *
 * \`produce[l - 1]\` is what a level \`l\` harvester adds to its buffer each
 * cycle, \`cycleTime[l - 1]\` is how many seconds that cycle takes at full
 * health, and \`capacity[l - 1]\` is the buffer it fills
 * (\`client/scripts/BRESOURCE.as:425\`, \`:385\`, \`:444\`). For the Storage Silo
 * \`capacity[l - 1]\` is instead what a finished silo adds to every resource
 * pool's cap (\`client/scripts/BASE.as:4705-4828\`), and \`produce\` and
 * \`cycleTime\` are empty because a silo produces nothing.
 */
export interface BuildingStats {
  readonly produce: readonly number[];
  readonly cycleTime: readonly number[];
  readonly capacity: readonly number[];
}

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
  /** Present on the harvesters (1 to 4) and the Storage Silo (6) only. */
  stats?: BuildingStats,
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
  /** Undefined for every type but the harvesters (1 to 4) and the Storage Silo (6). */
  readonly stats: BuildingStats | undefined;
}

/** Every row above, keyed by type id. */
export const COSTS: Record<number, BuildingCost> = Object.fromEntries(
  BUILDING_COST_ROWS.map(([type, name, kind, group, costs, quantity, stats]) => [
    type,
    { name, kind, group, costs, quantity, stats },
  ])
);

/** Every row of {@link OUTPOST_COST_ROWS}, keyed by type id. */
export const OUTPOST_COSTS: Record<number, BuildingCost> = Object.fromEntries(
  OUTPOST_COST_ROWS.map(([type, name, kind, group, costs, quantity, stats]) => [
    type,
    { name, kind, group, costs, quantity, stats },
  ])
);

/** One outpost type's {@link OutpostTraitRow}, keyed. */
export interface OutpostTraits {
  /** Kept out of the build menu whatever \`quantity\` says. */
  readonly blocked: boolean;
  /** Maximum health, \`hp[level - 1]\`. */
  readonly hp: readonly number[];
  /** \`fortify[k]\` takes fortification \`k\` to \`k + 1\`; empty when it cannot fortify. */
  readonly fortify: readonly CostStep[];
  /** Flinger payload or monster room, \`capacity[level - 1]\`; empty for everything else. */
  readonly capacity: readonly number[];
}

/** Every row of {@link OUTPOST_TRAIT_ROWS}, keyed by type id. */
export const OUTPOST_TRAITS: Record<number, OutpostTraits> = Object.fromEntries(
  OUTPOST_TRAIT_ROWS.map(([type, blocked, hp, fortify, capacity]) => [
    type,
    { blocked, hp, fortify, capacity },
  ])
);

/**
 * The cost table a yard of \`kind\` builds from: the main yard's, or the
 * outpost's, which replaces it wholesale (\`client/scripts/GLOBAL.as:716-723\`).
 */
export const propsFor = (kind: YardKind): Record<number, BuildingCost> =>
  kind === "outpost" ? OUTPOST_COSTS : COSTS;

/** The costs for a building type, or undefined for a type this table has no row for. */
export const costOf = (type: number, kind: YardKind = "main"): BuildingCost | undefined =>
  propsFor(kind)[type];

/** The Storage Silo, the only building that raises a resource pool's cap. */
export const STORAGE_SILO_TYPE = 6;

/**
 * A harvester's production ladder, or undefined for anything that is not one.
 *
 * The four harvester types are the resource ids: type 1 banks \`r1\`, type 2
 * \`r2\`, and so on (spec \`docs/specs/base-building.md:578-590\`). The Storage
 * Silo carries a \`capacity\` ladder but produces nothing, so it reads as
 * undefined here and through {@link siloCapacity} instead. An outpost's
 * harvesters have their own ladder in the outpost table.
 */
export const productionOf = (type: number, kind: YardKind = "main"): BuildingStats | undefined => {
  const stats = propsFor(kind)[type]?.stats;
  return stats && stats.produce.length > 0 ? stats : undefined;
};

/**
 * What one finished Storage Silo at \`level\` adds to every resource pool's cap.
 *
 * \`level\` is the building's own level, 1 to 10, matching the \`capacity[l - 1]\`
 * lookup the client makes (\`client/scripts/BASE.as:4705-4828\`). A silo still
 * counting its initial build down is level 0 and adds nothing, which is what
 * the 0 for an out-of-range level says.
 */
export const siloCapacity = (level: number): number =>
  COSTS[STORAGE_SILO_TYPE]?.stats?.capacity[level - 1] ?? 0;

/**
 * The highest level a type can reach, which is the number of cost steps it has
 * (spec \`docs/specs/base-building.md:412-413\`). 0 for an unknown type. The
 * outpost table caps several types lower: a Flinger at 4, a Hatchery at 3,
 * Housing and the laser, tesla, flak and railgun at 6.
 */
export const maxLevel = (type: number, kind: YardKind = "main"): number =>
  propsFor(kind)[type]?.costs.length ?? 0;

/**
 * The fortify ladder of a type in a yard of \`kind\`, empty when it has none.
 *
 * Only the outpost table's is carried: fortifying a main-yard building is a Map
 * Room 3 feature this project does not offer (\`services/yard/catchUpBuildings.ts\`).
 */
export const fortifyStepsOf = (type: number, kind: YardKind): readonly CostStep[] =>
  kind === "outpost" ? (OUTPOST_TRAITS[type]?.fortify ?? []) : [];

/** The hall type of a yard: the Town Hall, or the core on an outpost. */
export const hallTypeOf = (kind: YardKind): number => (kind === "outpost" ? OUTPOST_CORE_TYPE : 14);

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

const body = `${header}${rows}\n];\n${OUTPOST_SECTION}`;

writeFileSync(WEB_OUT, body, "utf8");
writeFileSync(SERVER_OUT, `${body}${SERVER_FOOTER}`, "utf8");

const steps = entries.reduce((total, one) => total + one.steps.length, 0);
const statted = entries.filter((one) => one.stats).map((one) => one.id);
console.log(
  `${entries.length} building types, ${steps} cost steps, ` +
    `stats on ${statted.length} (${statted.join(", ")})`,
);
console.log(`-> ${WEB_OUT}`);
console.log(`-> ${SERVER_OUT}`);
console.log(
  entries
    .map(
      (one) =>
        `${one.id}\t${one.name}\t${one.kind}\tg${one.group}\t` +
        `${one.steps.length} steps\tquantity ${one.quantity.length}` +
        `${one.stats ? "\tstats" : ""}${one.mr2 ? `\tMR2 ${one.mr2}` : ""}`,
    )
    .join("\n"),
);
console.log(
  `outposts: ${outposts.length} types, ` +
    `buildable ${outposts
      .filter(inOutpostMenu)
      .map((one) => `${one.id}x${one.quantity[1]}/L${one.steps.length}`)
      .join(" ")}, ` +
    `fortify on ${outposts
      .filter((one) => one.fortify.length > 0)
      .map((one) => one.id)
      .join(", ")}`,
);
