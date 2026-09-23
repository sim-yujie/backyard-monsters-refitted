/**
 * Regenerates `src/game/yard/buildingArtData.ts` from the Flash client's props
 * table.
 *
 *   cd web && node tools/gen-building-art.mjs
 *
 * The source of truth is `client/scripts/YARD_PROPS.as`, where every building
 * entry carries an `imageData` block: a `baseurl` folder plus one sub-object per
 * *image level* — the level at which the art changes, not every level the
 * building can reach. Each sub-object names the file and the pixel offset of the
 * bitmap's top-left corner relative to the building's isometric origin, for the
 * default, damaged and destroyed states.
 *
 * Display names come from the game's own English string table
 * (`server/public/gamestage/assets/archived/en.v612.txt`), because the props
 * table stores a `#b_key#` placeholder rather than a name.
 *
 * Nothing here runs in the browser and nothing in the client imports it.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const PROPS = resolve(repo, "client/scripts/YARD_PROPS.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/archived/en.v612.txt");
const OUT = resolve(here, "../src/game/yard/buildingArtData.ts");
const MANIFEST = resolve(here, "../test/fixtures/building-art-files.json");
const ASSETS = resolve(repo, "server/public/assets");

const source = readFileSync(PROPS, "utf8");
const strings = JSON.parse(readFileSync(STRINGS, "utf8")).core;

/** Index of the matching `}` for the `{` at `open`. */
const matchBrace = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Skip a string literal; AS3 has no escapes worth worrying about here.
      i = text.indexOf('"', i + 1);
      if (i < 0) break;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unbalanced braces from ${open}`);
};

const lineOf = (index) => source.slice(0, index).split("\n").length;

/** Every `"imageData": { ... }` block, with the id of the entry holding it. */
const blocks = [];
const marker = /"imageData"\s*:\s*\{/g;
for (let hit = marker.exec(source); hit; hit = marker.exec(source)) {
  const open = hit.index + hit[0].length - 1;
  const close = matchBrace(source, open);
  const body = source.slice(open, close + 1);

  // The owning entry's fields all precede `imageData`; the nearest earlier
  // `"id":` is therefore this entry's.
  const before = source.slice(0, hit.index);
  const idHit = [...before.matchAll(/"id"\s*:\s*(\d+)/g)].pop();
  if (!idHit) continue;

  const nameHit = [...before.matchAll(/"name"\s*:\s*"([^"]*)"/g)].pop();
  const clsHit = [...before.matchAll(/"type"\s*:\s*"([^"]*)"/g)].pop();

  // `hp` follows imageData in every entry, so it is read forwards from here,
  // stopping at the next entry's `"id":` so a missing array cannot borrow the
  // next building's.
  const after = source.slice(close, source.indexOf('"id"', close));
  const hpHit = /"hp"\s*:\s*\[([^\]]*)\]/.exec(after);
  const hp = hpHit
    ? hpHit[1]
        .split(",")
        .map((one) => Number(one.trim()))
        .filter((one) => Number.isFinite(one))
    : [];

  blocks.push({
    id: Number(idHit[1]),
    name: nameHit?.[1] ?? "",
    kind: clsHit?.[1] ?? "",
    hp,
    body,
    line: lineOf(hit.index),
  });
}

/** `["file.png", new Point(-30, -19)]` -> `{ file, x, y }`. */
const readImage = (level, key) => {
  const hit = new RegExp(
    `"${key}"\\s*:\\s*\\[\\s*"([^"]+)"\\s*,\\s*new Point\\(\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*\\)`,
  ).exec(level);
  if (!hit) return null;
  return { file: hit[1], x: Number(hit[2]), y: Number(hit[3]), w: 0, h: 0 };
};

