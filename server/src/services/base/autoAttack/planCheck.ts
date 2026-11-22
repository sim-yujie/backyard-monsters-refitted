import type { Save } from "../../../database/models/save.model.js";
import {
  defenderForcesOf,
  dropObstaclesOf,
  flingClashes,
  overlappingBuildings,
  flingZoneSize,
  type CombatBuildingDataMap,
  type FlingClash,
  type FlingEvent,
  withAttackerBuffs,
} from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { tribeIdAt, tribeLayoutFor } from "../../maproom/v2/tribeLayouts.js";
import { academyLevels, type AbandonedInput, type AbandonedOutcome } from "../combat/abandonedAttack.js";
import { replayAbandonedInWorker } from "../combat/replayRunner.js";
import { planLog, type AttackPlan, type CampKey, type OwnedChampion } from "./attackPlan.js";

/**
 * Repeat attack's plan check (beta 9; the owner's fix 2 on desk card
 * repeat-record-fix, 22 Nov 2026): before a Repeat runs, every fling of the
 * saved plan is held against the camp's FRESH layout by the rule a
 * hand-played drop meets (`game-rules/combat/dropZone.ts`, the web's
 * tap-to-drop rule): its drop zone may not overlap a standing building.
 *
 * A plan recorded on a camp that was already damaged (every plan before patch
 * 8.2) can drop monsters into ruins that a fresh camp has standing; such a
 * plan is refused, so the player records a new one by hand. The layout is
 * always the fresh one, whatever state the camp attacked now is in: the check
 * is of the plan, not of this camp.
 *
 * A hand-played attack may also drop where a building stood until its own
 * monsters flattened it, so a fling that touches a building of the fresh
 * layout is not refused at once when something was flung or bombed before
 * it: the plan is fought on the fresh camp, under the seed the Repeat will
 * fight with, up to that fling, and it is refused only when a building it
 * touches is still standing then. A plan whose flings all land clear (nearly
 * every good plan) needs no battle at all.
 */

/** A fresh camp's yard for a tribe and level, as `freshTribeData` serves it. */
export const freshCampYard = (key: CampKey) => tribeLayoutFor(tribeIdAt((key.wmid - 1) / 10), key.level).save;

/** Events in tick order, ties in the order logged, as the replay orders them. */
const ordered = (events: readonly FlingEvent[]): FlingEvent[] =>
  events
    .map((event, at) => ({ event, at }))
    .sort((one, other) => (one.event.t === other.event.t ? one.at - other.at : one.event.t - other.event.t))
    .map(({ event }) => event);

/** The attacker as the check needs them. */
export interface PlanCheckAttacker {
  readonly academy: JsonObject | null | undefined;
  readonly champion: readonly OwnedChampion[] | null | undefined;
  /** Their main save's `storedata`, for the monster boosts they bring. */
  readonly storedata?: Save["storedata"];
}

/** What the check fights a battle with; the tests stand in for the worker. */
export type PlanCheckReplay = (input: AbandonedInput) => Promise<AbandonedOutcome>;

/**
 * The first fling of a plan that would land on a standing building of the
 * camp's fresh layout, or null when every fling lands clear.
 *
 * @param plan - The saved plan.
 * @param key - The camp's tribe and level.
 * @param attacker - The attacker: their academy levels size each drop zone.
 * @param seed - The seed the Repeat will fight with.
 * @param now - Unix seconds, for the camp's defence.
 * @param replay - Fights the battle (a worker; the tests pass their own).
 * @throws Whatever `replay` throws (a timeout, a worker that never loaded).
 */
export const planFlingOnBuilding = async (
  plan: AttackPlan,
  key: CampKey,
  attacker: PlanCheckAttacker,
  seed: number,
  now: number,
  replay: PlanCheckReplay = replayAbandonedInWorker
): Promise<FlingClash | null> => {
  const yard = freshCampYard(key);
  const buildingdata = (yard.buildingdata ?? {}) as CombatBuildingDataMap;
  const obstacles = dropObstaclesOf(buildingdata);
  const levels = academyLevels(attacker.academy as JsonObject | null | undefined);
  const events = ordered(plan.events);
  const clashes = flingClashes(events, obstacles, levels);
  if (clashes.length === 0) return null;

  // Nothing flung or bombed before it: nothing can have fallen yet.
  const first = clashes[0]!;
  const before = events.slice(0, first.index);
  if (!before.some((event) => event.kind === "fling" || event.kind === "bomb")) return first;

  // Fought to the last clash, to see what had fallen before each.
  const last = clashes[clashes.length - 1]!;
  const log = planLog({ ...plan, events: events.slice(0, last.index + 1) }, seed, attacker.champion);
  // The defence a fresh camp serves (`servedDefenderForces`, without the
  // database): its bunkers and cage, whole, and the attacker's boosts.
  const housed = (yard.monsters as { housed?: unknown } | undefined)?.housed;
  const defence = withAttackerBuffs(
    defenderForcesOf({
      buildingdata,
      academy: yard.academy,
      champion: yard.champion,
      storedata: yard.storedata,
      now,
      monsters: housed && typeof housed === "object" && !Array.isArray(housed) ? housed : yard.monsters,
      buildinghealthdata: {},
    }),
    attacker.storedata ?? null,
    now
  );
  const outcome = await replay({
    defender: {
      type: "tribe",
      buildingdata,
      buildinghealthdata: null,
      resources: (yard.resources ?? null) as AbandonedInput["defender"]["resources"],
    },
    attacker: {
      academy: attacker.academy as JsonObject | null | undefined,
      champion: (attacker.champion ?? null) as AbandonedInput["attacker"]["champion"],
      siege: null,
    },
    log,
    tick: Math.floor(last.t),
    declareWar: false,
    defence,
    fallenBefore: clashes.map((clash) => clash.index),
  });

  for (const clash of clashes) {
    const fallen = outcome.fallenBefore?.[String(clash.index)] ?? [];
    const standing = dropObstaclesOf(buildingdata, null, fallen);
    const event = events[clash.index] as Extract<FlingEvent, { kind: "fling" }>;
    const hits = overlappingBuildings({ x: event.x, y: event.y }, flingZoneSize(event, levels), standing);
    if (hits.length > 0) return { ...clash, buildings: hits.map((hit) => hit.id) };
  }
  return null;
};
