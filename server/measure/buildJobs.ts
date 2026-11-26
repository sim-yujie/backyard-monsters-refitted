// Builds the replay jobs the bench fights, from the helper's own database copy (battle_load_db).
// Read-only. Writes measure/jobs.json: { kind, label, job } where job is a ReplayJob.
//
//   DB_NAME=battle_load_db REDIS_URL=redis://localhost:6379/13 bun measure/buildJobs.ts
//
// What is real and what is built:
// - repeat: every saved Repeat plan in the copy (bym.attack_plan, real hand-played plans by
//   yardtester 2503 and others), fought on the camp's fresh layout to the plan's own tick, as
//   a Repeat's landing fights it.
// - save: the one real stored player attack (bym.defence_replay: 30 C14 + 2 champions, to tick
//   24,000 = 5 min), re-fought on real main yards of the copy spread across building counts
//   (the same fling, so only the yard changes), plus a second army (5 flings of C12) to tick 16,000.
// - raid: the server's own raid planner (planRaid) on the same real main yards, then fightRaid.
// - inferno: the 13 Descent yards (descentYardOf) with an Inferno army (IC monsters), as a
//   Descent landing fights them.
import pg from "pg";
import { writeFileSync } from "node:fs";
import { decodeReplay } from "../src/services/defences/defenceReplayStore.js";
import { freshCampYard } from "../src/services/base/autoAttack/planCheck.js";
import { planLog, type AttackPlan } from "../src/services/base/autoAttack/attackPlan.js";
import { defenderForcesOf, withAttackerBuffs, type CombatBuildingDataMap } from "../src/game-rules/combat/index.js";
import { planRaid } from "../src/services/raids/raidPlan.js";
import { descentYardOf } from "../src/services/inferno/descent.js";
import { playerLevelOf } from "../src/services/base/calculateBaseLevel.js";
import type { ReplayJob } from "../src/services/base/combat/replayRunner.js";