/**
 * `["anim.1.png", new Rectangle(-46, -15, 90, 83), 15]` -> the same shape plus
 * the frame size.
 *
 * A few buildings — the Monster Bunker is the clearest — ship no still `top` at
 * all and are drawn entirely from an animation strip. The strip is a horizontal
 * run of `frames` cells of `w` x `h` (`BFOUNDATION.as:1495-1496`), and the
 * rectangle's x/y is the same top-left offset a Point would carry
 * (`BFOUNDATION.as:1250-1252` reads `[1].x`/`[1].y` either way). Recording the
 * frame size lets the web client draw cell 0 as a still.
 */
const readStrip = (level, key) => {
  const hit = new RegExp(
    `"${key}"\\s*:\\s*\\[\\s*"([^"]+)"\\s*,\\s*new Rectangle\\(\\s*(-?\\d+)\\s*,\\s*(-?\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)`,
  ).exec(level);
  if (!hit) return null;
  return {
    file: hit[1],
    x: Number(hit[2]),
    y: Number(hit[3]),
    w: Number(hit[4]),
    h: Number(hit[5]),
  };
};

/** The still image for a state, falling back to frame 0 of its strip. */
const readTop = (level, suffix) =>
  readImage(level, `top${suffix}`) ?? readStrip(level, `anim${suffix}`);

const entries = [];
const seen = new Set();

for (const block of blocks) {
  // The first props table in the file is the main yard's. Outpost and Inferno
  // tables live in their own files, but a few ids appear twice inside
  // YARD_PROPS itself; the first wins, matching `_buildingProps[id - 1]`.
  if (seen.has(block.id)) continue;
  seen.add(block.id);

  const baseurl = /"baseurl"\s*:\s*"([^"]*)"/.exec(block.body)?.[1];
  if (!baseurl) continue;

  // Each image level is `"<n>": { ... }` directly inside the block.
  const levels = [];
  const levelMarker = /"(\d+)"\s*:\s*\{/g;
  for (let hit = levelMarker.exec(block.body); hit; hit = levelMarker.exec(block.body)) {
    const open = hit.index + hit[0].length - 1;
    const close = matchBrace(block.body, open);
    const body = block.body.slice(open, close + 1);
    levelMarker.lastIndex = close;

    const top = readTop(body, "");
    if (!top) continue;

    levels.push({
      level: Number(hit[1]),
      top,
      damaged: readTop(body, "damaged"),
      destroyed: readTop(body, "destroyed"),
      shadow: readImage(body, "shadow"),
      shadowDamaged: readImage(body, "shadowdamaged"),
      shadowDestroyed: readImage(body, "shadowdestroyed"),
    });
  }

  if (levels.length === 0) continue;
  levels.sort((a, b) => a.level - b.level);

  entries.push({
    id: block.id,
    name: strings[block.name] ?? block.name.replaceAll("#", ""),
    kind: block.kind,
    baseurl,
    hp: block.hp,
    levels,
    line: block.line,
  });
}

entries.sort((a, b) => a.id - b.id);

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const image = (value) =>
  value === null
    ? "null"
    : value.w > 0
      ? `["${value.file}",${value.x},${value.y},${value.w},${value.h}]`
      : `["${value.file}",${value.x},${value.y}]`;

const level = (entry) =>
  `[${entry.level},${image(entry.top)},${image(entry.damaged)},${image(entry.destroyed)},` +
  `${image(entry.shadow)},${image(entry.shadowDamaged)},${image(entry.shadowDestroyed)}]`;

const body = entries
  .map(
    (entry) =>
      `  // ${entry.id} ${entry.name}${entry.kind ? ` (${entry.kind})` : ""} ` +
      `— YARD_PROPS.as:${entry.line}\n` +
      `  [${entry.id}, ${JSON.stringify(entry.name)}, ${JSON.stringify(entry.baseurl)}, [\n` +
      entry.levels.map((one) => `    ${level(one)},`).join("\n") +
      `\n  ], [${entry.hp.join(",")}]],`,
  )
  .join("\n");

