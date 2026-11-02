/**
 * The calculation behind `docs/mr2-neighbours.md`: real MR2 armies against
 * real MR2 defences in the real combat engine, with each candidate neighbour
 * bonus. Run from `web/`:
 * `bun tools/mr2-neighbours/study.ts [table | need [wide] | calibrate]`.
 */
import { createBattle } from "../../src/game/combat/rules/engine.ts";
import { buildEngineYard } from "../../src/game/combat/rules/yard.ts";
import { toCombatYard } from "../../src/game/combat/rules/types.ts";
import { damagePercent } from "../../src/game/combat/rules/damagePercent.ts";
import { kozu } from "../../../server/src/game-data/tribes/v2/kozu.ts";
import { legionnaire } from "../../../server/src/game-data/tribes/v2/legionnaire.ts";
import { abunaki } from "../../../server/src/game-data/tribes/v2/abunaki.ts";
import { dreadnaught } from "../../../server/src/game-data/tribes/v2/dreadnaught.ts";
import { readFileSync } from "node:fs";

type Roster = Record<string, number>;
const last = <T>(table: Record<number, T>): T => table[Math.max(...Object.keys(table).map(Number))]!;

const sandbox = JSON.parse(
  readFileSync(new URL("../../test/fixtures/baseload-sandbox-yard.json", import.meta.url), "utf8"),
);

/** Defences: the strongest camp of each MR2 tribe, and a built-up player yard. */
const YARDS: Record<string, { buildingdata: unknown; kind: "wild" | "main"; resources?: unknown }> = {
  kozu: { buildingdata: last(kozu).buildingdata, kind: "wild" },
  legionnaire: { buildingdata: last(legionnaire).buildingdata, kind: "wild" },
  abunaki: { buildingdata: last(abunaki).buildingdata, kind: "wild" },
  dreadnaught: { buildingdata: last(dreadnaught).buildingdata, kind: "wild" },
  player: { buildingdata: sandbox.buildingdata, kind: "main", resources: sandbox.resources },
};

/** One level 6 Flinger load (4,000 bucket) each, academy level 6. */
const ARMIES: Record<string, Roster> = {
  daves: { C12: 25 },
  groundMix: { C10: 20, C8: 40, C4: 50, C1: 140 },
  air: { C14: 40, C16: 20 },
};

const LEVELS = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [`C${i + 1}`, 6]));

const scaled = (army: Roster, scale: number): Roster =>
  Object.fromEntries(Object.entries(army).map(([id, n]) => [id, Math.max(1, Math.round(n * scale))]));

/** Half the army from the west, half from the south a few seconds later. */
const fight = (yard: string, army: Roster, bonus?: { hp?: number; damage?: number }, seed = 4242) => {
  const half = (r: Roster, second: boolean): Roster =>
    Object.fromEntries(
      Object.entries(r)
        .map(([id, n]) => [id, second ? n - Math.floor(n / 2) : Math.floor(n / 2)] as const)
        .filter(([, n]) => n > 0),
    );
  const y = YARDS[yard]!;
  const engineYard = buildEngineYard({
    buildingdata: y.buildingdata as never,
    buildinghealthdata: null,
    resources: (y.resources ?? null) as never,
    kind: y.kind,
    height: null,
  });
  const battle = createBattle(engineYard, {
    seed,
    levels: LEVELS,
    playerLevel: 40,
    ...(bonus ? { defenceBonus: bonus } : {}),
  });
  battle.runTo(400);
  battle.apply({ kind: "fling", t: 400, x: -615, y: 115, r: 300, monsters: half(army, false) } as never);
  battle.runTo(800);
  battle.apply({ kind: "fling", t: 800, x: 355, y: 375, r: 300, monsters: half(army, true) } as never);
  let to90 = Infinity;
  let damage = 0;
  for (let t = 800 + 200; t <= 800 + 40 * 600; t += 200) {
    battle.runTo(t);
    const state = battle.state();
    const fired = new Set(state.firedTraps);
    const combat = toCombatYard({ kind: y.kind, buildingdata: y.buildingdata as never, buildinghealthdata: state.health, spent: fired });
    damage = damagePercent(combat, state.health, fired);
    if (damage >= 90 && to90 === Infinity) to90 = t / 40;
    if (damage >= 100 || battle.over()) break;
    if (state.creepsFlung > 0 && state.creepsKilled >= state.creepsFlung) break;
  }
  const state = battle.state();
  return { damage, to90, killed: state.creepsKilled, flung: state.creepsFlung };
};