if (process.env.DB_NAME !== "battle_load_db") throw new Error("set DB_NAME=battle_load_db");
const db = new pg.Client({ host: "localhost", port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
await db.connect();

const NOW = Math.floor(Date.now() / 1000);
const jobs: { kind: string; label: string; job: ReplayJob }[] = [];

const housedOf = (monsters: any) => {
  const housed = monsters?.housed;
  return housed && typeof housed === "object" && !Array.isArray(housed) ? housed : monsters;
};

// ---- repeat (camp) ----
const yt = (await db.query("select academy, champion, storedata from bym.save where basesaveid = 2503")).rows[0];
const plans = (await db.query("select p.userid, p.wmid, p.level, p.plan, s.academy, s.champion, s.storedata from bym.attack_plan p join bym.save s on s.userid = p.userid and s.type = 'main'")).rows;
for (const row of plans) {
  const plan = row.plan as AttackPlan;
  const yard = freshCampYard({ wmid: row.wmid, level: row.level });
  const buildingdata = (yard.buildingdata ?? {}) as CombatBuildingDataMap;
  const defence = withAttackerBuffs(
    defenderForcesOf({
      buildingdata,
      academy: yard.academy,
      champion: yard.champion,
      storedata: yard.storedata,
      now: NOW,
      monsters: housedOf(yard.monsters),
      buildinghealthdata: {},
    }),
    row.storedata ?? null,
    NOW
  );
  const log = planLog(plan, 12345, row.champion);
  jobs.push({
    kind: "repeat",
    label: `plan u${row.userid} w${row.wmid} L${row.level} ev${plan.events.length} tick${plan.tick}`,
    job: {
      kind: "abandoned",
      input: {
        defender: { type: "tribe", buildingdata, buildinghealthdata: null, resources: (yard.resources ?? null) as any },
        attacker: { academy: row.academy, champion: row.champion ?? null, siege: null },
        log,
        tick: plan.tick,
        declareWar: false,
        defence,
      },
    },
  });
}

// ---- save (player attack) ----
const real = decodeReplay((await db.query("select replay from bym.defence_replay limit 1")).rows[0].replay);
const realAcademy = Object.fromEntries(Object.entries(real.levels).map(([id, level]) => [id, { level }]));
const realChampions = [
  { t: 3, l: 6, hp: 40000, status: 0, pl: 1 },
  { t: 5, l: 5, hp: 62000, status: 0, pl: 2 },
];
// Real main yards across the building-count spread (every ~1/14th of the list by count).
const yards = (
  await db.query(`
    with y as (
      select basesaveid, userid, buildingdata, buildinghealthdata, resources, academy, champion, storedata, monsters, points, basevalue, aiattacks,
             (select count(*) from jsonb_object_keys(buildingdata)) nb,
             row_number() over (order by (select count(*) from jsonb_object_keys(buildingdata)) desc) rn,
             count(*) over () total
      from bym.save where type = 'main' and jsonb_typeof(buildingdata) = 'object'
    )
    select * from y where rn = 1 or rn % (total / 14) = 0 order by rn limit 15`)
).rows;
const c12Army = {
  v: 1 as const,
  seed: 777,
  events: [
    { kind: "fling", t: 400, x: -560, y: -300, r: 100, monsters: { C12: 3 } },
    { kind: "fling", t: 900, x: 560, y: -300, r: 100, monsters: { C12: 3 } },
    { kind: "fling", t: 1400, x: -560, y: 300, r: 100, monsters: { C12: 3 } },
    { kind: "fling", t: 1900, x: 560, y: 300, r: 100, monsters: { C12: 3 } },
    { kind: "fling", t: 2400, x: 0, y: 650, r: 100, monsters: { C12: 3 } },
  ],
};
for (const y of yards) {
  const defence = defenderForcesOf({
    buildingdata: y.buildingdata,
    academy: y.academy,
    champion: y.champion,
    storedata: y.storedata,
    now: NOW,
    monsters: housedOf(y.monsters),
    buildinghealthdata: y.buildinghealthdata,
  });
  const defender = { type: "main", buildingdata: y.buildingdata, buildinghealthdata: y.buildinghealthdata, resources: y.resources };
  jobs.push({
    kind: "save",
    label: `real army (30 C14 + 2 champs) on yard ${y.basesaveid} nb${y.nb} tick24000`,
    job: {
      kind: "abandoned",
      input: {
        defender,
        attacker: { academy: realAcademy, champion: realChampions as any, siege: null },
        log: { v: 1, seed: real.seed, events: real.events },
        tick: real.tick,
        declareWar: false,
        defence,
        left: false,
      },
    },
  });
  jobs.push({
    kind: "save",
    label: `5x3 C12 on yard ${y.basesaveid} nb${y.nb} tick16000`,
    job: {
      kind: "abandoned",
      input: {
        defender,
        attacker: { academy: yt.academy, champion: null, siege: null },
        log: c12Army as any,
        tick: 16000,
        declareWar: false,
        defence,
        left: false,
      },
    },
  });

  // ---- raid on the same yard ----
  const plan = planRaid({
    buildingdata: y.buildingdata,
    buildinghealthdata: y.buildinghealthdata,
    resources: y.resources,
    level: playerLevelOf(y),
    preference: 0,
    seed: 4242 + Number(y.basesaveid),
  });
  if (plan) {
    jobs.push({
      kind: "raid",
      label: `${plan.tribe} raid on yard ${y.basesaveid} nb${y.nb} lvl${playerLevelOf(y)}`,
      job: { kind: "raid", input: { buildingdata: y.buildingdata, buildinghealthdata: y.buildinghealthdata, resources: y.resources, log: plan.log, defence } },
    });
  }
}

// ---- inferno (Descent landing) ----
const infernoAcademy = Object.fromEntries(["IC1", "IC2", "IC3", "IC4", "IC5", "IC6", "IC7", "IC8"].map((id) => [id, { level: 3 }]));
for (let index = 1; index <= 13; index++) {
  const yard = descentYardOf(index) as any;
  const buildingdata = (yard.buildingdata ?? {}) as CombatBuildingDataMap;
  const defence = defenderForcesOf({
    buildingdata,
    academy: yard.academy,
    champion: yard.champion,
    storedata: yard.storedata,
    now: NOW,
    monsters: housedOf(yard.monsters),
    buildinghealthdata: {},
  });
  jobs.push({
    kind: "inferno",
    label: `descent yard ${index} nb${Object.keys(buildingdata).length}`,
    job: {
      kind: "abandoned",
      input: {
        defender: { type: "inferno", buildingdata, buildinghealthdata: null, resources: yard.resources ?? null },
        attacker: { academy: infernoAcademy, champion: null, siege: null },
        log: {
          v: 1,
          seed: 99 + index,
          events: [
            { kind: "fling", t: 400, x: -560, y: -300, r: 150, monsters: { IC3: 8, IC1: 10 } },
            { kind: "fling", t: 1200, x: 560, y: -300, r: 150, monsters: { IC5: 6, IC2: 8 } },
            { kind: "fling", t: 2000, x: 0, y: 620, r: 150, monsters: { IC4: 6, IC6: 4 } },
          ],
        } as any,
        tick: 16000,
        declareWar: false,
        defence,
        descentYard: index,
      },
    },
  });
}

await db.end();
writeFileSync(new URL("./jobs.json", import.meta.url), JSON.stringify(jobs));
const counts: Record<string, number> = {};
for (const j of jobs) counts[j.kind] = (counts[j.kind] ?? 0) + 1;
console.log("jobs", counts);
