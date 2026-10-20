import { invalidBugReportErr } from "../../errors/errors.js";

/**
 * The pictures a bug report carries, as the web client sends them: a
 * `data:image/...;base64,` URL. Only JPEG, PNG and WebP are kept, and only
 * when the bytes really are one (the first bytes are checked, not just the
 * label), so nothing else reaches the database or the email.
 */

export type BugReportImageType = "image/jpeg" | "image/png" | "image/webp";

export interface BugReportImage {
  readonly type: BugReportImageType;
  readonly bytes: Buffer;
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

/** The file type the bytes start with, or null for anything else. */
export const sniffImageType = (bytes: Buffer): BugReportImageType | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
};

/** The file name extension for an attachment. */
export const imageExtension = (type: BugReportImageType): string =>
  type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : "webp";

/**
 * Decodes one picture, or null when none was sent.
 *
 * @param {unknown} value - The data URL as the body carried it; empty means none.
 * @param {number} maxBytes - The largest picture accepted, decoded.
 * @param {string} what - The picture's name in the refusal ("screenshot", "picture").
 * @throws {ClientSafeError} When it is not a JPEG, PNG or WebP, or is too big.
 */
export const decodeBugReportImage = (value: unknown, maxBytes: number, what: string): BugReportImage | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw invalidBugReportErr(`The ${what} could not be read.`, what);
  // Base64 is 4 characters per 3 bytes: refuse a long one before decoding it.
  if (value.length > Math.ceil(maxBytes / 3) * 4 + 64) throw imageTooBig(what, maxBytes);
  const match = DATA_URL.exec(value);
  if (!match) throw invalidBugReportErr(`The ${what} must be a JPEG, PNG or WebP picture.`, what);
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > maxBytes) throw imageTooBig(what, maxBytes);
  const type = sniffImageType(bytes);
  if (!type) throw invalidBugReportErr(`The ${what} must be a JPEG, PNG or WebP picture.`, what);
  return { type, bytes };
};

const imageTooBig = (what: string, maxBytes: number) =>
  invalidBugReportErr(`The ${what} is too big. The largest is ${Math.round(maxBytes / 100_000) / 10} MB.`, what);
