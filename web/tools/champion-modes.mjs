/**
 * The balance matrix for champion Modes (issue #220).
 *
 *   cd web && bun tools/champion-modes.mjs            # the matrix
 *   cd web && bun tools/champion-modes.mjs --seeds 5  # more seeds per cell
 *
 * Replays each champion in each Mode, alone and with a wave of Pokeys, on the
 * sandbox yard and two made-up yards (a tower nest and a loot field), several
 * seeds a cell, and prints the mean damage %, the mean share of the champion's
 * health it kept, and the mean loot. `docs/design/champion-ai.md` §6.4 calls
 * the Modes broken when one is at least as good as another on both damage and
 * health kept, or when Offensive barely out-damages Defensive; the script
 * marks a cell where Offensive does not deal the most or Defensive does not
 * keep the most.
 *
 * Tuning is an edit to `STANCE_TILTS` in `src/game/combat/rules/stance.ts`.
 */

import { readFileSync } from "node:fs";

import { replayAttack } from "../src/game/combat/rules/replay.js";
import { CHAMPION_STANCES } from "../src/game/combat/rules/stance.js";
import { championByType, championStatWithPower } from "../src/game/combat/rules/stats.js";
import { SANDBOX } from "./lib/combat-scenarios.mjs";

const args = process.argv.slice(2);
const seedFlag = args.indexOf("--seeds");
const SEEDS = seedFlag >= 0 ? Number(args[seedFlag + 1]) : 3;

const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

const MAXED = Object.fromEntries(
  ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C13", "C14"].map((id) => [id, 6]),
);

/** A Town Hall ringed by Snipers and Cannons, with harvesters out of their reach. */
const TOWER_NEST = {
  0: { id: 0, t: 14, l: 5, X: 0, Y: 0 },
  1: { id: 1, t: 21, l: 5, X: 150, Y: 0 },
  2: { id: 2, t: 21, l: 5, X: -150, Y: 0 },
  3: { id: 3, t: 21, l: 5, X: 0, Y: 150 },
  4: { id: 4, t: 21, l: 5, X: 0, Y: -150 },
  5: { id: 5, t: 20, l: 5, X: 150, Y: 150 },
  6: { id: 6, t: 20, l: 5, X: -150, Y: -150 },
  7: { id: 7, t: 25, l: 5, X: 150, Y: -150 },
  8: { id: 8, t: 25, l: 5, X: -150, Y: 150 },
  9: { id: 9, t: 1, l: 5, X: 700, Y: 700, st: 8000 },
  10: { id: 10, t: 2, l: 5, X: -700, Y: 700, st: 8000 },
  11: { id: 11, t: 3, l: 5, X: 700, Y: -700, st: 8000 },
  12: { id: 12, t: 6, l: 3, X: -500, Y: -500 },
};

/** Harvesters and a silo spread wide, two Lasers and a Sniper among them. */
const LOOT_FIELD = {
  0: { id: 0, t: 14, l: 3, X: 0, Y: 0 },
  1: { id: 1, t: 1, l: 5, X: 300, Y: 0, st: 9000 },
  2: { id: 2, t: 2, l: 5, X: -300, Y: 0, st: 9000 },
  3: { id: 3, t: 3, l: 5, X: 0, Y: 300, st: 9000 },
  4: { id: 4, t: 4, l: 5, X: 0, Y: -300, st: 9000 },
  5: { id: 5, t: 6, l: 3, X: 400, Y: 400 },
  6: { id: 6, t: 23, l: 5, X: 250, Y: 250 },
  7: { id: 7, t: 23, l: 5, X: -250, Y: -250 },
  8: { id: 8, t: 21, l: 5, X: -350, Y: 350 },
};

const RESOURCES = { r1: 2_000_000, r2: 2_000_000, r3: 2_000_000, r4: 2_000_000 };

const YARDS = [
  { name: "sandbox", buildingdata: sandbox.buildingdata, health: sandbox.buildinghealthdata ?? {}, resources: sandbox.resources, drop: [180, -480] },
  { name: "tower-nest", buildingdata: TOWER_NEST, health: {}, resources: RESOURCES, drop: [500, 500] },
  { name: "loot-field", buildingdata: LOOT_FIELD, health: {}, resources: RESOURCES, drop: [600, 0] },
];

const CHAMPIONS = [
  { t: 1, l: 6, pl: 0 },
  { t: 2, l: 6, pl: 0 },
  { t: 4, l: 3, pl: 0 },
  { t: 5, l: 5, pl: 0 },
];

const WAVES = [
  { name: "alone", monsters: {} },
  { name: "+40 Pokeys", monsters: { C1: 40 } },
];

const lootOf = (amounts) => Object.values(amounts).reduce((sum, one) => sum + one, 0);

const cell = (yard, champion, wave, stance) => {
  const id = championByType(champion.t);
  const maxHp = championStatWithPower(id, "health", champion.l, champion.pl);
  let damage = 0;
  let kept = 0;
  let loot = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const outcome = replayAttack({
      buildingdata: yard.buildingdata,
      buildinghealthdata: yard.health,
      resources: yard.resources,
      kind: "main",
      levels: MAXED,
      playerLevel: 20,
      tailTicks: 9600,
      log: {
        v: 1,
        seed: 22000 + seed,
        events: [
          {
            kind: "fling",
            t: 80,
            x: yard.drop[0],
            y: yard.drop[1],
            r: 300,
            monsters: wave.monsters,
            champion: { ...champion, s: stance },
          },
        ],
      },
    });
    damage += outcome.damage;
    kept += (outcome.championsHp?.[id] ?? outcome.championHp ?? 0) / maxHp;
    loot += lootOf(outcome.attackloot);
  }
  return { damage: damage / SEEDS, kept: kept / SEEDS, loot: loot / SEEDS };
};

const pct = (value) => `${value.toFixed(1)}%`.padStart(7);

console.log(`Champion Modes, ${SEEDS} seed(s) a cell: damage % / health kept / loot`);
let flagged = 0;
for (const yard of YARDS) {
  for (const wave of WAVES) {
    console.log(`\n${yard.name}, ${wave.name}`);
    for (const champion of CHAMPIONS) {
      const results = Object.fromEntries(
        CHAMPION_STANCES.map((stance) => [stance, cell(yard, champion, wave, stance)]),
      );
      const { offensive, hybrid, defensive } = results;
      const notes = [];
      if (offensive.damage < Math.max(hybrid.damage, defensive.damage)) notes.push("O not top damage");
      if (defensive.kept < Math.max(hybrid.kept, offensive.kept)) notes.push("D not top health");
      if (notes.length > 0) flagged += 1;
      const line = CHAMPION_STANCES.map((stance) => {
        const one = results[stance];
        return `${stance.slice(0, 3)} ${pct(one.damage)} ${pct(one.kept * 100)} ${String(Math.round(one.loot)).padStart(8)}`;
      }).join(" | ");
      console.log(`  ${championByType(champion.t)} L${champion.l}  ${line}  ${notes.join(", ")}`);
    }
  }
}
console.log(`\n${flagged} cell(s) flagged.`);
