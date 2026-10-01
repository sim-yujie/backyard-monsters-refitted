/**
 * How a champion's learning brain drifts (issue #219).
 *
 *   cd web && bun tools/champion-brain.mjs                 # 30 attacks a Mode
 *   cd web && bun tools/champion-brain.mjs --attacks 50
 *   cd web && bun tools/champion-brain.mjs --rate 300      # try another BRAIN_RATE
 *
 * One champion, starting from a zero brain, attacks a tower-heavy yard again
 * and again in one Mode, with a wave of Pokeys, from a different side and seed
 * each time. After each attack its lesson goes through the server's own rule
 * (`learnFromLesson`), and the next attack is flung with the brain that left
 * it, as the server freezes it at launch. Prints the weights every five
 * attacks, the champion's score by its Mode's goal early and late, and the
 * tendencies the Champion Cage would show at the end.
 *
 * Tuning is an edit to `BRAIN_RATE` in `src/game/combat/rules/brain.ts`.
 */

import {
  BRAIN_KEYS,
  BRAIN_RATE,
  learnFromLesson,
  lessonScore,
} from "../src/game/combat/rules/brain.ts";
import { replayAttack } from "../src/game/combat/rules/replay.ts";
import { CHAMPION_STANCES } from "../src/game/combat/rules/stance.ts";
import { brainSummary, tendenciesText } from "../src/game/yard/championBrain.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const ATTACKS = flag("--attacks", 30);
const RATE = flag("--rate", BRAIN_RATE);

const MAXED = Object.fromEntries(
  ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C13", "C14"].map((id) => [id, 6]),
);

/**
 * A Town Hall inside a ring of eight towers, harvesters both under their guns
 * and out past them, a silo off to one side.
 */
const TOWER_YARD = {
  0: { id: 0, t: 14, l: 5, X: 0, Y: 0 },
  1: { id: 1, t: 21, l: 5, X: 200, Y: 0 },
  2: { id: 2, t: 21, l: 5, X: -200, Y: 0 },
  3: { id: 3, t: 21, l: 5, X: 0, Y: 200 },
  4: { id: 4, t: 21, l: 5, X: 0, Y: -200 },
  5: { id: 5, t: 20, l: 5, X: 200, Y: 200 },
  6: { id: 6, t: 20, l: 5, X: -200, Y: -200 },
  7: { id: 7, t: 25, l: 5, X: 200, Y: -200 },
  8: { id: 8, t: 25, l: 5, X: -200, Y: 200 },
  9: { id: 9, t: 1, l: 5, X: 100, Y: 100, st: 8000 },
  10: { id: 10, t: 2, l: 5, X: -100, Y: -100, st: 8000 },
  11: { id: 11, t: 1, l: 5, X: 750, Y: 750, st: 8000 },
  12: { id: 12, t: 2, l: 5, X: -750, Y: 750, st: 8000 },
  13: { id: 13, t: 3, l: 5, X: 750, Y: -750, st: 8000 },
  14: { id: 14, t: 4, l: 5, X: -750, Y: -750, st: 8000 },
  15: { id: 15, t: 6, l: 3, X: 0, Y: -550 },
};
const RESOURCES = { r1: 2_000_000, r2: 2_000_000, r3: 2_000_000, r4: 2_000_000 };
const DROPS = [
  [900, 0],
  [0, 900],
  [-900, 0],
  [0, -900],
  [800, 800],
  [-800, -800],
];
const CHAMPION = { t: 1, l: 6, pl: 0 };
/** The Pokeys each attack brings: players do not bring the same army every time. */
const WAVES = [30, 20, 40, 25, 35];

const run = (stance) => {
  let brain = undefined;
  let stats = undefined;
  const scores = [];
  const rows = [];
  for (let attack = 0; attack < ATTACKS; attack += 1) {
    const [x, y] = DROPS[attack % DROPS.length];
    const outcome = replayAttack({
      buildingdata: TOWER_YARD,
      resources: RESOURCES,
      kind: "main",
      levels: MAXED,
      playerLevel: 20,
      tailTicks: 9600,
      learn: true,
      log: {
        v: 1,
        seed: 41000 + attack * 7,
        events: [
          {
            kind: "fling",
            t: 80,
            x,
            y,
            r: 300,
            monsters: { C1: WAVES[attack % WAVES.length] },
            champion: { ...CHAMPION, s: stance, ...(brain ? { b: brain } : {}) },
          },
        ],
      },
    });
    const lesson = outcome.lessons?.[0];
    if (!lesson) continue;
    scores.push(lessonScore(lesson, stance));
    const learned = learnFromLesson(brain, stats, lesson, stance, RATE);
    brain = learned.brain;
    stats = learned.stats;
    if ((attack + 1) % 5 === 0) rows.push({ attack: attack + 1, ...brain });
  }
  return { brain, stats, scores, rows };
};

const mean = (values) => values.reduce((sum, one) => sum + one, 0) / Math.max(1, values.length);
const cell = (value) => String(value).padStart(7);

console.log(`Champion brain: Gorgo L6 + 20 to 40 Pokeys, ${ATTACKS} attacks a Mode, rate ${RATE}`);
for (const stance of CHAMPION_STANCES) {
  const { brain, stats, scores, rows } = run(stance);
  console.log(`\n${stance}`);
  console.log(`  attack ${BRAIN_KEYS.map(cell).join("")}`);
  for (const row of rows) {
    console.log(`  ${String(row.attack).padStart(6)} ${BRAIN_KEYS.map((key) => cell(row[key])).join("")}`);
  }
  const early = mean(scores.slice(0, 5));
  const late = mean(scores.slice(-5));
  console.log(`  score by its goal: first five ${early.toFixed(3)}, last five ${late.toFixed(3)}`);
  console.log(`  cage says: ${tendenciesText(brainSummary({ b: brain, bs: stats }))}`);
}
