import type { Context } from "koa";
import { SaveKeys } from "../../../../enums/SaveKeys.js";
import { Save } from "../../../../database/models/save.model.js";
import { MONSTER_CATALOGUE, maxTrainingLevel } from "../../../../game-data/monsterCatalogue.js";
import { ClientSafeError } from "../../../../middleware/clientSafeError.js";
import { Status } from "../../../../enums/StatusCodes.js";

interface AcademyRequestBody {
  [SaveKeys.ACADEMY]?: string;
}

interface AcademyData {
  [monster: string]: {
    level?: number;
  };
}

/**
 * The highest academy level any monster reaches (6), for the ids the monster
 * catalogue does not hold (the Inferno's `IC…`).
 */
const HIGHEST_LEVEL = Math.max(...MONSTER_CATALOGUE.map((entry) => maxTrainingLevel(entry.id)));

/**
 * The highest level `monster` can be trained to: the catalogue's
 * `trainingCosts.length + 1` (5 for C15, 6 for the rest), else
 * {@link HIGHEST_LEVEL}.
 */
const levelCap = (monster: string): number => maxTrainingLevel(monster) || HIGHEST_LEVEL;

export const academyHandler = (ctx: Context, save: Save) => {
  const body = ctx.request.body as AcademyRequestBody;
  const saveData = body[SaveKeys.ACADEMY];

  if (saveData) {
    let academyData: AcademyData;
    try {
      academyData = JSON.parse(saveData);
    } catch {
      // Same shape as a schema field failing validation (issue #224): a 400
      // naming the field, not a 500 from the uncaught `JSON.parse` throw.
      throw new ClientSafeError({
        message: "Invalid request: academy: must be valid JSON",
        status: Status.BAD_REQUEST,
        data: { reason: "invalidRequest", field: "academy" },
        isClientFriendly: true,
      });
    }

    for (const [monster, monsterData] of Object.entries(academyData)) {
      if (monsterData && typeof monsterData.level === "number") {
        academyData[monster].level = Math.min(monsterData.level, levelCap(monster));
      }
    }

    save.academy = academyData;
  }
};