const SEEDS = [4242, 777, 31337, 9001, 1234];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const avg = (yard: string, army: Roster, bonus?: { hp?: number; damage?: number }) => {
  const runs = SEEDS.map((seed) => fight(yard, army, bonus, seed));
  return {
    damage: mean(runs.map((r) => r.damage)),
    to90: [...runs.map((r) => r.to90)].sort((a, b) => a - b)[Math.floor(runs.length / 2)]!,
    lost: mean(runs.map((r) => r.killed / Math.max(1, r.flung))),
  };
};

/** The smallest share of the army (in 5% steps) that takes the yard to 90%. */
const armyNeeded = (yard: string, army: Roster, bonus?: { hp?: number; damage?: number }): number => {
  for (let scale = 0.5; scale <= 3.001; scale += 0.05) {
    if (avg(yard, scaled(army, scale), bonus).damage >= 90) return Math.round(scale * 100) / 100;
  }
  return Infinity;
};

const mode = process.argv[2] ?? "table";
const STEPS = [0, 0.08, 0.16, 0.24, 0.32, 0.48];
const SHAPES: Record<string, (x: number) => { hp?: number; damage?: number }> = {
  hp: (x) => ({ hp: x }),
  dmg: (x) => ({ damage: x }),
  both: (x) => ({ hp: x, damage: x }),
};
/** Each pair: a defence, an army, and the share of a full load that fights it. */
const PAIRS: Array<[string, string, number]> = [
  ["kozu", "daves", 1],
  ["kozu", "groundMix", 1],
  ["legionnaire", "groundMix", 0.6],
  ["dreadnaught", "daves", 1],
  ["dreadnaught", "air", 0.6],
  ["abunaki", "daves", 1.3],
  ["player", "air", 1],
  ["player", "daves", 1.5],
];

if (mode === "need") {
  // The smallest army (share of a full load, 5% steps) that takes the yard to 90% on average.
  const settings: Record<string, { hp?: number; damage?: number }> = process.argv[3] === "single48" ? {
    "hp+48": { hp: 0.48 },
    "dmg+48": { damage: 0.48 },
  } : process.argv[3] === "wide" ? {
    none: {},
    "hp+24": { hp: 0.24 },
    "dmg+24": { damage: 0.24 },
    "both+32": { hp: 0.32, damage: 0.32 },
    "both+48": { hp: 0.48, damage: 0.48 },
  } : {
    none: {},
    "hp+8": { hp: 0.08 },
    "dmg+8": { damage: 0.08 },
    "both+8": { hp: 0.08, damage: 0.08 },
    "both+14": { hp: 0.14, damage: 0.14 },
    "both+18": { hp: 0.18, damage: 0.18 },
    "both+24": { hp: 0.24, damage: 0.24 },
  };
  const pairs: Array<[string, string]> = [
    ["abunaki", "daves"],
    ["dreadnaught", "daves"],
    ["dreadnaught", "groundMix"],
    ["player", "air"],
    ["kozu", "groundMix"],
  ];
  for (const [yard, name] of pairs) {
    const row = [`${yard}/${name}`];
    for (const [label, bonus] of Object.entries(settings)) {
      row.push(`${label} ${armyNeeded(yard, ARMIES[name]!, bonus)}`);
    }
    console.log(row.join("	"));
  }
} else if (mode === "probe") {
  const [, , , yard, name, scale] = process.argv;
  for (const hp of [0, 0.5, 1, 3]) {
    const r = fight(yard!, scaled(ARMIES[name!]!, Number(scale ?? 1)), { hp }, 4242);
    console.log(`hp+${hp * 100}%`, JSON.stringify(r));
  }
} else if (mode === "calibrate") {
  for (const yard of Object.keys(YARDS)) {
    for (const [name, army] of Object.entries(ARMIES)) {
      const r = avg(yard, army);
      console.log(`${yard}	${name}	damage ${r.damage.toFixed(1)}%	to90 ${r.to90.toFixed(0)} s	lost ${(r.lost * 100).toFixed(0)}%`);
    }
  }
} else {
  const fmt = (r: { damage: number; to90: number; lost: number }) =>
    `${r.damage.toFixed(0)}% ${Number.isFinite(r.to90) ? r.to90.toFixed(0) + "s" : "-"} L${(r.lost * 100).toFixed(0)}`;
  console.log(["pair", ...Object.keys(SHAPES).flatMap((k) => STEPS.slice(1).map((x) => `${k}+${x * 100}`))].join("	"));
  for (const [yard, name, scale] of PAIRS) {
    const army = scaled(ARMIES[name]!, scale);
    const base = avg(yard, army);
    const row = [`${yard}/${name}x${scale}`, `base ${fmt(base)}`];
    for (const [shape, make] of Object.entries(SHAPES)) {
      for (const x of STEPS.slice(1)) row.push(`${shape}+${Math.round(x * 100)} ${fmt(avg(yard, army, make(x)))}`);
    }
    console.log(row.join("	"));
  }
}
