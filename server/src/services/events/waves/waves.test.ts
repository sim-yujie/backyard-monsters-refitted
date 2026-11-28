import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * The wave events (beta 10, Wild Monster Invasion 1 and 2): the Flash tables,
 * the wave planner, the win rule, the dashboard's runs, the landing (no
 * theft, progress, Glimmers once, the totem) and the status the HUD reads.
 */

mock.module("../../../server.js", () => ({
  postgres: { em: {} },
  redis: memoryRedis(),
}));

const { WAVE_EVENTS, waveEventByKey } = await import("./waveEvents.js");
const { planWave, waveBeaten, waveSize } = await import("./wavePlan.js");
const { readRuns, runId, runningWaveRun, startWaveRun, stopWaveRun } = await import("./waveRuns.js");
const { TOTEM_LEVEL_AFTER_WAVE, WAVE_GLIMMERS, totemLevelFor } = await import("./waveRewards.js");
const { giveTotem, landWave } = await import("./waveLanding.js");
const { memoryWaveProgressStore, useWaveProgressStore } = await import("./waveProgress.js");
const { waveStatusOf } = await import("./waveFight.js");
const { waveRunEvents } = await import("./waveRunEvents.js");
const { WAVE_TRIBE } = await import("./waveTribe.js");
const { memoryCoinStore, useCoinStore } = await import("../eventCoins.js");
const { landRaid } = await import("../../raids/raidLanding.js");
const { fightRaid } = await import("../../raids/raidFight.js");
const { readSchedule } = await import("../../raids/raidSchedule.js");
const { RAID_MAX_SECONDS, ticks } = await import("../../../game-rules/combat/index.js");

const WMI1 = waveEventByKey("wmi1")!;
const WMI2 = waveEventByKey("wmi2")!;
const em = {} as EntityManager;
const DAY = 86_400;

describe("the Flash tables", () => {
  test("each invasion has 30 waves, 2 bonus waves and a prize per wave", () => {
    // The Brukkarg attack events (card `yards`) have their own tables: `yards/yardEvents.test.ts`.
    for (const event of WAVE_EVENTS.filter((one) => one.card === undefined)) {
      expect(event.waves.length).toBe(32);
      expect(event.prizes.length).toBe(32);
      expect(event.firstBonusWave).toBe(31);
      expect(event.days).toBe(7);
      for (const wave of event.waves) expect(wave.length).toBeGreaterThan(0);
    }
  });

  test("Flash's descriptions: WMI1 wave 1 is 5 Octo-oozes, WMI2 wave 19 is 240 Spurtz, wave 30 is 40 Sabnox, 80 Grokus, 32 King Wormzer", () => {
    expect(planWave({ event: WMI1, wave: 1, quarter: 0 })!.army).toEqual({ C2: 5 });
    expect(planWave({ event: WMI2, wave: 19, quarter: 0 })!.army).toEqual({ IC1: 240 });
    // `WAVES_DESC[29]`: "40 Max enraged Sabnox, 80 MAX enraged Grokus, 32 max enraged King Wormzer".
    expect(planWave({ event: WMI2, wave: 30, quarter: 0 })!.army).toEqual({ IC7: 40, IC6: 80, IC8: 32 });
  });

  test("WMI2 is Inferno monsters only; WMI1 has champion groups (Gorgo, Drull, Fomor)", () => {
    for (const wave of WMI2.waves) for (const group of wave) expect(group.kind === "creep" && group.monster.startsWith("IC")).toBe(true);
    const guardians = new Set(WMI1.waves.flat().flatMap((group) => (group.kind === "champion" ? [group.guardian] : [])));
    expect([...guardians].sort()).toEqual([1, 2, 3]);
  });

  test("the prize table: Glimmers every wave, more on totem waves, the totem at 1/10/20/30 and the bonus waves", () => {
    const prizes = WMI1.prizes;
    expect(prizes[1]).toEqual({ glimmers: WAVE_GLIMMERS.ordinary });
    expect(prizes[0]).toEqual({ glimmers: WAVE_GLIMMERS.totemWave, totemLevel: 1 });
    expect(prizes[29]).toEqual({ glimmers: WAVE_GLIMMERS.totemWave, totemLevel: 4 });
    expect(prizes[30]).toEqual({ glimmers: WAVE_GLIMMERS.bonus1, totemLevel: 5 });
    expect(prizes[31]).toEqual({ glimmers: WAVE_GLIMMERS.bonus2, totemLevel: 6 });
    expect(Object.keys(TOTEM_LEVEL_AFTER_WAVE)).toEqual(["1", "10", "20", "30", "31", "32"]);
    expect([0, 1, 9, 10, 29, 30, 31, 32].map(totemLevelFor)).toEqual([0, 1, 1, 2, 3, 4, 5, 6]);
  });
});

