/**
 * Regenerates `src/game/attack/monsterSpriteData.ts` from the Flash client's
 * sprite table.
 *
 *   cd web && node tools/gen-monster-sprites.mjs
 *
 * The source of truth is `client/scripts/SPRITES.as`. `Setup()` (`:17-96`)
 * declares one `SpriteData(file, frameWidth, frameHeight, anchorX, anchorY)`
 * per sheet, and `GetSprite()` (`:119-375`) holds the drawing rules: which
 * column a heading maps to and which row an animation state reads. The sheet
 * lines are parsed; the `GetSprite` rules are a branch-per-creature `if`
 * ladder that no regex can read honestly, so they are transcribed below in
 * `RULES` with the line each one came from, and `checkSource` asserts the
 * expressions they were transcribed from are still in the file.
 *
 * Every sheet named is checked against `server/public/assets/monsters/` and
 * its PNG header is read for the pixel size, so the table records how many
 * columns and rows a sheet really has. A missing file, or a size that is not a
 * whole multiple of the frame size and is not listed in `KNOWN_SLACK`, stops
 * the generator.
 *
 * Nothing here runs in the browser and nothing in the client imports it.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const SPRITES = resolve(repo, "client/scripts/SPRITES.as");
const SPRITE_DATA = resolve(repo, "client/scripts/com/monsters/display/SpriteData.as");
const CHAMPIONCAGE = resolve(repo, "client/scripts/CHAMPIONCAGE.as");
const CREATURELOCKER = resolve(repo, "client/scripts/CREATURELOCKER.as");
const CREEP_BASE = resolve(repo, "client/scripts/com/monsters/monsters/creeps/CreepBase.as");
const CHAMPION_BASE = resolve(
  repo,
  "client/scripts/com/monsters/monsters/champions/ChampionBase.as",
);
const MONSTER_BASE = resolve(repo, "client/scripts/com/monsters/monsters/MonsterBase.as");
const ASSETS = resolve(repo, "server/public/assets");
const OUT = resolve(here, "../src/game/attack/monsterSpriteData.ts");

const sprites = readFileSync(SPRITES, "utf8");
const lineOf = (index) => sprites.slice(0, index).split("\n").length;

/* ── Source tripwires ─────────────────────────────────────────────────────── */

/**
 * Fails when a Flash expression a rule below was transcribed from is no longer
 * in the file. The rules cannot be parsed, so this is what keeps them honest
 * against an edit to the decompiled source.
 */
const checkSource = (path, text, needle, what) => {
  if (!text.includes(needle)) {
    throw new Error(`${path}: expected to find ${what}: ${JSON.stringify(needle)}`);
  }
};

const championBase = readFileSync(CHAMPION_BASE, "utf8");
const monsterBase = readFileSync(MONSTER_BASE, "utf8");
const creepBase = readFileSync(CREEP_BASE, "utf8");

