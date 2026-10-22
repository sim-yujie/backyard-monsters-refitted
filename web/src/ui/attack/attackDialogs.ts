/** The Retreat question's class (`app/scenes/AttackScene.ts`). */
export const ATTACK_CONFIRM_CLASS = "attack-confirm";

/**
 * Whether the attack screen is asking or telling the player something: the
 * Retreat question, or an end panel ("Attack over" and the others on the
 * end backdrop, `EndAttackPanel.ts`). Bob's tips wait while one is up
 * (`game/yard/plugins/tips.ts`), so a tip never sits on top of it.
 */
export const isAttackDialogOpen = (): boolean =>
  document.querySelector(`.${ATTACK_CONFIRM_CLASS}, .attack-end__backdrop`) !== null;
