import z from "zod";

/**
 * A JSON value sent stringified inside a text field — the shape the
 * form-encoded body (and `middleware/jsonBody.ts`'s re-stringified JSON body)
 * uses for anything with structure: `attackData`, `buildingdata`, `cellids`
 * and friends.
 *
 * Malformed JSON fails the field the same way any other bad value does — a
 * `ZodError` the `ErrorInterceptor` turns into a 400 naming the field (issue
 * #224) — instead of an uncaught `JSON.parse` throw reaching the interceptor
 * as an unhandled error and becoming a 500.
 *
 * Returns `unknown`, like `JSON.parse`; pipe it into a schema to check the
 * parsed shape, or just cast at the call site for an existing `as T`.
 *
 * @param message - The 400's message on bad JSON, e.g.
 *   `"attackData must be valid JSON"`.
 */
export const jsonField = (message: string) =>
  z.string().transform((raw, ctx): unknown => {
    try {
      return JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });

/**
 * {@link jsonField}, but optional, and reading a missing or empty string as
 * "nothing sent" rather than invalid JSON — the
 * `data ? JSON.parse(data) : undefined` shape repeated across the base
 * save/load/migrate schemas.
 *
 * Defaults to `any`, matching the untyped `JSON.parse` these replace: most
 * callers went straight into a loosely-typed save column and gained nothing
 * from `unknown` but a cast at every one of them.
 *
 * @param field - The field's name, named in the 400's message
 *   (`"<field> must be valid JSON"`).
 */
export const optionalJsonField = <T = any>(field: string) =>
  z
    .string()
    .optional()
    .transform((data, ctx): T | undefined => {
      if (!data) return undefined;
      try {
        return JSON.parse(data) as T;
      } catch {
        ctx.addIssue({ code: "custom", message: `${field} must be valid JSON` });
        return z.NEVER;
      }
    });
