import type { BaseLoadResponse } from "@/api/types";
import { defenderForcesOf } from "@/game/combat/rules";
import type { AttackRoster, AttackTarget } from "./attackTarget";

/**
 * An attack on the player's own yard, fought on the client (issue #22,
 * `docs/design/baiter-simulator.md` §5.1, §8): the Monster Baiter's tests
 * today, and whatever the wild raids (#226) stage on the client later.
 *
 * The own yard is the defender, handed over already loaded so the attack
 * scene asks the server for nothing, and `roster` is whatever attacks it. The
 * yard defends itself as it would against a real attack (issue #195, Q16):
 * its bunkers' garrisons at its own academy levels, and its caged champion.
 *
 * The load's `attackerbrains` is dropped: it is what the server freezes into
 * a real attack for the attacker's champions (issue #219), and the own yard's
 * load is never that, so a champion in `roster` fights with a fresh brain
 * (Baiter owner answer Q6).
 */
export const ownYardTarget = (save: BaseLoadResponse, roster: AttackRoster): AttackTarget => {
  const load: BaseLoadResponse = { ...save };
  delete load.attackerbrains;
  return {
    baseid: String(save.baseid ?? ""),
    kind: "wild",
    name: "Wild monsters",
    load: {
      ...load,
      defenderforces: defenderForcesOf({
        buildingdata: save.buildingdata,
        academy: save.academy,
        champion: save.champion,
      }),
    },
    roster,
  };
};
