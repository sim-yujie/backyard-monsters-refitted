/**
 * The frost tribe's monsters' own abilities (beta 10, owner 27 Nov 2026,
 * desk card frost-prod): "Frozen Eye-ra causes a frost AOE that slows towers
 * upon exploding, frozen Teratorns fire frostballs, Fangs cause frost DPS,
 * the rest are visual for now."
 *
 * A creep is frost when the fight says so (`BattleOptions.frostAttackers`,
 * `BattleOptions.frostDefenders`, a raid wave's `RaidEvent.frost`); no
 * player owns one. Only the three monsters below fight differently; every
 * other frost monster is a look. Every figure is PROPOSED for the owner's
 * desk: a frost monster fights noticeably better than its normal twin, but
 * not more than about a fifth to a quarter better on the same yard.
 *
 * Whole ticks and whole percents only, no random draws: the server's replay
 * and the page agree to the bit.
 */

import { TICKS_PER_SECOND } from "./stats.js";

/** A level's entry of a six-level ladder, the top one past it. */
const byLevel = (ladder: readonly number[], level: number): number =>
  ladder[Math.max(0, Math.min(ladder.length - 1, Math.floor(level) - 1))] ?? 0;

/* ── Frozen Eye-ra (C5): a frost area where it bursts ─────────────────────── */

/**
 * The frost area's radius, in yard units round the burst (the same space as
 * a tower's scan point, which it is measured to). The plain blast reaches 60.
 */
export const FROST_AREA_RADIUS = [160, 170, 180, 190, 200, 210] as const;

/** How much slower a tower in the frost area acts, whole percent. */
export const FROST_AREA_SLOW = [25, 28, 31, 34, 37, 40] as const;

/** How long the frost area lasts, seconds. */
export const FROST_AREA_SECONDS = [5, 5.5, 6, 6.5, 7, 7.5] as const;

export const frostAreaRadius = (level: number): number => byLevel(FROST_AREA_RADIUS, level);
export const frostAreaSlow = (level: number): number => byLevel(FROST_AREA_SLOW, level);
export const frostAreaTicks = (level: number): number =>
  Math.round(byLevel(FROST_AREA_SECONDS, level) * TICKS_PER_SECOND);

/* ── Frozen Teratorn (C14): frostballs ────────────────────────────────────── */

/**
 * How much slower a frostball leaves what it hits, whole percent: a tower
 * acts that much less often, a monster moves and swings that much slower.
 * 0 makes the frostball a look only.
 */
export const FROSTBALL_SLOW = [15, 16, 17, 18, 19, 20] as const;

/**
 * A frostball bursts where it lands: every tower whose middle is within this
 * many yard units of the middle of the building it hit is chilled, the
 * building itself too if it is a tower. A Teratorn's own target is seldom a
 * tower (it takes the nearest building), so a chill on its target alone
 * changed almost nothing.
 */
export const FROSTBALL_RADIUS = 100;

/** How long a frostball's chill lasts, seconds (a Teratorn shoots every 1.125 s). */
export const FROSTBALL_SECONDS = 2;

export const frostballSlow = (level: number): number => byLevel(FROSTBALL_SLOW, level);
export const FROSTBALL_TICKS = Math.round(FROSTBALL_SECONDS * TICKS_PER_SECOND);

/* ── Frozen Fang (C8): frostbite ──────────────────────────────────────────── */

/**
 * A bite leaves frostbite on what it bit, a monster or a building: this
 * share of the bite's damage, once a second, for {@link FROSTBITE_SECONDS}.
 * One frostbite per target: a new bite sets its strength and its seconds
 * again, so a Fang biting on adds a steady share, never a pile.
 */
export const FROSTBITE_SHARE = [0.24, 0.25, 0.27, 0.29, 0.31, 0.33] as const;

/** Seconds a frostbite lasts after the last bite. */
export const FROSTBITE_SECONDS = 3;

export const frostbiteShare = (level: number): number => byLevel(FROSTBITE_SHARE, level);
