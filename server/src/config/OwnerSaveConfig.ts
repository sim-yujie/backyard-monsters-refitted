/**
 * Owner saves of a main yard or an outpost: the retirement switch
 * (`docs/design/yard-buildings.md` §1 T1 and §3.3 "Owner saves").
 *
 * An owner `/base/save` writes `Save.saveKeys` onto the row more or less as
 * sent, `storedata` included, which is how the Flash client banked everything
 * it did in the yard. There is no Flash client any more (D1) and the web
 * client never sends one — its yard changes go through the server's action
 * routes — so the only thing that path still does is let a hand-made request
 * overwrite the yard wholesale. `refuse` closes it; `allow` puts it back for
 * debugging.
 *
 * - `refuse` — an owner save of a main yard or an outpost is refused with `409` and
 *              `reason: "ownerSaveRetired"` before anything is read or written.
 * - `allow`  — the save goes through as it always did.
 *
 * Attack saves are not affected by either mode. Outpost owner saves were left
 * open until the outposts plan (WP0b); they are refused alongside main yards.
 *
 * Read once at import time, like `ECONOMY_SAVE_VALIDATION`
 * (`config/EconomyConfig.ts`). An absent or unknown value means `refuse`, and
 * {@link ownerSaveModeWasUnrecognised} lets the startup banner say so.
 */

/** refuse: owner main-yard and outpost saves are refused. allow: they are applied. */
export type OwnerSaveMode = "refuse" | "allow";

/** Every mode `OWNER_SAVE_MODE` may name. */
export const OWNER_SAVE_MODES = ["refuse", "allow"] as const;

/** The mode an absent or unrecognised environment variable means. */
export const DEFAULT_OWNER_SAVE_MODE: OwnerSaveMode = "refuse";

/** Whether a string names a mode this server implements. */
export const isOwnerSaveMode = (raw: unknown): raw is OwnerSaveMode =>
  typeof raw === "string" && (OWNER_SAVE_MODES as readonly string[]).includes(raw);

/** The mode a raw environment value asks for, or {@link DEFAULT_OWNER_SAVE_MODE}. */
export const parseOwnerSaveMode = (raw: string | undefined): OwnerSaveMode =>
  isOwnerSaveMode(raw) ? raw : DEFAULT_OWNER_SAVE_MODE;

export interface OwnerSaveConfig {
  readonly mode: OwnerSaveMode;
}

export const ownerSaveConfig: OwnerSaveConfig = {
  mode: parseOwnerSaveMode(process.env.OWNER_SAVE_MODE),
};

/** True when `OWNER_SAVE_MODE` was set to something that is not a mode. */
export const ownerSaveModeWasUnrecognised =
  process.env.OWNER_SAVE_MODE !== undefined && !isOwnerSaveMode(process.env.OWNER_SAVE_MODE);