// Heading: screen-space atan2 in degrees, normalised to [0, 360).
checkSource(
  MONSTER_BASE,
  monsterBase,
  "this._targetRotation = Math.atan2(this._yd, this._xd) * 57.2957795 - 90;",
  "the heading formula (MonsterBase.as:591)",
);
checkSource(MONSTER_BASE, monsterBase, "this._targetRotation += 90;", "the +90 (MonsterBase.as:608)");
checkSource(MONSTER_BASE, monsterBase, "this.m_rotation %= 360;", "the wrap (MonsterBase.as:613)");
checkSource(MONSTER_BASE, monsterBase, "this._frameNumber += 1;", "the tick counter (MonsterBase.as:558)");
// Champions subtract 45 degrees before the 22.5 degree column split.
checkSource(
  CHAMPION_BASE,
  championBase,
  '"walking", m_rotation - 45, _frameNumber)',
  "the champion 45 degree offset (ChampionBase.as:1545)",
);
// Flyer bob and shadow canvases.
checkSource(CREEP_BASE, creepBase, "Math.sin(_frameNumber / 50) * 5", "the flyer bob (CreepBase.as:262)");
checkSource(CREEP_BASE, creepBase, "_shadowMC.x = -21;", "the creep shadow canvas x (CreepBase.as:123)");
checkSource(CREEP_BASE, creepBase, "_shadowMC.y = -16;", "the creep shadow canvas y (CreepBase.as:124)");
checkSource(CHAMPION_BASE, championBase, "_shadowMC.y = -26;", "the champion shadow canvas y (ChampionBase.as:236)");
// The GetSprite branches each rule was read from.
for (const [needle, what] of [
  ["param4 = 360 + param4;", "negative heading wrap (:128)"],
  ["GetFrame(param1, _sprites.worker, param4 / 12, 1);", "worker hard-hat row (:134)"],
  ["GetFrame(param1, _sprites.C9, param4 / 12, 1);", "C9 invisible row (:145)"],
  ["GetFrame(param1, _sprites.C12, param4 * 0.083333333);", "C12 1/12 (:156)"],
  ["GetFrame(param1, _sprites.C13, param4 / 12, 4);", "C13 burrowed row (:169)"],
  ["GetFrame(param1, _sprites.C14, int(param4 / 11.25), param5 % 9 / 3);", "C14 flap (:182)"],
  ["GetFrame(param1, _sprites.C16, int(param4 / 11.25), param5 % 9 / 3);", "C16 flap (:188)"],
  ["GetFrame(param1, _sprites.C19, param4 / 12, 1);", "C19 idle row (:195)"],
  ["GetFrame(param1, _sprites.C19, param4 / 12, param5 / 8 % 5 + 1);", "C19 moving rows (:200)"],
  ["GetFrame(param1, _sprites.C15, int(param4 / 11.25));", "C15 32 directions (:207)"],
  ["GetFrame(param1, _sprites.IC1, param4 / 11.25, param5 / 8 % 2 + 1);", "IC1 walk rows (:213)"],
  ["GetFrame(param1, _sprites.IC3, param4 / 12, param5 / 8 % 8 + 1);", "IC3 walk rows (:219)"],
  ["GetFrame(param1, _sprites.IC5, param4 / 12, param5 / 8 % 6 + 1);", "IC5 walk rows (:225)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 7 + 1);", "G1/G2 walk (:235)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 8 + 8);", "G1/G2 L4+ attack (:239)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 7 + 8);", "G1/G2 L1-3 attack (:242)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 8 + 1);", "G3 L2 walk (:257)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 6 + 1);", "G3 L3+ walk (:260)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % _loc9_ + 0);", "G4 walk (:277)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % 10 + 20);", "G4 stomp (:308)"],
  ["GetFrame(param1, _sprites[param2], int(param4 / 22.5), param5 / 8 % _loc9_ + _loc10_);", "G4/G5 attack (:305, :333)"],
  ["GetFrame(param1, _sprites.C200, param4 / 12, 1);", "C200 carrying row (:351)"],
  ["GetFrame(param1, _sprites.rocket, param4 / 11.25);", "rocket 32 directions (:357)"],
  ["GetFrame(param1, _sprites[param2], param4 / 12);", "default 30 directions, row 0 (:369)"],
]) {
  checkSource(SPRITES, sprites, needle, what);
}

/* ── SpriteData lines ─────────────────────────────────────────────────────── */

/** `FUBAR_X` and `FUBAR_Y`, the canvas point a cell's anchor is copied to. */
const fubar = {};
for (const hit of readFileSync(SPRITE_DATA, "utf8").matchAll(
  /public static const (FUBAR_[XY]):int = (\d+);/g,
)) {
  fubar[hit[1]] = Number(hit[2]);
}
if (fubar.FUBAR_X === undefined || fubar.FUBAR_Y === undefined) {
  throw new Error(`${SPRITE_DATA}: FUBAR_X / FUBAR_Y not found`);
}

