import { formatShort } from "@/ui/format";

/**
 * One loot amount as the attack strip writes it (7.7.1).
 *
 * The full figure ("+1,575") where the strip has room; on a phone, upright or
 * on its side (`isPhoneLayout`), the short one ("+1.5K", rounded down like the
 * top bar's), so the four amounts fit on the phone's own loot row. The strip's
 * tooltip keeps the exact figures either way.
 */
export const stripLootFigure = (amount: number, short: boolean): number | string =>
  short ? formatShort(Math.abs(amount)) : amount;
