import z from "zod";

import { BUG_REPORT_LIMITS } from "../config/BugReportConfig.js";
import { emailSchema } from "./AuthSchemas.js";

/**
 * A bug report as the web client sends it (`controllers/bugReports`).
 *
 * Only the player's words can be refused. What the client gathers on its own
 * (version, screen, device, browser, screen size, errors) is clipped to size
 * rather than refused, and anything that is not text becomes empty, so a
 * report is never lost to an odd browser. The pictures are checked by
 * `services/bugReports/bugReportImage.ts`.
 */

export const BugReportMessage = {
  tooShort: "Please tell us a little about what went wrong.",
  tooLong: `Please keep it under ${BUG_REPORT_LIMITS.messageMax} characters.`,
} as const;

/** Text the client gathered: trimmed and cut to `max`, or empty. */
const clipped = (max: number) =>
  z.unknown().transform((value) => (typeof value === "string" ? value.trim().slice(0, max) : ""));

/**
 * The client's recent game errors, newest last: an array, or the JSON text of
 * one (`middleware/jsonBody.ts` re-stringifies a JSON body's arrays). Only the
 * last `errorsMax` strings are kept, each cut to `errorLengthMax`.
 */
const errorList = z.unknown().transform((value): string[] => {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((line): line is string => typeof line === "string")
    .slice(-BUG_REPORT_LIMITS.errorsMax)
    .map((line) => line.slice(0, BUG_REPORT_LIMITS.errorLengthMax));
});

export const BugReportSchema = z.object({
  message: z
    .string({ error: BugReportMessage.tooShort })
    .trim()
    .min(BUG_REPORT_LIMITS.messageMin, BugReportMessage.tooShort)
    .max(BUG_REPORT_LIMITS.messageMax, BugReportMessage.tooLong),
  gameVersion: clipped(32),
  screen: clipped(64),
  device: z.unknown().transform((value) => (value === "phone" || value === "computer" ? value : "")),
  userAgent: clipped(512),
  screenSize: clipped(64),
  errors: errorList,
  /** A `data:image/...;base64,` URL, or empty. */
  screenshot: z.unknown().optional(),
  picture: z.unknown().optional(),
});

/** A report from the login screen: an email to answer, and the Turnstile token. */
export const GuestBugReportSchema = BugReportSchema.extend({
  email: emailSchema,
  turnstileToken: z.unknown().optional(),
});

export type BugReportBody = z.infer<typeof BugReportSchema>;
