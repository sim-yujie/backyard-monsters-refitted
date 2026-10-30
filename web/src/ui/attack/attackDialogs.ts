import { gameIcon } from "@/ui/gameIcon";

/** The Retreat question's class (`app/scenes/AttackScene.ts`). */
export const ATTACK_CONFIRM_CLASS = "attack-confirm";

/**
 * The Retreat question (less-text job 8): "Retreat now?", "The attack ends
 * now.", the broken wall and "35% kept", then "Keep fighting" or "Retreat".
 * Flash asked nothing before a retreat (attack-flow Open Question 9), so there
 * is no Flash line to match.
 */
export const RETREAT_TITLE = "Retreat now?";
export const KEEP_FIGHTING = "Keep fighting";

/**
 * What a retreat means. `goingTo` names where a HUD switch asked to go, when
 * that is not the map (#152): the end screen comes first, and it leads to the
 * map. A warning before the choice, so it stays in words.
 */
export const retreatMessage = (goingTo?: string): string =>
  "The attack ends now." +
  (goingTo ? ` The end screen saves the result first, then leads to the map, not straight to ${goingTo}.` : "");

/** "35% kept": the damage the strip shows, which a retreat keeps, floored and never below 0. */
export const keptText = (damage: number): string => `${Math.max(0, Math.floor(damage))}% kept`;

/**
 * The question's second line: the broken wall ("Yard damage" to screen
 * readers) and {@link keptText}. The fight goes on behind the question, so the
 * scene rewrites `value` as the damage climbs (Inferno S3 browser check: it
 * said 28% while the strip said 37%).
 */
export const retreatKeptLine = (damage: number): { line: HTMLElement; value: HTMLElement } => {
  const line = document.createElement("span");
  line.className = "attack-confirm__kept";
  const value = document.createElement("span");
  value.className = "attack-confirm__kept-value";
  value.textContent = keptText(damage);
  line.append(gameIcon("yarddamage2", { size: 24, label: "Yard damage" }), value);
  return { line, value };
};

/**
 * Whether the attack screen is asking or telling the player something: the
 * Retreat question, or an end panel ("Attack over" and the others on the
 * end backdrop, `EndAttackPanel.ts`). Bob's tips wait while one is up
 * (`game/yard/plugins/tips.ts`), so a tip never sits on top of it.
 */
export const isAttackDialogOpen = (): boolean =>
  document.querySelector(`.${ATTACK_CONFIRM_CLASS}, .attack-end__backdrop`) !== null;
