import z from "zod";
import { optionalJsonField } from "./jsonField.js";

/**
 * Schema for validating and transforming MR3 cellid's from the client.
 * The client sends data stringified, so we need to convert it back to an array.
 *
 * @type {z.ZodObject}
 */
export const CellSchema = z.object({
  /**
   * The list of cell IDs requested by the client.
   * @type {number[] | undefined}
   */
  cellids: optionalJsonField<number[]>("cellids"),
});
