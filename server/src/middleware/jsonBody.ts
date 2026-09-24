import type { Context, Next } from "koa";

/**
 * Lets a client send a native `application/json` body to routes that were
 * written for the Flash client's form-encoded one (issue #28).
 *
 * The whole server reads flat string fields off `ctx.request.body`: anything
 * with structure in it — `data`, `ids`, `traps`, `buildingdata`, `resources`,
 * `champion`, `bookmarks`, `cellids`, `attackData` and friends — arrives as a
 * JSON string inside a single form field, and the zod schema or the service
 * `JSON.parse`s it by hand (`docs/server-api.md` §1). A JSON client would
 * naturally send those as real objects and arrays, which every one of those
 * `z.string()` fields rejects.
 *
 * Rather than teach ~30 schemas and a dozen services a second shape, the
 * conversion happens once here, at the edge: on a JSON request, a top-level
 * field whose value is an object or an array is re-stringified, so the body
 * handed to the router is byte-identical to what the form path produces. The
 * form path never enters this middleware at all, so the archived Flash client
 * cannot be affected by it.
 *
 * Scalars are left exactly as sent, for two reasons. Numbers already work,
 * because the numeric body fields are declared `z.coerce.number()`. Booleans
 * must not be touched: `updateSettings` takes `shinyLocked: z.boolean()` and
 * only a JSON body can satisfy it, and stringifying `false` to `"false"` would
 * turn it truthy for anything reading it loosely. The one thing a JSON client
 * must still do by hand is send the id fields that are declared `z.string()`
 * (`baseid`, `basesaveid`, `attackid`) as strings.
 */

/**
 * The content types koa-bodyparser routes to its JSON parser, copied from its
 * defaults (`koa-bodyparser/index.js`). Kept in step so that "the body was
 * parsed as JSON" and "this middleware normalises it" can never disagree.
 */
export const JSON_BODY_TYPES = [
  "application/json",
  "application/json-patch+json",
  "application/vnd.api+json",
  "application/csp-report",
  "application/scim+json",
];

/**
 * Re-stringifies the object- and array-valued fields of a parsed JSON body.
 *
 * Pure, and only ever looks one level deep, because that is exactly how deep a
 * form-encoded body can go: `{ data: { nodes: [] } }` becomes
 * `{ data: "{\"nodes\":[]}" }`, which is what `URLVariables` would have sent.
 * A field that is already a string is left alone, so a client that stringifies
 * some fields itself and not others is read the same way either way.
 *
 * `null` counts as a scalar here: it is left in place rather than becoming the
 * string `"null"`, which the optional fields would then try to parse.
 *
 * @param body - The parsed JSON body, whatever koa-bodyparser produced.
 * @returns The same value when nothing needed converting, otherwise a new
 *   object with the structured fields stringified.
 */
export const normaliseJsonBody = (body: unknown): unknown => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;

  const entries = Object.entries(body as Record<string, unknown>);
  const structured = entries.filter(
    ([, value]) => value !== null && typeof value === "object"
  );

  if (structured.length === 0) return body;

  const normalised: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const [key, value] of structured) normalised[key] = JSON.stringify(value);

  return normalised;
};

/**
 * Middleware wrapper for {@link normaliseJsonBody}. Mounted directly after
 * `koa-bodyparser` so that everything downstream — logging, the anticheat hook,
 * the schemas — sees one body shape.
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @param {Next} next - The next middleware function in the stack.
 */
export const jsonBodyCompat = async (ctx: Context, next: Next) => {
  if (ctx.request.is(JSON_BODY_TYPES)) {
    ctx.request.body = normaliseJsonBody(ctx.request.body);
  }

  await next();
};
