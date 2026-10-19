/**
 * The shortest time between two tribe raids on one player, in hours (owner,
 * 2026-10-19). It counts from the moment a raid's warning opens, whether that
 * raid then lands, is called off by a reload or is never launched, so a
 * cancelled raid cannot be followed straight away by another.
 * @constant {number}
 */
export const MIN_HOURS_BETWEEN_TRIBE_RAIDS = 3;
