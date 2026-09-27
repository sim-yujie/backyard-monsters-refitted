/**
 * Regenerates the monster catalogue from the Flash client's monster tables.
 *
 *   cd web && npm run gen:monster-catalogue
 *   cd web && node tools/gen-monster-catalogue.mjs --check     (compare, write nothing)
 *
 * The catalogue is what the Monsters screen shows and what the server's
 * locker, hatchery, academy and lab routes charge: per monster the unlock price
 * and time, the Monster Locker level it needs, whether it is obtainable, its
 * place in the lists, the academy training ladder and the per-level hatch cost,
 * hatch time and housing space; plus the Monster Lab's ten abilities
 * (`docs/design/yard-buildings.md` §4.2).
 *
 * What it reads, and from where:
 *
 * | Table               | Source                                                  |
 * |---------------------|---------------------------------------------------------|
 * | `MONSTER_CATALOGUE` | `client/scripts/CREATURELOCKER.as`, `_mainCreatures`    |
 * | `LAB_ABILITIES`     | `client/scripts/MONSTERLAB.as`, `_powerupProps`         |
 * | names, descriptions | `server/public/gamestage/assets/english.json`, the live |
 * |                     | string table (the archived `en.v612.txt` lacks the      |
 * |                     | C16-C19 names and every lab string)                     |
 *
 * Only the surface monsters `C1`..`C19` are written. `C200` is the AI looter
 * the client excludes from every list (`CREATURELOCKER.as:1095`) and the
 * Inferno roster (`IC1`..`IC8`) is out of scope (decision D19).
 *
 * Decision D7 re-enables Vorg (`C16`), Slimeattikus (`C17`) and Rezghul
 * (`C19`): all three are written `blocked: false`. Rezghul also has no list
 * place in the source (`page: 0`, `order: 0`, so the Flash locker never showed
 * it even unblocked); it is given page 4, order 4, the one free slot, after
 * D.A.V.E. Slimeattikus Mini (`C18`) is only ever spawned by a dying `C17`
 * (`fake: true`, `dependent: "C17"`), so it stays `blocked` and carries
 * `spawnedBy: "C17"`.
 *
 * The object literals are read with a small strict parser rather than with
 * regexes or `eval`: anything it does not recognise — a new field type, an
 * expression it cannot fold, an id added or removed, a missing field — stops
 * the run with the file and line, so a changed source can never quietly emit a
 * zero price or a short ladder.
 *
 * Two files are written, byte for byte identical:
 *
 *   web/src/game/monsters/monsterCatalogue.ts
 *   server/src/game-data/monsterCatalogue.ts
 *
 * Both import nothing, so the same text compiles in either package; the sync
 * tests beside each copy fail if the two ever differ. `--check` regenerates in
 * memory and exits 1 if either file on disk is stale, and `--scripts <dir>`
 * reads the two `.as` files from another directory (the generator's own test
 * uses both). Line endings are compared normalised, because worktrees check
 * files out with CRLF.
 *
 * Nothing here runs in the browser and nothing in `src/` imports it.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const scriptsAt = args.indexOf("--scripts");
const SCRIPTS =
  scriptsAt >= 0 ? resolve(args[scriptsAt + 1] ?? "") : resolve(repo, "client/scripts");

const LOCKER = resolve(SCRIPTS, "CREATURELOCKER.as");
const LAB = resolve(SCRIPTS, "MONSTERLAB.as");
const STRINGS = resolve(repo, "server/public/gamestage/assets/english.json");
const WEB_OUT = resolve(here, "../src/game/monsters/monsterCatalogue.ts");
const SERVER_OUT = resolve(repo, "server/src/game-data/monsterCatalogue.ts");

const strings = JSON.parse(readFileSync(STRINGS, "utf8"));

/* ── A strict reader for AS3 object literals ─────────────────────────────── */

/** Thrown for anything the source says that this generator does not expect. */
class ShapeError extends Error {}

