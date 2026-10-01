import { devConfig } from "../config/GameConfig.js";
import { User } from "../database/models/user.model.js";
import { getCurrentDateTime } from "../utils/getCurrentDateTime.js";
import { Reward } from "../enums/Rewards.js";
import { BaseType } from "../enums/Base.js";
import { infernoYardSandbox } from "../utils/sandbox/infernoYard.js";
import { overworldYardSandbox } from "../utils/sandbox/overworldYard.js";
import { STARTER_MONSTER } from "../services/yard/locker.js";
import { STARTER_RESOURCES, starterBuildingData } from "../services/yard/starterBase.js";

/**
 * Generates the default base data object for a new save.
 *
 * A main yard starts with the original's starter base: a level 1 Town Hall,
 * Twig Snapper (holding 200 twigs), Pebble Shiner and General Store, and
 * 1,600 twigs and 1,600 pebbles (`services/yard/starterBase.ts`, issue #154),
 * and the Pokey unlocked (`services/yard/locker.ts` `STARTER_MONSTER`, #218).
 * An account that ticked "Start with the test yard (dev)" at sign-up gets the
 * maxed sandbox yard instead, when the server has DEV_SANDBOX on (issue #217).
 *
 * @param {User} [user] - The user for whom the base data is being generated.
 * @returns {object} - The default base data object.
 */
export const getDefaultBaseData = (user: User, baseType: BaseType) => {
  // The sandbox test base, for an account that asked for it at sign-up while
  // DEV_SANDBOX is on (issue #217). Never in production: devSandbox is off there.
  if (baseType === BaseType.MAIN && devConfig.devSandbox && user.sandbox_start)
    return overworldYardSandbox(user);

  if (baseType === BaseType.INFERNO && devConfig.infernoSandbox)
    return infernoYardSandbox(user);

  const currentTime = getCurrentDateTime();
  const sevenDays = 7 * 24 * 60 * 60;
  const isMain = baseType === BaseType.MAIN;

  return {
    saveuserid: user.userid,
    userid: user.userid,
    name: user.username,
    credits: devConfig.shiny || 1000,
    createtime: currentTime,
    protected: currentTime + sevenDays,

    // Pre-populated Objects
    ...(isMain && { buildingdata: starterBuildingData() }),
    // The Pokey is always unlocked, as in Flash (issue #218).
    ...(isMain && { lockerdata: { [STARTER_MONSTER]: { t: 2 } } }),
    resources: {
      r1: isMain ? STARTER_RESOURCES.r1 : 0,
      r2: isMain ? STARTER_RESOURCES.r2 : 0,
      r3: 0,
      r4: 0,
      r1max: 10000,
      r2max: 10000,
      r3max: 10000,
      r4max: 10000,
    },
    iresources: {
      r1: 0,
      r2: 0,
      r3: 0,
      r4: 0,
      r1max: 10000,
      r2max: 10000,
      r3max: 10000,
      r4max: 10000,
    },
    krallen: null,
    rewards: devConfig.unlockAllEventRewards
      ? {
          // Default event rewards
          unblockSlimeattikus: { id: Reward.SLIMEATTIKUS },
          unblockVorg: { id: Reward.VORG },
          goldenDAVE: { id: Reward.GOLDEN_DAVE },
          improvedHCC: { id: Reward.IMPROVED_HCC },
          extraTiles: { id: Reward.EXTRA_TILES },
          yardPlannerExtraSlots: { id: Reward.YARD_PLANNER_EXTRA_SLOTS },
          daveStatue: { id: Reward.DAVE_STATUE }
        }
      : {},
  };
};
