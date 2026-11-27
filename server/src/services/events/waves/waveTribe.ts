/**
 * The wave events' mark on the shared raid machinery, kept apart so the raid
 * landing (`raids/raidLanding.ts`, `raids/raidFlow.ts`) can read it without
 * importing the wave engine. A wave is an open raid under {@link WAVE_TRIBE};
 * the landing treats it as Moloch's emergence raid is treated, plus: nothing
 * is stolen (owner, 27 Nov 2026), and the wave's own result
 * ({@link WaveResult}, `waveLanding.ts`) rides on the raid's.
 */
export const WAVE_TRIBE = "wave";

/** Whether an open or landed raid is a wave event's wave. */
export const isWaveTribe = (tribe: string | null | undefined): boolean => tribe === WAVE_TRIBE;

/** What a landed wave tells the player, on top of the raid's result (`RaidResult.wave`). */
export interface WaveResult {
  /** The event's key (`wmi1`) and the run's id. */
  readonly event: string;
  readonly run: string;
  /** The wave fought, 1-based, and how many the event has. */
  readonly wave: number;
  readonly waves: number;
  /** Won: every raider down and more than 10% of the yard standing. */
  readonly beaten: boolean;
  /** Surrendered before the end (always a loss). */
  readonly surrendered: boolean;
  /** The next wave to call, or null once all are beaten. */
  readonly next: number | null;
  /** Glimmers paid for it (0 for a loss or a wave already paid). */
  readonly glimmers: number;
  /** The totem's new level when this wave raised it, and its decoration type. */
  readonly totem?: { readonly type: number; readonly level: number; readonly placed: boolean };
}
