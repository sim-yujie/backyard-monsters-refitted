import { formatShort } from "@/ui/format";

/**
 * Where the attack strip writes the loot short (7.7.1): a phone, upright or on
 * its side (the phone layout, `phoneLayout.ts`), and any screen under 1180 px
 * wide, such as an iPad on its side, where four full figures of six digits
 * ("+502,850") pushed Retreat onto a second row mid-battle.
 */
export const STRIP_SHORT_LOOT_QUERY = "(max-width: 1179.98px), (max-height: 500px)";

/** Whether the strip writes the loot short now; false where nothing can tell. */
export const stripLootShort = (): boolean =>
  typeof window !== "undefined" && window.matchMedia?.(STRIP_SHORT_LOOT_QUERY).matches === true;

/**
 * One loot amount as the attack strip writes it (7.7.1).
 *
 * The full figure ("+1,575") where the strip has room; the short one ("+1.5K",
 * rounded down like the top bar's) where it has not (`stripLootShort`), so
 * the four amounts keep their places. The strip's tooltip keeps the exact
 * figures either way.
 */
export const stripLootFigure = (amount: number, short: boolean): number | string =>
  short ? formatShort(Math.abs(amount)) : amount;