// A shape error is the expected way to fail: print where, not a stack trace.
process.on("uncaughtException", (error) => {
  if (!(error instanceof ShapeError)) throw error;
  console.error(`gen-monster-catalogue: ${error.message}`);
  process.exit(1);
});

const fail = (file, line, message) => {
  throw new ShapeError(`${file.split(/[\\/]/).pop()}:${line}: ${message}`);
};

/**
 * Tokens of `text`, each with the 1-based line it starts on.
 *
 * Understands exactly what the two tables use: punctuation, double-quoted
 * strings without escapes, decimal numbers, identifiers, and `//` and `/* *\/`
 * comments (Rezghul's block carries a few).
 */
const tokenize = (text, file, firstLine) => {
  const tokens = [];
  let line = firstLine;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) fail(file, line, "unterminated block comment");
      for (let k = i; k < end; k++) if (text[k] === "\n") line++;
      i = end + 2;
    } else if ("{}[]:,*/+-()".includes(c)) {
      tokens.push({ kind: c, line });
      i++;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0 || text.slice(i + 1, end).includes("\n"))
        fail(file, line, "unterminated string");
      if (text.slice(i + 1, end).includes("\\"))
        fail(file, line, "escaped string not supported");
      tokens.push({ kind: "string", value: text.slice(i + 1, end), line });
      i = end + 1;
    } else if (/[0-9.]/.test(c)) {
      const hit = /^(?:\d+\.?\d*|\.\d+)/.exec(text.slice(i));
      tokens.push({ kind: "number", value: Number(hit[0]), line });
      i += hit[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const hit = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(i));
      tokens.push({ kind: "ident", value: hit[0], line });
      i += hit[0].length;
    } else {
      fail(file, line, `unexpected character ${JSON.stringify(c)}`);
    }
  }
  return tokens;
};

/** A reference to a class or constant, e.g. `"classType": Bolt`. Never emitted. */
class Ident {
  constructor(name) {
    this.name = name;
  }
}

/**
 * Parses one object literal from `tokens` and returns `{ value, lines }`, where
 * `lines[key]` is the line each top-level key sits on (for the citations).
 *
 * Arithmetic (`60 * 60 * 2`, `3000000 / 3`) is folded; an operand that is not a
 * number is refused. A repeated key keeps its last value, as AS3 does (Vorg
 * spells `"blocked": true` twice).
 */
const parseLiteral = (tokens, file) => {
  let at = 0;
  const lines = {};
  const peek = () => tokens[at];
  const next = () => {
    const token = tokens[at++];
    if (!token) fail(file, tokens[tokens.length - 1]?.line ?? 0, "unexpected end of table");
    return token;
  };
  const expect = (kind) => {
    const token = next();
    if (token.kind !== kind) fail(file, token.line, `expected ${kind}, found ${token.kind}`);
    return token;
  };

  const object = (depth) => {
    expect("{");
    const out = {};
    while (peek()?.kind !== "}") {
      const key = next();
      if (key.kind !== "string" && key.kind !== "ident") fail(file, key.line, "expected a key");
      expect(":");
      out[key.value] = value(depth + 1);
      if (depth === 0) lines[key.value] = key.line;
      if (peek()?.kind === ",") next();
      else if (peek()?.kind !== "}") fail(file, peek()?.line ?? key.line, "expected , or }");
    }
    next();
    return out;
  };

  const array = (depth) => {
    expect("[");
    const out = [];
    while (peek()?.kind !== "]") {
      out.push(value(depth + 1));
      if (peek()?.kind === ",") next();
      else if (peek()?.kind !== "]") fail(file, peek()?.line ?? 0, "expected , or ]");
    }
    next();
    return out;
  };

  const number = (operand, token) => {
    if (typeof operand !== "number") fail(file, token.line, "arithmetic on a non-number");
    return operand;
  };

  const factor = () => {
    const token = next();
    if (token.kind === "number") return token.value;
    if (token.kind === "-") return -number(factor(), token);
    if (token.kind === "(") {
      const inner = sum();
      expect(")");
      return inner;
    }
    if (token.kind === "ident") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      return new Ident(token.value);
    }
    return fail(file, token.line, `unexpected ${token.kind}`);
  };

  const product = () => {
    let left = factor();
    while (peek()?.kind === "*" || peek()?.kind === "/") {
      const op = next();
      const right = number(factor(), op);
      left = op.kind === "*" ? number(left, op) * right : number(left, op) / right;
    }
    return left;
  };

  const sum = () => {
    let left = product();
    while (peek()?.kind === "+" || peek()?.kind === "-") {
      const op = next();
      const right = number(product(), op);
      left = op.kind === "+" ? number(left, op) + right : number(left, op) - right;
    }
    return left;
  };

  const value = (depth) => {
    const kind = peek()?.kind;
    if (kind === "{") return object(depth);
    if (kind === "[") return array(depth);
    if (kind === "string") return next().value;
    return sum();
  };

  const result = object(0);
  if (at !== tokens.length) fail(file, tokens[at].line, "trailing tokens after the table");
  return { value: result, lines };
};

