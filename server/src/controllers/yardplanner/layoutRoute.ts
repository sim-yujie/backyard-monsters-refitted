import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * Wraps a Yard Planner controller so a rejected layout answers in the shape the
 * planner client reads: the status the error carries, and its detail flattened
 * into the body next to `error`.
 *
 * `ErrorInterceptor` would otherwise nest that detail under `errorDetails.data`
 * (`server/src/middleware/clientSafeError.ts`), which every other route is
 * built around and which this must not change. Anything that is not a
 * `ClientSafeError` is re-thrown and handled globally as usual.
 */
export const layoutRoute =
  (handler: KoaController): KoaController =>
  async (ctx, next) => {
    try {
      await handler(ctx, next);
    } catch (err) {
      if (!(err instanceof ClientSafeError)) throw err;
      ctx.status = err.status;
      ctx.body = { error: err.message, ...err.data };
    }
  };