describe("planWave", () => {
  test("each group lands on its own tick at its level, Lab rank and rage, turned by the wave's quarter turn", () => {
    // WMI2 wave 32: IC4 at 0, 5, 10, 15 s, level 6, powerup 3, rage 20.
    const plan = planWave({ event: WMI2, wave: 32, quarter: 0 })!;
    const first = plan.events[0]!;
    expect(first).toMatchObject({ kind: "raid", t: 0, monsters: { IC4: 12 }, level: 6, rank: 3, rage: 20 });
    expect(plan.events[1]!.t).toBe(ticks(5));
    expect(plan.lastSpawnTick).toBe(Math.max(...plan.events.map((event) => event.t)));
    // North (270) by default; a half turn sends it from the south.
    const north = planWave({ event: WMI1, wave: 1, quarter: 0 })!.events[0]!;
    const south = planWave({ event: WMI1, wave: 1, quarter: 2 })!.events[0]!;
    expect(north.y).toBeLessThan(0);
    expect(south.y).toBeGreaterThan(0);
    expect(planWave({ event: WMI1, wave: 1, quarter: 2 })!.turn).toBe(180);
  });

  test("a group with no rank or rage leaves them out (Moloch's ranks and no enrage)", () => {
    const event = planWave({ event: WMI1, wave: 1, quarter: 0 })!.events[0]!;
    expect(event.rank).toBeUndefined();
    expect(event.rage).toBeUndefined();
  });

  test("the champion seam: wave 22's champion lands as a champion raider at the table's level, food bonus and health", () => {
    const plan = planWave({ event: WMI1, wave: 22, quarter: 0 })!;
    expect(plan.championsSkipped).toBe(0);
    const champion = plan.events.find((event) => event.champion);
    expect(champion?.monsters).toEqual({});
    expect(champion?.champion?.hp).toBe(120000);
    expect(champion?.champion?.t).toBeGreaterThanOrEqual(1);
    // A spawner that answers null still skips and counts it.
    const skipped = planWave({ event: WMI1, wave: 22, quarter: 0, champions: () => null })!;
    expect(skipped.championsSkipped).toBe(1);
  });

  test("every WMI1 champion wave (20, 22, 26, 30, 31) brings its champion", () => {
    for (const wave of [20, 22, 26, 30, 31]) {
      const plan = planWave({ event: WMI1, wave, quarter: 0 })!;
      expect(plan.events.some((event) => event.champion)).toBe(true);
      expect(plan.championsSkipped).toBe(0);
    }
  });

  test("a wave past the table is null; waveSize counts monsters and champions", () => {
    expect(planWave({ event: WMI1, wave: 33, quarter: 0 })).toBeNull();
    expect(waveSize(WMI1, 1)).toBe(5);
    expect(waveSize(WMI1, 22)).toBe(20 + 1 + 10);
  });
});

describe("waveBeaten (Flash's WMATTACK clean-up for an event)", () => {
  test("more than 10% of the yard standing and the fight over before the raiders' cap", () => {
    expect(waveBeaten({ ticks: 8000, healthShare: 0.11 })).toBe(true);
    expect(waveBeaten({ ticks: 8000, healthShare: 0.1 })).toBe(false);
    // Ran to the cap: raiders were left standing.
    expect(waveBeaten({ ticks: ticks(RAID_MAX_SECONDS), healthShare: 0.9 })).toBe(false);
  });
});

