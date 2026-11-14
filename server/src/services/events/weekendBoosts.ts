import type { WeekendEventId } from "../../game-data/events/weekendEvents.js";
import { boostAt } from "./weekendSchedule.js";
import { weekendSettings } from "./weekendSettings.js";

/**
 * The weekend events' effects, as numbers (`game-data/events/weekendEvents.ts`).
 * Every effect is the server's: the client only shows what these give.
 *
 * Each effect takes the boost of the moment the thing starts (an upgrade's
 * price, a training's or research's length, a monster's hatch time) or lands
 * (an attack's loot): **a timer started during the weekend keeps its shorter
 * length after the weekend ends**, so a training started Sunday 23:00 still
 * finishes 30% sooner; one started Monday 00:00 does not. An upgrade bought
 * at 30% off and cancelled later gives back what was paid, not the full price.
 *
 * Using an effect pays no Glimmers: a weekend's Glimmers are its daily
 * check-in (owner, 13 Nov 2026; `weekendCoins.ts`).
 */

/** The percentage of `id` running at `t` (unix seconds), or 0. */
export const weekendBoost = (id: WeekendEventId, t: number): number => boostAt(weekendSettings(), id, t);

/** `amount` less `percent`%, rounded up (a price never drops below what the percentage says). */
export const lessByPercent = (amount: number, percent: number): number =>
  percent > 0 && amount > 0 ? Math.ceil((amount * (100 - percent)) / 100) : amount;

/** `amount` plus `percent`%, rounded down. */
export const moreByPercent = (amount: number, percent: number): number =>
  percent > 0 && amount > 0 ? Math.floor((amount * (100 + percent)) / 100) : amount;

/** A timer `percent`% shorter, at least 1 second. */
export const shorterBy = (seconds: number, percent: number): number =>
  percent > 0 && seconds > 0 ? Math.max(1, Math.ceil((seconds * (100 - percent)) / 100)) : seconds;

/** Every resource of a cost less `percent`%. */
export const costLessBy = <T extends { readonly [K in keyof T]: number }>(cost: T, percent: number): T =>
  Object.fromEntries(
    Object.entries(cost).map(([key, value]) => [key, lessByPercent(value as number, percent)])
  ) as T;

/**
 * Tribe Plunder's extra loot on a credit from a wild tribe: each resource
 * `percent`% more. It goes on top of what the battle credited (already capped
 * by the server's own replay); the tribe does not lose the extra, and the
 * attacker's storage cap still applies when it is banked.
 */
export const withPlunderBonus = <T extends { readonly [K in keyof T]: number }>(credit: T, percent: number): T =>
  Object.fromEntries(
    Object.entries(credit).map(([key, value]) => [key, moreByPercent(value as number, percent)])
  ) as T;

/** Tribe Plunder's percentage at `t`, for a credit from a wild tribe; 0 for anyone else. */
export const plunderPercent = (fromTribe: boolean, t: number): number =>
  fromTribe ? weekendBoost("plunder", t) : 0;
