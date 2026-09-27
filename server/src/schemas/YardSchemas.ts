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
