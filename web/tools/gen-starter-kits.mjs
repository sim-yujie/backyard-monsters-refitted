/**
 * Regenerates the outpost Starter Kits from the Flash client (outposts WP9,
 * issue #188).
 *
 *   cd web && node tools/gen-starter-kits.mjs
 *
 * The source of truth is `client/scripts/popup_prefab.as`, `GetBuildings`
 * (`:278-311`). Each kit is a `JSON.parse` of a building map, one line each
 * (`:283`, `:290`, `:297`), followed by its price: twigs, pebbles and putty
 * for "Use Resources" and the Shiny for "Use N Shiny" (`:284-287`,
 * `:291-294`, `:298-301`). A building row is `{ X, Y, t, id }` plus, where
 * the kit sets them, `prefab` (the level it builds up to; Flash reads a
 * missing one as 1, `:259-261`), `fort` (Ultra's fortifications) and `rCP`
 * (a harvester's production countdown, `BFOUNDATION.as:3018`, `:3095`, which
 * a kit's empty harvester does not use). The core (112) is in every layout:
 * the kit moves the outpost's core there (`GLOBAL.townHall.Setup`, `:251-257`).
 *
 * Kit `k` (1 Regular, 2 Mega, 3 Ultra) shows `ui/prefab-${k + 1}.v5.jpg`
 * (`:23`) under the names `str_regularkit`, `str_megakit` and `str_ultrakit`
 * (`:34-36`).
 *
 * Two files are written:
 *
 *   server/src/game-data/starterKits.ts   every layout, verbatim, and the prices
 *   web/src/game/yard/starterKitData.ts   the prices and what each kit holds
 *
 * Nothing here runs in the browser and nothing in the client imports it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const SOURCE = resolve(repo, "client/scripts/popup_prefab.as");
const SERVER_OUT = resolve(repo, "server/src/game-data/starterKits.ts");
const WEB_OUT = resolve(here, "../src/game/yard/starterKitData.ts");

/** `GetBuildings`' three branches: the kit id, its name and the line of its layout. */
const KITS = [
  { id: 1, name: "Regular Kit" },
  { id: 2, name: "Mega Kit" },
  { id: 3, name: "Ultra Kit" },
];

/** The fields a kit row may carry, in the order they are written. */
const FIELDS = ["id", "t", "X", "Y", "prefab", "fort", "rCP"];

const lines = readFileSync(SOURCE, "utf8").split(/\r?\n/);

/**
 * Finds `if (param1 == k)` (or `else if`) in `GetBuildings` and reads the
 * layout and the four `SecNum` prices that follow it.
 */
const readKit = (kit) => {
  const branch = lines.findIndex((line, index) =>
    index > 270 && new RegExp(`if \\(param1 == ${kit.id}\\)`).test(line),
  );
  if (branch < 0) throw new Error(`popup_prefab.as: no GetBuildings branch for kit ${kit.id}`);

  const layoutLine = branch + 1;
  const match = /JSON\.parse\("(.*)"\);\s*$/.exec(lines[layoutLine]);
  if (!match) throw new Error(`popup_prefab.as:${layoutLine + 1}: no JSON.parse layout`);
  // The ActionScript string literal escapes its quotes; JSON reads it back.
  const layout = JSON.parse(JSON.parse(`"${match[1]}"`));

  const prices = [];
  for (let at = layoutLine + 1; prices.length < 4; at++) {
    const price = /_loc3_\[(\d)\] = new SecNum\((\d+)\);/.exec(lines[at]);
    if (!price) throw new Error(`popup_prefab.as:${at + 1}: expected the kit's price`);
    prices[Number(price[1])] = Number(price[2]);
  }

  const buildings = Object.entries(layout)
    .map(([key, row]) => {
      const out = {};
      for (const field of FIELDS) if (row[field] !== undefined) out[field] = row[field];
      if (out.id === undefined) out.id = Number(key);
      for (const field of Object.keys(row)) {
        if (!FIELDS.includes(field)) throw new Error(`kit ${kit.id}: unknown field ${field}`);
      }
      return out;
    })
    .sort((a, b) => a.id - b.id);

  return {
    ...kit,
    line: layoutLine + 1,
    resources: { r1: prices[0], r2: prices[1], r3: prices[2] },
    shiny: prices[3],
    buildings,
  };
};

const kits = KITS.map(readKit);

