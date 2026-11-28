import { readFileSync } from "node:fs";
import { replayAttack } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/replay.js";
import * as frost from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/frost.js";
// usage: bun measure3.mjs <yard: sandbox|small> <ability> <count> <levels csv> [nSeeds] [ladder overrides json]
const [yardName, name, count, lvArg, nSeeds = "10", over] = process.argv.slice(2);
if (over) for (const [k, v] of Object.entries(JSON.parse(over))) v.forEach((x, i) => (frost[k][i] = x));
const sb = JSON.parse(readFileSync("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/test/fixtures/baseload-sandbox-yard.json", "utf8"));
const fx = JSON.parse(readFileSync("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/test/fixtures/combat/frost-raid.json", "utf8"));
const yard = yardName === "sandbox" ? sb.buildingdata : fx.yard;
const resources = yardName === "sandbox" ? sb.resources : fx.resources;
const spots = yardName === "sandbox" ? [[900,-700],[-900,700],[900,700],[-900,-700]] : [[-520,-520],[720,-320],[-320,720],[720,720]];
const mon = { eyera: "C5", teratorn: "C14", fang: "C8" }[name];
const escort = name === "eyera" ? { C1: 4 * Number(count) } : {};
const seeds = Array.from({ length: Number(nSeeds) }, (_, i) => 1000 + i * 37);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
for (const L of lvArg.split(",").map(Number)) {
  const res = { false: [], true: [] };
  for (const isFrost of [false, true]) for (const [x, y] of spots) for (const seed of seeds) {
    const o = replayAttack({ buildingdata: yard, buildinghealthdata: {}, resources, kind: "main", playerLevel: 20, tailTicks: 48000, raid: true,
      defenderLevels: { [mon]: L, C1: L },
      log: { v: 1, seed, events: [{ kind: "raid", t: 0, x, y, r: 70, monsters: { [mon]: Number(count), ...escort }, ...(isFrost ? { frost: true } : {}) }] } });
    res[isFrost].push({ d: o.damage, k: o.creepsKilled, n: o.creepsFlung, b: o.destroyedIds.length });
  }
  const n = res.false, f = res.true, D = (a) => a.map((r) => r.d), B = (a) => a.map((r) => r.b), K = (a) => a.map((r) => r.k);
  let up = 0, down = 0; n.forEach((r, i) => { if (f[i].d > r.d + 0.5) up++; else if (f[i].d < r.d - 0.5) down++; });
  console.log(yardName, name, mon + "x" + count, "L" + L,
    "dmg% mean", mean(D(n)).toFixed(1), "->", mean(D(f)).toFixed(1), "x" + (mean(D(f)) / mean(D(n))).toFixed(3),
    "| med", q(D(n), .5).toFixed(1), "->", q(D(f), .5).toFixed(1),
    "| bldgs", mean(B(n)).toFixed(1), "->", mean(B(f)).toFixed(1), "x" + (mean(B(f)) / mean(B(n))).toFixed(3),
    "| lost", mean(K(n)).toFixed(1), "->", mean(K(f)).toFixed(1), "/" + n[0].n,
    "| frost better/worse", up + "/" + down + " of " + n.length);
}
