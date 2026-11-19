/**
 * Today's habit rule against the owner's pick B (19 Nov 2026), in real battles.
 *
 *   cd web && bun tools/champion-habits-b.mjs <yards-dir> [--attacks 60] [--json out.json]
 *     [--gate 8 --support 3 --doubt 8 --weight 50 --hybrid 75]
 *
 * `<yards-dir>` holds real yards, one JSON file each: `{ buildingdata, health,
 * resources }` (exported from a local copy of the database; never commit
 * them). Each champion attacks the yards in turn, one Mode at a time, with a
 * rotating army, drop side and seed, through the shared engine
 * (`replayAttack`, lessons on). After each attack its lesson goes through the
 * rule under test, and the next attack is flung with the weights that left
 * it, as the server freezes them at launch. Both rules fight the same list
 * of attacks, so every difference is the rule's.
 *
 * Three runs per champion and Mode:
 *
 * - **today**: the weights rule before B (fade 10 %, steps of at most 15),
 *   copied here from `habits.ts` as it stood on revamp 5db69bbd4.
 * - **B**: `learnHabits` as built.
 * - **B, shuffled**: B fed the same lessons with each attack's result taken
 *   from another attack (a fixed shuffle): what B does when results carry
 *   no signal at all.
 *
 * For each it prints: attacks until a habit first counts (today: 1+ pip,
 * B: Active), how many times a habit switched on or off, the share of
 * attacks fought with a habit on, the biggest jump of one habit's weight in
 * one attack, the share of attacks whose battle came out differently from
 * the champion's instincts alone (the same attack replayed without habits;
 * whole-battle digest), and its mean score by its Mode's goal against the
 * instincts-only mean over the same attacks.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRAIN_RATE } from "../src/game/combat/rules/brain.ts";
import {
  FOMOR_JUDGE,
  HABIT_RULES,
  STANCE_SHORT,
  habitBounds,
  habitCap,
  habitScore,
  habitsOf,
  learnHabits,
  parseHabitStats,
} from "../src/game/combat/rules/habits.ts";
import { MONSTER_HABIT_KEYS } from "../src/game/combat/rules/stance.ts";
import { replayAttack } from "../src/game/combat/rules/replay.ts";
import { championByType } from "../src/game/combat/rules/stats.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const dir = args.find((one, index) => !one.startsWith("--") && !(index > 0 && args[index - 1].startsWith("--")));
if (!dir) throw new Error("usage: bun tools/champion-habits-b.mjs <yards-dir> [--attacks 60]");
const ATTACKS = flag("--attacks", 60);
const jsonAt = args.indexOf("--json");
const JSON_OUT = jsonAt >= 0 ? args[jsonAt + 1] : null;
const RULES = {
  gate: flag("--gate", HABIT_RULES.gate),
  support: flag("--support", HABIT_RULES.support),
  doubt: flag("--doubt", HABIT_RULES.doubt),
  weight: flag("--weight", HABIT_RULES.weight),
  hybridWeight: flag("--hybrid", HABIT_RULES.hybridWeight),
};

const yards = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));

/** yardtester's academy (levels), as in the local database. */
const LEVELS = Object.fromEntries(
  ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C10", "C11", "C13", "C14"].map((id) => [id, 6]),
);

/** Armies that get hurt and that bring fliers, so every habit has something to look at. */
const ARMIES = [
  { C1: 20, C4: 6, C14: 2 },
  { C7: 10, C8: 4, C3: 12 },
  { C2: 6, C5: 3, C13: 3 },
  { C1: 30, C11: 2, C14: 1 },
];

/** yardtester's real champions: Fomor L6 (power 1) and Drull L5. */
const CHAMPIONS = [
  { name: "Fomor L6 (yardtester)", t: 3, l: 6, pl: 1 },
  { name: "Drull L5 (yardtester)", t: 2, l: 5, pl: 1 },
];

const STANCES = ["offensive", "defensive", "hybrid"];

/** A drop point outside the yard's buildings, on one of eight sides. */
const dropFor = (yard, side) => {
  const points = Object.values(yard.buildingdata).filter((one) => one && typeof one.X === "number");
  let cx = 0;
  let cy = 0;
  for (const one of points) {
    cx += one.X;
    cy += one.Y;
  }
  cx /= Math.max(1, points.length);
  cy /= Math.max(1, points.length);
  let reach = 0;
  for (const one of points) reach = Math.max(reach, Math.hypot(one.X - cx, one.Y - cy));
  const angle = (side * Math.PI) / 4;
  return [Math.round(cx + Math.cos(angle) * (reach + 120)), Math.round(cy + Math.sin(angle) * (reach + 120))];
};

