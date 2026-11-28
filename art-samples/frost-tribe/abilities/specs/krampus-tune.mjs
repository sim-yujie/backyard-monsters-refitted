// Krampus alone on the sandbox yard (champ-measure.mjs's), with ladders overridden:
//   bun krampus-tune.mjs '{"damage":[...],"health":[...],"cut":[...],"freeze":[...],"freezeSec":[...]}' [levels]
// Fomor / Korath on the same yard, 10 seeds x 4 spots: L1 5.9 / 17.2, L3 8.5 / 23.7, L6 12.2 / 29.2.
import { readFileSync } from "node:fs";
const W = "/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/web";
const { replayAttack } = await import(W + "/src/game/combat/rules/replay.ts");
const { WILD_CHAMPION_PROPS } = await import(W + "/src/game/combat/rules/wildChampions.ts");
const ch = await import(W + "/src/game/combat/rules/champions.ts");
const over = JSON.parse(process.argv[2] ?? "{}");
const p = WILD_CHAMPION_PROPS.G6.props;
const put = (dst, src) => src && src.forEach((v, i) => (dst[i] = v));
put(p.damage, over.damage); put(p.health, over.health); put(p.speed, over.speed); put(p.buffs, over.buffs);
put(ch.KRAMPUS_SIGHT_CUT, over.cut); put(ch.KRAMPUS_FREEZE_CHANCE, over.freeze); put(ch.KRAMPUS_FREEZE_SECONDS, over.freezeSec);
const small = process.env.YARD === "small";
const yt = process.env.YARD === "yardtester";
const sb = yt ? JSON.parse(readFileSync(new URL("./yardtester-main.json", import.meta.url), "utf8")) : small ? (() => { const fx = JSON.parse(readFileSync(W + "/test/fixtures/combat/frost-raid.json", "utf8")); return { buildingdata: fx.yard, resources: fx.resources }; })()
  : JSON.parse(readFileSync(W + "/test/fixtures/baseload-sandbox-yard.json", "utf8"));
const spots = yt ? [[1000,-900],[-1000,800],[900,900],[-1000,-1000]] : small ? [[-520,-520],[720,-320],[-320,720],[720,720]] : process.env.SPOTS8 ? [[900,-700],[-900,700],[900,700],[-900,-700],[0,-1000],[0,1000],[1000,0],[-1000,0]] : [[900,-700],[-900,700],[900,700],[-900,-700]];
const ID = process.env.CHAMP ?? "6";
const seeds = Array.from({ length: 10 }, (_, i) => 11 + i * 11);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
for (const L of (process.argv[3] ?? "1,3,6").split(",").map(Number)) {
  const d = [], b = [];
  for (const [x, y] of spots) for (const seed of seeds) {
    const o = replayAttack({ buildingdata: sb.buildingdata, buildinghealthdata: {}, resources: sb.resources, kind: "main", playerLevel: 20, tailTicks: Number(process.env.TAIL ?? 48000), raid: true,
      log: { v: 1, seed, events: [{ kind: "raid", t: 0, x, y, r: 40, monsters: {}, champion: { t: Number(ID), l: L } }] } });
    d.push(o.damage); b.push(o.destroyedIds.length);
  }
  console.log("L" + L, "G" + ID, yt ? "yardtester" : small ? "small" : "sandbox", "dmg%", mean(d).toFixed(1), "bldgs", mean(b).toFixed(1));
}
