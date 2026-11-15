import type { Save } from "../../database/models/save.model.js";
import { LEGACY_HELPS_LEFT } from "./helpConfig.js";

/** What help-mode `/base/load` adds to the yard (`docs/design/friends.md` §6.2). */
export interface HelpBlock {
  /** Helps today that still pay a reward. */
  rewardsLeft: number;
  /** Kept only for pre-7.6 clients (`LEGACY_HELPS_LEFT` in `helpConfig.ts`); the 7.6 client ignores it. */
  helpsLeft: number;
  /** Per building id: `speedup` / `repair` each `true` or a refusal reason. */
  buildings: Record<string, { speedup?: true | string; repair?: true | string }>;
  /** A `tooNew` refusal's gate (`friendship`, `account` or `level`) and, when time lifts it, `from`. */
  gate?: { reason: string; from?: number; rule?: string };
}

/**
 * The hook the help rules (WP6) fill in: what the visitor can still do in the
 * owner's yard. Empty until then.
 */
export type HelpBlockFor = (helperUserid: number, ownerSave: Save) => Promise<HelpBlock>;

let hook: HelpBlockFor = async () => ({ rewardsLeft: 0, helpsLeft: LEGACY_HELPS_LEFT, buildings: {} });

export const helpBlockFor: HelpBlockFor = (helperUserid, ownerSave) => hook(helperUserid, ownerSave);

/** WP6 installs its implementation here. */
export const setHelpBlockFor = (next: HelpBlockFor): void => {
  hook = next;
};