/**
 * The object literal assigned to `name` in `path`: `name = { ... };`.
 *
 * There must be exactly one such assignment. The brace walk skips string
 * literals and comments so a `}` inside either cannot end the table early.
 */
const readTable = (path, name) => {
  const text = readFileSync(path, "utf8");
  const hits = [...text.matchAll(new RegExp(`\\b${name}\\s*=\\s*\\{`, "g"))];
  if (hits.length !== 1) {
    fail(path, 0, `expected one \`${name} = {\` assignment, found ${hits.length}`);
  }
  const open = hits[0].index + hits[0][0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length && close < 0; i++) {
    const c = text[i];
    let skipTo = i;
    if (c === '"') skipTo = text.indexOf('"', i + 1);
    else if (c === "/" && text[i + 1] === "/") skipTo = text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") skipTo = text.indexOf("*/", i + 2);
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) close = i;
    if (skipTo < 0) break;
    i = skipTo;
  }
  if (close < 0) fail(path, 0, `unbalanced braces in \`${name}\``);
  const firstLine = text.slice(0, open).split("\n").length;
  const tokens = tokenize(text.slice(open, close + 1), path, firstLine);
  return {
    ...parseLiteral(tokens, path),
    declaredAt: text.slice(0, hits[0].index).split("\n").length,
  };
};

/* ── Field checks ─────────────────────────────────────────────────────────── */

const isCount = (value) => Number.isInteger(value) && value >= 0;

const ladder = (file, line, id, key, value, { minLength = 1 } = {}) => {
  if (!Array.isArray(value) || value.length < minLength || !value.every(isCount)) {
    fail(file, line, `${id}.${key} is not a list of at least ${minLength} whole numbers`);
  }
  return value;
};

const pairs = (file, line, id, key, value, length) => {
  const ok =
    Array.isArray(value) &&
    value.length >= length[0] &&
    value.length <= length[1] &&
    value.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every(isCount));
  if (!ok) fail(file, line, `${id}.${key} is not ${length.join("-")} [putty, seconds] pairs`);
  return value;
};

const count = (file, line, id, key, value) => {
  if (!isCount(value)) fail(file, line, `${id}.${key} is not a whole number`);
  return value;
};

const text = (file, line, id, key, value) => {
  if (typeof value !== "string" || value.length === 0)
    fail(file, line, `${id}.${key} is not a string`);
  return value;
};

/** A key in the live string table; a missing one is an error, not a blank. */
const lookup = (file, line, id, key) => {
  const found = strings[key];
  if (typeof found !== "string") fail(file, line, `${id}: no English string for ${key}`);
  return found;
};

/* ── The locker table ─────────────────────────────────────────────────────── */

