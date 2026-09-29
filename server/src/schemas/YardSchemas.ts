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

/**
 * The yard a request acts on, on every yard route: absent (or `0`) for the
 * caller's main yard, else the `baseid` of one of their Map Room 2 outposts
 * (the id `/base/load` and `Save.outposts` use). The wrapper reads it
 * beside the route's own schema (`controllers/yard/yardAction.ts`).
 */
export const YardTargetSchema = z.object({
  baseid: z
    .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
    .optional()
    .transform((raw) => (raw === undefined || String(raw) === "0" ? undefined : String(raw))),
});

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

/**
 * `POST /bm/yard/bank`: `ids`, a JSON array of harvester building ids (a JSON
 * body's array arrives stringified, `middleware/jsonBody.ts`), or `all=1` for
 * every eligible harvester (the HUD's Collect all). Exactly one of the two.
 */
export const YardBankSchema = z
  .object({
    ids: z
      .string()
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "ids must be a JSON array of building ids" });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.number().int().nonnegative()).min(1).max(1000))
      .optional(),
    all: z.coerce.number().int().min(1).max(1).optional(),
  })
  .refine((body) => (body.ids === undefined) !== (body.all === undefined), {
    message: "Send either ids or all=1",
  });

/**
 * A yard position in yard units: a footprint's origin. Bounded well past the
 * largest plot (1780 x 1420, `services/yardplanner/layoutGeometry.ts`) so only
 * the shape is checked here; whether the building fits is the route's rule.
 */
const YardCoordinateField = z.coerce.number().int().min(-4000).max(4000);

/**
 * `POST /bm/yard/build` and `/build/instant`: a building type and where its
 * footprint starts. Whether the type may be built there is the route's rule
 * (`services/yard/build.ts`).
 */
export const YardBuildSchema = z.object({
  type: z.coerce.number().int().positive(),
  x: YardCoordinateField,
  y: YardCoordinateField,
});

/** `POST /bm/yard/build/cancel`: the building under construction to cancel. */
export const YardCancelBuildSchema = z.object({ id: BuildingIdField });

/**
 * `POST /bm/yard/academy/train` and `/academy/instant`: a roster id such as
 * `C5`, and optionally the Monster Academy to use (its building id; absent
 * takes the first idle one high enough). Only the shape; the rest is the
 * route's rule.
 */
export const YardAcademyTrainSchema = z.object({
  monster: z.string().min(1).max(16),
  academy: BuildingIdField.optional(),
});

/** `POST /bm/yard/academy/cancel` and `/academy/finish`: the training monster. */
export const YardAcademyMonsterSchema = z.object({
  monster: z.string().min(1).max(16),
});

/**
 * `POST /bm/yard/repair`: `ids`, a JSON array of building ids, or `all=1` for
 * every damaged building (the post-attack banner's Repair all). Exactly one of
 * the two, read as the bank route reads them.
 */
export const YardRepairSchema = z
  .object({
    ids: z
      .string()
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "ids must be a JSON array of building ids" });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.number().int().nonnegative()).min(1).max(1000))
      .optional(),
    all: z.coerce.number().int().min(1).max(1).optional(),
  })
  .refine((body) => (body.ids === undefined) !== (body.all === undefined), {
    message: "Send either ids or all=1",
  });

/** `POST /bm/yard/repair/instant` takes no fields: it repairs everything damaged. */
export const YardRepairInstantSchema = z.object({});

/** `POST /bm/yard/recycle`: the building to recycle. */
export const YardRecycleSchema = z.object({ id: BuildingIdField });

/**
 * Monster counts as a JSON object, `{"C2": 20, "C5": 3}` (a JSON body's
 * object arrives stringified, `middleware/jsonBody.ts`): at least one id,
 * each a whole count of 1 or more. Which ids are allowed is the route's rule.
 */
const MonsterCountsField = z
  .string()
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "monsters must be a JSON object of counts" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .record(z.string().min(1).max(16), z.number().int().min(1).max(100_000))
      .refine((counts) => {
        const size = Object.keys(counts).length;
        return size >= 1 && size <= 40;
      }, "Send between 1 and 40 monster types")
  );

/** `POST /bm/yard/juice`: housed monsters to juice for goo (`services/yard/juice.ts`). */
export const YardJuiceSchema = z.object({ monsters: MonsterCountsField });

/**
 * `POST /bm/yard/bunker/fill`: monsters to put in a Monster Bunker, from
 * housing (putty) or bought (Shiny) (`services/yard/bunker.ts`).
 */
export const YardBunkerFillSchema = z.object({
  bunker: BuildingIdField,
  monsters: MonsterCountsField,
  source: z.enum(["housing", "buy"]),
});

/**
 * `POST /bm/yard/bunker/remove`: take monsters out of a Monster Bunker for
 * good, juiced when a Juicer works; `count` a number or `all`.
 */
export const YardBunkerRemoveSchema = z.object({
  bunker: BuildingIdField,
  monster: z.string().min(1).max(16),
  count: z.union([z.literal("all"), z.coerce.number().int().min(1).max(100_000)]).default(1),
});

/** `POST /bm/yard/lab/start` and `/lab/instant`: the monster whose next Lab rank to research. */
export const YardLabMonsterSchema = z.object({
  monster: z.string().min(1).max(16),
});

/** `POST /bm/yard/lab/cancel` and `/lab/finish` take no fields: one Lab, one research. */
export const YardLabSchema = z.object({});
/** `POST /bm/yard/champion/raise`: the champion type to hatch at the cage (1..5; only 1-3 are raisable). */
export const YardChampionRaiseSchema = z.object({
  type: z.coerce.number().int().min(1).max(5),
});

/** `POST /bm/yard/champion/feed`: feed the champion in the cage from housing or with Shiny. */
export const YardChampionFeedSchema = z.object({
  mode: z.enum(["monsters", "shiny"]),
});

/** `POST /bm/yard/champion/evolve`, `/heal` and `/juice` act on the champion in the cage. */
export const YardChampionSchema = z.object({});

/** `POST /bm/yard/champion/rename`: the new name, checked for length and language by the route. */
export const YardChampionRenameSchema = z.object({
  name: z.string().max(200),
});

/** `POST /bm/yard/champion/freeze` moves the champion in the cage into the Champion Chamber. */
export const YardChampionFreezeSchema = z.object({});

/** `POST /bm/yard/champion/thaw`: the frozen champion type to bring back to the cage. */
export const YardChampionThawSchema = z.object({
  type: z.coerce.number().int().min(1).max(5),
});

/** `POST /bm/yard/fortify`: the building to fortify one step (outposts). */
export const YardFortifySchema = z.object({ id: BuildingIdField });

/** `POST /bm/yard/fortify/cancel`: the building whose running fortification to cancel. */
export const YardCancelFortifySchema = z.object({ id: BuildingIdField });

/**
 * `POST /bm/yard/starterkit` (outposts WP9): the kit (1 Regular, 2 Mega, 3
 * Ultra), how it is paid for, and the Shiny top-up the player agreed to when
 * the pool is short (`services/yard/starterKit.ts`).
 */
/** `POST /bm/yard/decor/place`: a decoration out of storage, and where (#128). */
export const YardPlaceDecorationSchema = z.object({
  type: z.coerce.number().int().positive(),
  x: YardCoordinateField,
  y: YardCoordinateField,
});

export const YardStarterKitSchema = z.object({
  kit: z.coerce.number().int().min(1).max(3),
  pay: z.enum(["resources", "shiny"]),
  topUp: z.coerce.number().int().nonnegative().optional(),
});
