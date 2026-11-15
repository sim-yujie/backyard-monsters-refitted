import type { ResourceAmounts } from "@/api/friends";
import type { HelpAllSummary } from "@/game/friends/helpAll";
import type { HelpMarkExit } from "@/game/yard/YardHelpMarks";
import type { ResourceKey } from "../resourceIcon";
import type { HelpAllBar, HelpAllLine } from "./HelpAllBar";
import { HelpLandsFx } from "./helpLands";

/**
 * What Help all looks like as it lands (beta 8; owner, 15 Nov 2026: "I find
 * the toast very dissatisfactory"). The scene gives the helps; an effect
 * plays them out on the yard, the top bar and the visit bar. With no effect
 * the scene does as before: each wrench goes as its help lands, the top bar
 * floats each reward, and the bar shows the result line.
 *
 * While an effect runs the scene holds each reward back from the top bar
 * (`hold`) and keeps each helped wrench drawn (`marks.hold`); the effect
 * delivers the one and lets the other go, in its own time.
 */

/** The top bar's side of an effect (`Hud`). */
export interface HelpFxHud {
  hold(key: ResourceKey, amount: number): void;
  deliver(key: ResourceKey, amount: number, ms?: number): void;
  floatBelow(key: ResourceKey, delta: number): void;
  pulse(key: ResourceKey): void;
  readoutBox(key: ResourceKey): DOMRect | null;
  releaseHeld(): void;
}

/** The yard's side: the friend's wrenches (`YardRenderer`). */
export interface HelpFxMarks {
  hold(ids: readonly number[]): void;
  leave(id: number, exit?: HelpMarkExit): void;
  release(): void;
}

/** Everything an effect plays on. */
export interface HelpFxStage {
  readonly hud: HelpFxHud;
  readonly marks: HelpFxMarks;
  readonly bar: HelpAllBar;
  /** Where a building's wrench is on the screen now (page pixels), or null when it is off screen or gone. */
  wrenchAt(id: number): { x: number; y: number } | null;
  readonly reducedMotion: boolean;
}

/** One help that landed. */
export interface HelpFxStep {
  readonly id: number;
  readonly secondsSaved: number;
  readonly reward: ResourceAmounts;
}

/** One Help all's effect, from the press to the bar's resting state. */
export interface HelpAllFx {
  /** The press: the buildings about to be helped. */
  start(ids: readonly number[]): void;
  /** A help landed; its reward is already held back from the top bar. */
  helped(step: HelpFxStep): void;
  /** A help was refused: its wrench stays or goes as the scene says. */
  missed(id: number): void;
  /**
   * The last help is in. Resolves once the effect has played out what it
   * needs to before the bar settles, with the bar's line: `ms: 0` for none,
   * or null for the scene's own line.
   */
  done(summary: HelpAllSummary, line: HelpAllLine): Promise<HelpAllLine | null>;
  /** The visit ended mid-way: everything off the screen at once, every held amount shown. */
  cancel(): void;
}

/** Makes one Help all's effect on a stage; null plays none. */
export type HelpAllFxMaker = (stage: HelpFxStage) => HelpAllFx | null;

/** The effect Help all plays: "help lands" (`helpLands.ts`; owner, Review Desk 7, 15 Nov 2026). */
export const helpAllFxMaker = (): HelpAllFxMaker | null => (stage) => new HelpLandsFx(stage);