const SURFACE = Array.from({ length: 19 }, (_, k) => `C${k + 1}`);
const EXPECTED_IDS = [...SURFACE, "C200", ...Array.from({ length: 8 }, (_, k) => `IC${k + 1}`)];

/** Decision D7, applied on top of the source (see the header). */
const D7 = {
  C16: { blocked: false },
  C17: { blocked: false },
  C19: { blocked: false, page: 4, order: 4 },
};

const locker = readTable(LOCKER, "_mainCreatures");

const ids = Object.keys(locker.value);
const added = ids.filter((id) => !EXPECTED_IDS.includes(id));
const missing = EXPECTED_IDS.filter((id) => !ids.includes(id));
if (added.length || missing.length) {
  fail(
    LOCKER,
    locker.declaredAt,
    `_mainCreatures ids changed (added ${added.join(", ") || "none"}; ` +
      `missing ${missing.join(", ") || "none"})`,
  );
}

const monsters = SURFACE.map((id) => {
  const raw = locker.value[id];
  const line = locker.lines[id];
  const props = raw.props;
  if (!props || typeof props !== "object") fail(LOCKER, line, `${id} has no props block`);
  const nameKey = text(LOCKER, line, id, "name", raw.name);
  const descriptionKey = text(LOCKER, line, id, "description", raw.description);
  if (raw.blocked !== undefined && typeof raw.blocked !== "boolean") {
    fail(LOCKER, line, `${id}.blocked is not a boolean`);
  }
  return {
    id,
    line,
    name: lookup(LOCKER, line, id, nameKey),
    // C18 is never listed, and the string table has no blurb for it.
    description:
      id === "C18" ? (strings[descriptionKey] ?? "") : lookup(LOCKER, line, id, descriptionKey),
    page: count(LOCKER, line, id, "page", raw.page),
    order: count(LOCKER, line, id, "order", raw.order),
    index: count(LOCKER, line, id, "index", raw.index),
    resource: count(LOCKER, line, id, "resource", raw.resource),
    time: count(LOCKER, line, id, "time", raw.time),
    level: count(LOCKER, line, id, "level", raw.level),
    blocked: raw.blocked === true,
    fake: raw.fake === true,
    dependent: raw.dependent ?? null,
    trainingCosts: pairs(LOCKER, line, id, "trainingCosts", raw.trainingCosts, [4, 5]),
    cResource: ladder(LOCKER, line, id, "cResource", props.cResource),
    cTime: ladder(LOCKER, line, id, "cTime", props.cTime),
    cStorage: ladder(LOCKER, line, id, "cStorage", props.cStorage),
  };
});

const byId = new Map(monsters.map((one) => [one.id, one]));

// The override is only right while the source still says what D7 overrides.
for (const id of Object.keys(D7)) {
  const one = byId.get(id);
  if (!one.blocked)
    fail(LOCKER, one.line, `${id} is no longer blocked in the source; revisit D7`);
}
if (byId.get("C19").page !== 0) {
  fail(
    LOCKER,
    byId.get("C19").line,
    "C19 now has a list page in the source; revisit the D7 slot",
  );
}
const mini = byId.get("C18");
if (!mini.blocked || !mini.fake || mini.dependent !== "C17") {
  fail(
    LOCKER,
    mini.line,
    'C18 is no longer the blocked, fake child of C17 (`dependent: "C17"`)',
  );
}
for (const one of monsters) {
  if (one.id !== "C18" && one.dependent !== null) {
    fail(LOCKER, one.line, `${one.id} is newly dependent on ${one.dependent}`);
  }
  if (one.id !== "C18" && one.fake) fail(LOCKER, one.line, `${one.id} is newly fake`);
}

const rows = monsters.map((one) => {
  const override = D7[one.id] ?? {};
  return {
    ...one,
    ...override,
    spawnedBy: one.id === "C18" ? one.dependent : null,
    overridden: Object.keys(override),
  };
});

