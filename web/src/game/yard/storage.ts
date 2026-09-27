/**
 * The storage cap as a reason a price cannot be paid
 * (`docs/design/yard-buildings.md` §5.2; `docs/specs/base-building.md` §4
 * "What happens when full").
 *
 * The server clamps every credit to the cap (`server/src/services/yard/credit.ts`),
 * so a price above it can never be saved up for: waiting does not help, more
 * Storage Silos do. The original said so in place of "not enough resources"
 * (`client/scripts/BUILDINGOPTIONSPOPUP.as:472-478`, `:513-520`), and every
 * screen with a price says it the same way.
 */

/** What a screen says for a price above the storage cap, as a phrase (a gate line's style). */
export const NEED_MORE_SILOS_PHRASE = "Need more silos: this costs more than your storage holds";

/** The same as a sentence. */
export const NEED_MORE_SILOS = `${NEED_MORE_SILOS_PHRASE}.`;

/** True when `cost` is more than the cap can ever hold. An unknown cap is never exceeded. */
export const overCap = (cost: number, cap: number | null | undefined): boolean =>
  typeof cap === "number" && cap > 0 && cost > cap;
