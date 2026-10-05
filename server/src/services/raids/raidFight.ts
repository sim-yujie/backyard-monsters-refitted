import {
  RAID_MAX_SECONDS,
  TICKS_PER_SECOND,
  battleDefence,
  buildEngineYard,
  createBattle,
  damagePercent,
  digestState,
  ticks,
  toCombatYard,
  type BuildingHealthMap,
  type CombatBuildingDataMap,
  type DefenderForces,
  type RaidLog,
  type ResourceAmounts,
} from "../../game-rules/combat/index.js";

/**
 * A wild monster raid's fight, run once on the server when it starts (#226
 * WP3, `docs/design/wild-raids.md` §6). Pure, and free of the database, Redis
 * and the logger, so it runs in the replay worker (`replayRunner.ts`).
 *
 * It is `replayRaid` (`game-rules/combat/replay.ts`) step for step, as
 * `abandonedAttack.ts` is `replayAttack`'s: the same yard, options and loop,
 * so the same digest (`raidFight.test.ts` holds the two together). It runs
 * the engine itself only to read the yard the battle leaves behind, which the
 * replay's outcome does not carry and the landing needs:
 *
 * - **What came out of the bank**, from storage hits and falls, apart from
 *   **what each harvester gave up** from its unbanked amount (`st`).
 *   `defenderLoss` is the two together; on a main yard a harvester's loot
 *   never touches the bank (`engine.ts` `takeLoot`).
 * - **The yard's health share**: what is left of the yard over the same
 *   buildings an attack's damage percentage counts (`countsTowardDamage` in
 *   `damagePercent.ts`: no mushrooms, walls, fired traps or health-less
 *   types), so the share is `1 - damage / 100`. Flash's `CleanUp` sums a
 *   similar set for the good-defence popup (`WMATTACK.as:829-835`); the
 *   shared rule is used so a raid and an attack read one yard alike.
 *
 * The raid is a main-yard defence (§6.2 item 5): kind `main`, the raid's hit
 * limit, the player's own bunkers, academy levels and caged champion.
 */

/** What the fight is handed: the yard frozen at the fight's start, and the plan. */
export interface RaidFightInput {
  readonly buildingdata: CombatBuildingDataMap;
  readonly buildinghealthdata?: BuildingHealthMap | null;
  readonly resources?: Partial<ResourceAmounts> | null;
  readonly log: RaidLog;
  /** Building hits before a raider leaves. */
  readonly hitLimit: number;
  /** The player's bunkers, academy levels and caged champion (`defenderForcesOf`). */
  readonly defence?: DefenderForces | null;
}

/** What the landing needs of the fight, kept with the open raid until finish. */
export interface RaidFightOutcome {
  /** Ticks fought; the fight's length at 1x is this over {@link TICKS_PER_SECOND}. */
  readonly ticks: number;
  /** Every building below full health afterwards, by id. */
  readonly health: BuildingHealthMap;
  /** The damage percentage an attack would store. */
  readonly damage: number;
  readonly firedTraps: readonly number[];
  readonly destroyedIds: readonly number[];
  /** Everything the raiders took: the bank's part and the harvesters' together. */
  readonly defenderLoss: ResourceAmounts;
  /** What left the bank (storage hits and falls). */
  readonly bankLoss: ResourceAmounts;
  /** What each harvester gave up from its unbanked amount, by building id; only those that gave any. */
  readonly harvesterLoss: Readonly<Record<string, number>>;
  /** What is left of the yard, 0 to 1: `1 - damage / 100` over the damage percentage's buildings. */
  readonly healthShare: number;
  readonly bunkerGarrisons: Readonly<Record<number, Readonly<Record<string, number>>>>;
  /** Each caged champion by type and its health afterwards; empty when none defended (#310). */
  readonly defenderChampions: readonly { readonly t: number; readonly hp: number }[];
  readonly creepsFlung: number;
  readonly creepsKilled: number;
  readonly digest: string;
}

const RESOURCES = ["r1", "r2", "r3", "r4"] as const;

/** The fight's length at 1x, seconds. */
export const fightSecondsOf = (outcome: Pick<RaidFightOutcome, "ticks">): number => outcome.ticks / TICKS_PER_SECOND;

export const fightRaid = (input: RaidFightInput): RaidFightOutcome => {
  const yard = buildEngineYard({
    buildingdata: input.buildingdata,
    buildinghealthdata: input.buildinghealthdata ?? null,
    resources: input.resources ?? null,
    kind: "main",
  });
  const bankBefore = { ...yard.resources };
  const storedBefore = new Map(yard.buildings.map((building) => [building.id, building.stored]));

  const battle = createBattle(yard, {
    seed: input.log.seed,
    ...battleDefence(input.defence),
    raid: { hitLimit: input.hitLimit },
  });
  // A raid's waves all land at once (`raidPlan.ts`); kept in log order, as the replay's sort keeps ties.
  const events = input.log.events
    .map((event, at) => ({ event, at }))
    .sort((one, other) => (one.event.t === other.event.t ? one.at - other.at : one.event.t - other.event.t))
    .map(({ event }) => event);
  let last = 0;
  for (const event of events) {
    const at = Math.max(0, Math.floor(event.t));
    battle.runTo(at);
    battle.apply(event);
    last = Math.max(last, at);
  }
  battle.runTo(last + ticks(RAID_MAX_SECONDS));

  const state = battle.state();
  const fired = new Set(state.firedTraps);
  const combatYard = toCombatYard({
    kind: "main",
    buildingdata: input.buildingdata,
    buildinghealthdata: state.health,
    spent: fired,
  });

  const bankLoss: Record<string, number> = {};
  for (const key of RESOURCES) bankLoss[key] = Math.max(0, Math.trunc(bankBefore[key] - yard.resources[key]));

  const harvesterLoss: Record<string, number> = {};
  for (const building of yard.buildings) {
    const gave = (storedBefore.get(building.id) ?? 0) - building.stored;
    if (building.kind === "resource" && gave > 0) harvesterLoss[String(building.id)] = Math.trunc(gave);
  }
  const damage = damagePercent(combatYard, state.health, fired);

  return {
    ticks: state.tick,
    health: state.health,
    damage,
    firedTraps: [...state.firedTraps],
    destroyedIds: [...state.destroyedIds],
    defenderLoss: { ...state.defenderLoss },
    bankLoss: bankLoss as unknown as ResourceAmounts,
    harvesterLoss,
    healthShare: Math.max(0, Math.min(1, 1 - damage / 100)),
    bunkerGarrisons: state.bunkerGarrisons,
    defenderChampions: state.defenderChampions.map((caged) => ({ t: caged.t, hp: caged.hp })),
    creepsFlung: state.creepsFlung,
    creepsKilled: state.creepsKilled,
    digest: digestState(battle.checkpoint()),
  };
};
