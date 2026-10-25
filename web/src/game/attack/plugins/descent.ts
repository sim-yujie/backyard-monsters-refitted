import { ATTACK_PLUGINS, type AttackPlugin } from "@/game/attack/attackPlugins";
import { DESCENT_TAUNTS, MOLOCH_NEUTRAL, lineFor } from "@/game/inferno/descentText";
import { descentDialogue } from "@/ui/inferno/DescentScreens";

/**
 * Moloch's taunt as a Descent yard opens for the attack (Inferno WP 1.13):
 * Flash showed it when a base loaded for the attack while in the Descent
 * (`BASE.as:2146-2148`, `INFERNO_DESCENT_POPUPS.ShowTauntDialog`, the
 * counter being the yard fought). His word after the fight is the end
 * package's, once the server has landed it.
 */
export const descentPlugin: AttackPlugin = ({ target, modal }) => {
  const yard = target.descentYard;
  if (yard === undefined) return;
  const taunt = descentDialogue(modal, MOLOCH_NEUTRAL, lineFor(DESCENT_TAUNTS, yard));
  return () => taunt.close();
};

ATTACK_PLUGINS.push(descentPlugin);
