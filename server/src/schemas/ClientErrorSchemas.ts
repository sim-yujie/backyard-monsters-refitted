import z from "zod";

/**
 * A batch of browser errors the web client sends on its own
 * (`controllers/errors/clientErrors.ts`, web `game/bugReport/errorReporter.ts`).
 *
 * Nothing is refused for its shape: a field that is not text becomes empty,
 * text is cut to size, entries without a message are skipped, and only the
 * first {@link CLIENT_ERROR_LIMITS.batchMax} entries are read, so an odd
 * browser never turns an error report into an error of its own. The words are
 * cleaned of anything personal later (`services/errors/errorText.ts`).
 */

export const CLIENT_ERROR_LIMITS = {
  /** Entries read from one batch. */
  batchMax: 10,
  /** The most one entry may count for (the client counts repeats). */
  countMax: 100,
  /** Raw lengths read before cleaning. */
  messageMax: 1000,
  placeMax: 400,
  stackMax: 4000,
} as const;

const text = (max: number) => (value: unknown): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** An array, or the JSON text of one (`middleware/jsonBody.ts` re-stringifies a JSON body's arrays). */
const listOf = (value: unknown): unknown[] => {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list : [];
};

export interface ClientErrorItem {
  readonly kind: "error" | "rejection";
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  readonly count: number;
}

const itemOf = (raw: unknown): ClientErrorItem | null => {
  if (raw === null || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const message = text(CLIENT_ERROR_LIMITS.messageMax)(item.message);
  if (!message) return null;
  const count = Math.floor(Number(item.count));
  return {
    kind: item.kind === "rejection" ? "rejection" : "error",
    message,
    place: text(CLIENT_ERROR_LIMITS.placeMax)(item.place),
    stack: text(CLIENT_ERROR_LIMITS.stackMax)(item.stack),
    count: Number.isFinite(count) ? Math.min(CLIENT_ERROR_LIMITS.countMax, Math.max(1, count)) : 1,
  };
};

export const ClientErrorsSchema = z.object({
  errors: z.unknown().optional().transform((value) =>
    listOf(value)
      .slice(0, CLIENT_ERROR_LIMITS.batchMax)
      .map(itemOf)
      .filter((item): item is ClientErrorItem => item !== null)
  ),
  gameVersion: z.unknown().optional().transform(text(32)),
  screen: z.unknown().optional().transform(text(64)),
});

export type ClientErrorsBody = z.infer<typeof ClientErrorsSchema>;
