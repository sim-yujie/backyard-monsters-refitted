import { ApiError, postJson } from "./http";

/**
 * Sends a batch of browser errors for the owner's dashboard
 * (`server/src/controllers/errors/clientErrors.ts`): signed in with the
 * account number kept, or from the login screen with nothing about the
 * sender kept. The game's own error sender is `game/bugReport/errorReporter.ts`.
 */

const SIGNED_IN_PATH = "/api/:apiVersion/clienterrors";
const SIGNED_OUT_PATH = "/api/:apiVersion/clienterrors/guest";

export interface ClientErrorItem {
  readonly kind: "error" | "rejection";
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  readonly count: number;
}

export interface ClientErrorBatch {
  readonly errors: readonly ClientErrorItem[];
  readonly gameVersion: string;
  readonly screen: string;
}

/**
 * How a send ended: `sent`; `stop` when the server says not to send more
 * this page load (too many, signed out, or no such route on this server);
 * `failed` for anything else (offline, a server error).
 */
export type ClientErrorSendResult = "sent" | "stop" | "failed";

const STOP_STATUSES = new Set([401, 403, 404, 429]);

export const sendClientErrors = async (batch: ClientErrorBatch, signedIn: boolean): Promise<ClientErrorSendResult> => {
  try {
    await postJson(signedIn ? SIGNED_IN_PATH : SIGNED_OUT_PATH, { ...batch });
    return "sent";
  } catch (caught) {
    if (caught instanceof ApiError && (STOP_STATUSES.has(caught.status) || STOP_STATUSES.has(caught.serverStatus))) return "stop";
    return "failed";
  }
};