// Every listed monster needs its own place in the locker's pages.
const listed = rows.filter((one) => !one.blocked);
const slots = new Map();
for (const one of listed) {
  if (one.page < 1) fail(LOCKER, one.line, `${one.id} is listed but has no locker page`);
  const slot = `${one.page}/${one.order}`;
  if (slots.has(slot))
    fail(LOCKER, one.line, `${one.id} shares locker slot ${slot} with ${slots.get(slot)}`);
  slots.set(slot, one.id);
}

/* ── The lab table ────────────────────────────────────────────────────────── */

const LAB_IDS = ["C3", "C4", "C5", "C7", "C8", "C9", "C11", "C12", "C13", "C14"];

const lab = readTable(LAB, "_powerupProps");

const labIds = Object.keys(lab.value);
if (labIds.length !== LAB_IDS.length || !LAB_IDS.every((id) => labIds.includes(id))) {
  fail(LAB, lab.declaredAt, `_powerupProps ids changed: ${labIds.join(", ")}`);
}

const abilities = LAB_IDS.map((id) => {
  const raw = lab.value[id];
  const line = lab.lines[id];
  if (byId.get(id)?.blocked !== false)
    fail(LAB, line, `${id} has a lab ability but is not listed`);
  const costs = pairs(LAB, line, id, "costs", raw.costs, [3, 3]);
  const effect = raw.effect;
  if (!Array.isArray(effect) || effect.length !== 3 || !effect.every(Number.isFinite)) {
    fail(LAB, line, `${id}.effect is not three numbers`);
  }
  return {
    id,
    line,
    order: count(LAB, line, id, "order", raw.order),
    name: lookup(LAB, line, id, text(LAB, line, id, "name", raw.name)),
    effectLabel: text(LAB, line, id, "ability", raw.ability),
    description: lookup(LAB, line, id, text(LAB, line, id, "description", raw.description)),
    upgradeDescription: lookup(
      LAB,
      line,
      id,
      text(LAB, line, id, "upgrade_description", raw.upgrade_description),
    ),
    costs,
    effect,
  };
}).sort((a, b) => a.order - b.order);

/* ── Emit ─────────────────────────────────────────────────────────────────── */

const list = (values) => `[${values.join(", ")}]`;
const steps = (values) => `[${values.map(list).join(", ")}]`;

const monsterRow = (one) => {
  const notes = [`CREATURELOCKER.as:${one.line}`];
  if (one.overridden.length) notes.push(`D7 sets ${one.overridden.join(", ")}`);
  return [
    `  // ${one.id} ${one.name} — ${notes.join("; ")}`,
    `  {`,
    `    id: ${JSON.stringify(one.id)},`,
    `    name: ${JSON.stringify(one.name)},`,
    `    description: ${JSON.stringify(one.description)},`,
    `    page: ${one.page},`,
    `    order: ${one.order},`,
    `    index: ${one.index},`,
    `    resource: ${one.resource},`,
    `    time: ${one.time},`,
    `    level: ${one.level},`,
    `    blocked: ${one.blocked},`,
    `    spawnedBy: ${JSON.stringify(one.spawnedBy)},`,
    `    trainingCosts: ${steps(one.trainingCosts)},`,
    `    cResource: ${list(one.cResource)},`,
    `    cTime: ${list(one.cTime)},`,
    `    cStorage: ${list(one.cStorage)},`,
    `  },`,
  ].join("\n");
};

const abilityRow = (one) =>
  [
    `  // ${one.id} ${byId.get(one.id).name} — MONSTERLAB.as:${one.line}`,
    `  {`,
    `    id: ${JSON.stringify(one.id)},`,
    `    order: ${one.order},`,
    `    name: ${JSON.stringify(one.name)},`,
    `    effectLabel: ${JSON.stringify(one.effectLabel)},`,
    `    description: ${JSON.stringify(one.description)},`,
    `    upgradeDescription: ${JSON.stringify(one.upgradeDescription)},`,
    `    costs: ${steps(one.costs)},`,
    `    effect: ${list(one.effect)},`,
    `  },`,
  ].join("\n");

