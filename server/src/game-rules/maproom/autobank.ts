/**
 * The Map Room 2 outpost income arithmetic, shared by the server and the web
 * client (issue #207).
 *
 * The server pays each player's outpost income into their main pool
 * (`server/src/services/maproom/v2/autobank.ts`); the web client predicts the
 * same payouts between answers so the resource bar climbs every 10 s, as
 * Flash's did (`web/src/game/yard/outpostIncome.ts`). Both count the ticks and
 * clamp the credit with this file, so the prediction lands on exactly the
 * figure the next answer brings. It is kept as one source here and one
 * byte-for-byte copy at `server/src/game-rules/maproom/` by
 * `web/tools/sync-combat-rules.mjs`, as the range rule beside it is.
 *
 * - Income is paid in whole 10 s ticks (`client/scripts/BASE.as:2539-2543`),
 *   counted from `t`, the moment it is paid up to; the part of a tick not yet
 *   reached waits for next time.
 * - At most two days of it are paid (`AutoBankManager.as:75-77`).
 * - Each tick at or before the Production Overdrive's end pays twice
 *   (`AutoBankManager.as:258-263`, `client/scripts/STORE.as:2413-2418`).
 * - Every credit fills up to the storage cap and no further, and a pool
 *   already over the cap keeps what it holds (`BASE.Fund`,
 *   `client/scripts/BASE.as:4476-4536`).
 *
 * Pure: no imports, no clock, nothing from either tree.
 */

/** One autobank tick, in seconds (`client/scripts/BASE.as:2539-2543`). */
export const AUTOBANK_TICK = 10;

/** Production Overdrive's power (`client/scripts/STORE.as:2413-2418`). */
export const AUTOBANK_OVERDRIVE = 2;

/** At most two days of offline outpost income are paid (`AutoBankManager.as:75-77`). */
export const OUTPOST_INCOME_WINDOW = 60 * 60 * 24 * 2;

/** One figure per resource: twigs, pebbles, putty, goo. */
export interface IncomeAmounts {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
}

const INCOME_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** What {@link autobankTicks} works out: what is owed, and where `t` moves to. */
export interface AutobankTicks {
  /** Per resource, before the storage cap. */
  owed: IncomeAmounts;
  /** Whole ticks paid. */
  ticks: number;
  /** The new `t`: the end of the last tick paid. */
  t: number;
}

/**
 * The whole ticks owed since `last`, and what they come to at `rate`.
 *
 * With no `last` (a yard that never autobanked) nothing is owed and `t` is
 * `now`; a `last` in the future counts from `now`.
 *
 * @param rate - The player's income per tick, all outposts together.
 * @param last - `buildingresources.t`; undefined when there is none.
 * @param now - Unix seconds.
 * @param overdriveUntil - When Production Overdrive ends, if it runs.
 */
export const autobankTicks = (
  rate: Readonly<IncomeAmounts>,
  last: number | undefined,
  now: number,
  overdriveUntil?: number
): AutobankTicks => {
  const owed: IncomeAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  if (last === undefined || !Number.isFinite(last)) return { owed, ticks: 0, t: now };

  const from = Math.max(Math.min(last, now), now - OUTPOST_INCOME_WINDOW);
  const ticks = Math.floor((now - from) / AUTOBANK_TICK);
  const overdriven =
    overdriveUntil === undefined
      ? 0
      : Math.min(ticks, Math.max(0, Math.floor((overdriveUntil - from) / AUTOBANK_TICK)));
  const paidTicks = ticks + overdriven * (AUTOBANK_OVERDRIVE - 1);

  for (const key of INCOME_KEYS) owed[key] = Math.max(0, Math.trunc(rate[key])) * paidTicks;

  return { owed, ticks, t: from + ticks * AUTOBANK_TICK };
};

/**
 * What a pool holding `held` holds after `amount` is credited under `cap`:
 * filled up to the cap and no further, and never less than it held, so a pool
 * already over the cap keeps what it has (`BASE.Fund`).
 *
 * @param held - What the pool holds now.
 * @param amount - A whole, non-negative credit.
 * @param cap - The storage cap.
 */
export const fillToCap = (held: number, amount: number, cap: number): number =>
  Math.max(held, Math.min(held + amount, cap));
