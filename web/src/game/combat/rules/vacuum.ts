/**
 * The Loot-O-Tron 5000, the Vacuum, in the fight (Inferno WP 6.6,
 * `docs/design/inferno.md` S6): the figures and the arithmetic the engine's
 * Vacuum reads, each from Flash's `com/monsters/siege/weapons/Vacuum.as` and
 * `VacuumHose.as`.
 *
 * Wherever it is dropped, it latches onto the defender's Town Hall, or a
 * Resource Outpost (`Vacuum.findTarget`), and lowers a hose
 * onto it. Every frame the hose sucks `lootBonus` resources a second out of
 * the defender's pool, one resource picked at random each frame, and hands
 * them to the attacker (`VacuumHose.tick`, `VacuumLoot`). It stops when its
 * `duration` runs out (`SiegeWeapons.activateWeapon`), when the building it
 * is on falls, or when the defending towers that can reach it have shot its
 * `durability` away (`BTOWER.canShootVacuumHose`).
 *
 * Positions here are screen points, the space Flash measured all of this in.
 */

import { VACUUM, VACUUM_OUTPOST_LOOT_SHARE, siegeLevel, siegeValue } from "./siege.js";
import { flyerMode, TICKS_PER_SECOND } from "./stats.js";
import type { ResourceAmounts } from "./types.js";

/**
 * What it can latch onto (`Vacuum.as:9`, `:221-223`): the yard's core
 * building when that is a Town Hall (`BUILDING14`) or a Map Room 3 Resource
 * Outpost (`ResourceOutpost.k_TYPE`, 139). A Map Room 2 outpost's core is a
 * `BUILDING112`, which it cannot, so there it never fires.
 */
export const VACUUM_TARGET_TYPES: readonly number[] = [14, 139];

/** The Resource Outpost, whose pool it may only take a share of (`VacuumHose.as:211-215`). */
export const VACUUM_OUTPOST_TYPE = 139;

/**
 * The hose sucks on its own `ENTER_FRAME` (`Vacuum.as:203-211`), a frame of
 * the 40 fps stage: every second tick after the drop.
 */
export const VACUUM_FRAME_TICKS = 2;

/** The hose starts this far above the building's anchor (`VacuumHose.as:222`). */
export const VACUUM_HOSE_RISE = 400;

/**
 * Where it comes to rest: the building's `_spoutPoint`, (1, -67) on every
 * building (`BFOUNDATION.as:339`, `BUILDING14.as:20`), then 50 px higher
 * (`VacuumHose.as:224-228`).
 */
export const VACUUM_SPOUT_Y = -67;
export const VACUUM_SPOUT_LIFT = 50;

/** It is lowered over 2 s (`TweenLite.to(this._vacuum, 2, ...)`, `VacuumHose.as:224`). */
export const VACUUM_LOWER_TICKS = 2 * TICKS_PER_SECOND;

/**
 * Whether a tower type can shoot the hose: its `BTOWER._targetFlyerMode` is
 * not 0 (`BTOWER.as:25-35`, `:163-169`, {@link flyerMode}). The Sniper Tower,
 * the Tesla Tower, the Aerial Defense Tower and the Magma Tower; the rest
 * have a 0 there, or no entry, and never fire at it.
 */
export const shootsHose = (type: number): boolean => flyerMode(type) !== 0;

/** `_totalPossibleLoot` on a Town Hall: `uint.MAX_VALUE`, no cap (`VacuumHose.as:210`). */
export const VACUUM_NO_CAP = 4_294_967_295;

/** One Vacuum dropped at a level, on the battle's clock. */
export interface VacuumPlan {
  /** `durability`: the hose's health. */
  readonly durability: number;
  /** `lootBonus`: resources a second. */
  readonly rate: number;
  /** The tick its timer runs out: `duration` seconds after the drop. */
  readonly endsAt: number;
}

/** A Vacuum dropped on tick `droppedAt` at `level`, or null for level 0 (not researched). */
export const vacuumPlan = (level: number, droppedAt: number): VacuumPlan | null => {
  const at = siegeLevel(level);
  const durability = siegeValue(VACUUM.durability, at);
  const rate = siegeValue(VACUUM.lootBonus, at);
  const duration = siegeValue(VACUUM.duration, at);
  if (durability === null || rate === null || duration === null) return null;
  return { durability, rate, endsAt: droppedAt + duration * TICKS_PER_SECOND };
};

/**
 * The hose's screen `y` `elapsed` ticks after the drop, over a building
 * anchored at screen `anchorY`: `Expo.easeOut` (`gs/easing/Expo.as:12-14`)
 * from {@link VACUUM_HOSE_RISE} above the anchor down to its spout.
 */
export const vacuumHoseY = (anchorY: number, elapsed: number): number => {
  const from = anchorY - VACUUM_HOSE_RISE;
  const change = anchorY + VACUUM_SPOUT_Y - VACUUM_SPOUT_LIFT - from;
  if (elapsed >= VACUUM_LOWER_TICKS) return from + change;
  return change * (-Math.pow(2, (-10 * elapsed) / VACUUM_LOWER_TICKS) + 1) + from;
};

/**
 * What a frame sucks (`VacuumHose.tick`, `:280-283`): the whole resources due
 * by now less the whole resources due by the frame before, each
 * `int(ms * rate / 1000)` from the drop. `from` and `to` are ticks since it.
 */
export const vacuumGain = (rate: number, from: number, to: number): number => {
  const due = (ticks: number): number =>
    Math.trunc((((ticks * 1000) / TICKS_PER_SECOND) * rate) / 1000);
  return due(to) - due(from);
};

/**
 * What one frame takes of the resource it picked, which holds `held`
 * (`VacuumLoot`, `:114-119`): `ceil(amount)` if there is that much, else what
 * is left.
 */
export const vacuumTake = (held: number, amount: number): number =>
  held >= Math.ceil(amount) ? Math.ceil(amount) : Math.trunc(held);

/**
 * `_totalPossibleLoot` (`:210-215`): on a Resource Outpost, a tenth of the
 * whole pool when it latched on, as a `uint`; on a Town Hall, no cap. It
 * stops taking once it has taken more than this (`hasMaxedAmountToLoot`).
 */
export const vacuumLootCap = (targetType: number, pool: ResourceAmounts): number => {
  if (targetType !== VACUUM_OUTPOST_TYPE) return VACUUM_NO_CAP;
  const total = pool.r1 + pool.r2 + pool.r3 + pool.r4;
  return Math.trunc(total * VACUUM_OUTPOST_LOOT_SHARE);
};