const output = `/**
 * The monster catalogue and the Monster Lab's abilities. GENERATED — do not edit
 * by hand; regenerate with \`npm run gen:monster-catalogue\` from \`web/\`
 * (\`web/tools/gen-monster-catalogue.mjs\`).
 *
 * Sources: \`client/scripts/CREATURELOCKER.as\` (\`_mainCreatures\`, declared at
 * :${locker.declaredAt}) and \`client/scripts/MONSTERLAB.as\` (\`_powerupProps\`, declared at
 * :${lab.declaredAt}); names and descriptions from
 * \`server/public/gamestage/assets/english.json\`. Decision D7
 * (\`docs/design/yard-buildings.md\` §4.8) is applied on top: Vorg (C16),
 * Slimeattikus (C17) and Rezghul (C19) are obtainable, Rezghul in locker slot
 * page 4 / order 4; Slimeattikus Mini (C18) stays blocked as C17's spawn. C200
 * and the Inferno roster are not included.
 *
 * This file exists twice, byte for byte: \`web/src/game/monsters/monsterCatalogue.ts\`
 * (what the Monsters screen shows) and \`server/src/game-data/monsterCatalogue.ts\`
 * (what the yard routes charge). A sync test beside each copy fails if they
 * differ, because a price the client shows and the server does not charge is a
 * bug the player pays for. Combat stats are not here: they stay in the shared
 * combat rules and \`server/src/game-data/stats/monsterStats.ts\`.
 */

/** One paid step: \`[putty, seconds]\`. */
export type PaidStep = readonly [putty: number, seconds: number];

/** One surface monster. */
export interface MonsterEntry {
  /** Roster id, \`C1\`..\`C19\`. */
  readonly id: string;
  readonly name: string;
  /** The game's own blurb; contains \`<br>\` and \`<b>\` markup. */
  readonly description: string;
  /**
   * Locker list place: page 1-4, then \`order\` within the page
   * (\`client/scripts/CREATURELOCKERPOPUP.as:113-120\`). 0 for C18, never listed.
   */
  readonly page: number;
  readonly order: number;
  /**
   * The hatchery and housing sort key (\`CREATURELOCKER.as:1240\`,
   * \`client/scripts/HOUSING.as:288\`). Not unique: C9 and C17 are both 10, so
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
   * Academy training, entry \`i\` paying for level \`i + 1\` → \`i + 2\`, so the
   * highest level is \`trainingCosts.length + 1\` (\`client/scripts/ACADEMY.as:65-67\`).
   */
  readonly trainingCosts: readonly PaidStep[];
  /** Goo per hatch, by academy level (see {@link atLevel}). */
  readonly cResource: readonly number[];
  /** Hatch seconds, by academy level. */
  readonly cTime: readonly number[];
  /** Housing space, by academy level. */
  readonly cStorage: readonly number[];
}

/** One Monster Lab ability; rank \`r\` (1-3) costs \`costs[r - 1]\` and gives \`effect[r - 1]\`. */
export interface LabAbility {
  /** The monster it belongs to. */
  readonly id: string;
  /** Lab list order (\`client/scripts/MONSTERLABPOPUP.as:452\`). */
  readonly order: number;
  /** The ability's name, e.g. "Teleportation". */
  readonly name: string;
  /**
   * The label the original printed after the effect value, e.g. "Blink Range";
   * how the value is formatted differs per monster
   * (\`client/scripts/MONSTERLABPOPUP.as:215-250\`).
   */
  readonly effectLabel: string;
  readonly description: string;
  readonly upgradeDescription: string;
  readonly costs: readonly PaidStep[];
  readonly effect: readonly number[];
}

export const MONSTER_CATALOGUE: readonly MonsterEntry[] = [
${rows.map(monsterRow).join("\n")}
];

export const LAB_ABILITIES: readonly LabAbility[] = [
${abilities.map(abilityRow).join("\n")}
];

const MONSTERS_BY_ID: ReadonlyMap<string, MonsterEntry> = new Map(
  MONSTER_CATALOGUE.map((entry) => [entry.id, entry]),
);

const ABILITIES_BY_ID: ReadonlyMap<string, LabAbility> = new Map(
  LAB_ABILITIES.map((ability) => [ability.id, ability]),
);

/** The catalogue entry for \`id\`, or undefined for an id not in it (C200, Inferno, junk). */
export const monsterEntry = (id: string): MonsterEntry | undefined => MONSTERS_BY_ID.get(id);

/** The lab ability for \`id\`, or undefined for the monsters that have none. */
export const labAbility = (id: string): LabAbility | undefined => ABILITIES_BY_ID.get(id);

/**
 * Orders monsters as the hatchery and housing lists do: by \`index\`, ties broken
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
 * The value of a per-level ladder at academy \`level\`: \`ladder[level - 1]\`,
 * clamped to the last entry when the level runs past the ladder, as
 * \`CREATURES.GetProperty\` does (\`client/scripts/CREATURES.as:74-80\`). A level
 * below 1 reads as 1.
 */
export const atLevel = (ladder: readonly number[], level: number): number => {
  const clamped = Math.min(Math.max(Math.trunc(level), 1), ladder.length);
  return ladder[clamped - 1] ?? 0;
};

/** Goo to hatch one \`id\` at academy \`level\`; undefined for an unknown id. */
export const hatchCost = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cResource, level);
};

/** Seconds to hatch one \`id\` at academy \`level\`; undefined for an unknown id. */
export const hatchTime = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cTime, level);
};

/** Housing space one \`id\` takes at academy \`level\`; undefined for an unknown id. */
export const housingSpace = (id: string, level: number): number | undefined => {
  const entry = monsterEntry(id);
  return entry && atLevel(entry.cStorage, level);
};

/** The highest academy level \`id\` can reach; 0 for an unknown id. */
export const maxTrainingLevel = (id: string): number => {
  const entry = monsterEntry(id);
  return entry ? entry.trainingCosts.length + 1 : 0;
};

/**
 * What training \`id\` from academy \`level\` to \`level + 1\` costs, or undefined
 * when it is already at its highest level or the id is unknown.
 */
export const trainingStep = (id: string, level: number): PaidStep | undefined =>
  monsterEntry(id)?.trainingCosts[level - 1];

/** What researching rank \`rank\` (1-3) of \`id\`'s lab ability costs, or undefined. */
export const labStep = (id: string, rank: number): PaidStep | undefined =>
  labAbility(id)?.costs[rank - 1];
`;