/** `SpriteData.FUBAR_Y - 21` -> 15. Only `const`, `const + n` and `const - n` occur. */
const evalArg = (text) => {
  const expr = text.trim().replace(/SpriteData\.(FUBAR_[XY])/g, (_, name) => String(fubar[name]));
  const hit = /^(-?[\d.]+)(?:\s*([+-])\s*([\d.]+))?$/.exec(expr);
  if (!hit) throw new Error(`Cannot evaluate SpriteData argument ${JSON.stringify(text)}`);
  const base = Number(hit[1]);
  if (!hit[2]) return base;
  return hit[2] === "+" ? base + Number(hit[3]) : base - Number(hit[3]);
};

/**
 * Every `_sprites.<key> = new SpriteData("<file>", w, h, ax, ay)` line.
 *
 * Entries keyed by a constant (`_sprites[Jars.JAR_GRAPHIC]`) or naming a
 * file outside `monsters/` are siege weapons and status icons, not monsters,
 * and are counted but left out. `worker` is declared twice, once per yard
 * type (`:19-24`); the Inferno one is keyed `infernoWorker` here.
 */
const declared = [];
let skipped = 0;
const setup = sprites.slice(sprites.indexOf("public static function Setup()"), sprites.indexOf("public static function Clear()"));
const setupOffset = sprites.indexOf(setup);
for (const hit of setup.matchAll(
  /_sprites(?:\.(\w+)|\[[^\]]+\]) = new SpriteData\(\s*("([^"]+)"|[^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\);/g,
)) {
  const file = hit[3];
  if (!hit[1] || !file || !file.startsWith("monsters/")) {
    skipped++;
    continue;
  }
  let key = hit[1];
  if (key === "worker" && file.startsWith("monsters/inferno_")) key = "infernoWorker";
  if (declared.some((one) => one.key === key)) throw new Error(`Duplicate sprite key ${key}`);
  declared.push({
    key,
    file,
    frameWidth: evalArg(hit[4]),
    frameHeight: evalArg(hit[5]),
    anchorX: evalArg(hit[6]),
    anchorY: evalArg(hit[7]),
    line: lineOf(setupOffset + hit.index),
  });
}
if (declared.length === 0) throw new Error(`${SPRITES}: no SpriteData lines matched`);

/* ── Champion offsets and movement ────────────────────────────────────────── */

/**
 * `CHAMPIONCAGE.as` per-champion property arrays, indexed by level with the
 * last entry reused above the array's length (`GetGuardianProperty`,
 * `CHAMPIONCAGE.as:401-416`).
 *
 * The champion `SpriteData` anchors are all `FUBAR_X, FUBAR_Y`, which makes
 * the copy offset zero, and the one-cell canvas is instead placed at the
 * level's `offset_x`/`offset_y` (`ChampionBase.as:239-243`, `:752-757`). The
 * cell's top-left therefore sits at `position + offset`, so the effective
 * anchor is `-offset`. Krallen (G5) indexes by power level rather than level
 * (`Krallen.as:48`, `ChampionBase.as:736`), which is what its sheet number is.
 */
