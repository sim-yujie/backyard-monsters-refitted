import { readFileSync } from "node:fs";
import { createBattle } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/engine.js";
import { buildEngineYard } from "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web/src/game/combat/rules/yard.js";
const bd = JSON.parse(readFileSync("/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/76e0abb4-8739-4ca5-9be3-d7f40897aab6/scratchpad/frost-abil-r2/.yt-clean-bd.json", "utf8"));
delete bd["84"].m;
for (const [x, y] of [[400, -100], [-400, 300], [0, 400]]) {
  const yard = buildEngineYard({ buildingdata: bd, buildinghealthdata: {}, resources: { r1: 1e6, r2: 1e6, r3: 1e6, r4: 0 } });
  const b = createBattle(yard, { seed: 5, raid: true, bunkers: { 84: { C14: 3 } }, defenderLevels: { C14: 6 }, wildChampions: true });
  b.apply({ kind: "raid", t: 0, x, y, r: 20, monsters: { C1: 2 }, champion: { t: 6, l: 6 } });
  let first = -1, flyersSeen = 0;
  for (let i = 0; i < 80 * 60 && !b.over(); i++) {
    b.step();
    const fl = b.creeps().filter((c) => c.friendly && c.flying);
    flyersSeen = Math.max(flyersSeen, fl.length);
    if (first < 0 && fl.some((c) => c.frostbitten)) first = b.tick;
  }
  console.log("Krampus from", x, y, "defending flyers seen", flyersSeen, "first shard frostbite at tick", first, first > 0 ? "(" + (first / 80).toFixed(1) + " s)" : "");
}
