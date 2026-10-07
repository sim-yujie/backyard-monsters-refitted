import { bulkFeedDisabledErr } from "../../../../errors/errors.js";
import type { KoaController } from "../../../../utils/KoaController.js";

/**
 * THIS ENDPOINT IS FOR API CONSUMERS ONLY.
 * ____________________________________________________________
 *
 * Switched off (issue #330, owner decision, `docs/design/fog-of-war.md`
 * §5.3): this used to serve every occupied cell in an MR2 world in a single
 * request — player main yards, their outposts, and attacked wild monster
 * camps — which is exactly the whole-world base feed the fog of war exists
 * to stop. It, and any other bulk whole-world base feed for API consumers,
 * goes dark while the fog is on.
 *
 * `/worldmapv2/terrain` is unaffected: it carries no base data, so it is not
 * the "whole-world base data" this shutoff covers. `worldSnapshot.ts`
 * (the builder this controller used to call) is left in place, in case the
 * owner ever wants a per-caller, sight-scoped feed back.
 *
 * Status
 *   404   always — `bulkFeedDisabledErr()`
 *
 * @param {Context} ctx - The Koa request/response context object.
 * @returns {Promise<void>} - Never resolves; always throws.
 */
export const getSnapshot: KoaController = async () => {
  throw bulkFeedDisabledErr();
};
