import { readFileSync } from "node:fs";
import { replayAttack } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/replay.js";
const sb = JSON.parse(readFileSync("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/test/fixtures/baseload-sandbox-yard.json", "utf8"));
const spots = [[900,-700],[-900,700],[900,700],[-900,-700]];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
for (const L of (process.env.LV ?? "1,3,6").split(",").map(Number)) {
  const row = [];
  for (const [name, t] of [["Fomor",3],["Krampus",6],["Korath",4]]) {
    const d = [], hp = [];
    for (const [x,y] of spots) for (const seed of [11, 22, 33]) {
      const o = replayAttack({ buildingdata: sb.buildingdata, buildinghealthdata: {}, resources: sb.resources, kind: "main", playerLevel: 20, tailTicks: 48000, raid: true,
        log: { v: 1, seed, events: [{ kind: "raid", t: 0, x, y, r: 40, monsters: {}, champion: { t, l: L } }] } });
      d.push(o.damage); hp.push(o.destroyedIds.length);
    }
    row.push(name + " dmg% " + mean(d).toFixed(1) + " bldgs " + mean(hp).toFixed(1));
  }
  console.log("L" + L, row.join(" | "));
}
