/**
 * Times every wave of the wave events against one yard (`bun scripts/waveLoad.ts <yard.json> [wmi1:30,wmi2:32]`),
 * for retuning the tables and the load estimate. The yard JSON is a main save's buildingdata, buildinghealthdata,
 * resources, academy, champion and storedata. Reads no database.
 */
import fs from "node:fs";
import { defenderForcesOf } from "../src/game-rules/combat/index.js";
import { fightRaid } from "../src/services/raids/raidFight.js";
import { planWave } from "../src/services/events/waves/wavePlan.js";
import { waveEventByKey } from "../src/services/events/waves/waveEvents.js";
import { waveBeaten } from "../src/services/events/waves/wavePlan.js";

const yard = JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"));
const defence = defenderForcesOf({ buildingdata: yard.buildingdata, academy: yard.academy, champion: yard.champion, storedata: yard.storedata, now: Math.floor(Date.now() / 1000) });
const which = (process.argv[3] ?? "wmi1:1,wmi1:10,wmi1:30,wmi1:31,wmi1:32,wmi2:19,wmi2:30,wmi2:31,wmi2:32").split(",");
for (const item of which) {
  const [key, n] = item.split(":");
  const event = waveEventByKey(key!)!;
  const plan = planWave({ event, wave: Number(n), quarter: 0 })!;
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const outcome = fightRaid({ buildingdata: yard.buildingdata, buildinghealthdata: yard.buildinghealthdata, resources: yard.resources, log: { v: 1, seed: 12345, events: plan.events }, defence, raidSpawnsUntil: plan.lastSpawnTick });
  const ms = performance.now() - started;
  const heap = (process.memoryUsage().heapUsed - heapBefore) / 1e6;
  const total = Object.values(plan.army).reduce((a, b) => a + b, 0);
  console.log(`${key} wave ${n}: ${total} monsters, ${ms.toFixed(0)} ms, ~${heap.toFixed(1)} MB heap, fight ${(outcome.ticks / 80).toFixed(0)} s, last spawn ${(plan.lastSpawnTick / 80).toFixed(0)} s, health ${(outcome.healthShare * 100).toFixed(0)}%, killed ${outcome.creepsKilled}/${outcome.creepsFlung}, beaten ${waveBeaten(outcome)}, champs skipped ${plan.championsSkipped}`);
}
