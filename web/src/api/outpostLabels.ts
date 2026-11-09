import { get, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Outpost names and pins (beta 7, server `controllers/outposts/labelRoutes.ts`):
 *
 *   GET  /api/:apiVersion/bm/outposts/labels   { labels }
 *   POST /api/:apiVersion/bm/outposts/name     { baseid, name } → { labels }: "" clears the name
 *   POST /api/:apiVersion/bm/outposts/pin      { baseid, pin }  → { labels }
 *
 * Every answer is the player's whole set. A refusal comes back as an
 * ApiError whose message is the server's own short words ("You can pin up to
 * 20 outposts."), shown as it is.
 */

/** The server's limits (`services/outposts/outpostLabelRules.ts`). */
export const OUTPOST_NAME_MAX = 24;
export const OUTPOST_PINS_MAX = 20;

/** The player's names and pins. */
export interface OutpostLabels {
  /** `baseid` → name, only for outposts that have one. */
  readonly names: Readonly<Record<string, string>>;
  /** Pinned `baseid`s, in the order they were pinned. */
  readonly pins: readonly string[];
}

export const NO_OUTPOST_LABELS: OutpostLabels = { names: {}, pins: [] };

/** The labels as the server sent them, anything malformed dropped. */
export const readOutpostLabels = (raw: unknown): OutpostLabels => {
  if (!raw || typeof raw !== "object") return NO_OUTPOST_LABELS;
  const { names, pins } = raw as { names?: unknown; pins?: unknown };
  const cleanNames: Record<string, string> = {};
  if (names && typeof names === "object") {
    for (const [baseid, name] of Object.entries(names as Record<string, unknown>)) {
      if (typeof name === "string" && name !== "") cleanNames[baseid] = name;
    }
  }
  const cleanPins = Array.isArray(pins)
    ? [
        ...new Set(
          pins
            .filter(
              (one): one is string | number =>
                typeof one === "string" || typeof one === "number",
            )
            .map(String),
        ),
      ]
    : [];
  return { names: cleanNames, pins: cleanPins };
};

type LabelsAnswer = ApiEnvelope & { labels?: unknown };

export const fetchOutpostLabels = async (): Promise<OutpostLabels> =>
  readOutpostLabels((await get<LabelsAnswer>("/api/:apiVersion/bm/outposts/labels")).labels);

/** Names one of the player's outposts; "" puts it back to its coordinates. */
export const renameOutpost = async (baseid: string, name: string): Promise<OutpostLabels> =>
  readOutpostLabels(
    (await postJson<LabelsAnswer>("/api/:apiVersion/bm/outposts/name", { baseid, name }))
      .labels,
  );

/** Pins or unpins one of the player's outposts. */
export const pinOutpost = async (baseid: string, pin: boolean): Promise<OutpostLabels> =>
  readOutpostLabels(
    (await postJson<LabelsAnswer>("/api/:apiVersion/bm/outposts/pin", { baseid, pin })).labels,
  );