const guardians = {};
{
  const cage = readFileSync(CHAMPIONCAGE, "utf8");
  const readArray = (block, key) => {
    const hit = new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*)\\]`).exec(block);
    if (!hit) throw new Error(`${CHAMPIONCAGE}: no "${key}" array`);
    return hit[1].split(",").map((one) => one.trim().replaceAll('"', ""));
  };
  const marker = /"(G\d)"\s*:\s*\{/g;
  for (let hit = marker.exec(cage); hit; hit = marker.exec(cage)) {
    const next = cage.slice(hit.index + hit[0].length).search(/"G\d"\s*:\s*\{/);
    const block = cage.slice(hit.index, next < 0 ? undefined : hit.index + hit[0].length + next);
    guardians[hit[1]] = {
      offsetX: readArray(block, "offset_x").map(Number),
      offsetY: readArray(block, "offset_y").map(Number),
      movement: readArray(block, "movement"),
      levels: readArray(block, "health").length,
      line: cage.slice(0, hit.index).split("\n").length,
    };
  }
}
if (Object.keys(guardians).length !== 5) {
  throw new Error(`${CHAMPIONCAGE}: expected G1-G5, found ${Object.keys(guardians).join(",")}`);
}
const guardianProperty = (values, level) => values[Math.min(level, values.length) - 1];

/**
 * `"movement"` per creep from `CREATURELOCKER.as`, `"ground"` when absent.
 * Flight is what decides whether a shadow sheet is drawn
 * (`CreepBase.as:118-125`).
 */
const creepMovement = {};
{
  const locker = readFileSync(CREATURELOCKER, "utf8");
  const marker = /"((?:I?C)\d+)"\s*:\s*\{/g;
  for (let hit = marker.exec(locker); hit; hit = marker.exec(locker)) {
    const next = locker.slice(hit.index + hit[0].length).search(/"(?:I?C)\d+"\s*:\s*\{/);
    const block = locker.slice(hit.index, next < 0 ? undefined : hit.index + hit[0].length + next);
    const movement = /"movement"\s*:\s*"(\w+)"/.exec(block);
    creepMovement[hit[1]] = movement ? movement[1] : "ground";
  }
}
if (creepMovement.C14 !== "fly" || creepMovement.C13 !== "burrow") {
  throw new Error(`${CREATURELOCKER}: movement parse looks wrong (${JSON.stringify(creepMovement)})`);
}

/* ── Drawing rules, transcribed from GetSprite ────────────────────────────── */

/**
 * A run of rows: `first + floor(tick / ticksPerFrame) % count`.
 *
 * Nearly every cycle steps every 8 ticks (`param5 / 8 % n`); the Teratorn and
 * Vorg wing flap is `param5 % 9 / 3`, which is the same as stepping every 3.
 */
const cycle = (first, count, ticksPerFrame = 8) => ({ first, count, ticksPerFrame });
const STILL = cycle(0, 1);

/** A creep that falls through to the default branch: 30 headings, row 0 (`:367-372`). */
const DEFAULT_RULE = { directions: 30, directionOffset: 0, animations: { walk: STILL }, line: 369 };

/**
 * Per-key rules. Flash's action strings map onto the web client's animation
 * names as: `walking`, `flying`, `moving`, `empty` -> `walk`; `idle` -> `idle`;
 * the attack mode -> `attack`; `stomp`, `invisible`, `landed` keep their name;
 * the worker's `BST` hard-hat row is `hardhat`; the looter's loaded row is
 * `carrying`.
 *
 * Champion families take a level (the sheet number) because their attack and
 * walk cycles lengthen at higher levels.
 */
const RULES = {
  worker: { directions: 30, directionOffset: 0, animations: { walk: STILL, hardhat: cycle(1, 1) }, line: 130 },
  infernoWorker: { directions: 30, directionOffset: 0, animations: { walk: STILL, hardhat: cycle(1, 1) }, line: 130 },
  C9: { directions: 30, directionOffset: 0, animations: { walk: STILL, invisible: cycle(1, 1) }, line: 142 },
  C12: { directions: 30, directionOffset: 0, animations: { walk: STILL }, line: 154 },
  // `burrowed` reads row 4 and `transition` rows 1-3 (:167-178) of a sheet
  // that has one row; see OFF_SHEET.
  C13: {
    directions: 30,
    directionOffset: 0,
    animations: { walk: STILL, burrowed: cycle(4, 1), transition: cycle(1, 3) },
    line: 160,
  },
  C14: { directions: 32, directionOffset: 0, animations: { walk: cycle(0, 3, 3), landed: STILL }, line: 180 },
  C16: { directions: 32, directionOffset: 0, animations: { walk: cycle(0, 3, 3), landed: STILL }, line: 186 },
  C19: { directions: 30, directionOffset: 0, animations: { idle: cycle(1, 1), walk: cycle(1, 5) }, line: 192 },
  C15: { directions: 32, directionOffset: 0, animations: { walk: STILL }, line: 205 },
  IC1: { directions: 32, directionOffset: 0, animations: { walk: cycle(1, 2) }, line: 211 },
  IC3: { directions: 30, directionOffset: 0, animations: { walk: cycle(1, 8) }, line: 217 },
  IC5: { directions: 30, directionOffset: 0, animations: { walk: cycle(1, 6) }, line: 223 },
  shadow: { directions: 1, directionOffset: 0, animations: { walk: STILL }, line: 338 },
  bigshadow: { directions: 1, directionOffset: 0, animations: { walk: STILL }, line: 342 },
  C200: { directions: 30, directionOffset: 0, animations: { walk: STILL, carrying: cycle(1, 1) }, line: 346 },
  rocket: { directions: 32, directionOffset: 0, animations: { walk: STILL }, line: 355 },
};

/** Champion rules by family and sheet number. All 16 headings, 45 degrees off. */
const CHAMPION_RULES = {
  // Gorgo and Drull: idle row 0, walk 1-7, attack 8-14 (levels 1-3) or 8-15 (4-6).
  G1: (level) => ({
    directions: 16,
    directionOffset: 45,
    animations: { idle: STILL, walk: cycle(1, 7), attack: level >= 4 ? cycle(8, 8) : cycle(8, 7) },
    line: 229,
  }),
  G2: (level) => CHAMPION_RULES.G1(level),
  // Fomor: idle row 0; anything else is the walk cycle, whose length is per level (:248-264).
  G3: (level) => ({
    directions: 16,
    directionOffset: 45,
    animations: { idle: STILL, walk: level === 1 ? cycle(1, 7) : level === 2 ? cycle(1, 8) : cycle(1, 6) },
    line: 248,
  }),
  // Korath: walk from row 0, attack starts where the walk ends, stomp rows 20-29 (:265-313).
  G4: (level) => {
    const walk = level >= 4 ? 10 : level === 3 ? 9 : 8;
    const attack = level >= 4 ? cycle(10, 10) : level === 3 ? cycle(9, 10) : cycle(8, 9);
    return {
      directions: 16,
      directionOffset: 45,
      animations: { idle: STILL, walk: cycle(0, walk), attack, stomp: cycle(20, 10) },
      line: 265,
    };
  },
  // Krallen: idle and walk share rows 0-9, attack rows 10-15 (:314-337).
  G5: () => ({
    directions: 16,
    directionOffset: 45,
    animations: { idle: cycle(0, 10), walk: cycle(0, 10), attack: cycle(10, 6) },
    line: 314,
  }),
};

/**
 * Cycles Flash asks for that the sheet does not hold. `copyPixels` with a
 * rectangle past the bitmap's edge copies nothing, so the Flash client kept
 * whatever frame was last drawn; the table simply omits them. Anything else
 * that reads past a sheet is an error.
 */
const OFF_SHEET = new Set([
  "infernoWorker.hardhat",
  "C13.burrowed",
  "C13.transition",
  "G4_1.stomp",
  "G4_2.stomp",
  "G4_3.stomp",
  "G4_4.stomp",
]);

/**
 * Cycles that run one row past the end of their sheet. Korath's level 3 attack
 * asks for rows 9-18 (`:293-296`) of an 18-row sheet, so its last step copies
 * nothing and the ninth frame is held for another 8 ticks. The table keeps
 * the rows that exist and drops the phantom one.
 */
const TRIM = new Set(["G4_3.attack"]);

/**
 * Sheets whose pixel size is not a whole multiple of the frame size, with the
 * leftover the generator must find: positive is unused padding after the last
 * column or row, negative is a last row or column cut short. Rows and columns
 * are rounded rather than floored so the Project X sheet, one pixel short of
 * its single row, still counts as one row.
 */
const KNOWN_SLACK = {
  "monsters/sprite.11.v2.png": { x: 0, y: -1 },
  "monsters/13.png": { x: 0, y: 1 },
  "monsters/slimeattikusmini_anim.png": { x: 0, y: -4 },
  "monsters/zagnoid.png": { x: 1, y: 0 },
  "monsters/grokus.v2.png": { x: 8, y: 0 },
};

/**
 * The skin sheets `CreepSkinManager` can substitute for a creature: only the
 * Golden D.A.V.E. subscription reward (`GoldenDAVEReward.as:12-20`).
 */
const SKINS = { C12: ["C12Gold"] };

/* ── PNG headers ──────────────────────────────────────────────────────────── */

/**
 * A PNG's pixel size from its IHDR chunk: eight signature bytes, a four-byte
 * length, `IHDR`, then width and height as big-endian 32-bit integers.
 */
const pngSize = (path) => {
  const head = Buffer.alloc(24);
  const handle = openSync(path, "r");
  try {
    if (readSync(handle, head, 0, 24, 0) < 24) throw new Error(`${path}: too short to be a PNG`);
  } finally {
    closeSync(handle);
  }
  if (head.toString("latin1", 1, 4) !== "PNG" || head.toString("latin1", 12, 16) !== "IHDR") {
    throw new Error(`${path}: not a PNG`);
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
};

/* ── Assemble ─────────────────────────────────────────────────────────────── */

const entries = [];
const problems = [];
const mismatches = [];

for (const sheet of declared) {
  const path = resolve(ASSETS, sheet.file);
  if (!existsSync(path)) {
    problems.push(`${sheet.key}: ${sheet.file} is not under server/public/assets/`);
    continue;
  }
  const { width, height } = pngSize(path);
  const columns = Math.round(width / sheet.frameWidth);
  const rows = Math.round(height / sheet.frameHeight);
  const slack = {
    x: Number((width - columns * sheet.frameWidth).toFixed(3)),
    y: Number((height - rows * sheet.frameHeight).toFixed(3)),
  };
  const known = KNOWN_SLACK[sheet.file];
  if (slack.x !== 0 || slack.y !== 0) {
    if (!known || known.x !== slack.x || known.y !== slack.y) {
      problems.push(
        `${sheet.key}: ${sheet.file} is ${width}x${height} but frames are ` +
          `${sheet.frameWidth}x${sheet.frameHeight}: ${columns} columns and ${rows} rows leave ` +
          `${slack.x}x${slack.y} px, not in KNOWN_SLACK`,
      );
      continue;
    }
  } else if (known) {
    problems.push(`${sheet.key}: ${sheet.file} divides evenly; drop it from KNOWN_SLACK`);
    continue;
  }

  const family = /^(G\d)_(\d)$/.exec(sheet.key);
  let rule;
  let anchorX = sheet.anchorX;
  let anchorY = sheet.anchorY;
  let movement = "ground";
  if (family) {
    const guardian = guardians[family[1]];
    const level = Number(family[2]);
    rule = CHAMPION_RULES[family[1]](level);
    if (anchorX !== fubar.FUBAR_X || anchorY !== fubar.FUBAR_Y) {
      problems.push(`${sheet.key}: champion anchor is not FUBAR; the CHAMPIONCAGE offsets no longer apply cleanly`);
      continue;
    }
    anchorX = -guardianProperty(guardian.offsetX, level);
    anchorY = -guardianProperty(guardian.offsetY, level);
    movement = guardianProperty(guardian.movement, level);
  } else {
    rule = RULES[sheet.key] ?? DEFAULT_RULE;
    movement = creepMovement[sheet.key] ?? "ground";
  }

  // Which shadow sheet, if any: `CreepBase.as:1709-1728` draws `shadow` for
  // IC5, C14 and C16, `bigshadow` for C15, and `ChampionBase.as:1547-1549`
  // `bigshadow` for a flying champion. Rezghul asks for one too
  // (`Rezghul.as:65`) but never gets a shadow canvas because it walks
  // (`CreepBase.as:118-121`), so flight is the real condition.
  const flies = movement === "fly" || movement === "fly_low";
  const shadow = !flies ? null : sheet.key === "C15" || family ? "bigshadow" : "shadow";

  const animations = {};
  for (const [name, one] of Object.entries(rule.animations)) {
    const tag = `${sheet.key}.${name}`;
    if (TRIM.has(tag)) {
      if (one.first + one.count <= rows || one.first >= rows) {
        problems.push(`${tag}: does not overrun the ${rows}-row sheet; drop it from TRIM`);
        continue;
      }
      animations[name] = cycle(one.first, rows - one.first, one.ticksPerFrame);
      continue;
    }
    const fits = one.first + one.count <= rows;
    if (!fits && OFF_SHEET.has(tag)) continue;
    if (!fits) {
      problems.push(`${tag}: rows ${one.first}-${one.first + one.count - 1} read past a ${rows}-row sheet`);
      continue;
    }
    if (OFF_SHEET.has(tag)) {
      problems.push(`${tag}: fits the sheet after all; drop it from OFF_SHEET`);
      continue;
    }
    animations[name] = one;
  }

  if (rule.directions !== columns && rule.directions !== 1) {
    mismatches.push(`${sheet.key}: GetSprite reads ${rule.directions} headings from a ${columns}-column sheet`);
  }

  entries.push({
    key: sheet.key,
    family: family ? family[1] : sheet.key,
    file: sheet.file,
    width,
    height,
    frameWidth: sheet.frameWidth,
    frameHeight: sheet.frameHeight,
    columns,
    rows,
    anchorX,
    anchorY,
    directions: rule.directions,
    directionOffset: rule.directionOffset,
    animations,
    movement,
    shadow,
    skins: SKINS[sheet.key] ?? [],
    line: sheet.line,
    ruleLine: rule.line,
  });
}

for (const key of Object.keys(RULES)) {
  if (!entries.some((one) => one.key === key)) problems.push(`RULES.${key} names a sheet SPRITES.as no longer declares`);
}
for (const skins of Object.values(SKINS)) {
  for (const skin of skins) {
    if (!entries.some((one) => one.key === skin)) problems.push(`skin ${skin} is not a declared sheet`);
  }
}
for (const tag of OFF_SHEET) {
  if (!entries.some((one) => one.key === tag.split(".")[0])) problems.push(`OFF_SHEET ${tag} names no sheet`);
}

if (problems.length > 0) {
  console.error(problems.map((one) => `  - ${one}`).join("\n"));
  throw new Error(`${problems.length} problem(s) in the sprite table; nothing written`);
}

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const cycleText = (one) => `{ first: ${one.first}, count: ${one.count}, ticksPerFrame: ${one.ticksPerFrame} }`;

const entryText = (entry) => {
  const animations = Object.entries(entry.animations)
    .map(([name, one]) => `      ${name}: ${cycleText(one)},`)
    .join("\n");
  return (
    `  // SPRITES.as:${entry.line}, rules :${entry.ruleLine}\n` +
    `  ${entry.key}: {\n` +
    `    key: "${entry.key}",\n` +
    `    family: "${entry.family}",\n` +
    `    file: "${entry.file}",\n` +
    `    width: ${entry.width},\n` +
    `    height: ${entry.height},\n` +
    `    frameWidth: ${entry.frameWidth},\n` +
    `    frameHeight: ${entry.frameHeight},\n` +
    `    columns: ${entry.columns},\n` +
    `    rows: ${entry.rows},\n` +
    `    anchorX: ${entry.anchorX},\n` +
    `    anchorY: ${entry.anchorY},\n` +
    `    directions: ${entry.directions},\n` +
    `    directionOffset: ${entry.directionOffset},\n` +
    `    animations: {\n${animations}\n    },\n` +
    `    movement: "${entry.movement}",\n` +
    `    shadow: ${entry.shadow === null ? "null" : `"${entry.shadow}"`},\n` +
    `    skins: [${entry.skins.map((one) => `"${one}"`).join(", ")}],\n` +
    `  },`
  );
};

