import z from "zod";
import type { AttackData } from "./AttackSchema.js";
import { optionalJsonField } from "./jsonField.js";

export const BaseLoadSchema = z.object({
  /**
   * The baseMode type to load.
   * @type {string}
   */
  type: z.string(),

  /**
   * The user ID of the user making the request.
   * @type {string}
   */
  userid: z.string(),

  /**
   * The base ID of the base to load.
   * @type {string}
   */
  baseid: z.string(),

  /**
   * The map room version the client is currently in (1, 2, or 3).
   * @type {number | undefined}
   */
  mapversion: z.coerce
    .number()
    .transform((version) => (Number.isNaN(version) ? undefined : version))
    .optional(),

  /**
   * The attack payload, transformed from a JSON string to an AttackPayload object.
   * @type {AttackData | undefined}
   */
  attackData: optionalJsonField<AttackData>("attackData"),

  // No `attackcost`: Map Room 3 took its attack cost from here, and a negative
  // one paid the attacker (security audit 2026-10-29, C1). A field sent anyway
  // is dropped by the parse.
});