const header = `/**
 * Building art, one row per building type. GENERATED — do not edit by hand.
 *
 * Source: \`client/scripts/YARD_PROPS.as\`, the \`imageData\` block of each entry
 * in \`_yardProps\` (declared at :9). Regenerate with
 * \`node tools/gen-building-art.mjs\` from \`web/\`.
 *
 * A row is \`[typeId, name, folder, levels]\`. \`folder\` is the \`baseurl\` the
 * Flash client prefixed every filename with, and is served by the game server
 * under \`/assets/\`. \`levels\` holds one entry per *image* level — the levels at
 * which the art changes, which is usually far fewer than the levels a building
 * can reach. A level with no entry of its own uses the nearest lower one; see
 * \`resolveArt\` in buildingArt.ts, mirroring \`BFOUNDATION.as:896-914\`.
 *
 * Each image is \`[file, offsetX, offsetY]\`, where the offset places the
 * bitmap's top-left corner relative to the building's isometric origin
 * (\`BFOUNDATION.as:1108-1111\`, \`:1250-1252\`). Shadows are JPEGs with no alpha
 * and are drawn with a multiply blend (\`BFOUNDATION.as:1108\`).
 */

/**
 * \`[file, offsetX, offsetY]\`, or null when this building has no such image.
 *
 * A fourth and fifth number mean the file is a horizontal animation strip and
 * only its first \`width\` x \`height\` cell should be drawn: a handful of
 * buildings, the Monster Bunker among them, ship no still art at all.
 */
export type ArtImage =
  | readonly [file: string, x: number, y: number]
  | readonly [file: string, x: number, y: number, width: number, height: number]
  | null;

/** \`[level, top, topDamaged, topDestroyed, shadow, shadowDamaged, shadowDestroyed]\`. */
export type ArtLevel = readonly [
  level: number,
  top: ArtImage,
  damaged: ArtImage,
  destroyed: ArtImage,
  shadow: ArtImage,
  shadowDamaged: ArtImage,
  shadowDestroyed: ArtImage,
];

export type ArtRow = readonly [
  type: number,
  name: string,
  folder: string,
  levels: readonly ArtLevel[],
  /** Maximum health per level, \`hp[level - 1]\`. Empty when the props table has none. */
  hp: readonly number[],
];

export const BUILDING_ART_ROWS: readonly ArtRow[] = [
`;

writeFileSync(OUT, `${header}${body}\n];\n`, "utf8");

/* ── Manifest ─────────────────────────────────────────────────────────────────
 * Which of the files the table names are actually on the game server's disk.
 * The unit tests read this rather than the filesystem, so they still mean
 * something when they run somewhere the server checkout is not.
 */

const folders = {};
const missing = [];

for (const entry of entries) {
  // Several types share one folder — every flower is `decorations/flowers/` —
  // so the listing accumulates rather than replacing what a previous type found.
  const present = folders[entry.baseurl]?.files ?? [];
  for (const level of entry.levels) {
    for (const image of [
      level.top,
      level.damaged,
      level.destroyed,
      level.shadow,
      level.shadowDamaged,
      level.shadowDestroyed,
    ]) {
      if (!image || present.includes(image.file)) continue;
      if (existsSync(resolve(ASSETS, entry.baseurl, image.file))) present.push(image.file);
      else missing.push(`${entry.id} ${entry.baseurl}${image.file}`);
    }
  }
  folders[entry.baseurl] = {
    exists: existsSync(resolve(ASSETS, entry.baseurl)),
    files: present.sort(),
  };
}

writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      note:
        "Generated by web/tools/gen-building-art.mjs. Which files named by " +
        "buildingArtData.ts exist under server/public/assets/.",
      assetRoot: "server/public/assets/",
      folders,
      missing: missing.sort(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`${entries.length} building types -> ${OUT}`);
console.log(`${Object.keys(folders).length} folders, ${missing.length} missing files -> ${MANIFEST}`);
console.log(
  entries
    .map((e) => `${e.id}\t${e.name}\t${e.baseurl}\t${e.levels.map((l) => l.level).join(",")}`)
    .join("\n"),
);
