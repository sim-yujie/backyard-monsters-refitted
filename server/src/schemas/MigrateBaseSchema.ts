import z from "zod";
import { BaseType } from "../enums/Base.js";

/**
 * Request schema for migrate base.
 *
 * @type {z.ZodObject}
 */
export const MigrateBaseSchema = z.object({
  /**
   * The baseMode type sent by the client.
   * @type {string}
   */
  type: z.nativeEnum(BaseType),

  /**
   * The base ID of the base which is migration.
   * @type {string}
   */
  baseid: z.string(),

  /**
   * The resources the client offers for the migration. Ignored: without a positive `shiny` the server charges its own resource price (issue #181).
   * @type {object | undefined}
   */
  resources: z
    .string()
    .transform((res) => JSON.parse(res))
    .optional(),

  /**
   * The Shiny the client offers for the migration. A positive value picks the Shiny price; the amount is the server's (issue #181).
   * @type {number | undefined}
   */
  shiny: z
    .string()
    .transform((shiny) => parseInt(shiny))
    .optional(),
});
