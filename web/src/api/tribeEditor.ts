import { ApiError, get, postJson } from "./http";
import type { ApiEnvelope, BaseLoadResponse, BuildingDataMap } from "./types";

/**
 * The tribe yard editor's routes (LOCAL servers only; the server registers
 * them only with `TRIBE_EDITOR=on`, `ENV=local` and no production `NODE_ENV`,
 * `server/src/controllers/tribeEditor/tribeEditor.ts`). Anywhere else they
 * answer 404, which {@link tribeEditorStatus} reads as "off".
 *
 *   GET  /api/:apiVersion/dev/tribe-editor/status
 *   GET  /api/:apiVersion/dev/tribe-editor/yard   tribe, level
 *   POST /api/:apiVersion/dev/tribe-editor/save   tribe, level, buildingdata, …
 */

const PREFIX = "/api/:apiVersion/dev/tribe-editor";

/** The four Map Room 2 tribes, by the id the server's data files use. */
export type TribeId = "legionnaire" | "kozu" | "abunaki" | "dreadnaught";

export interface EditorTribe {
  id: TribeId;
  /** "Legionnaire", "Kozu", "Abunakki", "Dreadnaut". */
  name: string;
  /** The levels its camps can have. */
  levels: number[];
  /** Where the original layouts stand. */
  originals: number[];
  /** Levels with a yard the editor saved. */
  saved: number[];
}

export interface TribeEditorStatus extends ApiEnvelope {
  enabled: true;
  tribes: EditorTribe[];
}

export interface TribeYardResponse extends ApiEnvelope {
  tribe: TribeId;
  level: number;
  /** The level the yard it opens with stands at: `level`, or the nearest below. */
  from: number;
  /** Whether that yard was saved by the editor (false for an original layout). */
  saved: boolean;
  yard: BaseLoadResponse;
}

export interface TribeSaveBody {
  tribe: TribeId;
  level: number;
  buildingdata: BuildingDataMap;
  academy?: Record<string, unknown>;
  monsters?: Record<string, unknown>;
  lockerdata?: Record<string, unknown>;
}

export interface TribeSaveResponse extends TribeEditorStatus {
  tribe: TribeId;
  level: number;
  /** The data file written, relative to the server folder. */
  file: string;
  buildings: number;
}

/** The editor's status, or null when this server has it off (or does not know it). */
export const tribeEditorStatus = async (): Promise<TribeEditorStatus | null> => {
  try {
    const status = await get<TribeEditorStatus>(`${PREFIX}/status`);
    return status.enabled === true ? status : null;
  } catch (caught) {
    if (caught instanceof ApiError) return null;
    throw caught;
  }
};

/** The yard a camp of this tribe and level uses now. */
export const loadTribeYard = (tribe: TribeId, level: number): Promise<TribeYardResponse> =>
  get<TribeYardResponse>(`${PREFIX}/yard`, { tribe, level });

/** "Save as <Tribe> level <N>". */
export const saveTribeYard = (body: TribeSaveBody): Promise<TribeSaveResponse> =>
  postJson<TribeSaveResponse>(`${PREFIX}/save`, { ...body });
