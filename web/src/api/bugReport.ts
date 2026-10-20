import { ApiError, NetworkError, postJson } from "./http";

/**
 * Sends a bug report (`server/src/controllers/bugReports/submitBugReport.ts`):
 * signed in from the Account menu, or signed out from the login screen with
 * an email for the reply and the Turnstile token.
 */

const SIGNED_IN_PATH = "/api/:apiVersion/bugreport";
const SIGNED_OUT_PATH = "/api/:apiVersion/bugreport/guest";

export interface BugReportPayload {
  readonly message: string;
  readonly gameVersion: string;
  readonly screen: string;
  readonly device: "phone" | "computer";
  readonly userAgent: string;
  readonly screenSize: string;
  readonly errors: readonly string[];
  /** JPEG data URL, or omitted when the player removed it. */
  readonly screenshot?: string;
  readonly picture?: string;
}

export interface GuestBugReportPayload extends BugReportPayload {
  readonly email: string;
  readonly turnstileToken?: string;
}

/** How a send ended: sent, or refused with words to show the player. */
export type BugReportResult =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly message: string; readonly limit: boolean; readonly botCheck: boolean };

const reasonOf = (error: ApiError): unknown =>
  (error.details?.data as { reason?: unknown } | undefined)?.reason ??
  (error.body as { reason?: unknown } | undefined)?.reason;

const refusal = (caught: unknown): BugReportResult => {
  if (caught instanceof NetworkError) {
    return {
      ok: false,
      message: "Couldn't reach the game server. Check your connection and try again.",
      limit: false,
      botCheck: false,
    };
  }
  if (caught instanceof ApiError) {
    const reason = reasonOf(caught);
    return {
      ok: false,
      message: caught.status === 413 ? "The pictures are too big to send. Remove one and try again." : caught.message,
      limit: reason === "bugReportLimit",
      botCheck: reason === "botCheckFailed" || reason === "botCheckUnavailable",
    };
  }
  return { ok: false, message: "Something went wrong sending your report. Please try again.", limit: false, botCheck: false };
};

export const sendBugReport = async (payload: BugReportPayload | GuestBugReportPayload, signedIn: boolean): Promise<BugReportResult> => {
  try {
    const answer = await postJson<{ id?: number }>(signedIn ? SIGNED_IN_PATH : SIGNED_OUT_PATH, { ...payload });
    return { ok: true, id: Number(answer.id ?? 0) };
  } catch (caught) {
    return refusal(caught);
  }
};
