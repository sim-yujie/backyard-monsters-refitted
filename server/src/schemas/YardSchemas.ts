import z from "zod";

/**
 * Body schemas for the yard action routes, `POST /api/:apiVersion/bm/yard/*`
 * (`docs/design/yard-buildings.md` §2.1, §3.2).
 *
 * Bodies are form fields like the planner's, so every scalar arrives as a
 * string and numeric fields are `z.coerce`d; a JSON body reaches the schema in
 * the same flat shape (`middleware/jsonBody.ts`). Unknown keys are stripped,
 * not refused. A body that fails its schema answers `400` with `reason`
 * `badRequest` (`controllers/yard/yardAction.ts`).
 *
 * Each route adds its schema here.
 */

/**
 * A building id: a key in the caller's `buildingdata`. Only the shape is
 * checked here; whether the yard has that building is the route's rule.
 */
export const BuildingIdField = z.coerce.number().int().nonnegative();

/** `POST /bm/yard/state` takes no fields. */
export const YardStateSchema = z.object({});

/** `POST /bm/yard/upgrade`: the building to take one level up. */
export const YardUpgradeSchema = z.object({ id: BuildingIdField });

/** `POST /bm/yard/upgrade/cancel`: the building whose running upgrade to cancel. */
export const YardCancelUpgradeSchema = z.object({ id: BuildingIdField });

/** `POST /bm/yard/speedup`: a building and one of the four speed-up items. */
export const YardSpeedupSchema = z.object({
  id: BuildingIdField,
  item: z.enum(["SP1", "SP2", "SP3", "SP4"]),
});

/** `POST /bm/yard/upgrade/instant`: the building to raise one level. */
export const YardInstantUpgradeSchema = z.object({
  id: BuildingIdField,
});

/**
 * `POST /bm/yard/shop/buy`: a store item code. Only the code: the price is the
 * server's (`services/yard/shiny.ts`), and a `price` or `cost` field the client
 * adds is stripped with every other unknown key. Whether the code is for sale
 * is the route's allowlist (`controllers/yard/shopBuy.ts`).
 */
export const YardShopBuySchema = z.object({
  item: z.string().min(1).max(16),
});

/** `POST /bm/yard/locker/cancel` and `/locker/finish` take no fields: there is only one unlock. */
export const YardLockerSchema = z.object({});

/**
 * `POST /bm/yard/locker/start` and `/locker/instant`: a roster id such as `C5`.
 * Only the shape; whether it is obtainable is the route's rule.
 */
export const YardLockerMonsterSchema = z.object({
  monster: z.string().min(1).max(16),
});

/**
 * The `hatchery` field of the hatchery routes: a hatchery's building id, or
 * `hcc` for the Hatchery Control Centre's shared queue.
 */
export const HatcheryTargetField = z.union([z.literal("hcc"), BuildingIdField]);

/**
 * `POST /bm/yard/hatchery/add`: a target, a roster id such as `C5`, and how
 * many (1..400, five level-3 hatcheries' worth). Only the shape; whether the
 * monster is unlocked and the queue has room is the route's rule.
 */
export const YardHatcheryAddSchema = z.object({
  hatchery: HatcheryTargetField,
  monster: z.string().min(1).max(16),
  count: z.coerce.number().int().min(1).max(400),
});

/**
 * `POST /bm/yard/hatchery/remove`: a target, a slot (0 = the monster in
 * production, n ≥ 1 = the n-th queue stack) and how many of it, or `all`
 * (1 when absent).
 */
export const YardHatcheryRemoveSchema = z.object({
  hatchery: HatcheryTargetField,
  slot: z.coerce.number().int().min(0).max(16),
  count: z.union([z.literal("all"), z.coerce.number().int().min(1)]).default(1),
});

/** `POST /bm/yard/hatchery/finish`: a hatchery, or `hcc` for everything the HCC feeds. */
export const YardHatcheryFinishSchema = z.object({
  hatchery: HatcheryTargetField,
});
