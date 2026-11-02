import type { SaveData } from "../../../../types/EntityData.js";

/**
 * abunaki camp yards saved by the tribe yard editor, by level (written by
 * `controllers/tribeEditor/tribeEditor.ts`; see `services/maproom/v2/tribeLayouts.ts`).
 * A level listed here replaces the yard camps of exactly that level use; a level
 * not listed uses the nearest yard below it.
 */
export const abunakiLevels: Record<number, SaveData> = {};
