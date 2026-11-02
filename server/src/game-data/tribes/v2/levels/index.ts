import type { SaveData } from "../../../../types/EntityData.js";
import { abunakiLevels } from "./abunaki.js";
import { dreadnaughtLevels } from "./dreadnaught.js";
import { kozuLevels } from "./kozu.js";
import { legionnaireLevels } from "./legionnaire.js";

/** Every tribe's editor-saved camp yards, by tribe id and level (`services/maproom/v2/tribeLayouts.ts`). */
export const savedTribeLevels: Readonly<Record<string, Record<number, SaveData>>> = {
  legionnaire: legionnaireLevels,
  kozu: kozuLevels,
  abunaki: abunakiLevels,
  dreadnaught: dreadnaughtLevels,
};
