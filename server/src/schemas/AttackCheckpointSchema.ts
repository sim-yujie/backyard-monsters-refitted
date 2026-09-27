import z from "zod";

/** A JSON field as the form path (or `jsonBody.ts`) delivers it: a string, parsed here. */
const jsonField = z
  .string()
  .optional()
  .transform((data): unknown => {
    if (!data) return undefined;
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  });

/**
 * `/base/checkpoint` (issue #138, `services/base/attackCheckpoint.ts`): the web
 * client's running record of an attack. Only the ids are checked here; the
 * checkpoint itself is read by `parseCheckpoint`, which refuses it whole
 * rather than failing on the first field.
 */
export const AttackCheckpointSchema = z.object({
  basesaveid: z.string().transform((id) => parseInt(id, 10)),
  attackid: z.string().optional(),
  tick: z.coerce.number(),
  flinglog: jsonField,
  sources: jsonField,
});
