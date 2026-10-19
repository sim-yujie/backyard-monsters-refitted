import type { Save } from "../../database/models/save.model.js";

/** What help-mode `/base/load` adds to the yard (`docs/design/friends.md` §6.2). */
export interface HelpBlock {
  helpsLeft: number;
  /** Per building id: `speedup` / `repair` each `true` or a refusal reason. */
  buildings: Record<string, { speedup?: true | string; repair?: true | string }>;
}

/**
 * The hook the help rules (WP6) fill in: what the visitor can still do in the
 * owner's yard. Empty until then.
 */
export type HelpBlockFor = (helperUserid: number, ownerSave: Save) => Promise<HelpBlock>;

let hook: HelpBlockFor = async () => ({ helpsLeft: 0, buildings: {} });

export const helpBlockFor: HelpBlockFor = (helperUserid, ownerSave) => hook(helperUserid, ownerSave);

/** WP6 installs its implementation here. */
export const setHelpBlockFor = (next: HelpBlockFor): void => {
  hook = next;
};
