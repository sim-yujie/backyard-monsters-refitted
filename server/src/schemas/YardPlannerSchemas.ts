import z from "zod";

/**
 * Schemas for the version 2 Yard Planner layout endpoints.
 *
 * The client posts form-urlencoded bodies, so every field arrives as a string:
 * `data` is a JSON string and is parsed here, and the slot arrives as a route
 * parameter. Shape rules live in the schema; rules that need the caller's save
 * (ownership, plot bounds, overlaps) live in
 * `services/yardplanner/validateLayout.ts`.
 *
 * Field names are the wire contract with the web client and must not drift:
 * `docs/design/yard-planner-redesign.md` §5.1.
 */

/** Ten slots for everyone, enforced server-side (redesign §8, decision Q2). */
export const LAYOUT_SLOTS = 10;

/** The version this server writes. Legacy rows are converted on read. */
export const LAYOUT_VERSION = 2;

/** Name length the planner's rename field allows, rounded up from the Flash client's 15. */
export const LAYOUT_NAME_MAX = 20;

/**
 * Hard ceiling on nodes in one layout. A maxed main yard is a few hundred
 * buildings — the 575-building sandbox save is the largest we have — so 1200
 * is well clear of any real layout while still bounding the work per request.
 */
export const LAYOUT_NODE_MAX = 1200;

/** Payload cap for the legacy `savetemplate` route, in bytes. */
export const LEGACY_PAYLOAD_MAX = 64 * 1024;

/** One placed building in a layout. */
export const LayoutNodeSchema = z.object({
  /** Building id, matching a key in the caller's `buildingdata`. */
  id: z.number().int(),
  /** Building type id. */
  t: z.number().int().nonnegative(),
  /** Origin in yard units, x axis. */
  x: z.number().int(),
  /** Origin in yard units, y axis. */
  y: z.number().int(),
  /** Level at save time. Advisory: Apply never writes it. */
  l: z.number().int().nonnegative().optional(),
  /** Fortification tier at save time. Advisory: Apply never writes it. */
  fort: z.number().int().nonnegative().optional(),
});

export type LayoutNode = z.infer<typeof LayoutNodeSchema>;

/** The `data` payload of a PUT or an apply, once the JSON string is parsed. */
export const LayoutPayloadSchema = z.object({
  version: z.literal(LAYOUT_VERSION),
  /** The `ENL.q` the layout was designed for. */
  expansion: z.number().int().min(0).max(6),
  nodes: z.array(LayoutNodeSchema).max(LAYOUT_NODE_MAX),
});

export type LayoutPayload = z.infer<typeof LayoutPayloadSchema>;

/** A stored layout, as `GET /layouts` returns it. */
export interface Layout extends LayoutPayload {
  slot: number;
  name: string;
  /** Unix seconds of the last write to this slot. */
  updatedAt: number;
}

/**
 * `PUT /layouts/:slot` body.
 *
 * Both fields fall back to the empty string rather than failing the parse, so
 * that a missing or repeated form field is reported by
 * `services/yardplanner/validateLayout.ts` in words a player can act on instead
 * of as a raw schema error.
 */
export const SaveLayoutSchema = z.object({
  name: z.string().catch(""),
  data: z.string().catch(""),
});

/** `POST /apply` body. Same fallback as {@link SaveLayoutSchema}. */
export const ApplyLayoutSchema = z.object({
  data: z.string().catch(""),
});

/** `POST /deletetemplate` body, the legacy alias for `DELETE /layouts/:slot`. */
export const DeleteTemplateSchema = z.object({
  slotid: z.coerce.number().int().min(0).max(LAYOUT_SLOTS - 1),
});

/**
 * `POST /savetemplate` body, the Flash client's route.
 *
 * `data` is whatever the Flash planner stringified: an index-keyed object of
 * `{ x, y, id, type }` nodes (`BaseTemplate.exportData:27-35`). It is kept as
 * sent and converted to v2 on write.
 */
export const LegacySaveTemplateSchema = z.object({
  slotid: z.coerce.number().int().min(0).max(LAYOUT_SLOTS - 1),
  name: z.string().optional(),
  data: z.union([z.string(), z.record(z.string(), z.unknown())]),
});
