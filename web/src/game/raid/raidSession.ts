import type { BaseLoadResponse } from "@/api/types";
import type { RaidFight, RaidResult, RaidView } from "@/api/raid";
import type { AttackTarget } from "@/game/attack/attackTarget";
import type { RaidEvent } from "@/game/combat/rules";

/**
 * The hand-offs between the yard and the raid's fight (issue #226 WP4), one
 * piece of state each way, as the Baiter's and Watch's are: the yard starts
 * the fight and opens the raid scene on it ({@link setRaidRun}), and the
 * raid scene lands it and opens the yard on what landed ({@link setRaidResult}).
 */

/** One raid's fight, as `/raid/start` handed it over. */
export interface RaidRun {
  readonly raid: RaidView;
  readonly fight: RaidFight;
  /** The own yard's save as the yard had it, for everything the fight's yard does not carry. */
  readonly save: BaseLoadResponse;
}

let pendingRun: RaidRun | null = null;
let pendingResult: RaidResult | null = null;

export const setRaidRun = (run: RaidRun): void => {
  pendingRun = run;
};

/** Takes the fight to play, clearing it. */
export const consumeRaidRun = (): RaidRun | null => {
  const run = pendingRun;
  pendingRun = null;
  return run;
};

export const setRaidResult = (result: RaidResult): void => {
  pendingResult = result;
};

/** Takes what the last raid landed, clearing it: the yard shows it once. */
export const consumeRaidResult = (): RaidResult | null => {
  const result = pendingResult;
  pendingResult = null;
  return result;
};

let pendingNote: string | null = null;

/** A line for the yard to show when a fight did not land (called off, or the server out of reach). */
export const setRaidNote = (note: string): void => {
  pendingNote = note;
};

/** Takes that line, clearing it. */
export const consumeRaidNote = (): string | null => {
  const note = pendingNote;
  pendingNote = null;
  return note;
};

/**
 * The fight's waves for the session's playback (`AttackSession.playScript`).
 * The server built and fought them; anything that is not a raid wave is
 * dropped rather than handed to the engine.
 */
export const raidEvents = (run: RaidRun): RaidEvent[] =>
  run.fight.events.filter(
    (event) => typeof event === "object" && event !== null && event.kind === "raid" && Number.isFinite(event.t),
  );

/**
 * The attack scene's target for a raid: the player's own main yard, as the
 * fight found it, with their defence. Nobody's army is housed here: the
 * raiders come in the fight's waves.
 */
export const raidTarget = (run: RaidRun): AttackTarget => ({
  baseid: String(run.save.baseid ?? ""),
  kind: "main",
  name: `${run.raid.tribe} raid`,
  load: {
    ...run.save,
    buildingdata: run.fight.yard.buildingdata,
    buildinghealthdata: run.fight.yard.buildinghealthdata,
    resources: run.fight.yard.resources,
    defenderforces: run.fight.defence,
  },
  roster: {
    monsters: {},
    levels: {},
    champions: [],
    flingerLevel: 0,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});
