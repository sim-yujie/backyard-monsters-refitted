import type { AutoAttackReplay } from "@/api/autoAttack";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { flungOf } from "@/game/attack/attackSave";
import type { FlingEvent } from "@/game/combat/rules";
import type { OffsetCell } from "@/game/HexGrid";

/**
 * Watch on an auto-attack (issue #221): the battle the server fought, played
 * back on the attack scene. Nothing on that screen talks to the server: the
 * yard is the camp as the battle found it, the drops are the server's own,
 * and the seed is the one the server fought with, so what plays out is the
 * battle that landed (`AttackSession.playScript`).
 *
 * The handoff from the result screen to the scene is one piece of state, as
 * the Baiter's is ({@link setWatchRun}, {@link consumeWatchRun}).
 */

/** One battle to watch. */
export interface WatchRun {
  readonly replay: AutoAttackReplay;
  /** The camp's cell, to come back to on the map. */
  readonly cell?: OffsetCell;
}

let pending: WatchRun | null = null;

/** Records the battle the watch scene should play next. */
export const setWatchRun = (run: WatchRun): void => {
  pending = run;
};

/** Takes the pending battle, clearing it. */
export const consumeWatchRun = (): WatchRun | null => {
  const run = pending;
  pending = null;
  return run;
};

/**
 * The replay's events. The server checked every one when it fought them
 * (`parseFlingLog`), with the same engine, so every kind it fought is one the
 * engine here plays; anything that is not an event at all is dropped rather
 * than handed to the engine.
 */
export const watchEvents = (run: WatchRun): FlingEvent[] =>
  run.replay.events.filter((event): event is FlingEvent => {
    if (typeof event !== "object" || event === null) return false;
    const { kind, t } = event as { kind?: unknown; t?: unknown };
    return typeof kind === "string" && typeof t === "number" && Number.isFinite(t);
  });

/**
 * The attack scene's target for a run: the camp, handed over already loaded,
 * and a roster of exactly what the battle flings, at the levels it fought at.
 */
export const watchTarget = (run: WatchRun): AttackTarget => ({
  baseid: run.replay.baseid,
  kind: "wild",
  ...(run.cell ? { cell: run.cell } : {}),
  name: run.replay.name,
  load: run.replay.load,
  roster: {
    monsters: flungOf(watchEvents(run)),
    levels: { ...run.replay.levels },
    champions: [],
    flingerLevel: 0,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});