const rowText = (row) =>
  `{ ${FIELDS.filter((field) => row[field] !== undefined)
    .map((field) => `${field}: ${row[field]}`)
    .join(", ")} }`;

/** Buildings by type and target level, for the picker's list. */
const contents = (kit) => {
  const counts = new Map();
  for (const row of kit.buildings) {
    if (row.t === 112) continue;
    const key = `${row.t}:${row.prefab ?? 1}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => {
    const [t, level] = key.split(":").map(Number);
    return [t, level, count];
  });
};

const header = (what) => `/**
 * ${what} GENERATED — do not edit by hand.
 *
 * Source: \`client/scripts/popup_prefab.as\`, \`GetBuildings\` (:278-311): each
 * kit's building map and its price. Regenerate with
 * \`node tools/gen-starter-kits.mjs\` from \`web/\`.
 */`;

const server = `${header("The outpost Starter Kits (outposts WP9, issue #188).")}

/**
 * One building of a kit, as \`popup_prefab.as\` spells it: its layout \`id\`,
 * type and spot, \`prefab\` (the level it builds up to; absent reads as 1,
 * \`popup_prefab.as:259-261\`), \`fort\` (a fortification, Ultra only) and
 * \`rCP\` (a harvester's production countdown, unused by a kit).
 */
export interface KitBuilding {
  readonly id: number;
  readonly t: number;
  readonly X: number;
  readonly Y: number;
  readonly prefab?: number;
  readonly fort?: number;
  readonly rCP?: number;
}

export interface StarterKit {
  /** \`GetBuildings\`' kit id: 1 Regular, 2 Mega, 3 Ultra. */
  readonly id: 1 | 2 | 3;
  readonly name: string;
  /** "Use Resources": twigs, pebbles and putty. */
  readonly resources: { readonly r1: number; readonly r2: number; readonly r3: number };
  /** "Use N Shiny". */
  readonly shiny: number;
  /** Every building, the core (112) included, in layout id order. */
  readonly buildings: readonly KitBuilding[];
}

export const STARTER_KITS: readonly StarterKit[] = [
${kits
  .map(
    (kit) => `  {
    // popup_prefab.as:${kit.line}
    id: ${kit.id},
    name: ${JSON.stringify(kit.name)},
    resources: { r1: ${kit.resources.r1}, r2: ${kit.resources.r2}, r3: ${kit.resources.r3} },
    shiny: ${kit.shiny},
    buildings: [
${kit.buildings.map((row) => `      ${rowText(row)},`).join("\n")}
    ],
  },`,
  )
  .join("\n")}
];
`;

const web = `${header("What the Starter Kit picker shows (outposts WP9, issue #188).")}

export interface StarterKitSummary {
  /** 1 Regular, 2 Mega, 3 Ultra: the id \`POST /bm/yard/starterkit\` takes. */
  readonly id: 1 | 2 | 3;
  readonly name: string;
  readonly resources: { readonly r1: number; readonly r2: number; readonly r3: number };
  readonly shiny: number;
  /** \`ui/prefab-\${id + 1}.v5.jpg\` (\`popup_prefab.as:23\`). */
  readonly thumbnail: string;
  /** Buildings besides the core. */
  readonly buildingCount: number;
  /** \`[type, level, count]\`: what the kit builds, the core left out. */
  readonly contents: readonly (readonly [number, number, number])[];
}

export const STARTER_KIT_SUMMARIES: readonly StarterKitSummary[] = [
${kits
  .map(
    (kit) => `  {
    id: ${kit.id},
    name: ${JSON.stringify(kit.name)},
    resources: { r1: ${kit.resources.r1}, r2: ${kit.resources.r2}, r3: ${kit.resources.r3} },
    shiny: ${kit.shiny},
    thumbnail: "/assets/ui/prefab-${kit.id + 1}.v5.jpg",
    buildingCount: ${kit.buildings.filter((row) => row.t !== 112).length},
    contents: [${contents(kit)
      .map(([t, level, count]) => `[${t}, ${level}, ${count}]`)
      .join(", ")}],
  },`,
  )
  .join("\n")}
];
`;

writeFileSync(SERVER_OUT, server);
writeFileSync(WEB_OUT, web);
console.log(
  `wrote ${kits.map((kit) => `${kit.name} (${kit.buildings.length} rows)`).join(", ")}`,
);
