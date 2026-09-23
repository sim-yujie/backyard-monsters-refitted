import { post } from "./http";
import { getSession } from "./auth";
import { BaseMode, type BaseLoadRequest, type BaseLoadResponse } from "./types";

/**
 * Base / yard routes. Mounted at /base/... with no /api/:apiVersion prefix and
 * no apiVersion middleware (docs/server-api.md §Base / Yard).
 */
const LOAD_PATH = "/base/load";

/**
 * Opens the caller's own main yard.
 *
 * `type: "build"` selects the editable own-yard handler, and `baseid: "0"`
 * (BaseMode.DEFAULT) is the sentinel the handler reads as "the main yard":
 * baseModeBuild treats it as the initial load, tops up the balanced reward and
 * resets invasion waves. `userid` is required by BaseLoadSchema but the
 * handler ignores it, so the caller's own id is the honest value to send.
 *
 * No field on this call is a JSON string. On other modes `attackData` and
 * `attackcost` are, and must be JSON.stringify'd into the single form field —
 * the server runs z.string().transform(JSON.parse) over them.
 */
export const loadOwnYard = async (
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: BaseMode.BUILD,
    userid: session ? String(session.userId) : "0",
    baseid: BaseMode.DEFAULT,
    ...(options.mapversion !== undefined ? { mapversion: options.mapversion } : {}),
  };

  return post<BaseLoadResponse>(LOAD_PATH, { ...body });
};

/**
 * Opens one of the caller's other yards (an outpost) by base id, still in
 * editable build mode.
 */
export const loadOwnBase = async (
  baseid: string,
  options: { mapversion?: number } = {},
): Promise<BaseLoadResponse> => {
  const session = getSession();

  const body: BaseLoadRequest = {
    type: BaseMode.BUILD,
    userid: session ? String(session.userId) : "0",
    baseid,
    ...(options.mapversion !== undefined ? { mapversion: options.mapversion } : {}),
  };

  return post<BaseLoadResponse>(LOAD_PATH, { ...body });
};
