import type { Save } from "../../database/models/save.model.js";
import { storageCap } from "../base/economy/resourceBudget.js";

/**
 * An outpost as its yard rules see it: its own buildings, with its owner's
 * main-yard pool (outposts WP3, issue #184).
 *
 * In Flash an outpost has no resources of its own. Its resource bar is the main
 * yard's pool, every charge and refund in an outpost moves that pool, and the
 * caps are the main yard's (silos count only there, plus 2,000,000 per outpost)
 * (`client/scripts/BASE.as:4776-4825`). Credits, points, the Monster Locker and
 * the Academy belong to the player too: `/base/load` serves them from the main
 * save whichever yard the owner opens (`services/base/mapSaveData.ts`).
 *
 * Rather than teach every yard rule about two rows, the yard action wrapper
 * hands the rules this view. It reads and writes the outpost row for
 * everything but {@link POOL_FIELDS}, which it reads from and writes to the
 * main row, and it adds `poolCap`, the main yard's storage cap, which the
 * credit clamp and the yard state read (`credit.ts`, `capOf`). So a rule that
 * charges `save.resources`, awards `save.points` or credits under the cap
 * does the right thing on an outpost without knowing it is on one; its `type`
 * (`outpost`) tells the rules which props table to read (`yardKindOf`).
 *
 * Both rows are MikroORM entities; the view only forwards to them, so the
 * entity manager sees and flushes the writes on the real rows. Never hand the
 * view itself to the entity manager.
 */

/** The columns that belong to the player and live on the main row. */
export const POOL_FIELDS: ReadonlySet<PropertyKey> = new Set([
  "resources",
  "credits",
  "points",
  "outposts",
  "lockerdata",
  "academy",
  // The account's tutorial record lives on the main row (issue #227).
  "onboarding",
  // So is the achievements' record (issue #204).
  "achievements",
]);

/** The extra key the view adds: the main yard's storage cap. */
const POOL_CAP = "poolCap";

/**
 * The outpost `yard` with the player-level columns of `pool`, its owner's main
 * yard. Reads and writes go straight through to the two rows.
 *
 * @param yard - The outpost row.
 * @param pool - The owner's main row.
 */
export const poolView = (yard: Save, pool: Save): Save =>
  new Proxy(yard, {
    get(target, prop) {
      if (prop === POOL_CAP) return storageCap(pool);
      return POOL_FIELDS.has(prop) ? Reflect.get(pool, prop) : Reflect.get(target, prop);
    },
    set(target, prop, value) {
      return POOL_FIELDS.has(prop) ? Reflect.set(pool, prop, value) : Reflect.set(target, prop, value);
    },
    has(target, prop) {
      return prop === POOL_CAP || Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = Reflect.ownKeys(target);
      return keys.includes(POOL_CAP) ? keys : [...keys, POOL_CAP];
    },
    // So a spread (`{ ...save, buildingdata }`) copies the pool too.
    getOwnPropertyDescriptor(target, prop) {
      if (prop === POOL_CAP) {
        return { value: storageCap(pool), writable: false, enumerable: true, configurable: true };
      }
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      if (own && "value" in own && POOL_FIELDS.has(prop)) return { ...own, value: Reflect.get(pool, prop) };
      return own;
    },
  });