const header = `/**
 * Monster sprite sheets, one entry per sheet. GENERATED — do not edit by hand.
 *
 * Source: \`client/scripts/SPRITES.as\`, the \`SpriteData\` lines in \`Setup()\`
 * (\`:17-96\`) and the drawing rules in \`GetSprite()\` (\`:119-375\`), with the
 * champion anchors from \`client/scripts/CHAMPIONCAGE.as\` and each creep's
 * movement from \`client/scripts/CREATURELOCKER.as\`. Regenerate with
 * \`npm run gen:monster-sprites\` from \`web/\`.
 *
 * A sheet is a grid of \`frameWidth\` x \`frameHeight\` cells. Columns are
 * headings and rows are animation frames (\`SPRITES.as:377-381\`): cell
 * \`(column, row)\` is the rectangle at \`(column * frameWidth, row * frameHeight)\`.
 * \`columns\` and \`rows\` are what the PNG on disk really holds; \`directions\`
 * is how many headings \`GetSprite\` splits the circle into, which for a few
 * sheets is not the same number. \`anchorX\`/\`anchorY\` is the pixel of the cell
 * that sits on the monster's ground point. The helpers in \`monsterSprites.ts\`
 * turn a heading and a tick into a cell.
 */

/** The animation states the table distinguishes. Absent ones fall back; see \`frameRow\`. */
export type MonsterAnimation =
  | "idle"
  | "walk"
  | "attack"
  | "stomp"
  | "invisible"
  | "landed"
  | "carrying"
  | "hardhat"
  | "burrowed"
  | "transition";

/** A run of rows: \`first + floor(tick / ticksPerFrame) % count\`. */
export interface RowCycle {
  readonly first: number;
  readonly count: number;
  readonly ticksPerFrame: number;
}

export interface MonsterSheet {
  /** The \`SPRITES.as\` key: \`C1\`, \`IC3\`, \`G1_4\`, \`shadow\`. */
  readonly key: string;
  /** \`G1\` for \`G1_4\`; the key itself otherwise. */
  readonly family: string;
  /** Path under the game server's \`/assets/\`. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** Fractional for one sheet (Zagnoid, 64.4). */
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly anchorX: number;
  readonly anchorY: number;
  /** Headings around the circle: 30, 32, 16, or 1 for a shadow. */
  readonly directions: number;
  /** Degrees subtracted from the heading before it is split into columns; 45 for champions. */
  readonly directionOffset: number;
  readonly animations: Readonly<Partial<Record<MonsterAnimation, RowCycle>>>;
  /** \`ground\`, \`fly\`, \`burrow\` or \`jump\` as the creature table has it. */
  readonly movement: string;
  /** The shadow sheet a flyer draws under itself, or null. */
  readonly shadow: "shadow" | "bigshadow" | null;
  /** Sheet keys a skin may swap in for this one. */
  readonly skins: readonly string[];
}

export const MONSTER_SPRITES: Readonly<Record<string, MonsterSheet>> = {
`;

writeFileSync(OUT, `${header}${entries.map(entryText).join("\n")}\n};\n`, "utf8");

const skins = new Set(Object.values(SKINS).flat());
const creatures = new Set(
  entries.filter((one) => /^(I?C\d+|G\d)/.test(one.family) && !skins.has(one.key)).map((one) => one.family),
);
console.log(`${entries.length} sheets, ${creatures.size} creatures, ${skipped} non-monster SpriteData lines skipped -> ${OUT}`);
for (const one of mismatches) console.log(`note: ${one}`);
