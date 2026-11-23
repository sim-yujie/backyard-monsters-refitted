import { loadOwnYard } from "@/api/base";
import { SceneName } from "@/app/sceneName";
import { setBaiterRun, TEST_ROSTER } from "@/game/baiter/baiterSession";
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
 * `"baiter"` opens the Baiter's test scene instead, on the same yard with a
 * made-up army of eight kinds: its test line sits above the army panel.
 *
 * Installed as `window.__attackDock` in a dev build or one built with
 * VITE_LAYOUT_CHECK=1 (main.ts), never in a release build.
 */
export const previewAttackDock = async (
  goTo: (scene: string) => void,
  kind: "attack" | "baiter" = "attack",
): Promise<boolean> => {
  const save = await loadOwnYard();
  if (kind === "baiter") {
    // A Baiter test of the own yard (beta 9 play-test, 23 Nov 2026): the
    // test's line above an army of eight kinds, one row each.
    const monsters = Object.fromEntries(TEST_ROSTER.slice(0, 8).map((id) => [id, { count: 5, level: 1 }]));
    setBaiterRun({ save, army: { monsters, champions: [] }, baiterLevel: 1 });
    goTo(SceneName.BAITER);
    return true;
  }
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
