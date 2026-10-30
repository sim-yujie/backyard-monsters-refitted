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

/**
 * The Inferno yard's columns that live on the main row, and the main-row
 * column each one reads (`docs/design/inferno.md` §3.1, WP 1.15).
 *
 * - `resources` is the Inferno purse, the main save's `iresources` (Bone,
 *   Coal, Sulfur, Magma): every build, upgrade, cancel and recycle in the
 *   Inferno charges or refunds it (`BASE.Fund(..., isInfernoBuilding)`,
 *   `client/scripts/BFOUNDATION.as:2557`).
 * - `credits`: Shiny is the player's, shared with the surface.
 * - `onboarding`, `achievements`: the account's records, as on an outpost.
 *
 * Everything else is the Inferno row's own, unlike an outpost's: its `points`
 * (the Inferno level, saved on the Inferno save in Flash, `BASE.as:3195`), its
 * `storedata`, and its Locker, Academy and housed monsters.
 */
const INFERNO_POOL_FIELDS: ReadonlyMap<PropertyKey, string> = new Map([
  ["resources", "iresources"],
  ["credits", "credits"],
  ["onboarding", "onboarding"],
  ["achievements", "achievements"],
]);

/**
 * The Inferno yard `yard` as its rules see it, with the Inferno purse and the
 * Shiny of `pool`, its owner's main yard (see {@link INFERNO_POOL_FIELDS}).
 * Its `type` stays `inferno`, so the rules read the Inferno table
 * (`yardKindOf`), and the storage cap is the Inferno's: 10,000 plus the yard's
 * own Resource Pods, times the yard's own Improved Packing Skills
 * (`storageCap`). The cap is worked out from the yard's buildings each time it
 * is read, so a Resource Pod an action builds or recycles moves it at once.
 *
 * @param yard - The Inferno yard row.
 * @param pool - The owner's main row.
 */
export const infernoView = (yard: Save, pool: Save): Save => {
  const poolKey = (prop: PropertyKey): string | undefined => INFERNO_POOL_FIELDS.get(prop);
  return new Proxy(yard, {
    get(target, prop) {
      const key = poolKey(prop);
      return key ? Reflect.get(pool, key) : Reflect.get(target, prop);
    },
    set(target, prop, value) {
      const key = poolKey(prop);
      return key ? Reflect.set(pool, key, value) : Reflect.set(target, prop, value);
    },
    getOwnPropertyDescriptor(target, prop) {
      const own = Reflect.getOwnPropertyDescriptor(target, prop);
      const key = poolKey(prop);
      if (own && "value" in own && key) return { ...own, value: Reflect.get(pool, key) };
      return own;
    },
  });
};
