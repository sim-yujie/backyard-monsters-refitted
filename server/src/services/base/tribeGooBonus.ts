/**
 * Wild tribes give more Goo (owner, 8 Nov 2026, patch 6.9: +25%).
 *
 * Applied to the loot a battle credited from a wild monster tribe on Map Room 1
 * or Map Room 2, before it is banked: Goo (`r4`) goes up by the bonus, the other
 * resources stay as they are. The extra goes on top of what the server's own
 * replay credited (already capped by what the tribe holds); the tribe does not
 * lose the extra, and the attacker's storage cap still applies when it is
 * banked. Inferno tribes are not included.
 *
 * Patch 9.1 (owner, 27 Nov 2026): the bonus steps down every 2 days, read from
 * the server clock when the loot is banked:
 *   before GOO_BONUS_STEP_START  +25%
 *   from the start               +20%
 *   from start + 48 h            +10%
 *   from start + 96 h            none
 */

/**
 * When the 9.1 step-down begins, as a UTC ISO time ending in `Z`
 * (e.g. "2026-11-28T10:00:00Z"). The lead sets it right before the 9.1 release,
 * to a round UTC hour at or just before the release; the notes' dates are this
 * time + 48 h and + 96 h.
 *
 * `null` = not set: the bonus stays at +25% for good (merging early changes nothing).
 */
export const GOO_BONUS_STEP_START: string | null = null;

/** The bonus before the step-down (patch 6.9). */
export const TRIBE_GOO_BONUS_BEFORE_STEPS = 25;

const HOUR = 60 * 60;

/** Each step: from `afterHours` past the start, the bonus is `percent`. Latest step last. */
export const TRIBE_GOO_BONUS_STEPS: readonly { readonly afterHours: number; readonly percent: number }[] = [
  { afterHours: 0, percent: 20 },
  { afterHours: 48, percent: 10 },
  { afterHours: 96, percent: 0 },
];

/** The start time in Unix seconds, or null when it is not set. */
export const stepStartSeconds = (start: string | null): number | null => {
  if (start === null) return null;
  const ms = Date.parse(start);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

/**
 * The wild-tribe Goo bonus in percent at `now` (Unix seconds, the server's
 * `getCurrentDateTime()` at banking).
 */
export const tribeGooBonusPercent = (now: number, start: string | null = GOO_BONUS_STEP_START): number => {
  const startAt = stepStartSeconds(start);
  if (startAt === null) return TRIBE_GOO_BONUS_BEFORE_STEPS;
  let percent = TRIBE_GOO_BONUS_BEFORE_STEPS;
  for (const step of TRIBE_GOO_BONUS_STEPS) {
    if (now >= startAt + step.afterHours * HOUR) percent = step.percent;
  }
  return percent;
};

/**
 * Adds the wild-tribe Goo bonus to a tribe's credit. `now` is the banking time
 * in Unix seconds; `start` is only passed by tests.
 */
export const withTribeGooBonus = <T extends { readonly r4?: number }>(
  credit: T,
  fromTribe: boolean,
  now: number,
  start: string | null = GOO_BONUS_STEP_START
): T => {
  const goo = credit.r4;
  if (!fromTribe || typeof goo !== "number" || goo <= 0) return credit;
  const percent = tribeGooBonusPercent(now, start);
  if (percent <= 0) return credit;
  return { ...credit, r4: Math.floor((goo * (100 + percent)) / 100) };
};
