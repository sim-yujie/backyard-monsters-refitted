import z from "zod";

/**
 * One Map Room 2 open timing record from a real player's browser
 * (`POST /api/:v/clienttiming`, `controllers/maproom/clientTiming.ts`; web
 * `game/maproom/openTimingSummary.ts` `compactRecord`). The client sends at
 * most two a page load (the first open and one later open).
 *
 * Strict, unlike the browser error batch: the record is ours and small, so
 * anything that is not its exact shape (an unknown field, a key too long, a
 * text too long, a map with too many keys, a number out of range) is refused
 * with a 400 and nothing is logged. Only numbers and short text get through.
 */

export const CLIENT_TIMING_LIMITS = {
  /** The JSON text of `record` (the JSON body middleware sends it as text). */
  rawMax: 16_000,
  /** Keys in each of `t`, `spans`, `art`, `shaders`. */
  mapKeysMax: 64,
  /** Keys in `info`. */
  infoKeysMax: 24,
  /** Length of a map key (a step, span, file or shader name). */
  keyMax: 80,
  /** Length of an `info` text (the client cuts at 120). */
  infoTextMax: 120,
  /** Largest milliseconds accepted (the client gives up an open after 2 minutes). */
  msMax: 600_000,
  /** Largest count (getarea calls) or kilobytes accepted. */
  countMax: 1_000_000,
} as const;

const L = CLIENT_TIMING_LIMITS;

/** Printable ASCII only, so a log line can never carry control characters. */
const PRINTABLE = /^[\x20-\x7e]+$/;

const key = (max: number) => z.string().min(1).max(max).regex(PRINTABLE);
const ms = z.number().finite().min(0).max(L.msMax);
const count = z.number().int().min(0).max(L.countMax);

const msMap = z
  .record(key(L.keyMax), ms)
  .refine((map) => Object.keys(map).length <= L.mapKeysMax, { message: `at most ${L.mapKeysMax} keys` });

/** Any text without control characters (a graphics card's name may not be plain ASCII). */
const NO_CONTROL = /^[^\x00-\x1f\x7f]*$/;

const infoValue = z.union([z.string().max(L.infoTextMax).regex(NO_CONTROL), z.number().finite(), z.boolean(), z.null()]);

export const OpenTimingRecordSchema = z.strictObject({
  v: z.literal(1),
  open: z.enum(["first", "later"]),
  reason: z.enum(["done", "timeout", "left"]),
  total: ms,
  t: msMap,
  spans: msMap,
  area: z.strictObject({ n: count, ok: count, fail: count, avg: ms.nullable(), max: ms.nullable() }),
  art: msMap,
  cut: ms,
  shaders: msMap,
  kb: z.strictObject({ total: count, area: count, art: count, code: count }),
  cached: z.enum(["yes", "no", "mixed"]).nullable(),
  info: z
    .record(key(40), infoValue)
    .refine((map) => Object.keys(map).length <= L.infoKeysMax, { message: `at most ${L.infoKeysMax} keys` }),
});

export type OpenTimingRecord = z.infer<typeof OpenTimingRecordSchema>;

/** Bad JSON text becomes a value the record schema refuses, so it is a 400 like any other. */
const fromJsonText = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (value.length > L.rawMax) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const ClientTimingSchema = z.strictObject({
  record: z.preprocess(fromJsonText, OpenTimingRecordSchema),
  gameVersion: z.string().max(32).regex(/^[\x20-\x7e]*$/).optional(),
});

export type ClientTimingBody = z.infer<typeof ClientTimingSchema>;
