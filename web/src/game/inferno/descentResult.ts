import type { DescentLanding } from "@/api/inferno";
import {
  descentBattleReport,
  descentCapture,
  descentDialogue,
} from "@/ui/inferno/DescentScreens";
import type { Popup } from "@/ui/Popup";
import {
  DESCENT_GLOATS,
  DESCENT_WHIMPERS,
  MOLOCH_GLOAT,
  MOLOCH_WHIMPER,
  lineFor,
} from "./descentText";

/**
 * Moloch's word after a Descent attack (`INFERNO_DESCENT_POPUPS.ShowPostAttackPopup`),
 * over the attack's end panel, once the server has landed it (WP 1.12): a
 * yard beaten, his whimper, the battle report and, after the 13th, the
 * capture; an attack lost, his gloat. `yard` is the yard fought, 1-13, which
 * picks his lines. Returns the way to take whatever is still open down.
 */
export const playDescentResult = (
  modal: HTMLElement,
  yard: number,
  landing: DescentLanding,
  startBuilding: () => void,
): (() => void) => {
  let open: Popup | null = null;
  let stopped = false;
  const next = (show: (done: () => void) => Popup): Promise<void> =>
    new Promise((resolve) => {
      if (stopped) return;
      open = show(() => {
        open = null;
        resolve();
      });
    });

  const play = async (): Promise<void> => {
    if (!landing.won) {
      await next((done) => descentDialogue(modal, MOLOCH_GLOAT, lineFor(DESCENT_GLOATS, yard), done));
      return;
    }
    await next((done) => descentDialogue(modal, MOLOCH_WHIMPER, lineFor(DESCENT_WHIMPERS, yard), done));
    await next((done) => descentBattleReport(modal, landing.loot, landing.total, done));
    // Flash: the 13th win (`_descentLvlMax - 1`); the server says so.
    if (landing.captured && !stopped) open = descentCapture(modal, startBuilding);
  };
  void play();

  return () => {
    stopped = true;
    (open as Popup | null)?.close();
    open = null;
  };
};