describe("the dashboard's runs", () => {
  const NOW = 1_900_000_000;
  test("start one at a time for the event's week; stop ends it now", () => {
    const one = startWaveRun([], "wmi1", NOW);
    expect(one).toEqual([{ event: "wmi1", startsAt: NOW, endsAt: NOW + 7 * DAY }]);
    expect(startWaveRun(one as never, "wmi2", NOW + 10)).toBe("alreadyRunning");
    expect(startWaveRun([], "nope", NOW)).toBe("unknownEvent");
    const stopped = stopWaveRun(one as never, NOW + 100)!;
    expect(stopped[0]!.endsAt).toBe(NOW + 100);
    expect(runningWaveRun(NOW + 100, stopped)).toBeNull();
    expect(stopWaveRun(stopped, NOW + 200)).toBeNull();
    const two = startWaveRun(stopped, "wmi2", NOW + 200, 3) as { event: string; startsAt: number; endsAt: number }[];
    expect(two.at(-1)).toEqual({ event: "wmi2", startsAt: NOW + 200, endsAt: NOW + 200 + 3 * DAY });
  });

  test("the stored value keeps only known events with a start before the end", () => {
    expect(readRuns({ runs: [{ event: "wmi1", startsAt: 5, endsAt: 9 }, { event: "x", startsAt: 1, endsAt: 2 }, { event: "wmi2", startsAt: 9, endsAt: 5 }] })).toEqual([
      { event: "wmi1", startsAt: 5, endsAt: 9 },
    ]);
  });

  test("each run is an Events page entry of kind wave", () => {
    const [entry] = waveRunEvents([{ event: "wmi2", startsAt: NOW, endsAt: NOW + DAY }]);
    expect(entry).toMatchObject({ id: `wmi2-${NOW}`, kind: "wave", title: "Wild Monster Invasion 2", banner: WMI2.banner.modern });
  });
});

describe("the status the HUD reads", () => {
  const run = { event: "wmi1", startsAt: 1000, endsAt: 1000 + 7 * DAY };
  test("next wave, its preview and prize; bonus waves keep their armies hidden; none after the last", () => {
    const fresh = waveStatusOf(WMI1, run, 0, 0);
    expect(fresh).toMatchObject({ next: 1, size: 5, preview: [{ monster: "C2", count: 5 }], totemLevel: 0, run: runId(run) });
    expect(fresh.prize).toEqual({ glimmers: WAVE_GLIMMERS.totemWave, totemLevel: 1 });
    const bonus = waveStatusOf(WMI1, run, 30, 3);
    expect(bonus).toMatchObject({ next: 31, preview: [], totemLevel: 4, lost: 3 });
    expect(waveStatusOf(WMI1, run, 32, 0)).toMatchObject({ next: null, prize: null, totemLevel: 6 });
  });
});

describe("giveTotem (Flash's BTOTEM.TotemReward / UpgradeTotem)", () => {
  test("none yet: one into storage at the level", () => {
    const save = { buildingdata: {}, researchdata: {} };
    expect(giveTotem(save, 121, 1)).toEqual({ level: 1, placed: false, raised: true });
    expect(save.researchdata).toEqual({ b121: 1, bl121: 1 });
  });
  test("placed: raised where it stands, never lowered", () => {
    const save = { buildingdata: { "9": { id: 9, t: 121, X: 0, Y: 0, l: 3 } }, researchdata: {} } as never as {
      buildingdata: Record<string, { l?: number }>;
      researchdata: Record<string, unknown>;
    };
    expect(giveTotem(save as never, 121, 4)).toEqual({ level: 4, placed: true, raised: true });
    expect(save.buildingdata["9"]!.l).toBe(4);
    expect(giveTotem(save as never, 121, 2)).toEqual({ level: 4, placed: true, raised: false });
    expect(save.researchdata).toEqual({});
  });
  test("stored: its stored level raised, the count kept", () => {
    const save = { buildingdata: {}, researchdata: { b131: 1, bl131: 2 } };
    expect(giveTotem(save, 131, 3)).toEqual({ level: 3, placed: false, raised: true });
    expect(save.researchdata).toEqual({ b131: 1, bl131: 3 });
  });
});