/** The attack list: yard, army, side and seed rotate at different rates. */
const plan = Array.from({ length: ATTACKS }, (_, index) => ({
  yard: yards[index % yards.length],
  army: ARMIES[Math.floor(index / yards.length) % ARMIES.length],
  side: (index * 3) % 8,
  seed: 61000 + index * 13,
}));

const fight = (attack, champion, stance, weights) => {
  const [x, y] = dropFor(attack.yard, attack.side);
  const any = weights && Object.keys(weights).length > 0;
  return replayAttack({
    buildingdata: attack.yard.buildingdata,
    buildinghealthdata: attack.yard.health,
    resources: attack.yard.resources,
    kind: "main",
    levels: LEVELS,
    playerLevel: 40,
    tailTicks: 9600,
    learn: true,
    log: {
      v: 1,
      seed: attack.seed,
      events: [
        {
          kind: "fling",
          t: 80,
          x,
          y,
          r: 300,
          monsters: attack.army,
          champion: { t: champion.t, l: champion.l, pl: champion.pl, s: stance, ...(any ? { hv: 1, h: weights } : {}) },
        },
      ],
    },
  });
};

const judgedByMonsters = (lesson) => lesson.army !== undefined || lesson.backed !== undefined;

/** Today's rule (before B): fade, then a step of at most 15 towards the result. */
const todayWeights = (weights, statsBefore, lesson, stance) => {
  const id = championByType(lesson.t);
  const parsed = parseHabitStats(statsBefore);
  const restarted = judgedByMonsters(lesson) && parsed.j !== FOMOR_JUDGE;
  const record = parsed[STANCE_SHORT[stance]];
  const usual = restarted ? undefined : record?.u[lesson.k ?? "main"];
  const score = habitScore(lesson, stance);
  const out = {};
  for (const habit of habitsOf(id, stance)) {
    let weight = Math.trunc((weights[habit] ?? 0) * 0.9);
    const looks = MONSTER_HABIT_KEYS.includes(habit) ? (lesson.allyPicks ?? lesson.picks) : lesson.picks;
    if (score !== null && usual !== undefined && looks > 0) {
      const credit = (lesson.credit[habit] ?? 0) / looks;
      weight += Math.min(Math.max(BRAIN_RATE * (score - usual) * credit, -15), 15);
    }
    const [low, high] = habitBounds(habit, stance);
    const whole = Math.min(Math.max(Math.round(weight), low), high);
    if (whole !== 0) out[habit] = whole;
  }
  return out;
};

/** The result fields of a lesson, moved from one attack to another for the shuffled run. */
const RESULT_FIELDS = ["dealt", "potential", "startHp", "endHp", "army", "ring", "backed", "backedLived"];
const SHUFFLE = Array.from({ length: ATTACKS }, (_, index) => (index * 37 + 11) % ATTACKS);

const mean = (values) => (values.length ? values.reduce((sum, one) => sum + one, 0) / values.length : NaN);

/** One champion in one Mode under one rule: `rule` is "today", "B" or "shuffled". */
const run = (champion, stance, rule, results) => {
  let weights = {};
  let stats = undefined;
  let learning = undefined;
  const short = STANCE_SHORT[stance];
  const rows = [];
  for (const [index, attack] of plan.entries()) {
    const outcome = fight(attack, champion, stance, weights);
    let lesson = outcome.lessons?.find((one) => one.t === champion.t);
    const any = Object.keys(weights).length > 0;
    if (results.plainDigest[index] === undefined) {
      // The same attack by its instincts alone, once for all three rules.
      const plain = any ? fight(attack, champion, stance, {}) : outcome;
      const plainLesson = plain.lessons?.find((one) => one.t === champion.t);
      results.plainDigest[index] = plain.digest;
      results.plainScore[index] = plainLesson ? habitScore(plainLesson, stance) : null;
    }
    const row = {
      attack: index + 1,
      weights: { ...weights },
      changed: outcome.digest !== results.plainDigest[index],
      score: lesson ? habitScore(lesson, stance) : null,
      plainScore: results.plainScore[index],
      events: {},
    };
    if (lesson) {
      if (rule === "shuffled") {
        // The result of another attack: what it fought is this one's, how it went is not.
        const other = results.lessons[SHUFFLE[index]];
        if (other) for (const field of RESULT_FIELDS) if (other[field] !== undefined) lesson = { ...lesson, [field]: other[field] };
      } else if (rule === "B") {
        results.lessons[index] = lesson;
      }
      if (rule === "today") {
        const next = todayWeights(weights, stats, lesson, stance);
        stats = learnHabits({}, stats, lesson, stance).stats;
        weights = next;
      } else {
        const learned = learnHabits(undefined, stats, lesson, stance, undefined, learning, RULES);
        stats = learned.stats;
        learning = learned.learning;
        weights = { ...(learned.book[short] ?? {}) };
        if (learned.learning.r) row.events = { ...learned.learning.r.e };
      }
    }
    rows.push(row);
  }
  return rows;
};

