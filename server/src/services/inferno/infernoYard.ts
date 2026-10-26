import type { EntityManager } from "@mikro-orm/core";
import type { SqlEntityManager } from "@mikro-orm/postgresql";

import { devConfig } from "../../config/GameConfig.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { syncInfernoCap } from "./infernoLoad.js";

/**
 * The player's Inferno yard, made by the server when the 13th Descent yard
 * falls (`docs/design/inferno.md` §3.1, WP 1.12).
 */

/** One building of the start layout: type, footprint origin and level. */
interface StartBuilding {
  t: number;
  X: number;
  Y: number;
  l: number;
}

/**
 * The layout an empty Inferno yard gets (`client/scripts/BASE.as:1616-1656`):
 * an Under Hall, a Bone and a Coal harvester at level 1 and two level 3 silos.
 * Flash placed them when the yard first loaded with no buildings, with 0
 * points; the server writes them when it makes the yard.
 */
export const INFERNO_START_BUILDINGS: readonly StartBuilding[] = [
  // Under Hall.
  { t: 14, X: -100, Y: 0, l: 1 },
  // Bone harvester.
  { t: 1, X: 60, Y: 0, l: 1 },
  // Coal harvester.
  { t: 2, X: 60, Y: 70, l: 1 },
  // Silos.
  { t: 6, X: 130, Y: 0, l: 3 },
  { t: 6, X: 130, Y: 80, l: 3 },
];

/** The start layout as `buildingdata`, ids 1 to 5. */
export const infernoStartBuildingData = (): BuildingDataMap =>
  Object.fromEntries(
    INFERNO_START_BUILDINGS.map((start, index) => {
      const id = index + 1;
      return [String(id), { id, ...start } as unknown as BuildingData];
    })
  );

const NEXT_USER_BASEID = `SELECT nextval('bym.user_baseid_seq') AS baseid`;

/**
 * Makes the player's Inferno yard with the start layout and hands it to the
 * caller to flush. Its purse stays the main save's `iresources`, which holds
 * what the Descent looted (`descent.ts`); the yard's own pool is left empty.
 * The dev Inferno sandbox (`INFERNO_SANDBOX`) keeps its own yard.
 *
 * @param main - The player's main save; its `baseid_inferno` names the new yard.
 */
export const createInfernoYard = async (em: EntityManager, user: User, main: Save): Promise<Save> => {
  const data = getDefaultBaseData(user, BaseType.INFERNO);
  const yard = em.create(Save, {
    ...data,
    ...(!devConfig.infernoSandbox && { buildingdata: infernoStartBuildingData() }),
  } as never);

  const [result] = await (em as SqlEntityManager).execute<[{ baseid: string }]>(NEXT_USER_BASEID);
  const baseid = String(result.baseid);

  yard.type = BaseType.INFERNO;
  yard.baseid = baseid;
  yard.homebaseid = parseInt(baseid, 10);
  yard.worldid = main.worldid;
  yard.credits = 0;
  main.baseid_inferno = parseInt(baseid, 10);
  // The main yard's Inferno caps: 70,000 with the two start pods.
  syncInfernoCap(main, yard);
  user.infernosave = yard;

  em.persist(yard);
  em.persist(main);
  em.persist(user);
  return yard;
};