/* ── Write or check ───────────────────────────────────────────────────────── */

const lf = (value) => value.replace(/\r\n/g, "\n");

if (CHECK) {
  const stale = [WEB_OUT, SERVER_OUT].filter(
    (path) => !existsSync(path) || lf(readFileSync(path, "utf8")) !== output,
  );
  if (stale.length) {
    console.error(`Stale monster catalogue; run \`npm run gen:monster-catalogue\` from web/:`);
    for (const path of stale) console.error(`  ${path}`);
    process.exit(1);
  }
  console.log(
    `monster catalogue up to date (${rows.length} monsters, ${abilities.length} lab abilities)`,
  );
} else {
  for (const path of [WEB_OUT, SERVER_OUT]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, output, "utf8");
  }
  console.log(
    `${rows.length} monsters (${listed.length} listed), ${abilities.length} lab abilities`,
  );
  console.log(`-> ${WEB_OUT}`);
  console.log(`-> ${SERVER_OUT}`);
  console.log(
    rows
      .map(
        (one) =>
          `${one.id}\t${one.name}\tL${one.level}\t${one.resource}\t${one.time}s\t` +
          `p${one.page}/${one.order}\ti${one.index}${one.blocked ? "\tblocked" : ""}`,
      )
      .join("\n"),
  );
}