const summarise = (champion, stance, rule, rows) => {
  const id = championByType(champion.t);
  const quarter = habitCap(stance) / 4;
  const keys = habitsOf(id, stance);
  const counts = (weights) =>
    rule === "today"
      ? keys.filter((key) => Math.abs(weights[key] ?? 0) >= quarter)
      : keys.filter((key) => (weights[key] ?? 0) !== 0);
  // The weights each attack was fought with, then the ones the last left.
  let first = null;
  let switches = 0;
  let maxJump = 0;
  let jumpsOver15 = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const before = rows[index].weights;
    const after = rows[index + 1]?.weights;
    if (first === null && counts(before).length > 0) first = index + 1;
    if (!after) continue;
    for (const key of keys) {
      const jump = Math.abs((after[key] ?? 0) - (before[key] ?? 0));
      maxJump = Math.max(maxJump, jump);
      if (jump > 15) jumpsOver15 += 1;
      const on = (weights) => counts(weights).includes(key);
      if (on(before) !== on(after) || Math.sign(before[key] ?? 0) * Math.sign(after[key] ?? 0) < 0) switches += 1;
    }
  }
  const withHabit = rows.filter((row) => counts(row.weights).length > 0).length;
  const changed = rows.filter((row) => row.changed).length;
  const late = rows.slice(-20).filter((row) => row.score !== null && row.plainScore !== null);
  const end = rows.at(-1).weights;
  return {
    champion: champion.name,
    stance,
    rule,
    firstOn: first,
    switches,
    shareOn: withHabit / rows.length,
    maxJump,
    jumpsOver15,
    battleChanged: changed / rows.length,
    lateScore: mean(late.map((row) => row.score)),
    latePlain: mean(late.map((row) => row.plainScore)),
    endWeights: end,
  };
};

const table = [];
const detail = {};
const started = Date.now();
for (const champion of CHAMPIONS) {
  for (const stance of STANCES) {
    const results = { lessons: [], plainScore: [], plainDigest: [] };
    for (const rule of ["B", "shuffled", "today"]) {
      const rows = run(champion, stance, rule, results);
      const summary = summarise(champion, stance, rule, rows);
      table.push(summary);
      detail[`${champion.name}/${stance}/${rule}`] = rows.map((row) => ({
        a: row.attack,
        w: row.weights,
        c: row.changed ? 1 : 0,
        s: row.score === null ? null : Number(row.score.toFixed(3)),
        p: row.plainScore === null ? null : Number(row.plainScore.toFixed(3)),
        ...(Object.keys(row.events).length ? { e: row.events } : {}),
      }));
      console.error(`${champion.name} ${stance} ${rule}: ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  }
}

const pct = (value) => `${Math.round(value * 100)}%`.padStart(5);
const pad = (value, width) => String(value).padStart(width);
console.log(`${ATTACKS} attacks a Mode on ${yards.length} real yards; B = ${JSON.stringify(RULES)}`);
console.log("champion                 mode       rule      firstOn switches  on%  maxJump >15  changed  score(last20) vs instincts");
for (const row of table) {
  console.log(
    `${row.champion.padEnd(24)} ${row.stance.padEnd(10)} ${row.rule.padEnd(9)} ${pad(row.firstOn ?? "-", 7)} ${pad(row.switches, 8)} ${pct(row.shareOn)} ${pad(row.maxJump, 8)} ${pad(row.jumpsOver15, 3)} ${pct(row.battleChanged).padStart(8)}  ${row.lateScore.toFixed(3)} vs ${row.latePlain.toFixed(3)}  end ${JSON.stringify(row.endWeights)}`,
  );
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ rules: RULES, attacks: ATTACKS, table, detail }));
