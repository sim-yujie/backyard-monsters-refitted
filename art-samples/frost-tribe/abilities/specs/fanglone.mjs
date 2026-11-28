import { createBattle } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/engine.js";
import { buildEngineYard } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/yard.js";
import * as frost from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/frost.js";
const over = process.argv[2]; if (over) for (const [k, v] of Object.entries(JSON.parse(over))) v.forEach((x, i) => (frost[k][i] = x));
const hpLost = (L, isFrost, secs) => {
  const yard = buildEngineYard({ buildingdata: { "1": { id: 1, t: 1, l: 10, X: 0, Y: 0, st: 1_000_000 } }, buildinghealthdata: {}, resources: { r1: 1e6, r2: 0, r3: 0, r4: 0 } });
  const b = createBattle(yard, { seed: 7, raid: true, defenderLevels: { C8: L } });
  b.apply({ kind: "raid", t: 0, x: 60, y: 60, r: 10, monsters: { C8: Number(process.env.N ?? 3) }, ...(isFrost ? { frost: true } : {}) });
  for (let i = 0; i < secs * 80 && !b.over(); i++) b.step();
  const h = yard.buildings.find((x) => x.id === 1);
  return h.maxHp - h.hp;
};
for (const L of [1,2,3,4,5,6]) { const n = hpLost(L, false, 30), f = hpLost(L, true, 30); console.log("Fang L" + L, "harvester hp lost in 30 s:", n, "->", f, "x" + (f / n).toFixed(3)); }
