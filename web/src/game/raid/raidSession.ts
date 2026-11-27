import type { BaseLoadResponse } from "@/api/types";
import type { RaidFight, RaidResult, RaidView } from "@/api/raid";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { raidSpawnsUntilOf, type RaidEvent } from "@/game/combat/rules";
import type { WaveStatus } from "@/api/waves";

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
  /**
   * Sprung from the Trojan Horse rather than a wild raid's warning (issue
   * #327, `docs/design/trojan-horse.md` §5): the raid scene shows the trap
   * banner before "Don't Panic!" (`raidPlugin.ts`), and its result and
   * aftermath are worded for "the wild monsters", not a tribe (§6).
   */
  readonly trojan?: boolean;
  /**
   * A wave event's wave (beta 10, Wild Monster Invasion): the raid scene
   * names the wave ahead of the fight and in its strip (`raidPlugin.ts`),
   * and the result is the wave's (`raidAftermath.ts`).
   */
  readonly wave?: WaveStatus;
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

/**
 * The raids whose result a yard has taken, newest last, so one raid's result
 * never shows twice: it can come both with the yard's load (the server landed
 * it there, `raidresult`) and in the finish's late answer (patch 7.5).
 */
const taken: string[] = [];
/** How many taken raids are remembered: a raid's two answers come within minutes. */
const TAKEN_KEPT = 20;
/** The open yard's ear for a result or a line that came after it opened. */
const listeners = new Set<() => void>();

/** Whether the yard has, or has had, this raid's result. */
const known = (id: string): boolean => taken.includes(id) || pendingResult?.id === id;

const tell = (): void => {
  for (const listener of [...listeners]) listener();
};

/**
 * What the raid scene's finish landed, for the yard. A raid whose result the
 * yard already has (from its load) is dropped. An open yard is told
 * ({@link onRaidNews}), since the answer can come after the player went back
 * to it.
 */
export const setRaidResult = (result: RaidResult): void => {
  if (known(result.id)) return;
  pendingResult = result;
  tell();
};

/**
 * What the yard's own load landed (`raidresult`, patch 7.5: the server lands
 * a fight whose finish was still on its way), handed to the yard opening on
 * it, quietly: that yard shows it as it mounts. One already known is dropped.
 */
export const adoptLoadedRaidResult = (result: RaidResult | null | undefined): void => {
  if (!result || typeof result.id !== "string" || known(result.id)) return;
  pendingResult = result;
};

/** Whether a result is waiting for its taker. */
export const raidResultWaiting = (): boolean => pendingResult !== null;

/** Results the yard has been opened afresh for, so it is never opened again for the same one. */
const refreshed: string[] = [];

/**
 * Whether the waiting result is not in the yard `load` sent yet: its raid
 * landed after the load read the yard (the finish answered while the yard
 * was loading, sol's second review), so the popup would sit on a yard
 * without its damage, theft or Shiny. Then the yard is opened afresh first
 * ({@link markRaidYardRefreshed}), once per result. A server that does not
 * say (`lastraid` absent) is taken at its word.
 */
export const raidResultAheadOfYard = (load: { readonly lastraid?: unknown }): boolean => {
  const result = pendingResult;
  if (result === null || typeof load.lastraid !== "string") return false;
  return load.lastraid !== result.id && !refreshed.includes(result.id);
};

/** The yard is being opened afresh for the waiting result. */
export const markRaidYardRefreshed = (): void => {
  if (pendingResult === null || refreshed.includes(pendingResult.id)) return;
  refreshed.push(pendingResult.id);
  if (refreshed.length > TAKEN_KEPT) refreshed.shift();
};

/**
 * Takes what the last raid landed, clearing it: the yard shows it once. With
 * `which`, only a result it accepts is taken; any other is left for its own
 * taker (Moloch's raids for the Inferno's plugin, the rest for the raid's).
 */
export const consumeRaidResult = (which: (result: RaidResult) => boolean = () => true): RaidResult | null => {
  const result = pendingResult;
  if (result === null || !which(result)) return null;
  pendingResult = null;
  taken.push(result.id);
  if (taken.length > TAKEN_KEPT) taken.shift();
  return result;
};

let pendingNote: { readonly text: string; readonly raid?: string } | null = null;

/**
 * A line for the yard to show when a fight did not land (called off, or the
 * server out of reach). With the raid's id, it is dropped once the yard has
 * that raid's result after all (the load landed it, patch 7.5). An open yard
 * is told.
 */
export const setRaidNote = (note: string, raid?: string): void => {
  if (raid !== undefined && known(raid)) return;
  pendingNote = raid === undefined ? { text: note } : { text: note, raid };
  tell();
};

/** Takes that line, clearing it; null too when its raid's result has reached the yard since. */
export const consumeRaidNote = (): string | null => {
  const note = pendingNote;
  pendingNote = null;
  if (note?.raid !== undefined && known(note.raid)) return null;
  return note?.text ?? null;
};

/** Calls `listener` whenever a result or a line is handed over; returns the way to stop. */
export const onRaidNews = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Forgets every hand-over: tests only. */
export const resetRaidSession = (): void => {
  pendingRun = null;
  pendingResult = null;
  pendingNote = null;
  taken.length = 0;
  refreshed.length = 0;
  listeners.clear();
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
 * The tick the fight's last wave lands on, for the session's battle
 * (`AttackSessionOptions.raidSpawnsUntil`): the server fought the Trojan
 * Horse's army with its last spawn's tick (`trojanFight.ts`,
 * `TROJAN_LAST_SPAWN_TICK`), which is its last event's own tick, so the fight
 * stays open through the gaps between spawns. A wild or Moloch raid's waves
 * all land at 0, which the server leaves at its default, 0, too. Beta 10's
 * timed groups and retreat wave are read by the same shared rule the server
 * uses (`raidSpawnsUntilOf`), so both end on one tick.
 */
export const raidSpawnsUntil = (run: RaidRun): number => raidSpawnsUntilOf(raidEvents(run));

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
