/** The Retreat question's class (`app/scenes/AttackScene.ts`). */
export const ATTACK_CONFIRM_CLASS = "attack-confirm";

/**
 * The Retreat question's second line: the damage the strip shows, which a
 * retreat keeps. The fight goes on behind the question, so the scene tells
 * it again as the damage climbs (Inferno S3 browser check: it said 28% while
 * the strip said 37%). Flash asked nothing before a retreat (attack-flow
 * Open Question 9), so there is no Flash line to match. `goingTo` names where
 * a HUD switch asked to go, when that is not the map (#152).
 */
export const retreatNote = (damage: number, goingTo?: string): string =>
  `${Math.max(0, Math.floor(damage))}% damage dealt so far will be kept.` +
  (goingTo ? ` The result is saved on the end screen first, which leads back to the map, not straight to ${goingTo}.` : "");

/**
 * Whether the attack screen is asking or telling the player something: the
 * Retreat question, or an end panel ("Attack over" and the others on the
 * end backdrop, `EndAttackPanel.ts`). Bob's tips wait while one is up
 * (`game/yard/plugins/tips.ts`), so a tip never sits on top of it.
 */
export const isAttackDialogOpen = (): boolean =>
  document.querySelector(`.${ATTACK_CONFIRM_CLASS}, .attack-end__backdrop`) !== null;
