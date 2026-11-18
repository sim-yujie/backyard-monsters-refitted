import { loadOwnYard } from "@/api/base";
import { SceneName } from "@/app/sceneName";
import { mainYardRoster } from "./attackEntry";
import { setAttackTarget } from "./attackTarget";
import { ownYardTarget } from "./ownYardTarget";

/**
 * The layout check's way onto the attack screen (web/e2e/layout,
 * attackDock.ts; owner, 18 Nov 2026): the check's sandbox yard has no Map
 * Room, so no real target is in reach. This opens the real attack scene, with
 * every package a real attack mounts, on the player's own yard, fought on the
 * client as a Baiter test is (`ownYardTarget`): the attack load asks the
 * server for nothing, and nothing is sent unless a fling is. The roster is the
 * main yard's own, with a Catapult and one Decoy added when the yard has
 * none, so the dock shows all three tabs.
 *
 * Installed as `window.__attackDock` in a dev build or one built with
 * VITE_LAYOUT_CHECK=1 (main.ts), never in a release build.
 */
export const previewAttackDock = async (goTo: (scene: string) => void): Promise<boolean> => {
  const save = await loadOwnYard();
  const roster = mainYardRoster(save, 4);
  setAttackTarget(
    ownYardTarget(save, {
      ...roster,
      catapultLevel: Math.max(1, roster.catapultLevel),
      siege: roster.siege ?? { decoy: { level: 1, quantity: 1 } },
    }),
  );
  goTo(SceneName.ATTACK);
  return true;
};