describe("a wave's landing", () => {
  const NOW = 1_900_000_000;
  const RUN = "wmi1-1899999000";
  let coins: ReturnType<typeof memoryCoinStore>;
  let progress: ReturnType<typeof memoryWaveProgressStore>;
  let restore: (() => void)[] = [];
  beforeEach(() => {
    coins = memoryCoinStore();
    progress = memoryWaveProgressStore();
    const before = [useCoinStore(coins), useWaveProgressStore(progress)] as const;
    restore = [() => useCoinStore(before[0]), () => useWaveProgressStore(before[1])];
  });
  afterEach(() => restore.forEach((undo) => undo()));

  const yard = () =>
    ({
      type: "main",
      mapversion: 2,
      wmid: 0,
      buildingdata: {
        "0": { id: 0, t: 14, X: 0, Y: 0, l: 1 },
        "1": { id: 1, t: 1, X: 100, Y: 0, l: 1, st: 300 },
        "2": { id: 2, t: 6, X: 0, Y: 100, l: 1 },
      },
      buildinghealthdata: {},
      researchdata: {},
      resources: { r1: 1000, r2: 50, r3: 0, r4: 0 },
      credits: 100,
      champion: [],
      monsters: {},
      academy: {},
      storedata: {},
      firedtraps: [],
      damage: 0,
      aiattacks: { v: 2, lastattack: 0, nextAttack: NOW + 999, sessionsSinceLastAttack: 4, attackPreference: 0, recent: [], fight: { id: "r_w", until: NOW + 60 } },
    }) as never as Parameters<typeof landRaid>[0] & { researchdata: Record<string, unknown> };

  const outcome = (healthShare: number) => ({
    ticks: 8000,
    health: { "2": 10 },
    damage: Math.round((1 - healthShare) * 100),
    firedTraps: [],
    destroyedIds: [],
    defenderLoss: { r1: 900, r2: 50, r3: 0, r4: 0 },
    bankLoss: { r1: 600, r2: 50, r3: 0, r4: 0 },
    harvesterLoss: { "1": 300 },
    healthShare,
    bunkerGarrisons: {},
    defenderChampions: [],
    creepsFlung: 5,
    creepsKilled: 5,
    digest: "d",
  });

  test("steals nothing, pays no Shiny, starts repairs and leaves the wild raids' wait alone", () => {
    const save = yard();
    const result = landRaid(save, { id: "r_w", tribe: WAVE_TRIBE, startedAt: NOW - 100, outcome: outcome(0.95) }, NOW);
    expect(result.stolen).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(result.shiny).toBe(0);
    expect(save.resources).toMatchObject({ r1: 1000, r2: 50 });
    expect(save.buildingdata!["1"]!.st).toBe(300);
    expect(save.buildingdata!["2"]!.rE).toBe(1);
    const schedule = readSchedule(save.aiattacks);
    expect(schedule.nextAttack).toBe(NOW + 999);
    expect(schedule.fight).toBeUndefined();
  });

  test("costs only repairs: fired traps stay armed, bunkers keep defenders, the champion its health, no housed loss", () => {
    const save = yard();
    (save.buildingdata as Record<string, unknown>)["7"] = { id: 7, t: 24, X: 200, Y: 0, l: 1 };
    save.champion = [{ t: 1, l: 3, hp: 5000 }] as never;
    const result = landRaid(
      save,
      {
        id: "r_w",
        tribe: WAVE_TRIBE,
        startedAt: NOW - 100,
        outcome: { ...outcome(0.6), firedTraps: [7], health: { "2": 10, "7": 0 }, defenderChampions: [{ t: 1, hp: 1 }] },
      },
      NOW
    );
    expect(save.buildingdata!["7"]).toBeDefined();
    expect((save.buildinghealthdata as Record<string, unknown>)["7"]).toBeUndefined();
    expect(save.firedtraps ?? []).not.toContain(7);
    expect(save.champion as unknown).toEqual([{ t: 1, l: 3, hp: 5000 }]);
    expect(result.housedLost).toBe(0);
    expect(save.buildingdata!["2"]!.rE).toBe(1);
  });

  test("wave 1 beaten: counted, Glimmers paid once, the totem into storage", async () => {
    const save = yard();
    const plan = { army: { C2: 5 }, wave: { event: "wmi1", run: RUN, wave: 1 } };
    const result = await landWave(em, save as never, 7, plan, outcome(0.5));
    expect(result).toMatchObject({ beaten: true, wave: 1, next: 2, glimmers: WAVE_GLIMMERS.totemWave, totem: { type: 121, level: 1, placed: false } });
    expect(save.researchdata).toEqual({ b121: 1, bl121: 1 });
    expect(coins.balances.get(7)).toBe(WAVE_GLIMMERS.totemWave);
    // The same wave landed twice pays nothing more.
    const again = await landWave(em, save as never, 7, plan, outcome(0.5));
    expect(again).toMatchObject({ beaten: true, glimmers: 0, next: 2 });
    expect(coins.balances.get(7)).toBe(WAVE_GLIMMERS.totemWave);
  });

  test("10% or less standing is a loss: counted as lost, nothing paid, the same wave next", async () => {
    const save = yard();
    const result = await landWave(em, save as never, 7, { wave: { event: "wmi1", run: RUN, wave: 1 } }, outcome(0.1));
    expect(result).toMatchObject({ beaten: false, next: 1, glimmers: 0 });
    expect(result!.totem).toBeUndefined();
    expect((await progress.read(em, 7, RUN)).lost).toBe(1);
  });

  test("a surrendered wave is a loss whatever the yard held", async () => {
    const result = await landWave(em, yard() as never, 7, { wave: { event: "wmi1", run: RUN, wave: 1, surrendered: true } }, outcome(1));
    expect(result).toMatchObject({ beaten: false, surrendered: true });
  });

  test("the last bonus wave beaten: Black Diamond totem, no next wave", async () => {
    progress.rows.set(`7:${RUN}`, { beaten: 31, lost: 0 });
    const save = yard();
    (save.buildingdata as Record<string, unknown>)["8"] = { id: 8, t: 121, X: 50, Y: 50, l: 5 };
    const result = await landWave(em, save as never, 7, { wave: { event: "wmi1", run: RUN, wave: 32 } }, outcome(0.6));
    expect(result).toMatchObject({ beaten: true, next: null, glimmers: WAVE_GLIMMERS.bonus2, totem: { level: 6, placed: true } });
  });
});

describe("surrender's cut-off fight (RaidFightInput.stopAt)", () => {
  const SANDBOX = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url)), "utf8"),
  ) as { buildingdata: Parameters<typeof fightRaid>[0]["buildingdata"]; resources: Record<string, number> };

  test("the yard as it stood at the cut, later waves never landing; a cut past the end is the whole fight", () => {
    const plan = planWave({ event: WMI2, wave: 9, quarter: 1 })!;
    const input = { buildingdata: SANDBOX.buildingdata, resources: SANDBOX.resources, log: { v: 1 as const, seed: 9, events: plan.events }, raidSpawnsUntil: plan.lastSpawnTick };
    const whole = fightRaid(input);
    const early = fightRaid({ ...input, stopAt: ticks(3) });
    expect(early.ticks).toBe(ticks(3));
    expect(early.damage).toBeLessThanOrEqual(whole.damage);
    // Groups due at 16 s never spawned by 3 s.
    expect(early.creepsFlung).toBeLessThan(whole.creepsFlung);
    const past = fightRaid({ ...input, stopAt: whole.ticks + 1000 });
    expect(past.digest).toBe(whole.digest);
  });
});
